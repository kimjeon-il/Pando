import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {buildIndependentPointScreen} from '../../tools/gis/verify-independent-river-point-anchors.mjs';

const ids=['20071308','20075401','20456598','20532766','20540915'];
function fixture(){return {manifest:{version:'0.13.2'},features:ids.map(id=>({metadata:{systemId:id,role:'mainstem'},
  geometry:{type:'LineString',coordinates:[[25,64],[25.1,64.1]]}}))};}
test('independent Hydro screen preserves source attribution and delegates bounded geometry to native code',async()=>{
  const input=fixture(),before=structuredClone(input),calls=[];
  const result=await buildIndependentPointScreen(input,async request=>{
    calls.push(request);return {lineLengthsMeters:[123456.7],points:request.points.map((point,index)=>({distanceMeters:index?1062.5:1234.4,nearestLonLat:point}))};
  });
  assert.deepEqual(input,before);assert.equal(result.schema,'pando-independent-hydronym-point-screen-v1');
  assert.equal(result.nameIdentityVerified,false);assert.equal(result.geometryCopiedToRuntime,false);
  assert.deepEqual(result.items.map(row=>row.systemId),ids);assert.deepEqual(calls.map(row=>row.crs),['EPSG:32635','EPSG:32635','EPSG:32640','EPSG:32638','EPSG:32638']);
  assert.equal(result.items[0].mainstemTotalLengthKm,123.457);
  const point=result.items[0].pointChecks.finnish_nls_oulujoki;
  assert.equal(point.closestHydroMainstemKm,1.234);assert.deepEqual(point.nearestHydroLonLat,[25.56374,64.99977]);
  assert.match(point.source,/finto\.fi/);assert.match(point.sourceType,/National Land Survey/);
  assert.equal(result.items[0].pointChecks.finnish_nls_siikajoki.closestHydroMainstemKm,1.062);
});
test('independent Hydro screen refuses an existing output before reading input or launching a native tool',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-hydro-screen-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const output=join(root,'existing.json');writeFileSync(output,'preserve');
  const result=spawnSync(process.execPath,[resolve('tools/gis/verify-independent-river-point-anchors.mjs'),
    '--decoded',join(root,'missing.json'),'--output',output],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/exists/i);assert.equal(readFileSync(output,'utf8'),'preserve');
});
test('independent Hydro screen rejects wrong baseline, missing systems and invalid native receipts',async()=>{
  const valid=fixture();
  await assert.rejects(buildIndependentPointScreen({...valid,manifest:{version:'other'}},()=>{}),/0\.13\.2/);
  await assert.rejects(buildIndependentPointScreen({...valid,features:valid.features.slice(1)},()=>{}),/missing mainstem/i);
  await assert.rejects(buildIndependentPointScreen(valid,async()=>({lineLengthsMeters:[],points:[]})),/native.*result/i);
});
