#!/usr/bin/env node
// Prepare one bounded original-source region as equivalent 512/1024 Q1 tiles.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,realpath,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createNativeDemWindowReader,inspectNativeDemSource} from '../../tools/gis/terrain-dem-raster.mjs';
import {quantizeSample,SAMPLE_REGIONS,SOURCE_SHA256} from './sample-quality.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function regionalBlockWindow(lon,lat,{rows=3}={}){
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon < -180||lon > 180||lat < -90||lat > 90)
    throw new TypeError('Invalid regional center');
  if(rows!==3&&rows!==4)throw new TypeError('Unsupported regional height');
  const x=(Math.floor((lon+180)*120/1024)-2)*1024,y=(Math.floor((90-lat)*120/1024)-(rows===4?2:1))*1024;
  if(x<0||y<0||x+5120>43200||y+rows*1024>21600)throw new RangeError('Regional window crosses a world edge');
  return [x,y,x+5120,y+rows*1024];
}
export function regionalOrigin(center,side,{alignWorld=false,block2=false}={}){
  if(!Number.isInteger(center)||!Number.isInteger(side)||side<1||(!alignWorld&&side%2)||block2&&!alignWorld)throw Error('Invalid regional tile origin');
  if(!alignWorld)return center-side/2;
  const cell=Math.floor(center/side),within=center-cell*side;
  return (cell-(block2&&within<side/2?1:0))*side;
}
export function cutGutterTiles(rgba,side,tileSize) {
  if(!Number.isInteger(side)||!Number.isInteger(tileSize)||side<1||tileSize<1||side%tileSize||
      !Buffer.isBuffer(rgba)||rgba.length!==(side+2)*(side+2)*4)throw Error('Invalid one-pixel-gutter source');
  const stride=side+2,result=[];
  for(let y=0;y<side;y+=tileSize)for(let x=0;x<side;x+=tileSize){
    const width=tileSize+2,bytes=Buffer.allocUnsafe(width*width*4);
    for(let row=0;row<width;row++)rgba.copy(bytes,row*width*4,((y+row)*stride+x)*4,((y+row)*stride+x+width)*4);
    result.push({x,y,width,height:width,rgba:bytes});
  }
  return result;
}

export async function buildGutterFixtures({source,out,regionIds=['southwest-china','thai-lowland','netherlands-coast'],alignWorld=false,block2=false,coverage5x3=false,coverage5x4=false}) {
  if(!regionIds.length||new Set(regionIds).size!==regionIds.length||
      regionIds.some(id=>!SAMPLE_REGIONS.some(region=>region.id===id)))throw Error('Unknown or duplicate region');
  if((block2||coverage5x3||coverage5x4)&&!alignWorld||[block2,coverage5x3,coverage5x4].filter(Boolean).length>1)throw Error('Multi-block fixture requires one aligned layout');
  source=await realpath(source);out=resolve(out);
  const before=await stat(source),digest=createHash('sha256');
  if(before.size!==1585813987)throw Error('Source length mismatch');
  for await(const chunk of createReadStream(source))digest.update(chunk);
  if(digest.digest('hex')!==SOURCE_SHA256)throw Error('Source hash mismatch');
  const metadata=await inspectNativeDemSource({source,strict:true});
  if(metadata.dtype!=='float32')throw Error('Float32 source required');
  await mkdir(out,{recursive:false});
  const level={id:5,width:43200,height:21600},side=1024,records=[];
  const reader=await createNativeDemWindowReader({source,width:level.width,height:level.height,strict:true});
  try{
    for(const region of SAMPLE_REGIONS.filter(item=>regionIds.includes(item.id))){
      const centerX=Math.floor((region.lon+180)*level.width/360),centerY=Math.floor((90-region.lat)*level.height/180);
      const expanded=coverage5x3||coverage5x4?regionalBlockWindow(region.lon,region.lat,{rows:coverage5x4?4:3}):null;
      const xStart=expanded?expanded[0]:regionalOrigin(centerX,side,{alignWorld,block2});
      const yStart=expanded?expanded[1]:regionalOrigin(centerY,side,{alignWorld,block2});
      for(let blockY=0;blockY<(coverage5x4?4:coverage5x3?3:block2?2:1);blockY++)for(let blockX=0;blockX<(expanded?5:block2?2:1);blockX++){
      const x=xStart+blockX*side,y=yStart+blockY*side;
      if(x+side>level.width||y+side>level.height)throw Error('Regional fixture crosses the world edge');
      // One output gutter plus a further pixel for source-based hillshade.
      const raw=await reader.read([x-2,y-2,x+side+2,y+side+2]);
      const values=new Float32Array(raw.length/4);
      for(let i=0;i<values.length;i++)values[i]=raw.readFloatLE(i*4);
      const {rgba}=quantizeSample(values,side+2,side+2,
        {north:y-2,levelWidth:level.width,levelHeight:level.height},'Q1');
      for(const tileSize of [512,1024])for(const tile of cutGutterTiles(rgba,side,tileSize)){
        const name=`${region.id}${block2||expanded?`-${x}-${y}`:''}-${tileSize}-${tile.x}-${tile.y}.rgba.gz`;
        const encoded=gzipSync(tile.rgba,{level:9,mtime:0});
        await writeFile(join(out,name),encoded,{flag:'wx'});
        records.push({region:region.id,level:5,window:[x,y,x+side,y+side],tileSize,
          offset:[tile.x,tile.y],width:tile.width,height:tile.height,gutter:1,
          rawBytes:tile.rgba.length,rawSha256:sha(tile.rgba),gzipBytes:encoded.length,
          gzipSha256:sha(encoded),file:name});
      }
      }
    }
  }finally{await reader.close();}
  const after=await stat(source);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Source changed during generation');
  const report={schema:'pando-terrain-gutter-fixture-v1',sourceSha256:SOURCE_SHA256,sourceBytes:before.size,
    geometry:'1024 square source blocks, Q1, original Float32-derived hillshade',alignWorld,block2,coverage5x3,coverage5x4,records};
  await writeFile(join(out,'gutter-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,out,...options]=process.argv.slice(2);
  if(!source||!out)throw Error('Expected source and new output directory');
  if(options.some(option=>!['--align-world','--block2','--coverage5x3','--coverage5x4','--china-only'].includes(option)&&!option.startsWith('--regions=')))throw Error('Unknown option');
  const regions=options.find(option=>option.startsWith('--regions='))?.slice('--regions='.length).split(',');
  if(regions&&options.includes('--china-only'))throw Error('Specify regions only once');
  const report=await buildGutterFixtures({source,out,alignWorld:options.includes('--align-world'),block2:options.includes('--block2'),coverage5x3:options.includes('--coverage5x3'),coverage5x4:options.includes('--coverage5x4'),
    ...(options.includes('--china-only')?{regionIds:['southwest-china']}:regions?{regionIds:regions}:{})});
  console.log(JSON.stringify({sourceSha256:report.sourceSha256,tiles:report.records.length}));
}
