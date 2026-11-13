#!/usr/bin/env node
// Check the real experiment data, including independently generated tile edges.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {cutGutterTiles} from './gutter-fixture.mjs';

const [root,out]=process.argv.slice(2);if(!root||!out)throw Error('Expected fixture directory and new report file');
const manifest=JSON.parse(await readFile(join(root,'gutter-report.json'),'utf8'));
if(manifest.schema!=='pando-terrain-gutter-fixture-v1'||(!manifest.block2&&!manifest.coverage5x3&&!manifest.coverage5x4&&!manifest.regionalExtended))throw Error('Expected a regional multi-block fixture');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),results=[];
for(const region of [...new Set(manifest.records.map(record=>record.region))]){
  const records=manifest.records.filter(record=>record.region===region),blocks=[];let subtiles=0,boundaries=0;
  const base=records.filter(item=>item.tileSize===1024),xs=base.map(item=>item.window[0]),ys=base.map(item=>item.window[1]);
  const columns=(Math.max(...xs)-Math.min(...xs))/1024+1,rows=(Math.max(...ys)-Math.min(...ys))/1024+1;
  if(![[2,2],[5,3],[5,4],[5,5],[6,4]].some(([w,h])=>w===columns&&h===rows))throw Error('Unsupported region dimensions');
  const expectedBlocks=columns*rows,expectedBoundaries=(columns-1)*rows+(rows-1)*columns;
  for(const record of records.filter(item=>item.tileSize===1024)){
    const bytes=gunzipSync(await readFile(join(root,record.file)));
    if(sha(bytes)!==record.rawSha256)throw Error('Base tile hash mismatch');
    blocks.push({record,bytes});
    for(const tile of cutGutterTiles(bytes,1024,512)){
      const selected=records.find(item=>item.tileSize===512&&item.window.join()===record.window.join()&&item.offset.join()===[tile.x,tile.y].join());
      if(!selected)throw Error('Missing subtile');
      const actual=gunzipSync(await readFile(join(root,selected.file)));
      if(sha(actual)!==selected.rawSha256||!actual.equals(tile.rgba))throw Error('Subtile mismatch');
      subtiles++;
    }
  }
  if(blocks.length!==expectedBlocks||subtiles!==expectedBlocks*4)throw Error('Incomplete region');
  for(const a of blocks)for(const b of blocks){
    const [ax,ay]=a.record.window,[bx,by]=b.record.window;
    if(ay===by&&bx===ax+1024){
      for(let y=0;y<1026;y++)if(!a.bytes.subarray((y*1026+1024)*4,(y*1026+1026)*4)
        .equals(b.bytes.subarray(y*1026*4,(y*1026+2)*4)))throw Error('Vertical shared gutter mismatch');
      boundaries++;
    }
    if(ax===bx&&by===ay+1024){
      if(!a.bytes.subarray(1024*1026*4).equals(b.bytes.subarray(0,2*1026*4)))throw Error('Horizontal shared gutter mismatch');
      boundaries++;
    }
  }
  if(boundaries!==expectedBoundaries)throw Error('Missing shared boundaries');
  results.push({region,baseTiles:blocks.length,subtiles,sharedBoundaries:boundaries,exact:true});
}
await writeFile(out,JSON.stringify({schema:'pando-gutter-fixture-verification-v1',sourceSha256:manifest.sourceSha256,results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({regions:results.length,results}));
