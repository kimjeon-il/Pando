import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const exterior=[[44,34],[58,34],[58,49],[44,49],[44,34]];
const former=[[48,39],[48,45],[54,45],[54,39],[48,39]];
const current=[[49,40],[49,44],[53,44],[53,40],[49,40]];
const far=[[100,1],[102,1],[102,2],[100,1]];
const polygon=rings=>({type:'Polygon',coordinates:rings});
const modern=()=>({type:'MultiPolygon',coordinates:[[exterior,former],[far]]});
const installed=()=>({type:'MultiPolygon',coordinates:[[exterior,current],[far]]});
const water=()=>polygon([[49,40],[53,40],[53,44],[49,44],[49,40]]);
function compute(t,request,{priorOutput=false}={}){
 assert.ok(binary,'Native GEOS/PROJ binary required');
 const dir=mkdtempSync(join(tmpdir(),'caspian-physical-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'approved-input.json'),output=join(dir,'private-rebuild.json');
 const frozen=JSON.stringify(request);
 writeFileSync(input,frozen);
 if(priorOutput)writeFileSync(output,'Do not overwrite me.');
 const r=spawnSync(binary,['--patch-caspian-physical',input,output],{
   encoding:'utf8',maxBuffer:2*1024*1024,
 });
 assert.equal(readFileSync(input,'utf8'),frozen);
 return {r,result:r.status===0?JSON.parse(readFileSync(output,'utf8')):null};
}
test('native Caspian physical-land rebuild keeps the far land and exactly repairs water',t=>{
 const source={modernLand:modern(),historicalWater:water(),expectedWaterHoles:0,
   publishedHistoricalLand:installed()};
 const {r,result}=compute(t,source);
 assert.equal(r.status,0,r.stderr);
 assert.equal(result.land.type,'MultiPolygon');
 assert.equal(result.metrics.historicalWaterHoles,0);
 assert.equal(result.metrics.publishedSymmetricDifferenceSquareDegrees,0);
 assert.equal(result.metrics.outsideRegionDifferenceSquareDegrees,0);
 assert.equal(result.metrics.unchangedFarPolygonCount,1);
 assert.equal(result.metrics.fullLandValid,true);
 assert.ok(result.metrics.modernWaterAreaKm2>result.metrics.historicalWaterAreaKm2);
});
test('native data validator rejects an altered published historical coastline instead of silently replacing it',t=>{
 const source={modernLand:modern(),historicalWater:water(),
   expectedWaterHoles:0,publishedHistoricalLand:modern()};
 const {r}=compute(t,source);
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Published Caspian land differs/);
});
test('native historical water must stay inside its 45–57E / 35–48N review window',t=>{
 const outside={type:'Polygon',coordinates:[[[60,40],[61,40],[61,41],[60,40]]]};
 const {r}=compute(t,{modernLand:modern(),historicalWater:outside,expectedWaterHoles:0});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/escaped its reconstruction window/);
});
test('physical historic master may only be written to a fresh output file',t=>{
 const {r}=compute(t,{modernLand:modern(),historicalWater:water(),expectedWaterHoles:0},
   {priorOutput:true});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Refusing to replace a historical physical asset candidate/);
});
