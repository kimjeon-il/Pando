import { describe as contractSuite } from 'node:test';
import * as __source_dep0 from "node:assert/strict";
import * as __source_dep1 from "node:test";
import * as __source_dep2 from "../../tools/gis/probe-baikonur-1994-landsat.mjs";
import * as __source_dep3 from "../../tools/gis/probe-baikonur-government-hydrography.mjs";
import * as __source_dep4 from "../../tools/gis/baikonur-landsat-pixel-preflight.mjs";
import * as __source_dep5 from "../../tools/gis/probe-baikonur-planetary-landsat.mjs";
import * as __source_dep6 from "../../tools/gis/baikonur-landsat-water-mask.mjs";

// Original feature contract: gis-baikonur-1994-landsat.test.mjs
contractSuite("gis-baikonur-1994-landsat", () => {
const assert = __source_dep0.default;
const test = __source_dep1.default;
const { sceneYearQuery, HISTORIC_SCENE_YEARS, auditBaikonurHistoricSceneAvailability } = __source_dep2;
const { TREATY_BANK_BOXES } = __source_dep3;





const assets={
  green:{href:'https://landsatplanetary.blob.core.windows.net/landsat/green.tif'},
  nir08:{href:'https://landsatplanetary.blob.core.windows.net/landsat/nir08.tif'},
  qa_pixel:{href:'https://landsatplanetary.blob.core.windows.net/landsat/qa_pixel.tif'}
};
test('exact treaty years and local geographic boxes only',()=>{
  assert.deepEqual(HISTORIC_SCENE_YEARS,[1994,1995,2019,2020]);
  for(const b of TREATY_BANK_BOXES)for(const year of HISTORIC_SCENE_YEARS){
    const u=new URL(sceneYearQuery(b.bbox,year));
    assert.equal(u.hostname,'planetarycomputer.microsoft.com');
    assert.equal(u.searchParams.get('datetime'),
      year+'-01-01T00:00:00Z/'+year+'-12-31T23:59:59Z');
    assert.equal(u.pathname,'/api/stac/v1/search');
    assert.equal(u.searchParams.get('collections'),'landsat-c2-l2');
    assert.equal(u.searchParams.get('limit'),'100');
  }
  assert.throws(()=>sceneYearQuery([63,45,64,46],1996),/Unreviewed/);
  assert.throws(()=>sceneYearQuery([64,46,63,45],1994),/bounds/);
});
test('metadata records are NOT historic shorelines or approved legal borders',async()=>{
  const requested=[];
  const response=await auditBaikonurHistoricSceneAvailability({
    fetcher:async input=>{
      requested.push(String(input));
      const year=Number(new URL(input).searchParams.get('datetime').slice(0,4));
      return new Response(JSON.stringify({type:'FeatureCollection',features:[
        {type:'Feature',collection:'landsat-c2-l2',id:'LANDSAT-'+year,
          properties:{datetime:year+'-07-10T05:00:00Z','eo:cloud_cover':12},
          assets},
      ]}),{status:200,headers:{'content-type':'application/json'}});
    },
  });
  assert.equal(requested.length,8);
  assert.equal(response.records.length,8);
  assert(response.records.every(x=>x.candidates.length===1));
  assert(response.records.every(x=>x.candidates[0].verifiedPixels===false));
  assert.equal(response.appliedPublishedGeometry,false);
  assert.equal(response.legalHistoricRightBankVerified,false);
  assert.equal(response.osmDataUsed,false);
});
test('unreachable STAC cannot assert valid scene imagery',async()=>{
  const r=await auditBaikonurHistoricSceneAvailability({
    fetcher:async()=>{throw Error('offline');}
  });
  assert.equal(r.records.length,8);
  assert(r.records.every(x=>x.status==='source-not-available'
    &&x.candidates.length===0&&x.reasons.length>0));
});
});

