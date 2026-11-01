import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {extractLSIBSharedChains} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-shared-oracle.json',import.meta.url),'utf8'));
test('native shared-edge ownership preserves Python source order and excludes three-owner edges',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const original=structuredClone(row.geometries);
    assert.deepEqual(await extractLSIBSharedChains(row.geometries,{binary}),row.expected,row.name);
    assert.deepEqual(row.geometries,original,row.name);
  }
});
test('selected AUT-LIE shared line matches frozen Python coordinates',{
  skip:!binary||!process.env.PANDO_LSIB_SHARED_ORACLE
},async()=>{
  const row=JSON.parse(await readFile(process.env.PANDO_LSIB_SHARED_ORACLE,'utf8'));
  assert.deepEqual(await extractLSIBSharedChains(row.geometries,{binary}),row.expected);
});
