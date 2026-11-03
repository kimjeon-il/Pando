/** Independent raw Landsat surface-reflectance pixel validation in Node.js.
 * Separate from the legally adopted riverbank. Never reads OSM geometry and
 * NEVER changes the KAB/KAZ polygons. No token or signed asset URL is logged.
 * Optional, isolated geotiff@2.1.3/proj4@2.22.0 research dependencies only.
 */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';
import {TREATY_BANK_BOXES} from './probe-baikonur-government-hydrography.mjs';
import {ANCHORS,decimalDegrees} from './baikonur-official-reference.mjs';

export const LANDSAT_STAC='https://planetarycomputer.microsoft.com/api/stac/v1/search';
const SAS_TOKEN='https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2';
const YEARS=Object.freeze([1994,1995,2020]);
const err=(m)=>{throw Error(m);};
const assert=(b,m)=>{if(!b)err(m);};
const treatyPoint=n=>{
  const [lat,lon]=ANCHORS[n-1];return [decimalDegrees(lon),decimalDegrees(lat)];
};
const sourceBbox=(scene,bbox)=>{
  const ext=scene.bbox;
  if(!Array.isArray(ext)||ext.length!==4)return 0;
  const dx=Math.max(0,Math.min(ext[2],bbox[2])-Math.max(ext[0],bbox[0]));
  const dy=Math.max(0,Math.min(ext[3],bbox[3])-Math.max(ext[1],bbox[1]));
  return dx*dy/Math.max(1e-10,(bbox[2]-bbox[0])*(bbox[3]-bbox[1]));
};
const urlFor=(bbox,year)=>{
  assert(YEARS.includes(year),'Unapproved Landsat year');
  const u=new URL(LANDSAT_STAC);
  u.search=new URLSearchParams({
    collections:'landsat-c2-l2',limit:'100',
    bbox:bbox.map(x=>x.toFixed(7)).join(','),
    datetime:year+'-01-01T00:00:00Z/'+year+'-12-31T23:59:59Z',
  }).toString();return u.href;
};
const getRawScenes=async(bbox,year)=>{
  const doc=await fetchBoundedJson(urlFor(bbox,year),{limit:5_000_000,timeoutMs:20000});
  assert(doc.type==='FeatureCollection'&&Array.isArray(doc.features),'Bad STAC catalog');
  return doc.features.filter(x=>{
    const p=x.properties||{},cloud=p['eo:cloud_cover'];
    return x.collection==='landsat-c2-l2'&&typeof cloud==='number'&&cloud<=20
      &&p.datetime?.startsWith(year+'-')
      &&(year>=2000||x.id?.startsWith('LT05_'))
      &&['green','nir08','qa_pixel'].every(k=>/^https:\/\//.test(x.assets?.[k]?.href||''));
  }).sort((a,b)=>sourceBbox(b,bbox)-sourceBbox(a,bbox)
    ||(year>=2000?(a.id.startsWith('LC08_')?-1:1)-(b.id.startsWith('LC08_')?-1:1):0)
    ||a.properties['eo:cloud_cover']-b.properties['eo:cloud_cover']);
};
export function screenSpectralDN(green,nir,qa){
  assert(green.length===nir.length&&nir.length===qa.length,'Unaligned Landsat bands');
  const water=new Uint8Array(green.length);
  const valid=new Uint8Array(green.length);
  let clean=0,waterN=0;
  for(let i=0;i<green.length;i++){
    const cloudFree=(qa[i]&63)===0&&green[i]>0&&nir[i]>0;
    const g=green[i]*0.0000275-0.2,n=nir[i]*0.0000275-0.2;
    if(!cloudFree||g<=0||n<=0)continue;
    valid[i]=1;clean++;
    if((g-n)/(g+n)>=0.1){water[i]=1;waterN++;}
  }
  return {water,valid,clean,waterN};
}
function scientificModules(){
  const dir=process.env.PANDO_RASTER_DEPS_DIR;
  assert(dir&&resolve(dir)!==process.cwd(),'Explicit isolated research dependencies required');
  const require=createRequire(join(resolve(dir),'package.json'));
  const geotiff=require('geotiff'),proj4=require('proj4');
  assert(typeof geotiff.fromUrl==='function'&&typeof proj4==='function','Raster module unavailable');
  return {geotiff,proj4};
}
const coordinateProjection=(image,proj4)=>{
  const key=image.getGeoKeys().ProjectedCSTypeGeoKey;
  assert([32640,32641,32642].includes(key),'Unexpected Landsat UTM CRS');
  const zone=key-32600;
  const utm='+proj=utm +zone='+zone+' +datum=WGS84 +units=m +no_defs';
  return {crs:'EPSG:'+key,project:p=>proj4('WGS84',utm,p)};
};
const windowFromBounds=(image,bbox,project)=>{
  const pts=[[bbox[0],bbox[1]],[bbox[0],bbox[3]],
    [bbox[2],bbox[1]],[bbox[2],bbox[3]]].map(project);
  const minX=Math.min(...pts.map(x=>x[0])),maxX=Math.max(...pts.map(x=>x[0]));
  const minY=Math.min(...pts.map(x=>x[1])),maxY=Math.max(...pts.map(x=>x[1]));
  const [ox,oy]=image.getOrigin(),[rx,ry]=image.getResolution();
  assert(rx>0&&ry<0,'Unexpected GeoTIFF grid axis orientation');
  const left=Math.max(0,Math.floor((minX-ox)/rx)),
    right=Math.min(image.getWidth(),Math.ceil((maxX-ox)/rx));
  const top=Math.max(0,Math.floor((maxY-oy)/ry)),
    bottom=Math.min(image.getHeight(),Math.ceil((minY-oy)/ry));
  assert(right-left>10&&bottom-top>10&&(right-left)*(bottom-top)<4_000_000,
    'Landsat scene does not cover enough of treaty reach');
  return [left,top,right,bottom];
};
const readBand=async(asset,token,{geotiff,proj4},bbox)=>{
  const url=new URL(asset.href);
  assert(url.protocol==='https:'&&url.hostname.endsWith('.blob.core.windows.net'),
    'Source is not an authenticated USGS Landsat COG');
  assert(!url.search,'STAC asset is unexpectedly already signed');
  const tiff=await geotiff.fromUrl(url.href+'?'+token,{allowFullFile:false});
  const image=await tiff.getImage(0);
  const projection=coordinateProjection(image,proj4);
  const window=windowFromBounds(image,bbox,projection.project);
  const data=await image.readRasters({window,samples:[0],interleave:false});
  return {data:data[0],window,crs:projection.crs,projection,origin:image.getOrigin(),
    resolution:image.getResolution(),width:window[2]-window[0],height:window[3]-window[1]};
};
const pixelMetric=({green,nir,qa},area)=>{
  const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>Math.abs(x-b[i])<1e-4);
  assert(green.width===nir.width&&green.width===qa.width
    &&green.height===nir.height&&green.height===qa.height
    &&equal(green.origin,nir.origin)&&equal(green.origin,qa.origin)
    &&equal(green.resolution,nir.resolution)&&equal(green.resolution,qa.resolution)
    &&equal(green.window,nir.window)&&equal(green.window,qa.window),'Landsat grid disagreement');
  const {valid,water,clean,waterN}=screenSpectralDN(green.data,nir.data,qa.data);
  const cleanPercent=Math.round(10000*clean/valid.length)/100;
  assert(cleanPercent>=50,'No representative cloud-free pixels in treaty reach');
  const nearest=[];
  const [ox,oy]=green.origin,[dx,dy]=green.resolution,
    [left,top]=green.window,w=green.width;
  for(const p of [area.start,area.end]){
    const [e,n]=green.projection.project(p);
    let best=Infinity;
    for(let i=0;i<water.length;i++)if(water[i]){
      const col=i%w,row=Math.floor(i/w);
      const x=ox+(left+col+.5)*dx,y=oy+(top+row+.5)*dy;
      const dist=Math.hypot(x-e,y-n);
      if(dist<best)best=dist;
    }
    nearest.push(Number.isFinite(best)?Math.round(best*10)/10:null);
  }
  return {gridCRS:green.crs,width:green.width,height:green.height,
    pixelSizeMeters:[Math.abs(dx),Math.abs(dy)],
    cleanPercent,waterCount:waterN,
    nearestWaterToTreatyAnchorsMeters:nearest,
    sourceMetricOnly:true};
};
export async function verifyLandsatPixels({years=YEARS,limitScenes=8}={}){
  const modules=scientificModules();
  const tokenBody=await fetchBoundedJson(SAS_TOKEN,{limit:10_000,timeoutMs:20000});
  const token=tokenBody.token;
  assert(typeof token==='string'&&token.includes('sig=')&&token.length<10000,
    'Invalid ephemeral container SAS token');
  const result={schema:'pando-baikonur-node-l2-pixel-validation-v1',
    years,originalDatumVerified:false,legalRightBankVerified:false,
    bankLinesReconstructed:false,osmDataUsed:false,siteMapChanged:false,
    source:'USGS public-domain Landsat Collection2 Level2 (node geotiff 2.1.3)',records:[]};
  for(const bounds of TREATY_BANK_BOXES){
    const [a,b]=bounds.treatyPointPair;
    const area={start:treatyPoint(a),end:treatyPoint(b),bbox:bounds.bbox};
    for(const year of years){
      const record={pair:[a,b],year,samples:[],unavailable:[]};
      try {
        const scenes=await getRawScenes(bounds.bbox,year);
        record.availableSceneCount=scenes.length;
        for(const scene of scenes.slice(0,limitScenes)){
          try {
            const assets=scene.assets;
            const first=await readBand(assets.green,token,modules,bounds.bbox);
            const second=await readBand(assets.nir08,token,modules,bounds.bbox);
            const third=await readBand(assets.qa_pixel,token,modules,bounds.bbox);
            const metrics=pixelMetric({green:first,nir:second,qa:third},area);
            record.samples.push({
              sceneId:scene.id,acquiredAt:scene.properties.datetime,
              sceneCloudPercent:scene.properties['eo:cloud_cover'],...metrics});
            if(record.samples.length>=2)break;
          }catch(e){
            record.unavailable.push({sceneId:scene.id,errorClass:e.name||'Error',
              messageCode:'SPECTRAL_WINDOW_UNAVAILABLE'});
          }
        }
      }catch(e){record.catalogFailureClass=e.name||'Error';}
      result.records.push(record);
      console.log('BAIKONUR_LANDSAT_NODE_OBSERVATION='+JSON.stringify({
        pair:record.pair,year,successfulScenes:record.samples.length,
        sampleWaterDistances:record.samples.map(x=>x.nearestWaterToTreatyAnchorsMeters),
        failures:record.unavailable.length}));
    }
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const argv=process.argv.slice(2);
    if(argv.length===1&&argv[0]==='--self-test'){
      const s=screenSpectralDN(new Uint16Array([16000,9000,16000]),
        new Uint16Array([9000,16000,9000]),new Uint16Array([0,0,8]));
      assert(s.clean===2&&s.waterN===1,'USGS spectral QA selftest failed');
      console.log('BAIKONUR_NODE_SPECTRAL_SELFTEST_OK');
    }else{
      assert(argv.length===2&&argv[0]==='--output','Use --self-test or --output FILE');
      const doc=await verifyLandsatPixels();
      writeFileSync(resolve(argv[1]),JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
      console.log('BAIKONUR_LANDSAT_NODE_FINAL='+JSON.stringify({
        samples:doc.records.map(x=>({pair:x.pair,year:x.year,n:x.samples.length})),
        legalBoundaryVerified:false,publishedGeometryModified:false
      }));
    }
  }catch(e){console.error(e.stack);process.exitCode=1;}
}
