import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {parseLSIBGeoJSON,readLSIBRaw} from '../../tools/gis/lsib-source-native.mjs';
import {mergeLSIBLines} from '../../tools/gis/lsib-screen-native.mjs';

const id='c133c4d6-bf4f-489d-b51e-abf2be55d369';
const mergeOracle=JSON.parse(await readFile(new URL('../fixtures/lsib-merge-lines-oracle.json',import.meta.url),'utf8'));
test('LSIB source reader rejects unsafe IDs and unpinned archives before invoking GDAL',async()=>{
  await assert.rejects(readLSIBRaw({archive:'unused',ids:["x' OR 1=1 --"]}),/identifier/i);
  await assert.rejects(readLSIBRaw({archive:'unused',ids:[id],all:true}),/identifier/i);
  await assert.rejects(readLSIBRaw({archive:'tests/unit/gis-lsib-archive-reader.test.mjs',ids:[id]}),/hash|pinned/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readLSIBRaw({archive:'unused',ids:[id]},{signal:controller.signal}),{name:'AbortError'});
});
test('LSIB source parsing preserves exact coordinates and rejects missing or duplicate features',()=>{
  const geometry={type:'MultiLineString',coordinates:[[[9.530734900000027,47],[9.6,47.1]],[[10,48],[11,49]]]};
  const row={type:'Feature',properties:{ID:id,COUNTRY1:' AUSTRIA ',LABEL:null},geometry};
  const expected=[{properties:{ID:id,COUNTRY1:'AUSTRIA',LABEL:''},geometry}];
  assert.deepEqual(parseLSIBGeoJSON(JSON.stringify(row)+'\n',[id]),expected);
  assert.throws(()=>parseLSIBGeoJSON('',[id]),/missing/i);
  assert.throws(()=>parseLSIBGeoJSON(JSON.stringify(row)+'\n'+JSON.stringify(row),[id]),/duplicate/i);
  assert.throws(()=>parseLSIBGeoJSON(JSON.stringify({...row,properties:{...row.properties,RANK:1}}),[id]),/attribute type/i);
});
test('explicit complete-source parsing preserves record order and rejects duplicate IDs',()=>{
  const other='4990410a-4158-4932-8445-90397c840a87',geometry={type:'LineString',coordinates:[[0,0],[1,1]]};
  const row=sourceId=>({type:'Feature',properties:{ID:sourceId},geometry});
  assert.deepEqual(parseLSIBGeoJSON([row(id),row(other)].map(JSON.stringify).join('\n'),undefined,{all:true}).map(item=>item.properties.ID),[id,other]);
  assert.throws(()=>parseLSIBGeoJSON([row(id),row(id)].map(JSON.stringify).join('\n'),undefined,{all:true}),/duplicate/i);
  assert.throws(()=>parseLSIBGeoJSON(JSON.stringify(row('invalid')),undefined,{all:true}),/identifier/i);
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
  assert.deepEqual(await readLSIBRaw({archive:process.env.PANDO_LSIB_ARCHIVE,ids:[],binary:'unused-ogr'}),[]);
  const rows=await readLSIBRaw({archive:process.env.PANDO_LSIB_ARCHIVE,ids:[id],binary:process.env.PANDO_GDAL_OGR2OGR});
  assert.equal(rows.length,1);assert.equal(rows[0].properties.ID,id);
  const old=JSON.parse(await readFile(process.env.PANDO_LSIB_DISPLAY_ORACLE,'utf8'));
  const index=JSON.parse(await readFile('tools/historical-library/sources/lsib-11.4/line-index.json','utf8'));
  assert.deepEqual(rows[0].properties,index.find(row=>row.properties.ID===id).properties);
  assert.equal(rows[0].geometry.type,'LineString');assert.deepEqual(rows[0].geometry.coordinates,old.reference);
});
test('LSIB supplement caller receives a selected original without coordinate changes',{
  skip:!process.env.PANDO_PYTHON_ORACLE||!process.env.PANDO_LSIB_ARCHIVE||!process.env.PANDO_GDAL_OGR2OGR||
    !process.env.PANDO_LSIB_DISPLAY_ORACLE||!process.env.PANDO_TERRITORIAL_RECIPE_BINARY
},async()=>{
  const old=JSON.parse(await readFile(process.env.PANDO_LSIB_DISPLAY_ORACLE,'utf8'));
  const script=`import importlib.util,json,os,sys\nspec=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nx=json.load(sys.stdin)\nrows=m.load_lsib_archive(os.environ['PANDO_LSIB_ARCHIVE'],[x['sourceId']])\nassert rows[0]['properties']['ID']==x['sourceId']\nassert [list(p) for p in rows[0]['line'].coords]==x['reference']\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(old),encoding:'utf8',windowsHide:true,timeout:300000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
