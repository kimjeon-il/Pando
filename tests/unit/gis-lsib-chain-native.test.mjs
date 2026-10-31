import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareLSIBReplacements} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-chain-oracle.json',import.meta.url),'utf8'));
function equivalent(actual,expected){
  for(const key of ['retained_length_degrees','source_length_degrees','replaced_length_degrees','simplification_bound_px'])
    assert.ok(Math.abs(actual[key]-expected[key])<1e-10,`${key}: ${actual[key]} vs ${expected[key]}`);
  for(const key of ['master_vertices','derived_vertices'])assert.equal(actual[key],expected[key],key);
  for(const key of ['anchors','coordinates']){
    assert.equal(actual[key].length,expected[key].length,key);
    for(let i=0;i<actual[key].length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(actual[key][i][j]-expected[key][i][j])<1e-10,`${key} ${i}/${j}`);
  }
}
test('batched LSIB replacement retains frozen Python geometry and refusal cases',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const [result]=await prepareLSIBReplacements(row.old,[row.reference],{binary});
    if(row.error)assert.match(result.error,/anchor|coverage|correspondence/i,row.name);
    else {
      equivalent(result.value,row.expected);
      for(const anchor of result.value.anchors)assert.equal(result.value.coordinates.filter(point=>Math.hypot(point[0]-anchor[0],point[1]-anchor[1])<1e-12).length,1,row.name);
    }
  }
  const first=oracle.cases[0],failed=oracle.cases[3];
  const rows=await prepareLSIBReplacements(first.old,[first.reference,failed.reference],{binary});
  equivalent(rows[0].value,first.expected);assert.ok(rows[1].error);
});
test('selected AUT-LIE replacement matches its frozen Python result',{
  skip:!binary||!process.env.PANDO_LSIB_CHAIN_ORACLE
},async()=>{
  const input=JSON.parse(await readFile(process.env.PANDO_LSIB_CHAIN_ORACLE,'utf8'));
  const [result]=await prepareLSIBReplacements(input.expected,[input.reference],{binary});
  equivalent(result.value,input.replacementExpected);
});
