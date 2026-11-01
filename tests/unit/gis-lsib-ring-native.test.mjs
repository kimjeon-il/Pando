import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {applyLSIBCountryPatches,extractLSIBSharedChains,replaceLSIBRings,validateLSIBCountryRepair} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-ring-oracle.json',import.meta.url),'utf8'));
test('ring batch rejects a missing owner and malformed coordinates before native execution',async()=>{
  await assert.rejects(replaceLSIBRings({geometries:{},patches:{missing:[]}}),/owner/i);
  await assert.rejects(replaceLSIBRings({geometries:{one:{}},patches:{one:[{old:[[0,0]],replacement:[[0,0],[1,1]]}]}}),/coordinates/i);
});
test('native shared-ring replacement preserves frozen Python geometry and refusals',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const geometries={one:row.geometry},patches={one:[{old:row.old,replacement:row.replacement}]};
    const before=structuredClone(geometries);
    if(row.error)await assert.rejects(replaceLSIBRings({geometries,patches},{binary}),error=>error.code==='LSIB_RING_REJECTED'&&/ring|owning|endpoint/i.test(error.message),row.name);
    else assert.deepEqual((await replaceLSIBRings({geometries,patches},{binary})).one,row.expected,row.name);
    assert.deepEqual(geometries,before,row.name);
  }
  const [left,right]=oracle.cases;
  const result=await replaceLSIBRings({geometries:{left:left.geometry,right:right.geometry},patches:{
    left:[{old:left.old,replacement:left.replacement}],right:[{old:right.old,replacement:right.replacement}]}},{binary});
  assert.deepEqual(result,{left:left.expected,right:right.expected});
  const reversed=await replaceLSIBRings({geometries:{right:right.geometry,left:left.geometry},patches:{}},{binary});
  assert.deepEqual(Object.keys(reversed),['right','left']);
});
test('selected AUT-LIE ring replacement matches frozen Python geometry',{
  skip:!binary||!process.env.PANDO_LSIB_RING_ORACLE
},async()=>{
  const input=JSON.parse(await readFile(process.env.PANDO_LSIB_RING_ORACLE,'utf8'));
  const result=await replaceLSIBRings({geometries:{AUT:input.geometry},patches:{AUT:[{old:input.expected,
    replacement:input.replacementExpected.coordinates}]}},{binary});
  assert.deepEqual(result.AUT,input.ringExpected);
});
test('a near-vertex anchor does not create a tiny backtrack',{skip:!binary},async()=>{
  const geometry={type:'Polygon',coordinates:[[[0,0],[3,0],[3,1],[3,2],[3,4],[3,5],[3,6],[0,6],[0,0]]]};
  const anchor=[3,5+5e-14],old=[anchor,[3,4],[3,2],[3,1]],replacement=[anchor,[3.2,4.2],[3.3,3],[3.2,1.8],[3,1]];
  const result=await replaceLSIBRings({geometries:{one:geometry},patches:{one:[{old,replacement}]}},{binary});
  const nearby=result.one.coordinates[0].slice(0,-1).filter(p=>Math.hypot(p[0]-anchor[0],p[1]-anchor[1])<1e-11);
  assert.deepEqual(nearby,[anchor]);
  assert.deepEqual(await validateLSIBCountryRepair({before:result,after:result},{binary}),{valid:true});
});
test('paired replacement validates both owners and surfaces missing native binary',{skip:!binary},async()=>{
  const old=[[2,0],[2,1],[2,2]],replacement=[[2,0],[2.1,1],[2,2]];
  const geometries={A:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,1],[2,2],[0,2],[0,0]]]},
    B:{type:'Polygon',coordinates:[[[2,0],[4,0],[4,2],[2,2],[2,1],[2,0]]]}};
  const patches=Object.fromEntries(Object.keys(geometries).map(code=>[code,[{old,replacement}]]));
  const before=structuredClone(geometries),after=await applyLSIBCountryPatches({geometries,patches},{binary});
  assert.deepEqual(geometries,before);assert.notDeepEqual(after,geometries);
  const shared=await extractLSIBSharedChains(after,{binary});
  assert.equal(shared.length,1);
  const points=shared[0].geometry.coordinates;
  assert.ok(JSON.stringify(points)===JSON.stringify(replacement)||JSON.stringify(points)===JSON.stringify([...replacement].reverse()));
  await assert.rejects(applyLSIBCountryPatches({geometries,patches},{binary:'missing-lsib-native'}),/native.*failed/i);
  await assert.rejects(validateLSIBCountryRepair({before:geometries,after},{binary:'missing-lsib-native'}),/native.*failed/i);
  await assert.rejects(extractLSIBSharedChains(geometries,{binary:'missing-lsib-native'}),/native.*failed/i);
});
