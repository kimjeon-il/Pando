import assert from 'node:assert/strict';
import test from 'node:test';
import {TREATY_BANK_BOXES,HYDROGRAPHY_LAYER_IDS,
  governmentBaikonurQuery,probeBaikonurGovernmentHydrography}
from '../../tools/gis/probe-baikonur-government-hydrography.mjs';

test('all scope windows derive solely from the 1994 Kazakhstan treaty anchors',()=>{
  assert.deepEqual(TREATY_BANK_BOXES.map(v=>v.treatyPointPair),[[17,18],[31,1]]);
  assert.deepEqual(HYDROGRAPHY_LAYER_IDS,[8,9]);
  for(const bank of TREATY_BANK_BOXES){
    assert(bank.bbox[0]>62&&bank.bbox[2]<65);
    assert(bank.bbox[1]>45&&bank.bbox[3]<46);
    const url=new URL(governmentBaikonurQuery({layerId:8,bbox:bank.bbox}));
    assert.equal(url.hostname,'gis.kgp.kz');
    assert.equal(url.searchParams.get('returnGeometry'),'false');
    assert.equal(url.searchParams.get('geometryType'),'esriGeometryEnvelope');
    assert.equal(url.searchParams.get('f'),'json');
  }
});
test('government hydrology query collects named candidates but not the unlicensed geometry',async()=>{
  const seen=[];
  const output=await probeBaikonurGovernmentHydrography({fetcher:async url=>{
    seen.push(String(url));
    return new Response(JSON.stringify({features:[
      {attributes:{objectid:1,name:'Сырдарья'},geometry:{rings:[[[1,2],[3,4]]]}},
      {attributes:{objectid:2,name_kk:'Сырдария'},geometry:{paths:[[[9,8],[7,6]]]}},
    ]}),{status:200,headers:{'content-type':'application/json'}});
  }});
  assert.equal(seen.length,4);
  assert.equal(output.maps.length,4);
  assert(output.maps.every(x=>x.status==='candidate-attributes-received'
    &&x.featureCount===2&&x.geometryRetained===false
    &&x.independentProvenanceUnverified));
  assert(output.geometryCopiedIntoPublishedMap===false);
  assert(!JSON.stringify(output).includes('rings'));
  assert(!JSON.stringify(output).includes('paths'));
  assert.match(output.rights,/UNVERIFIED/);
});
test('unavailable external data cannot be classified as a verified bank or licensed geometry',async()=>{
  const report=await probeBaikonurGovernmentHydrography({fetcher:async()=>{
    throw Error('offline');
  }});
  assert(report.maps.every(x=>x.status==='unavailable'&&/not evidence/.test(x.note)));
  assert.equal(report.geometryApproved,false);
  assert.equal(report.geometryExported,false);
});
