import assert from 'node:assert/strict';
import test from 'node:test';
import {planetarySignQuery,planetarySceneQuery,PLANETARY_COLLECTION,
  probePlanetaryBaikonur} from '../../tools/gis/probe-baikonur-planetary-landsat.mjs';
import {TREATY_BANK_BOXES} from '../../tools/gis/probe-baikonur-government-hydrography.mjs';
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
