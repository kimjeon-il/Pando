import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

// The source manifest stays untouched. Only the bounded experimental LOD5
// entries are available; unexpected LOD5 requests must fail, not fall back.
export function makeViewerFixtureManifest(source,fixture,tileSize){
  if(source?.version!=='0.14.0'||!Array.isArray(source.levels)||source.levels.length!==6||
      !source.tiles||!hex(source.assetsSha256)||fixture?.schema!=='pando-terrain-gutter-webp-v1'||
      !hex(fixture.sourceSha256)||![512,1024].includes(tileSize))throw Error('Invalid experiment inputs');
  const records=fixture.records.filter(record=>record.tileSize===tileSize),expected=tileSize===512?16:4;
  if(records.length!==expected)throw Error('Incomplete experimental regional tiles');
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
  result.experiment={kind:'regional-Q1-hybrid',tileSize,sourceSha256:fixture.sourceSha256,
    policy:'Q1 at LOD5 in the listed region; unchanged v0.14.0 at LOD0-4',candidateTileCount:map.size};
  const windows=records.map(record=>record.window),minX=Math.min(...windows.map(w=>w[0])),minY=Math.min(...windows.map(w=>w[1]));
  return {manifest:result,tiles:map,center:[(minX+1024)/120-180,90-(minY+1024)/120]};
}
