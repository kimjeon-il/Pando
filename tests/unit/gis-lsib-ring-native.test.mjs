import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {replaceLSIBRings} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-ring-oracle.json',import.meta.url),'utf8'));
test('native shared-ring replacement preserves frozen Python geometry and refusals',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const geometries={one:row.geometry},patches={one:[{old:row.old,replacement:row.replacement}]};
    const before=structuredClone(geometries);
    if(row.error)await assert.rejects(replaceLSIBRings({geometries,patches},{binary}),/ring|owning|endpoint/i,row.name);
    else assert.deepEqual((await replaceLSIBRings({geometries,patches},{binary})).one,row.expected,row.name);
    assert.deepEqual(geometries,before,row.name);
  }
  const [left,right]=oracle.cases;
  const result=await replaceLSIBRings({geometries:{left:left.geometry,right:right.geometry},patches:{
    left:[{old:left.old,replacement:left.replacement}],right:[{old:right.old,replacement:right.replacement}]}},{binary});
  assert.deepEqual(result,{left:left.expected,right:right.expected});
});
test('selected AUT-LIE ring replacement matches frozen Python geometry',{
  skip:!binary||!process.env.PANDO_LSIB_RING_ORACLE
},async()=>{
  const input=JSON.parse(await readFile(process.env.PANDO_LSIB_RING_ORACLE,'utf8'));
  const result=await replaceLSIBRings({geometries:{AUT:input.geometry},patches:{AUT:[{old:input.expected,
    replacement:input.replacementExpected.coordinates}]}},{binary});
  assert.deepEqual(result.AUT,input.ringExpected);
});