// Original feature contract: gis-baikonur-node-pixels.test.mjs
contractSuite("gis-baikonur-node-pixels", () => {
const assert = __source_dep0.default;
const test = __source_dep1.default;
const { screenSpectralDN, measureSpectralConnectivity } = __source_dep4;



test('clear Landsat 5 green and NIR reflectance classifies true water',()=>{
  const green=new Uint16Array([16000,9000,16000,16000]);
  const nir=new Uint16Array([9000,16000,9000,9000]);
  const qa=new Uint16Array([0,0,8,1]);
  const r=screenSpectralDN(green,nir,qa);
  assert.equal(r.clean,2);
  assert.equal(r.waterN,1);
  assert.deepEqual([...r.water],[1,0,0,0]);
});
test('cloud, fill, snow, shadow and negative reflectance are not usable water',()=>{
  const g=new Uint16Array([15000,15000,15000,15000,7000]);
  const n=new Uint16Array([8000,8000,8000,8000,7000]);
  const qa=new Uint16Array([1,2,8,32,0]);
  const r=screenSpectralDN(g,n,qa);
  assert.equal(r.clean,0);
  assert.equal(r.waterN,0);
});
test('spectral grids cannot mix pixels of unequal lengths',()=>{
  assert.throws(()=>screenSpectralDN(new Uint16Array(2),
    new Uint16Array(3),new Uint16Array(2)),/Unaligned/);
});

test('8-neighbour spectral connectivity accepts an actual shared water component',()=>{
  const w=new Uint8Array([
    1,0,0,0,0,
    0,1,0,0,0,
    0,0,1,0,0,
    0,0,0,1,0,
  ]);
  const audit=measureSpectralConnectivity(w,5,4,[0,18]);
  assert.equal(audit.componentCount,1);
  assert.equal(audit.maxComponentSize,4);
  assert.equal(audit.bothAnchorsOnSameWaterComponent,true);
});
test('disconnected river candidates must not be treated as one legal shoreline',()=>{
  const w=new Uint8Array([
    1,1,0,0,1,
    1,0,0,0,1,
    0,0,0,0,1,
  ]);
  const audit=measureSpectralConnectivity(w,5,3,[0,14]);
  assert.equal(audit.componentCount,2);
  assert.equal(audit.bothAnchorsOnSameWaterComponent,false);
});
test('zero-water and off-grid points cannot generate a false connected-bank claim',()=>{
  const zeros=measureSpectralConnectivity(new Uint8Array(12),4,3,[-1,11]);
  assert.equal(zeros.componentCount,0);
  assert.equal(zeros.bothAnchorsOnSameWaterComponent,false);
  assert.throws(()=>measureSpectralConnectivity(new Uint8Array(12),3,3),/dimensions/);
});
});

