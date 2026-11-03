import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sceneYearQuery,HISTORIC_SCENE_YEARS,
  auditBaikonurHistoricSceneAvailability
} from '../../tools/gis/probe-baikonur-1994-landsat.mjs';
import {TREATY_BANK_BOXES}
  from '../../tools/gis/probe-baikonur-government-hydrography.mjs';

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
