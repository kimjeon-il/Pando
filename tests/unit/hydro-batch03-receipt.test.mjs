import assert from 'node:assert/strict';
import test from 'node:test';
import {formatBatch03Receipts} from '../../tools/gis/hydro-independent-name-policy.mjs';
const ids=['40475481','40486439','41023100','41067217','41109275','41171836','41182380','41337891','41386179','41386700','41390476'];
const fixture=()=>({systemsReviewed:11,geoDataNotChanged:true,sourceOnlyScreen:true,approvalCount:0,baseline:'HydroRIVERS v0.13.2',
 items:ids.map((systemId,index)=>({systemId,originalNameKo:'이름',mainstemLengthKm:1,mainstemFeatures:1,mainstemLineSegments:1,independentPointChecks:index===0?Array.from({length:26},(_,i)=>({i})):[]})),
 governmentQueryReceipts:[{systemId:ids[0],kind:'test',status:'ok',url:'https://example.test'}]});
test('receipt output preserves every point in bounded ordered chunks and includes empty point lists',()=>{
 const lines=formatBatch03Receipts(fixture());assert.equal(lines[0],'FINAL_11_RESEARCH_SCREEN_SUCCESS');
 const chunks=lines.filter(line=>line.startsWith('OSM_BATCH03_POINT_CHUNK=')).map(line=>JSON.parse(line.split('=').slice(1).join('=')));
 assert.equal(chunks.length,12);assert.deepEqual(chunks.slice(0,2).map(x=>x.points.length),[25,1]);assert.equal(chunks[2].pointCount,0);
 const receipt=JSON.parse(lines.at(-1).slice('OSM_BATCH03_QUERY_RECEIPT='.length));assert.equal(receipt.raw,0);assert.equal(receipt.failureClass,null);
});
test('rejects altered scope, approval, geometry or missing mainstems',()=>{
 for(const change of [x=>x.items.reverse(),x=>{x.approvalCount=1;},x=>{x.geoDataNotChanged=false;},x=>{x.items[0].mainstemLengthKm=0;}]){
  const data=fixture();change(data);assert.throws(()=>formatBatch03Receipts(data));
 }
});
