import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {classifyLSIBSpatial} from '../../tools/gis/lsib-screen-native.mjs';

const fixture=JSON.parse(await readFile(new URL('../fixtures/lsib-spatial-oracle.json',import.meta.url),'utf8'));
function compare(actual,expected){
  assert.deepEqual(actual.disputed,expected.disputed);assert.equal(actual.chains.length,expected.chains.length);
  for(let i=0;i<actual.chains.length;i++){
    assert.equal(actual.chains[i].isRing,expected.chains[i].isRing);
    assert.ok(Math.abs(actual.chains[i].length-expected.chains[i].length)<1e-10);
    assert.deepEqual(actual.chains[i].nearby,expected.chains[i].nearby);
  }
}
test('spatial classification matches frozen Python buffer, ring and distance rules',async()=>{
  const input=structuredClone(fixture);compare(await classifyLSIBSpatial(input),fixture.expected);assert.deepEqual(input,fixture);
});
test('spatial classification surfaces native failures',async()=>{
  await assert.rejects(classifyLSIBSpatial(fixture,{binary:'missing-lsib-native'}),/native.*failed/i);
});
test('selected AUT/LIE and Natural Earth disputes match the Python result',{skip:!process.env.PANDO_LSIB_SPATIAL_ORACLE},async()=>{
  const fixture=JSON.parse(await readFile(process.env.PANDO_LSIB_SPATIAL_ORACLE,'utf8'));
  compare(await classifyLSIBSpatial(fixture),fixture.expected);
});
