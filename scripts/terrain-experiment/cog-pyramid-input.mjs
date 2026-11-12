#!/usr/bin/env node
// Bounded COG pyramid; every level is read separately from Float32 original.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,realpath,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createNativeDemWindowReader,inspectNativeDemSource} from '../../tools/gis/terrain-dem-raster.mjs';
import {quantizeSample,SOURCE_SHA256} from './sample-quality.mjs';

const [sourceArg,fixtureArg,outArg,region='southwest-china']=process.argv.slice(2);
if(!sourceArg||!fixtureArg||!outArg)throw Error('Expected source, regional fixture manifest and new output directory');
const source=await realpath(sourceArg),before=await stat(source),digest=createHash('sha256');
if(before.size!==1585813987)throw Error('Source length mismatch');
for await(const chunk of createReadStream(source))digest.update(chunk);
if(digest.digest('hex')!==SOURCE_SHA256)throw Error('Source SHA-256 mismatch');
const metadata=await inspectNativeDemSource({source,strict:true});if(metadata.dtype!=='float32')throw Error('Float32 source required');
const fixture=JSON.parse(await readFile(fixtureArg,'utf8'));
if(fixture.sourceSha256!==SOURCE_SHA256||fixture.block2!==true)throw Error('Expected matching 2x2 fixture');
const blocks=fixture.records.filter(record=>record.tileSize===1024&&record.region===region);
if(blocks.length!==4)throw Error('Four base tiles required');
const minX=Math.min(...blocks.map(record=>record.window[0])),minY=Math.min(...blocks.map(record=>record.window[1]));
// Four original cells on each side give each overview an aligned source grid.
const x0=minX-4,y0=minY-4,side=2056;
if(x0%4||y0%4||side%4)throw Error('Pyramid extent must be aligned at every level');
const out=resolve(outArg);await mkdir(out,{recursive:false});const records=[];
for(const level of [5,4,3]){
  const factor=2**(5-level),width=1350*2**level,height=675*2**level;
  const x=x0/factor,y=y0/factor,size=side/factor;
  const reader=await createNativeDemWindowReader({source,width,height,strict:true});
  try{
    const raw=await reader.read([x-1,y-1,x+size+1,y+size+1]),values=new Float32Array(raw.length/4);
    for(let i=0;i<values.length;i++)values[i]=raw.readFloatLE(i*4);
    const {rgba,stats}=quantizeSample(values,size,size,{north:y-1,levelWidth:width,levelHeight:height},'Q1');
    const file=`lod${level}.rgba.gz`,compressed=gzipSync(rgba,{level:9,mtime:0});
    await writeFile(join(out,file),compressed,{flag:'wx'});
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    records.push({level,width:size,height:size,window:[x,y,x+size,y+size],file,
      rawBytes:rgba.length,rawSha256:hash(rgba),gzipBytes:compressed.length,gzipSha256:hash(compressed),...stats});
  }finally{await reader.close();}
}
const after=await stat(source);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Source changed during sampling');
const report={schema:'pando-terrain-cog-pyramid-input-v1',sourceSha256:SOURCE_SHA256,region,baseOrigin:[x0,y0],records};
await writeFile(join(out,'pyramid-input.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({levels:records.length,baseOrigin:report.baseOrigin}));
