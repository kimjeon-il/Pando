// Immutable v0.14.0 DEM candidate: NOAA float32 R/G and byte-exact v0.13.3 B/A.
// Usage: --mode sample, then --mode full --sample-report <verified trial JSON>.
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createNativeDemWindowReader,inspectNativeDemSource} from './terrain-dem-raster.mjs';
import {encodeNativeDemElevation} from './terrain-dem-encode.mjs';
import {quantizeTerrainMeters} from './terrain-dem-check.mjs';
import {encodeDemWebp} from './terrain-dem-webp.mjs';
import {readNativeRawWebp} from '../map-image/native-resample.mjs';
import {hashTerrainFile,summarizeTerrainAssets} from './terrain-dem-assets.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const baseHash='622a6d272bdda6b507a1f4ba49794fe9ef41aca06f29d8b38e24114caa50d023';
const sourceHash='8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireTrue=(ok,why)=>{if(!ok)throw Error(why)};
const pathFor=(id,c,r)=>String(id)+'/'+c+'-'+r+'.webp';
const sampleTiles=[
  {id:5,c:32,r:8,region:'Thai lowland'},
  {id:5,c:31,r:7,region:'Himalaya'},
  {id:5,c:12,r:12,region:'Andes'},
  {id:5,c:5,r:10,region:'Pacific'},
  {id:5,c:21,r:4,region:'North Sea'},
  {id:5,c:19,r:21,region:'Antarctica'},
  {id:4,c:10,r:5,region:'LOD4'},
  {id:2,c:2,r:1,region:'LOD2'},
];
const quantization={
  source:'original ETOPO 2022 float32',method:'roundHalfToEven',sign:'preserve',
  selection:'source elevation sign and unrounded absolute magnitude; physicalLand remains the independent render mask',
  land:[{fromMeters:0,toMetersExclusive:256,stepMeters:16},{fromMeters:256,stepMeters:32}],
  ocean:[{fromMeters:0,toMetersExclusive:256,stepMeters:16},{fromMeters:256,toMetersExclusive:1024,stepMeters:64},{fromMeters:1024,stepMeters:128}],
  heightDecodeSpacingMeters:1,shadeInput:'original float32 (before quantization)',
};
const stepFor=value=>value<0?(Math.abs(value)<256?16:Math.abs(value)<1024?64:128):(value<256?16:32);
async function verifyInput(etopo,baseline){
  const original=JSON.parse(await readFile(join(baseline,'manifest.json'),'utf8'));
  requireTrue(original.version==='0.13.3'&&original.representation==='dem-relief-v1'&&original.assetsSha256===baseHash,
    'Unexpected v0.13.3 baseline manifest identity');
  requireTrue(original.levels?.length===6&&original.levels.reduce((s,l)=>s+l.rows*l.columns,0)===1280,
    'Expected exactly 1,280 old DEM tiles');
  requireTrue(original.sources?.[0]?.sha256===sourceHash,'Unexpected NOAA source pin');
  const size=(await stat(etopo)).size;
  requireTrue(size===1585813987,'ETOPO original file byte count mismatch');
  requireTrue((await hashTerrainFile(etopo)).sha256===sourceHash,'ETOPO SHA-256 mismatch');
  const source=await inspectNativeDemSource({source:etopo,strict:true});
  requireTrue(source.width===43200&&source.height===21600&&source.dtype==='float32','ETOPO source metadata mismatch');
  return original;
}
function metrics(rows){
  const oldBytes=rows.reduce((s,v)=>s+v.oldBytes,0),newBytes=rows.reduce((s,v)=>s+v.newBytes,0);
  const n=rows.reduce((s,v)=>s+v.count,0);
  return {tiles:rows.length,oldBytes,newBytes,savedBytes:oldBytes-newBytes,
    reductionPercent:100*(oldBytes-newBytes)/oldBytes,
    maxErrorMeters:Math.max(...rows.map(v=>v.maxError)),
    meanAbsErrorMeters:rows.reduce((s,v)=>s+v.sumAbs,0)/n,
    rmseMeters:Math.sqrt(rows.reduce((s,v)=>s+v.sumSquares,0)/n),
    sourceSamples:n,originalShadeByteExact:rows.every(v=>v.shadeExact)};
}
async function packTile(reader,level,column,row,baseline,output){
  const x=column*level.tileSize,y=row*level.tileSize;
  const x1=Math.min(level.width,x+level.tileSize),y1=Math.min(level.height,y+level.tileSize);
  const sw=x1-x+4,sh=y1-y+4,w=sw-2,h=sh-2;
  const floats=await reader.read([x-2,y-2,x1+2,y1+2]);
  const raw=await encodeNativeDemElevation({
    width:sw,height:sh,levelWidth:level.width,levelHeight:level.height,north:y-2,elevation:floats,
  },{directory:process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||resolve(root,'build-native/terrain-dem-encode/artifact')});
  const path=pathFor(level.id,column,row);
  const older=await readFile(join(baseline,path)),reference=await readNativeRawWebp(older);
  requireTrue(reference.width===w&&reference.height===h,'DEM baseline tile shape mismatch: '+path);
  const pixels=Buffer.allocUnsafe(w*h*4);
  let maxError=0,sumAbs=0,sumSquares=0,count=0;
  for(let r=0;r<h;r++){
    const start=((r+1)*sw+1)*4;
    raw.rgba.copy(pixels,r*w*4,start,start+w*4);
    for(let c=0;c<w;c++){
      const at=(r*w+c)*4;
      requireTrue(reference.data[at+3]===255,'Invalid old DEM opacity: '+path);
      pixels[at+2]=reference.data[at+2];
      pixels[at+3]=255;
      if(!r||!c||r===h-1||c===w-1)continue;
      const sourceMeters=floats.readFloatLE(((r+1)*sw+c+1)*4);
      const elevation=pixels[at]*256+pixels[at+1]-12000;
      requireTrue(elevation===quantizeTerrainMeters(sourceMeters),'v0.14.0 source quantization mismatch: '+path);
      const error=Math.abs(sourceMeters-elevation);
      requireTrue(error<=stepFor(sourceMeters)/2+0.0001,'DEM quantization exceeded error budget: '+path);
      maxError=Math.max(maxError,error);sumAbs+=error;sumSquares+=error*error;count++;
    }
  }
  // The v0.13.3 B channel was computed from the original, pre-quantized float32.
  // Preserve its polar and seam corrections rather than recomputing shade.
  const webp=await encodeDemWebp({width:w,height:h,data:pixels});
  await writeFile(join(output,path),webp,{flag:'wx'});
  return {path,oldBytes:older.length,newBytes:webp.length,sha256:digest(webp),
    count,sumAbs,sumSquares,maxError,shadeExact:true};
}
async function generate({etopo,baseline,output,manifest,selection}){
  const rows=[];
  for(const level of manifest.levels){
    const tiles=selection?selection.filter(item=>item.id===level.id):
      Array.from({length:level.rows*level.columns},(_,i)=>({
        id:level.id,c:i%level.columns,r:Math.floor(i/level.columns),
      }));
    if(!tiles.length)continue;
    await mkdir(join(output,String(level.id)));
    const reader=await createNativeDemWindowReader({source:etopo,width:level.width,height:level.height,strict:true});
    try{
      for(const tile of tiles){
        requireTrue(tile.c>=0&&tile.c<level.columns&&tile.r>=0&&tile.r<level.rows,'Tile out of LOD grid');
        rows.push({...await packTile(reader,level,tile.c,tile.r,baseline,output),region:tile.region||null});
      }
    }finally{await reader.close();}
  }
  return rows;
}
async function main(){
  const {values}=parseArgs({options:{mode:{type:'string'},etopo:{type:'string'},
    baseline:{type:'string'},output:{type:'string'},report:{type:'string'},
    'sample-report':{type:'string'}}});
  const {mode}=values;
  requireTrue(['sample','full'].includes(mode),'Expected --mode sample or full');
  for(const key of ['etopo','baseline','output','report'])requireTrue(values[key],'Missing --'+key);
  const etopo=resolve(values.etopo),baseline=resolve(values.baseline),
    output=resolve(values.output),report=resolve(values.report);
  requireTrue(output!==baseline&&!output.startsWith(baseline+sep),'Never overwrite existing DEM');
  requireTrue(output!==dirname(report),'Report must be outside the DEM candidate directory');
  const source=await verifyInput(etopo,baseline);
  if(mode==='full'){
    requireTrue(values['sample-report'],'Full generation requires --sample-report');
    const trial=JSON.parse(await readFile(values['sample-report'],'utf8'));
    requireTrue(trial.verified&&trial.sourceSha256===sourceHash&&trial.baselineSha256===baseHash&&
      trial.stats?.tiles===sampleTiles.length&&trial.stats.savedBytes>0&&trial.stats.originalShadeByteExact,
      'Representative tile gate has not passed');
    const confirmed=await summarizeTerrainAssets(baseline,source.levels);
    requireTrue(confirmed.assetsSha256===baseHash,'Original full DEM asset digest mismatch');
  }
  await mkdir(dirname(output),{recursive:true});
  await mkdir(output);
  const rows=await generate({etopo,baseline,output,manifest:source,
    selection:mode==='sample'?sampleTiles:null});
  const stats=metrics(rows);
  const reportValue={mode,verified:true,sourceSha256:sourceHash,baselineSha256:baseHash,stats,
    ...(mode==='sample'?{tiles:rows}: {})};
  if(mode==='sample'){
    requireTrue(stats.savedBytes>0&&stats.originalShadeByteExact,'Compression gate failed; full build must not run');
  }else{
    requireTrue(rows.length===1280,'Expected all 1280 DEM tiles');
    await copyFile(join(baseline,'tint.webp'),join(output,'tint.webp'));
    const inventory=await summarizeTerrainAssets(output,source.levels);
    const candidate={
      ...source,version:'0.14.0',
      elevation:{...source.elevation,encode:'roundHalfToEven(abs(meters)/step)*step*sign(meters)+12000',
        quantization},
      urlTemplate:source.urlTemplate.replaceAll('v0.13.3','v0.14.0'),
      tint:{...source.tint,url:source.tint.url.replaceAll('v0.13.3','v0.14.0')},
      tileSha256:inventory.tileSha256,assetsSha256:inventory.assetsSha256,
    };
    requireTrue(Object.keys(candidate.tileSha256).length===1280,'Not all DEM SHA256 present');
    await writeFile(join(output,'manifest.json'),JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
    reportValue.assetsSha256=inventory.assetsSha256;
    reportValue.manifestSha256=(await hashTerrainFile(join(output,'manifest.json'))).sha256;
    reportValue.levels=inventory.reports.map(rec=>{
      const original=rows.filter(row=>row.path.startsWith(String(rec.level)+'/'));
      return {level:rec.level,tiles:rec.tileCount,oldBytes:original.reduce((s,v)=>s+v.oldBytes,0),
        newBytes:rec.bytes,savedBytes:original.reduce((s,v)=>s+v.oldBytes,0)-rec.bytes};
    });
    reportValue.oldTintBytes=(await stat(join(baseline,'tint.webp'))).size;
  }
  await writeFile(report,JSON.stringify(reportValue,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode,verified:true,stats,assetsSha256:reportValue.assetsSha256||null}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('terrain-v014: '+error.stack);process.exitCode=1;});
