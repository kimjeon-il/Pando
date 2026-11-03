/** Independent, data-only river water masks for two Baikonur treaty right-bank reaches.
 * GDAL (native C++) clips public-domain USGS Landsat C2 L2 surface reflectance
 * via disposable Microsoft Planetary Computer SAS. No OSM input, no Python.
 * This generates research masks, NEVER a treaty boundary or production polygon.
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';
import {TREATY_BANK_BOXES} from './probe-baikonur-government-hydrography.mjs';
import {PLANETARY_COLLECTION} from './probe-baikonur-planetary-landsat.mjs';
import {ANCHORS,decimalDegrees} from './baikonur-official-reference.mjs';
const ensure=(v,m)=>{if(!v)throw Error(m);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const EPOCHS=Object.freeze([
  {key:'treaty2019',window:'2018-05-01T00:00:00Z/2019-09-30T23:59:59Z'},
  {key:'recent2025',window:'2025-05-01T00:00:00Z/2025-09-30T23:59:59Z'},
]);
const BAD_QA=0b00111111; // fill, dilated cloud, cirrus, cloud, cloud shadow, snow
const SCALE=0.0000275,OFFSET=-0.2;
export function surfaceReflectance(dn){
  return dn===0?null:dn*SCALE+OFFSET;
}
export function classifyLandsatWater(greenDn,nirDn,qa){
  if(!Number.isInteger(greenDn)||!Number.isInteger(nirDn)||!Number.isInteger(qa)
    ||(qa&BAD_QA)||greenDn===0||nirDn===0)return {valid:false,water:false,ndwi:null};
  const green=surfaceReflectance(greenDn),nir=surfaceReflectance(nirDn);
  if(green<-.02||nir<-.02||green>1.1||nir>1.1)return {valid:false,water:false,ndwi:null};
  const ndwi=(green-nir)/Math.max(.001,green+nir);
  const water=nir<.21&&green>.006&&(
    ndwi>=.13||((qa&128)!==0&&ndwi>=-.04));
  return {valid:true,water,ndwi};
}
const inSummer=s=>{const month=Number(String(s?.properties?.datetime||'').slice(5,7));return month>=5&&month<=9;};
const safeBlob=asset=>{
  if(typeof asset?.href!=='string')return false;
  try{const u=new URL(asset.href);return u.protocol==='https:'&&u.hostname.endsWith('.blob.core.windows.net')
    &&!u.search&&!u.hash&&/\.tif$/i.test(u.pathname);}catch{return false;}
};
export function usableScenes(features){
  return (features||[]).filter(x=>x.collection==='landsat-c2-l2'
    &&inSummer(x)&&Number.isFinite(x.properties?.['eo:cloud_cover'])
    &&x.properties['eo:cloud_cover']<=20
    &&['green','nir08','qa_pixel'].every(k=>safeBlob(x.assets?.[k])))
    .sort((a,b)=>a.properties['eo:cloud_cover']-b.properties['eo:cloud_cover']
      ||b.properties.datetime.localeCompare(a.properties.datetime)
      ||a.id.localeCompare(b.id));
}
function run(command,args,{input=null,env={},timeoutMs=180000}={}){
  const result=spawnSync(command,args,{input,env:{...process.env,...env},encoding:'utf8',
    maxBuffer:4_000_000,timeout:timeoutMs});
  // Don't ever log signed Azure URLs via stdout/stderr/arguments.
  if(result.error||result.status!==0){
    const cleaned=String(result.stderr||'').split(/\r?\n/)
      .filter(line=>/ERROR|WARNING|Failed|unable|cannot|unsupported|Invalid|HTTP|TIFF|COG/i.test(line))
      .slice(0,5).map(line=>line
        .replace(/https?:\/\/\S+/g,'[REDACTED_REMOTE_ASSET_URL]')
        .replace(/(?:sig|sv|se|sp|st)=\S+/gi,'[REDACTED_SAS_PARAMETER]'))
      .join(' | ').slice(0,440);
    throw Error(command+' failed, code='+String(result.status)
      +' errorClass='+String(result.error?.code||'none')+' diagnostic='+cleaned);
  }
  return result.stdout;
}
function utm(lon,lat){
  const out=run('gdaltransform',['-s_srs','EPSG:4326','-t_srs','EPSG:32641'],{
    input:lon+' '+lat+'\n',timeoutMs:10000}).trim().split(/\s+/).map(Number);
  ensure(out.length>=2&&out.every(Number.isFinite),'Invalid UTM projected coordinate');
  return out.slice(0,2);
}
function positionFor(point,info){
  const [lat,lon]=ANCHORS[point-1];
  const [x,y]=utm(decimalDegrees(lon),decimalDegrees(lat));
  const [west,dx,,north,,dy]=info.geoTransform;
  ensure(Math.abs(dx)>=29.9&&Math.abs(dx)<=30.1&&Math.abs(dy)>=29.9&&Math.abs(dy)<=30.1,
    'Unexpected 30-meter satellite analysis grid');
  return {anchor:point,x:(x-west)/dx,y:(y-north)/dy,projected:[x,y]};
}
const tokenPromises=new Map();
async function reusableSasForAsset(asset,{fetcher}){
  const uri=new URL(asset.href);
  ensure(uri.protocol==='https:'&&uri.hostname.endsWith('.blob.core.windows.net')
    &&!uri.search,'Unsigned https Azure USGS asset required');
  const account=uri.hostname.slice(0,-'.blob.core.windows.net'.length);
  const container=uri.pathname.split('/')[1];
  ensure(/^[a-z0-9]+$/.test(account)&&/^[a-z0-9-]+$/.test(container),
    'Invalid Planetary Computer storage scope');
  const key=account+'/'+container;
  if(!tokenPromises.has(key)){
    const url='https://planetarycomputer.microsoft.com/api/sas/v1/token/'+key;
    tokenPromises.set(key,fetchBoundedJson(url,{fetcher,timeoutMs:16000,limit:12000,
      headers:{Accept:'application/json'}}).then(record=>{
      ensure(typeof record?.token==='string'&&record.token.includes('sig=')&&record.token.includes('se='),
        'Planetary Computer collection SAS token invalid');
      return record.token.replace(/^\?/,'');
    }));
  }
  const token=await tokenPromises.get(key);
  return asset.href+'?'+token;
}
function warpSigned(asset,dir,filename,bbox,{fetcher}){
  const href=asset.href;
  return reusableSasForAsset(asset,{fetcher}).then(signedUrl=>{
    ensure(signedUrl.startsWith(href+'?')
      &&new URL(signedUrl).hostname===new URL(href).hostname,
      'Public Landsat SAS was not scoped to selected asset');
    // Check blob byte-range access before invoking native GDAL; never log SAS.
    const head=await fetch(signedUrl,{method:'HEAD',redirect:'manual',
      signal:AbortSignal.timeout(12000)});
    ensure(head.status>=200&&head.status<300,
      'SAS signed blob inaccessible by HEAD: HTTP '+head.status);
    await head.body?.cancel();
    const dest=join(dir,filename+'.bin'),u='/vsicurl/'+signedUrl;
    run('gdalwarp',[
      '-of','ENVI','-ot','UInt16','-r','near',
      '-overwrite','-t_srs','EPSG:32641','-te_srs','EPSG:4326',
      '-te',...bbox.map(x=>String(x)),'-tr','30','30',
      '-srcnodata','0','-dstnodata','0','-co','INTERLEAVE=BSQ',
      u,dest
    ],{env:{GDAL_DISABLE_READDIR_ON_OPEN:'EMPTY_DIR',
      GDAL_HTTP_TIMEOUT:'45',GDAL_HTTP_MAX_RETRY:'2',GDAL_HTTP_RETRY_DELAY:'2'},
      timeoutMs:210000});
    const info=JSON.parse(run('gdalinfo',['-json',dest],{timeoutMs:20000}));
    ensure(info.size?.length===2&&info.size[0]>0&&info.size[1]>0
      &&info.size[0]*info.size[1]<3000000&&Array.isArray(info.geoTransform),
    'Clipped Landsat grid is missing, oversize or unreferenced');
    const data=readFileSync(dest);
    ensure(data.length===info.size[0]*info.size[1]*2,
      'Unexpected endian/interleave or pixel count for clipped USGS imagery');
    // Never write/retain signed input URL, raw band geometry, or server token in receipts.
    return {data,info,sha256:sha(data)};
  });
}
export function calculateWaterMask(g,n,q){
  const size=g.info.size[0]*g.info.size[1],grid=g.info.geoTransform;
  ensure(g.info.size.every((x,i)=>x===n.info.size[i]&&x===q.info.size[i])
    &&g.info.geoTransform.every((x,i)=>Math.abs(x-n.info.geoTransform[i])<.000001
      &&Math.abs(x-q.info.geoTransform[i])<.000001),
  'Spectral bands and QA must have exactly identical Earth-coordinate pixels');
  const mask=new Uint8Array(size);let valid=0,water=0,qaWater=0,ndwiWater=0;
  for(let i=0;i<size;i++){
    const gn=g.data.readUInt16LE(i*2),nn=n.data.readUInt16LE(i*2),
      qa=q.data.readUInt16LE(i*2);
    const x=classifyLandsatWater(gn,nn,qa);
    if(x.valid){valid++;if(qa&128)qaWater++;}
    if(x.water){water++;if(x.ndwi>=.13)ndwiWater++;mask[i]=1;}
  }
  return {mask,width:g.info.size[0],height:g.info.size[1],
    geoTransform:grid,valid,water,qaWater,ndwiWater,validCoverage:valid/size,
    waterCoverage:water/size};
}
function nearestWater(mask,width,height,point,maxDist=150){
  let best={meters:Infinity,pixel:null},x0=Math.round(point.x),y0=Math.round(point.y);
  for(let y=Math.max(0,y0-maxDist);y<Math.min(height,y0+maxDist+1);y++)
    for(let x=Math.max(0,x0-maxDist);x<Math.min(width,x0+maxDist+1);x++){
      if(!mask[y*width+x])continue;
      const distance=30*Math.hypot(x-point.x,y-point.y);
      if(distance<best.meters)best={meters:Number(distance.toFixed(2)),pixel:[x,y]};
    }
  return Number.isFinite(best.meters)?best:null;
}
export function analyzeBankMask(observation,from,to){
  const {mask,width,height,geoTransform}=observation;
  const info={geoTransform},start=positionFor(from,info),end=positionFor(to,info);
  const anchorA=nearestWater(mask,width,height,start);
  const anchorB=nearestWater(mask,width,height,end);
  const overlap=Boolean(anchorA&&anchorB&&anchorA.meters<=3000&&anchorB.meters<=3000);
  const connected=overlap?waterPathConnected(mask,width,height,anchorA.pixel,anchorB.pixel):false;
  return {
    officialPoints:[from,to],
    anchorToWaterMeters:[anchorA?.meters??null,anchorB?.meters??null],
    matchedAnchorPixels:[anchorA?.pixel??null,anchorB?.pixel??null],
    connectsBothTreatyAnchors:connected,
    sourceStatus:connected?'candidate-channel-has-endpoint-connectivity':'not-yet-verified-channel',
    noLegalBankReconstructed:true,
  };
}
export function waterPathConnected(mask,width,height,a,b){
  if(!a||!b)return false;
  const start=a[1]*width+a[0],end=b[1]*width+b[0];
  if(!mask[start]||!mask[end])return false;
  const stack=new Int32Array(mask.length),seen=new Uint8Array(mask.length);
  stack[0]=start;seen[start]=1;
  let first=0,last=1;
  while(first<last){
    const i=stack[first++];if(i===end)return true;
    const x=i%width,y=Math.floor(i/width);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(dx===0&&dy===0)continue;
      const xx=x+dx,yy=y+dy;
      if(xx<0||xx>=width||yy<0||yy>=height)continue;
      const j=yy*width+xx;
      if(!seen[j]&&mask[j]){seen[j]=1;stack[last++]=j;}
    }
  }
  return false;
}
async function captureOne({bank,epoch,root,fetcher}){
  const url=new URL(PLANETARY_COLLECTION);
  url.search=new URLSearchParams({bbox:bank.bbox.map(x=>x.toFixed(7)).join(','),
    datetime:epoch.window,limit:'100'}).toString();
  const stac=await fetchBoundedJson(url,{fetcher,timeoutMs:30000,limit:5_000_000,
    headers:{Accept:'application/json'}});
  ensure(stac?.type==='FeatureCollection'&&Array.isArray(stac.features),'Invalid STAC imagery results');
  const list=usableScenes(stac.features);
  let lastFailure='no-eligible-scene';
  for(const scene of list.slice(0,2)){
    const dir=join(root,bank.treatyPointPair.join('-')+'-'+epoch.key+'-'+scene.id.replace(/[^a-zA-Z0-9_-]/g,''));
    mkdirSync(dir,{recursive:true});
    try{
      const [g,n,q]=await Promise.all(['green','nir08','qa_pixel'].map((band)=>
        warpSigned(scene.assets[band],dir,band,bank.bbox,{fetcher})));
      const state=calculateWaterMask(g,n,q);
      const [from,to]=bank.treatyPointPair;
      const evaluation=analyzeBankMask(state,from,to);
      const key=bank.treatyPointPair.join('-')+'-'+epoch.key;
      const packed=gzipSync(state.mask,{level:9,mtime:0});
      const name=key+'.water-mask.bin.gz';
      writeFileSync(join(root,name),packed,{flag:'wx'});
      const receipt={
        treatyPointPair:bank.treatyPointPair,epoch:epoch.key,
        sceneId:scene.id,acquiredAt:scene.properties.datetime,
        sceneCloudCoverPercent:scene.properties['eo:cloud_cover'],
        sourceStacUrl:url,originalProvider:'US Geological Survey',
        rights:'US public domain; USGS credit requested',
        sensor:'Landsat Collection 2 Level 2',
        maskAlgorithm:'cloud/shadow/snow masked USGS QA_PIXEL, scaled Green/NIR NDWI>=0.13 or QA water',
        pixelSizeMeters:30,crs:'EPSG:32641',
        raster:{width:state.width,height:state.height,
          geoTransform:state.geoTransform,valid:state.valid,water:state.water,
          qaWater:state.qaWater,ndwiWater:state.ndwiWater,
          validCoverage:Number(state.validCoverage.toFixed(4)),
          waterCoverage:Number(state.waterCoverage.toFixed(4)),
          spectralPixelHashes:{green:g.sha256,nir08:n.sha256,qaPixel:q.sha256}},
        sourceGridFile:name,sourceGridSha256:sha(packed),...evaluation,
        methodStatus:'PUBLIC_DOMAIN_RASTER_RESEARCH_ONLY_NO_OSM_OR_CADASTRAL_BANK',
        leasePolygonsReplaced:false,noOSMDataSource:true,
      };
      rmSync(dir,{recursive:true,force:true});
      return receipt;
    }catch(error){
      lastFailure=String(error.message||error).replace(/https?:\/\/[^\s]+/g,'[private-remote-url]');
      rmSync(dir,{recursive:true,force:true});
      if(/gdalwarp failed|Service response unavailable: 429|SAS token invalid/.test(lastFailure))break;
    }
  }
  return {treatyPointPair:bank.treatyPointPair,epoch:epoch.key,
    sourceStacUrl:url,scenesScanned:stac.features.length,eligible:list.length,
    errorClass:lastFailure,methodStatus:'NO_VALID_SATELLITE_CLIP_YET',
    leasePolygonsReplaced:false,noOSMDataSource:true,
  };
}
export async function main(argv=process.argv.slice(2)){
  const {values}=((await import('node:util')).parseArgs)({args:argv,
    options:{'output-dir':{type:'string'}}});
  ensure(typeof values['output-dir']==='string'&&values['output-dir'],
    'Usage: --output-dir CLEAN_NEW_DIRECTORY');
  const root=resolve(values['output-dir']);
  ensure(!existsSync(root),'Refusing to overwrite existing public-domain bank evidence');
  mkdirSync(root,{recursive:true});
  const records=[];
  for(const bank of TREATY_BANK_BOXES)for(const epoch of EPOCHS){
    const x=await captureOne({bank,epoch,root,fetcher:fetch});
    records.push(x);
    console.log('INDEPENDENT_BANK_IMAGE_CLIP='+JSON.stringify({
      points:x.treatyPointPair,epoch:x.epoch,scene:x.sceneId||null,
      mask:x.sourceGridFile||null,
      anchorDistances:x.anchorToWaterMeters||null,connected:x.connectsBothTreatyAnchors||false,
      validCoverage:x.raster?.validCoverage||null,errorClass:x.errorClass||null,
    }));
  }
  const report={
    schema:'baikonur-public-domain-syr-darya-raster-observation-v1',
    officialTreatyUrl:'https://old.adilet.zan.kz/rus/docs/U950002195_',
    sourcePolicy:'https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-be-within-public-domain',
    status:'RESEARCH_ONLY_NO_LEGAL_BANK_OR_PUBLISHED_GEOMETRY',
    openStreetMapDataUsed:false,polygonApplied:false,
    bankSections:records,
  };
  writeFileSync(join(root,'manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const complete=records.filter(x=>x.sceneId).length;
  console.log('BAIKONUR_LANDSAT_WATER_REPORT='+JSON.stringify({
    sections:records.length,clippedScenes:complete,
    bothTreatyAnchorsConnected:records.filter(x=>x.connectsBothTreatyAnchors).length,
    publicDomain:true,productionModified:false,
  }));
  // No CI success for an empty or partially clipped source study.
  if(complete!==4)process.exitCode=2;
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(e){console.error(e.stack);process.exitCode=1;}
}
