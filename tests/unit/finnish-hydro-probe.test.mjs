import assert from 'node:assert/strict';
import test from 'node:test';
import {probeFinnishHydro} from '../../tools/gis/probe-finnish-hydro.mjs';

test('records only a bounded response summary without copying source geometry',async()=>{
  let seen;
  const result=await probeFinnishHydro({fetcher:async(url,options)=>{seen={url:String(url),options};
    return new Response(JSON.stringify({type:'FeatureCollection',features:[{properties:{name:'river',id:7},geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}]}),{status:200});}});
  assert.match(seen.url,/^https:\/\/avoin-paikkatieto/);assert.equal(seen.options.headers.Accept,'application/geo+json, application/json');
  assert.equal(result.status,'sample-retrieved');assert.equal(result.featureCount,1);assert.deepEqual(result.sampleProperties,['name','id']);
  assert.equal(result.downloadedRawLinesIntoRuntime,false);assert.equal(JSON.stringify(result).includes('coordinates'),false);
});
test('unavailable, invalid or oversized service responses never become evidence that data is absent',async()=>{
  for(const fetcher of [async()=>{throw Error('offline');},async()=>new Response('invalid'),async()=>new Response('x'.repeat(1000001))]){
    const result=await probeFinnishHydro({fetcher});assert.equal(result.status,'unavailable');
    assert.match(result.note,/not evidence of missing national data/i);assert.equal(result.downloadedRawLinesIntoRuntime,false);
  }
});
test('refuses an unencrypted redirect before requesting it',async()=>{
  let count=0;
  const result=await probeFinnishHydro({fetcher:async()=>{count++;return new Response(null,{status:302,headers:{location:'http://example.test/insecure'}});}});
  assert.equal(count,1);assert.equal(result.status,'unavailable');
});
