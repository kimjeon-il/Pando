import {createHash} from 'node:crypto';
import {SAMPLE_REGIONS} from './sample-quality.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

export function experimentCenter(region){
  const target=SAMPLE_REGIONS.find(item=>item.id===region);
  if(!target)throw Error('Experiment region has no fixed camera coordinate');
  return region==='netherlands-coast'?[5.5,target.lat]:[target.lon,target.lat];
}

// The source manifest stays untouched. Only the bounded experimental LOD5
// entries are available; unexpected LOD5 requests must fail, not fall back.
export function makeViewerFixtureManifest(source,fixture,tileSize,region='southwest-china'){
  if(source?.version!=='0.14.0'||!Array.isArray(source.levels)||source.levels.length!==6||
      !source.tiles||!hex(source.assetsSha256)||fixture?.schema!=='pando-terrain-gutter-webp-v1'||!Array.isArray(fixture.records)||
      !hex(fixture.sourceSha256)||![512,1024].includes(tileSize)||typeof region!=='string'||!region)throw Error('Invalid experiment inputs');
  const records=fixture.records.filter(record=>record.tileSize===tileSize&&record.region===region),factor=1024/tileSize;
  if(![4*factor*factor,15*factor*factor].includes(records.length))throw Error('Incomplete experimental regional tiles');
  const map=new Map();
  for(const record of records){
    const {window,offset,width,height,gutter,webpBytes,webpSha256,file}=record;
    if(record.level!==5||!Array.isArray(window)||window.length!==4||!Array.isArray(offset)||offset.length!==2||
       [...window,...offset].some(value=>!Number.isSafeInteger(value))||width!==tileSize+2||height!==tileSize+2||
       gutter!==1||!Number.isSafeInteger(webpBytes)||webpBytes<1||!hex(webpSha256)||
       typeof file!=='string'||!/^[a-z0-9-]+\.webp$/.test(file))throw Error('Invalid candidate tile identity');
    const x=window[0]+offset[0],y=window[1]+offset[1];
    if(x<0||y<0||x%tileSize||y%tileSize)throw Error('Candidate tile is not aligned to the global grid');
    const key=`5/${x/tileSize}-${y/tileSize}.webp`;
    if(map.has(key))throw Error('Duplicate experiment tile');
    map.set(key,{file,bytes:webpBytes,sha256:webpSha256});
  }
  const columns=records.map(record=>(record.window[0]+record.offset[0])/tileSize);
  const rows=records.map(record=>(record.window[1]+record.offset[1])/tileSize);
  const width=Math.max(...columns)-Math.min(...columns)+1,height=Math.max(...rows)-Math.min(...rows)+1;
  if(width*height!==records.length||!((width===2*factor&&height===2*factor)||(width===5*factor&&height===3*factor)))
    throw Error('Incomplete rectangular experimental regional tiles');
  const result=structuredClone(source),level=result.levels[5];
  level.tileSize=tileSize;level.columns=Math.ceil(level.width/tileSize);level.rows=Math.ceil(level.height/tileSize);
  result.version='0.15.0';
  result.urlTemplate=result.urlTemplate.replace('v0.14.0','v0.15.0');
  result.packaging.sourcePath='terrain/v0.15.0/manifest.json';
  delete result.tileSha256;
  delete result.shade.quantizationStep;
  result.elevation.quantization={method:'roundHalfToEven',shadeInput:'original float32 (before quantization)',
    policy:'Q1 experiment only; outside regional LOD5 coverage is unavailable'};
  result.tiles=Object.fromEntries(Object.entries(source.tiles).filter(([key])=>!key.startsWith('5/')));
  for(const [key,record] of map)result.tiles[key]={bytes:record.bytes,sha256:record.sha256};
  result.assetsSha256=sha(JSON.stringify({base:source.assetsSha256,source:fixture.sourceSha256,
    tileSize,tiles:[...map].map(([key,value])=>[key,value.sha256])}));
  result.experiment={kind:'regional-Q1-hybrid',region,tileSize,sourceSha256:fixture.sourceSha256,
    policy:'Q1 at LOD5 in the listed region; unchanged v0.14.0 at LOD0-4',candidateTileCount:map.size};
  // A slightly eastward center keeps the full 32x viewport inside the
  // two-column Netherlands fixture while still covering its North Sea coast.
  const center=experimentCenter(region);
  return {manifest:result,tiles:map,center};
}
