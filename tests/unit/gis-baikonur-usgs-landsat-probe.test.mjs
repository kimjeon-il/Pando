import assert from 'node:assert/strict';
import test from 'node:test';
import {TREATY_BANK_BOXES} from '../../tools/gis/probe-baikonur-government-hydrography.mjs';
import {LANDSAT_STAC_COLLECTION,makeLandsatSceneSearchUrl,
  filterUsableLandsatScenes,probePublicDomainBaikonurScenes}
  from '../../tools/gis/probe-baikonur-usgs-landsat.mjs';
const bands=()=>({green:{href:'https://usgs.example.test/b3.tif'},
  nir08:{href:'https://usgs.example.test/b5.tif'},
  qa_pixel:{href:'https://usgs.example.test/qa.tif'}});
const scene=(id,cloud,assets=bands())=>({
  type:'Feature',id,collection:'landsat-c2-l2',
  properties:{'eo:cloud_cover':cloud,datetime:'2025-08-01T03:00:00Z'},
  assets,
});
test('2017/1994 treaty endpoints constrain only the two independently needed bank arcs',()=>{
  assert.equal(TREATY_BANK_BOXES.length,2);
  assert.deepEqual(TREATY_BANK_BOXES.map(x=>x.treatyPointPair),[[17,18],[31,1]]);
  for(const row of TREATY_BANK_BOXES){
    const url=new URL(makeLandsatSceneSearchUrl(row.bbox));
    assert.equal(url.origin,'https://earth-search.aws.element84.com');
    assert.equal(url.origin+url.pathname,LANDSAT_STAC_COLLECTION);
    assert.equal(url.searchParams.get('limit'),'80');
    assert.match(url.searchParams.get('datetime'),/2025-04-01/);
    assert.equal(url.searchParams.get('bbox'),row.bbox.map(x=>x.toFixed(7)).join(','));
  }
});
test('scene inventory selects public HTTPS USGS spectral and QA bands, not OSM geometry',()=>{
  const sample={type:'FeatureCollection',features:[
    scene('clear-public',3),scene('cloudy',89),
    scene('requester-pays',1,{green:{href:'s3://private/green.tif'},
      nir08:{href:'https://public/b5.tif'},qa_pixel:{href:'https://public/qa.tif'}}),
    scene('clear-public2',7),{...scene('different-collection',1),collection:'sentinel-2-c1-l2a'},
  ]};
  const result=filterUsableLandsatScenes(sample);
  assert.deepEqual(result.candidates.map(x=>x.sceneId),['clear-public','clear-public2']);
  assert.equal(result.rejected.cloudAbove20,1);
  assert.equal(result.rejected.nonPublicAssetUrl,1);
  assert.equal(result.rejected.notLandsatCollection,1);
  assert(result.candidates.every(x=>x.classification==='STAC_DISCOVERY_ONLY_IMAGE_PIXELS_NOT_ANALYZED'));
});
test('probe retains no raster bytes and never claims a digitized legal bank',async()=>{
  const urls=[];
  const out=await probePublicDomainBaikonurScenes({fetcher:async url=>{
    urls.push(String(url));
    return new Response(JSON.stringify({type:'FeatureCollection',features:[scene('scene-one',9)]}),
      {status:200,headers:{'content-type':'application/json'}});
  }});
  assert.equal(urls.length,2);
  assert(out.bankSections.every(x=>x.status==='public-domain-scenes-discovered'));
  assert(out.bankSections.every(x=>x.matchedInQuery===1));
  assert.equal(out.shorelineDigitized,false);
  assert.equal(out.geometryCopiedIntoPublishedMap,false);
  assert.equal(out.treatyRiverbankIdentified,false);
  assert(!JSON.stringify(out).includes('openstreetmap.org'));
});
test('no imagery available is not a claim that the riverbank has no satellite coverage',async()=>{
  const out=await probePublicDomainBaikonurScenes({fetcher:async()=>{throw Error('offline');}});
  assert.equal(out.bankSections.length,2);
  assert(out.bankSections.every(x=>x.status==='unavailable'
    &&x.notice.includes('not evidence')));
});
