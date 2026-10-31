import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {readLSIBRaw} from '../../tools/gis/lsib-source-native.mjs';
import {mergeLSIBLines} from '../../tools/gis/lsib-screen-native.mjs';

const id='c133c4d6-bf4f-489d-b51e-abf2be55d369';
const mergeOracle=JSON.parse(await readFile(new URL('../fixtures/lsib-merge-lines-oracle.json',import.meta.url),'utf8'));
test('LSIB source reader rejects unsafe IDs and unpinned archives before invoking GDAL',async()=>{
  await assert.rejects(readLSIBRaw({archive:'unused',ids:["x' OR 1=1 --"]}),/identifier/i);
  await assert.rejects(readLSIBRaw({archive:'tests/unit/gis-lsib-archive-reader.test.mjs',ids:[id]}),/hash|pinned/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readLSIBRaw({archive:'unused',ids:[id]},{signal:controller.signal}),{name:'AbortError'});
});

test('GEOS merges LSIB line parts exactly as the frozen Python reference',
  {skip:!process.env.PANDO_TERRITORIAL_RECIPE_BINARY},async()=>{
    const input=mergeOracle.cases.map(row=>row.geometry);
    input.push({type:'LineString',coordinates:input[0].coordinates[0]});
    const expected=mergeOracle.cases.map(row=>row.expected);expected.push(mergeOracle.cases[0].expected);
    assert.deepEqual(await mergeLSIBLines(input),expected);
  });

test('GDAL reads the exact selected LSIB source coordinates and attributes',{
  skip:!process.env.PANDO_LSIB_ARCHIVE||!process.env.PANDO_GDAL_OGR2OGR||!process.env.PANDO_LSIB_DISPLAY_ORACLE
},async()=>{
  const rows=await readLSIBRaw({archive:process.env.PANDO_LSIB_ARCHIVE,ids:[id],binary:process.env.PANDO_GDAL_OGR2OGR});
  assert.equal(rows.length,1);assert.equal(rows[0].properties.ID,id);
  const old=JSON.parse(await readFile(process.env.PANDO_LSIB_DISPLAY_ORACLE,'utf8'));
  const index=JSON.parse(await readFile('tools/historical-library/sources/lsib-11.4/line-index.json','utf8'));
  assert.deepEqual(rows[0].properties,index.find(row=>row.properties.ID===id).properties);
  assert.equal(rows[0].geometry.type,'LineString');assert.deepEqual(rows[0].geometry.coordinates,old.reference);
});
