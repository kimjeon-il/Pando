#!/usr/bin/env node
// Representative, immutable source windows only; this never generates the world.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createNativeDemWindowReader, inspectNativeDemSource } from '../../tools/gis/terrain-dem-raster.mjs';
import { quantizeHeight, quantizationStep, roundHalfEven } from './quality.mjs';

export const SOURCE_SHA256='8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2';
export const SAMPLE_REGIONS=Object.freeze([
  {id:'thai-lowland',lon:100,lat:15},{id:'southwest-china',lon:102,lat:28},
  {id:'himalaya',lon:86,lat:28},{id:'andes',lon:-73,lat:-13},
  {id:'pacific-ocean',lon:-150,lat:0},{id:'netherlands-coast',lon:4,lat:53},
  {id:'date-line',lon:179.8,lat:0},{id:'arctic',lon:0,lat:85},
]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function hashFile(path) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(path))digest.update(chunk);
  return digest.digest('hex');
}

// Illumination is computed from the same, unquantized Float32 window for all Q policies.
export function originalShade(window,width,x,y,{north,levelWidth,levelHeight}) {
  const index=y*width+x,pi=Math.PI,radius=6371008.8;
  const latitude=Math.max(-89.95,Math.min(89.95,90-(north+y+0.5)*180/levelHeight));
  const metersNorth=pi*radius/levelHeight,metersEast=2*pi*radius*Math.cos(latitude*pi/180)/levelWidth;
  const east=Math.fround(window[index+1]-window[index-1]);
  const northDelta=Math.fround(window[index-width]-window[index+width]);
  const dzEast=east/(2*metersEast),dzNorth=Math.fround(northDelta/Math.fround(2*metersNorth));
  const azimuth=315*pi/180,altitude=45*pi/180;
  const lx=Math.sin(azimuth)*Math.cos(altitude),ly=Math.cos(azimuth)*Math.cos(altitude),lz=Math.sin(altitude);
  const normal=Math.sqrt(dzEast*dzEast+Math.fround(dzNorth*dzNorth)+1);
  const diffuse=Math.max(0,(-dzEast*lx-Math.fround(dzNorth*Math.fround(ly))+lz)/normal);
  return Math.max(0,Math.min(255,roundHalfEven(Math.max(0,Math.min(1,0.42+0.58*diffuse))*255)));
}

export function quantizeSample(floats,width,height,level,policy) {
  if (!(floats instanceof Float32Array)||floats.length!==(width+2)*(height+2))throw Error('A one-pixel Float32 halo is required');
  const stride=width+2,rgba=Buffer.allocUnsafe(width*height*4),shade=Buffer.allocUnsafe(width*height);
  let sumSquares=0,sumAbs=0,maxError=0,min=Infinity,max=-Infinity;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const source=floats[(y+1)*stride+x+1];
    if(!Number.isFinite(source)||source< -12000||source>32767)throw Error('NoData or out-of-range Float32 sample');
    const q=quantizeHeight(source,policy),error=Math.abs(q-source),limit=quantizationStep(source,policy)/2;
    if(error>limit+1e-6||q< -12000||q>32767)throw Error('Quantization exceeded its documented error or Int16 range');
    const pixel=y*width+x,offset=pixel*4,packed=q+12000;
    const illumination=originalShade(floats,stride,x+1,y+1,level);
    rgba[offset]=packed>>8;rgba[offset+1]=packed&255;rgba[offset+2]=illumination;rgba[offset+3]=255;shade[pixel]=illumination;
    sumSquares+=error*error;sumAbs+=error;maxError=Math.max(maxError,error);min=Math.min(min,source);max=Math.max(max,source);
  }
  const count=width*height;
  return {rgba,shade,stats:{count,minMeters:min,maxMeters:max,maxErrorMeters:maxError,
    meanAbsErrorMeters:sumAbs/count,rmseMeters:Math.sqrt(sumSquares/count),shadeSha256:sha(shade)}};
}

export async function runSamples({source,out,size=256,regions=SAMPLE_REGIONS.map(region=>region.id),policies=['Q1','Q2','Q3'],levelIds=[2,5]}) {
  if(!Number.isSafeInteger(size)||size<16||size>1024)throw Error('Sample side must be 16..1024');
  if(!regions.length||regions.some(id=>!SAMPLE_REGIONS.some(region=>region.id===id))||new Set(regions).size!==regions.length)throw Error('Invalid sample regions');
  if(!policies.length||policies.some(id=>!['Q1','Q2','Q3'].includes(id))||new Set(policies).size!==policies.length)throw Error('Invalid policies');
  if(!levelIds.length||levelIds.some(id=>![2,5].includes(id))||new Set(levelIds).size!==levelIds.length)throw Error('Invalid sample levels');
  source=await realpath(source);out=resolve(out);
  const before=await stat(source);
  if(before.size!==1585813987)throw Error('Source length mismatch');
  const sourceSha256=await hashFile(source);
  if(sourceSha256!==SOURCE_SHA256)throw Error('Source SHA-256 mismatch');
  const metadata=await inspectNativeDemSource({source,strict:true});
  if(metadata.dtype!=='float32')throw Error('Float32 source required');
  await mkdir(out,{recursive:false});
  const records=[],levels=[{id:2,width:5400,height:2700},{id:5,width:43200,height:21600}].filter(level=>levelIds.includes(level.id));
  for(const level of levels){
    const reader=await createNativeDemWindowReader({source,width:level.width,height:level.height,strict:true});
    try{for(const region of SAMPLE_REGIONS.filter(item=>regions.includes(item.id))){
      const x=Math.floor((region.lon+180)*level.width/360)-Math.floor(size/2);
      const y=Math.floor((90-region.lat)*level.height/180)-Math.floor(size/2);
      const halo=await reader.read([x-1,y-1,x+size+1,y+size+1]);
      const raw=new Float32Array(halo.length/4);for(let i=0;i<raw.length;i++)raw[i]=halo.readFloatLE(i*4);
      for(const policy of policies){
        const {rgba,stats}=quantizeSample(raw,size,size,{north:y-1,levelWidth:level.width,levelHeight:level.height},policy);
        const encoded=gzipSync(rgba,{level:9,mtime:0}),name=`${region.id}-lod${level.id}-${policy}.rgba.gz`;
        await writeFile(join(out,name),encoded,{flag:'wx'});
        records.push({region,level:level.id,width:size,height:size,window:[x,y,x+size,y+size],policy,
          rawBytes:rgba.length,rawSha256:sha(rgba),gzipBytes:encoded.length,gzipSha256:sha(encoded),...stats});
      }
    }}finally{await reader.close();}
  }
  const after=await stat(source);
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Source changed during sampling');
  const report={schema:'pando-terrain-representative-quality-v1',sourceSha256,sourceBytes:before.size,
    sourceMetadata:metadata,sourceResampling:'native GDAL window reader, separately for each level',
    shade:'Float32 original per LOD, before quantization; 315/45 degrees',records};
  await writeFile(join(out,'sample-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1]};
  if(!arg('--source')||!arg('--out'))throw Error('Expected --source and --out');
  const options={source:arg('--source'),out:arg('--out'),size:Number(arg('--size')||256)};
  if(arg('--regions'))options.regions=arg('--regions').split(',');
  if(arg('--policies'))options.policies=arg('--policies').split(',');
  if(arg('--levels'))options.levelIds=arg('--levels').split(',').map(Number);
  const report=await runSamples(options);
  console.log(JSON.stringify({sourceSha256:report.sourceSha256,records:report.records.length}));
}
