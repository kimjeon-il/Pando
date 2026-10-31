import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareLSIBReviewed} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
test('GEOS validates reviewed open coastlines and rejects closed or crossing lines',{skip:!binary},async()=>{
  const line={type:'LineString',coordinates:[[7,43],[7.1,43.1],[7.2,43.1]]};
  assert.deepEqual(await prepareLSIBReviewed('coast',line,{binary}),line.coordinates);
  await assert.rejects(prepareLSIBReviewed('coast',{type:'LineString',coordinates:[[0,0],[1,0],[0,0]]},{binary}),/simple open/i);
  await assert.rejects(prepareLSIBReviewed('coast',{type:'LineString',coordinates:[[0,0],[1,1],[0,1],[1,0]]},{binary}),/simple open/i);
});
test('GEOS transforms a reviewed polygon exterior and refuses holes',{skip:!binary},async()=>{
  const ring=[[12.4,43.9],[12.5,43.9],[12.5,44],[12.4,43.9]],geometry={type:'Polygon',coordinates:[ring]};
  const actual=await prepareLSIBReviewed('igm',geometry,{binary});assert.equal(actual.length,ring.length);
  for(let i=0;i<ring.length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(actual[i][j]-ring[i][j])<1e-8);
  await assert.rejects(prepareLSIBReviewed('igm',{...geometry,coordinates:[ring,ring]},{binary}),/polygon without holes/i);
});
test('reviewed source lines match the retained Python/PROJ result',{skip:!binary||!process.env.PANDO_LSIB_REVIEWED_ORACLE},async()=>{
  const {items}=JSON.parse(await readFile(process.env.PANDO_LSIB_REVIEWED_ORACLE,'utf8'));
  for(const row of items){const actual=await prepareLSIBReviewed(row.mode,row.geometry,{binary});
    assert.equal(actual.length,row.expected.length,row.name);
    for(let i=0;i<actual.length;i++)for(let c=0;c<2;c++)
      assert.ok(Math.abs(actual[i][c]-row.expected[i][c])<1e-12,`${row.name} coordinate ${i}/${c}`);
  }
});
