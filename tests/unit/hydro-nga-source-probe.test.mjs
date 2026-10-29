import assert from 'node:assert/strict';
import test from 'node:test';
import {probeNgaStreams} from '../../tools/gis/probe-nga-streams.mjs';

test('admits only matching named stream points and retains their exact source query',async()=>{
 const seen=[];
 const result=await probeNgaStreams({fetcher:async url=>{seen.push(String(url));return new Response(JSON.stringify({features:[
  {attributes:{ufi:1,lat_dd:39,long_dd:126,full_name:'Taedong',desig_cd:'STM'}},
  {attributes:{ufi:1,lat_dd:39,long_dd:126,full_name:'Taedong',desig_cd:'STM'}},
  {attributes:{ufi:2,lat_dd:39,long_dd:126,full_name:'Taedong',desig_cd:'PPL'}},
  {attributes:{ufi:3,lat_dd:39,long_dd:126,full_name:'Unrelated',desig_cd:'STM'}}]}));}});
 assert.equal(seen.length,4);assert.equal(result.features.length,1);assert.equal(result.features[0].candidateSystem,'40391614');
 assert.equal(result.features[0].sourceQuery,seen[0]);assert.equal(result.queries.length,4);assert(result.queries.every(row=>row.status==='queried'));
});
test('holds failures and oversized responses without claiming missing government data',async()=>{
 for(const fetcher of [async()=>{throw Error('unreachable');},async()=>new Response('x'.repeat(200001)),async()=>new Response('{"error":{"code":500}}')]){
  const result=await probeNgaStreams({fetcher});assert.equal(result.features.length,0);assert(result.queries.every(row=>row.status==='failed'));
  assert(result.queries.every(row=>/not evidence/i.test(row.note)));
 }
});
