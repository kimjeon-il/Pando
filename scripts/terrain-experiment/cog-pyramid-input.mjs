#!/usr/bin/env node
// Bounded COG pyramid; every level is read separately from Float32 original.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,realpath,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createNativeDemWindowReader,inspectNativeDemSource} from '../../tools/gis/terrain-dem-raster.mjs';
import {quantizeSample,SOURCE_SHA256} from './sample-quality.mjs';
import {readDemWindowTiled} from './dem-window.mjs';

const [sourceArg,fixtureArg,outArg,region='southwest-china']=process.argv.slice(2);
if(!sourceArg||!fixtureArg||!outArg)throw Error('Expected source, regional fixture manifest and new output directory');
const source=await realpath(sourceArg),before=await stat(source),digest=createHash('sha256');
if(before.size!==1585813987)throw Error('Source length mismatch');
for await(const chunk of createReadStream(source))digest.update(chunk);
if(digest.digest('hex')!==SOURCE_SHA256)throw Error('Source SHA-256 mismatch');
const metadata=await inspectNativeDemSource({source,strict:true});if(metadata.dtype!=='float32')throw Error('Float32 source required');
const fixture=JSON.parse(await readFile(fixtureArg,'utf8'));
if(fixture.sourceSha256!==SOURCE_SHA256||(!fixture.block2&&!fixture.coverage5x3))throw Error('Expected matching regional fixture');
const blocks=fixture.records.filter(record=>record.tileSize===1024&&record.region===region);
if(blocks.length!==(fixture.coverage5x3?15:4))throw Error('Incomplete base tile inventory');
const minX=Math.min(...blocks.map(record=>record.window[0])),minY=Math.min(...blocks.map(record=>record.window[1]));
// Four original cells on each side give each overview an aligned source grid.
const x0=minX-4,y0=minY-4,baseWidth=(fixture.coverage5x3?5120:2048)+8,baseHeight=(fixture.coverage5x3?3072:2048)+8;
if(x0%4||y0%4||baseWidth%4||baseHeight%4)throw Error('Pyramid extent must be aligned at every level');
const out=resolve(outArg);await mkdir(out,{recursive:false});const records=[];
for(const level of [5,4,3]){
  const factor=2**(5-level),width=1350*2**level,height=675*2**level;
  const x=x0/factor,y=y0/factor,pixelWidth=baseWidth/factor,pixelHeight=baseHeight/factor;
  const reader=await createNativeDemWindowReader({source,width,height,strict:true});
  try{
    const raw=await readDemWindowTiled(reader,[x-1,y-1,x+pixelWidth+1,y+pixelHeight+1]),values=new Float32Array(raw.length/4);
    for(let i=0;i<values.length;i++)values[i]=raw.readFloatLE(i*4);
    const {rgba,stats}=quantizeSample(values,pixelWidth,pixelHeight,{north:y-1,levelWidth:width,levelHeight:height},'Q1');
    const file=`lod${level}.rgba.gz`,compressed=gzipSync(rgba,{level:9,mtime:0});
    await writeFile(join(out,file),compressed,{flag:'wx'});
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    records.push({level,width:pixelWidth,height:pixelHeight,window:[x,y,x+pixelWidth,y+pixelHeight],file,
      rawBytes:rgba.length,rawSha256:hash(rgba),gzipBytes:compressed.length,gzipSha256:hash(compressed),...stats});
  }finally{await reader.close();}
}
const after=await stat(source);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Source changed during sampling');
const report={schema:'pando-terrain-cog-pyramid-input-v1',sourceSha256:SOURCE_SHA256,region,baseOrigin:[x0,y0],records};
await writeFile(join(out,'pyramid-input.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({levels:records.length,baseOrigin:report.baseOrigin}));