// Original feature contract: gis-baikonur-planetary-landsat.test.mjs
contractSuite("gis-baikonur-planetary-landsat", () => {
const assert = __source_dep0.default;
const test = __source_dep1.default;
const { planetarySignQuery, planetarySceneQuery, PLANETARY_COLLECTION, probePlanetaryBaikonur } = __source_dep5;
const { TREATY_BANK_BOXES } = __source_dep3;




const origin='https://landsatplanetary.blob.core.windows.net/landsat/';
const row=(id)=>({
  type:'Feature',collection:'landsat-c2-l2',id,
  properties:{datetime:'2025-08-02T00:00:00Z','eo:cloud_cover':2.1},
  assets:{
    green:{href:origin+id+'_green.TIF'},
    nir08:{href:origin+id+'_nir08.TIF'},
    qa_pixel:{href:origin+id+'_qa.TIF'},
  },
});
test('restricts the public-domain search to exact treaty bank point windows',()=>{
  for(const {bbox} of TREATY_BANK_BOXES){
    const url=new URL(planetarySceneQuery(bbox));
    assert.equal(url.origin+url.pathname,PLANETARY_COLLECTION);
    assert.equal(url.searchParams.get('limit'),'80');
  }
});
test('SAS sign endpoint rejects non Azure government or attacker URLs',()=>{
  const good=planetarySignQuery(origin+'river_green.TIF');
  assert.equal(new URL(good).searchParams.get('href'),origin+'river_green.TIF');
  for(const bad of ['https://example.com/river.tif','s3://bucket/river.tif',
    'https://evil-blob.core.windows.net.attacker.tld/river.tif'])
    assert.throws(()=>planetarySignQuery(bad),/only ordinary Azure blob/);
});
test('ephemeral token is never stored or emitted in report after HEAD accessibility check',async()=>{
  const secret='sig=verySecret_DoNotStore_MUST_NOT_LEAK';
  const requested=[];
  const report=await probePlanetaryBaikonur({fetcher:async(url,opts={})=>{
    requested.push({hostname:new URL(url).hostname,method:opts.method||'GET'});
    if(opts.method==='HEAD'){
      assert(url.includes(secret));
      return new Response(null,{status:206,headers:{'accept-ranges':'bytes'}});
    }
    if(String(url).includes('/api/sas/v1/sign')){
      const href=new URL(url).searchParams.get('href');
      return new Response(JSON.stringify({href:href+'?'+secret}),
        {status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify({type:'FeatureCollection',features:[row('LC08_C2_TEST')]}),
      {status:200,headers:{'content-type':'application/json'}});
  }});
  assert.equal(requested.length,6);
  assert.equal(report.sections.length,2);
  assert(report.sections.every(x=>x.result==='public-domain-candidate-scenes-found'));
  assert(report.sections.every(x=>x.signedPixelReadTestStatus==='cog-readable-head'));
  assert.equal(report.tokenOrSignedUrlSaved,false);
  assert.equal(report.imagePixelsDownloaded,false);
  assert.equal(report.geometryPublished,false);
  assert(!JSON.stringify(report).includes(secret));
});
test('an unavailable STAC or SAS service never becomes a claim that imagery is missing',async()=>{
  const result=await probePlanetaryBaikonur({fetcher:async()=>{throw Error('offline');}});
  assert(result.sections.every(x=>x.result==='unavailable'));
  assert.equal(result.rightBankReconstructed,false);
});
});

// Original feature contract: gis-baikonur-landsat-water-mask.test.mjs
contractSuite("gis-baikonur-landsat-water-mask", () => {
const assert = __source_dep0.default;
const test = __source_dep1.default;
const { surfaceReflectance, classifyLandsatWater, usableScenes, calculateWaterMask, waterPathConnected, sceneCoversBbox } = __source_dep6;




const scene=(id,cloud,date='2025-07-10T00:00:00Z',collection='landsat-c2-l2')=>({
  id,collection,properties:{datetime:date,'eo:cloud_cover':cloud},
  assets:Object.fromEntries(['green','nir08','qa_pixel'].map(key=>
    [key,{href:'https://landsatlook.blob.core.windows.net/landsat/'+id+'_'+key+'.TIF'}])),
});
test('USGS L2 offsets are mandatory, not raw DN NDWI',()=>{
 assert.equal(surfaceReflectance(0),null);
 assert(Math.abs(surfaceReflectance(10000)-.075)<1e-10);
 assert(Math.abs(surfaceReflectance(20000)-.35)<1e-10);
 const water=classifyLandsatWater(11500,8200,128);
 assert.equal(water.valid,true);
 assert.equal(water.water,true);
 const land=classifyLandsatWater(12000,16800,0);
 assert.equal(land.valid,true);
 assert.equal(land.water,false);
 assert.equal(classifyLandsatWater(11500,8200,128|8).water,false);
 assert.equal(classifyLandsatWater(11500,8200,128|16).valid,false);
 assert.equal(classifyLandsatWater(11500,8200,128|32).valid,false);
 assert.equal(classifyLandsatWater(0,8200,128).valid,false);
});
test('scene discovery excludes non-public signed assets, winter and clouds before spectral work',()=>{
 const ok=scene('LC09_STAC_OK',3),winter=scene('LC08_WINTER',0,'2025-01-10T00:00:00Z'),
  cloud=scene('LC08_CLOUDS',65),external=scene('LC08_EXTERNAL',1);
 external.assets.green.href='s3://private-bucket/green.tif';
 assert.deepEqual(usableScenes([cloud,ok,external,winter]).map(x=>x.id),['LC09_STAC_OK']);
 assert.deepEqual(usableScenes([scene('LC09_OLD',1,'2019-08-01T00:00:00Z'),ok],
  '2025-05-01T00:00:00Z/2025-09-30T23:59:59Z').map(x=>x.id),['LC09_STAC_OK']);
});
test('WRS scene footprint must cover both legal endpoints and the whole bank box',()=>{
 const box=[62.97,45.55,63.76,45.80];
 const complete=scene('LC08_FULL_2019',1,'2019-08-01T00:00:00Z');
 complete.geometry={type:'Polygon',coordinates:[[[62.7,45.3],[64,45.3],
   [64,46.1],[62.7,46.1],[62.7,45.3]]]};
 const sliver=scene('LC08_SLIVER_2019',.5,'2019-08-01T00:00:00Z');
 sliver.geometry={type:'Polygon',coordinates:[[[62.7,45.3],[63.1,45.3],
   [63.1,46.1],[62.7,46.1],[62.7,45.3]]]};
 assert.equal(sceneCoversBbox(complete,box),true);
 assert.equal(sceneCoversBbox(sliver,box),false);
 assert.deepEqual(usableScenes([sliver,complete],
   '2019-05-01T00:00:00Z/2019-09-30T23:59:59Z',box).map(x=>x.id),
   ['LC08_FULL_2019']);
});
test('three prealigned GDAL UTM rasters produce honest water/valid counts',()=>{
 const pack=values=>{const raw=Buffer.alloc(values.length*2);values.forEach((v,i)=>raw.writeUInt16LE(v,i*2));
 return {data:raw,info:{size:[3,2],geoTransform:[400000,30,0,5100000,0,-30]}};};
 const a=pack([11500,12000,0,11500,12000,11500]);
 const b=pack([8200,16800,0,8200,16800,8200]);
 const q=pack([128,0,0,128|8,0,128]);
 const data=calculateWaterMask(a,b,q);
 assert.equal(data.valid,4);
 assert.equal(data.water,2);
 assert.deepEqual([...data.mask],[1,0,0,0,0,1]);
 assert.equal(data.width,3);
 assert.equal(data.height,2);
 const shifted={...b,info:{...b.info,geoTransform:[400001,30,0,5100000,0,-30]}};
 assert.throws(()=>calculateWaterMask(a,shifted,q),/exactly identical/);
});
test('channel connectivity uses independent pixel water mask and 8-way continuity',()=>{
 const mask=new Uint8Array(10*6);
 for(let x=0;x<9;x++)mask[2*10+x]=1;
 mask[3*10+9]=1;
 assert.equal(waterPathConnected(mask,10,6,[0,2],[9,3]),true);
 mask[2*10+5]=0;
 assert.equal(waterPathConnected(mask,10,6,[0,2],[9,3]),false);
 assert.equal(waterPathConnected(mask,10,6,[0,2],[20,2]),false);
});
});
