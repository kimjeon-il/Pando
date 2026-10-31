import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareLSIBReference} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-reference-oracle.json',import.meta.url),'utf8'));
test('GEOS selects and trims LSIB reference lines like the frozen Python cases',{skip:!binary},async()=>{
  for(const row of oracle.cases){const actual=await prepareLSIBReference(row,{binary});
    assert.equal(actual.length,row.expected.length,row.name);
    for(let i=0;i<actual.length;i++)for(let c=0;c<2;c++)
      assert.ok(Math.abs(actual[i][c]-row.expected[i][c])<1e-12,`${row.name} coordinate ${i}/${c}`);
  }
});
test('GEOS rejects a closed reference when the source is open',{skip:!binary},async()=>{
  const row=oracle.cases[0];await assert.rejects(prepareLSIBReference({...row,closedRing:true,anchors:[]},{binary}),/closed/i);
});
test('GEOS reference selection matches a preserved AUT-LIE source',{skip:!binary||!process.env.PANDO_LSIB_DISPLAY_ORACLE},async()=>{
  const row=JSON.parse(await readFile(process.env.PANDO_LSIB_DISPLAY_ORACLE,'utf8'));
  const actual=await prepareLSIBReference({geometries:[{type:'LineString',coordinates:row.reference}],anchors:row.anchors,merge:true,closedRing:false},{binary});
  assert.equal(actual.length,row.reference.length);
  for(let i=0;i<actual.length;i++)for(let c=0;c<2;c++)assert.ok(Math.abs(actual[i][c]-row.reference[i][c])<1e-12);
});
