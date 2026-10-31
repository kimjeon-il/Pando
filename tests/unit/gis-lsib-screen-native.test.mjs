import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-screen-distance-oracle.json',import.meta.url),'utf8'));
function invoke(source,target){return spawnSync(binary,['--sampled-lsib-screen','-'],{
  input:JSON.stringify({source,target}),encoding:'utf8',windowsHide:true});}
test('native LSIB screen sampling matches the frozen GEOS reference in both directions',{skip:!binary},()=>{
  for(const row of oracle.cases)for(const [source,target,distance,count] of [
    [row.source,row.target,row.forward,row.forwardSamples],[row.target,row.source,row.reverse,row.reverseSamples]]){
    const result=invoke(source,target);assert.equal(result.status,0,`${row.name}: ${result.stderr}`);
    const actual=JSON.parse(result.stdout);assert.equal(actual.samples,count,row.name);
    assert.ok(Math.abs(actual.sampledMaximumCssPx-distance)<1e-10,`${row.name}: ${actual.sampledMaximumCssPx} vs ${distance}`);
  }
});
test('native LSIB screen sampling rejects malformed coordinates',{skip:!binary},()=>{
  for(const [source,target] of [[[],[[0,0],[1,1]]],[[[0,0],[1,1]],[[0,0]]],[[[0,0],[1,'bad']],[[0,0],[1,1]]]]){
    const result=invoke(source,target);assert.notEqual(result.status,0);assert.ok(result.stderr);
  }
});
