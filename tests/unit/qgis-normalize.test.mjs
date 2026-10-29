import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {normalizeExchange} from '../../tools/qgis/normalize.mjs';

const sample=()=>({type:'FeatureCollection',features:[{type:'Feature',id:'qgis-fid',geometry:{type:'LineString',coordinates:[[127,37],[128,38]]},
  properties:{name:'경계',source:JSON.stringify({schemaVersion:1,kind:'gis',sourceId:'original',details:{licence:'retained',reviewed:false}})}}]});

test('QGIS normalization restores nested provenance while preserving input and feature identity',()=>{
  const input=sample(),before=structuredClone(input),output=normalizeExchange(input);
  assert.deepEqual(input,before);assert.equal(output.features[0].id,'qgis-fid');
  assert.deepEqual(output.features[0].geometry,before.features[0].geometry);
  assert.deepEqual(output.features[0].properties.source,JSON.parse(before.features[0].properties.source));
  input.features[0].properties.source='OpenStreetMap';
  assert.equal(normalizeExchange(input).features[0].properties.source,'OpenStreetMap');
  input.features[0].properties.source='{invalid';
  assert.throws(()=>normalizeExchange(input),SyntaxError);
});

test('QGIS normalization refuses projected, nonfinite and unsupported geometry',()=>{
  const input=sample();input.crs={type:'name',properties:{name:'EPSG:3857'}};
  assert.throws(()=>normalizeExchange(input),/EPSG:4326/);delete input.crs;
  for(const coordinate of [[300000,400000],[NaN,37],[true,37],[127,37,1],[]]){
    input.features[0].geometry.coordinates[0]=coordinate;
    assert.throws(()=>normalizeExchange(input),/coordinate/);
  }
  input.features[0].geometry=null;assert.throws(()=>normalizeExchange(input),/geometry/);
});

test('QGIS normalization CLI preserves existing output and accepts UTF-8 BOM',t=>{
  const directory=mkdtempSync(join(tmpdir(),'pando-qgis-normalize-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const input=join(directory,'입력.geojson'),output=join(directory,'결과.geojson');
  writeFileSync(input,'\ufeff'+JSON.stringify(sample()));
  const run=()=>spawnSync(process.execPath,[resolve('tools/qgis/normalize.mjs'),input,'--output',output],{encoding:'utf8',timeout:15000});
  const result=run();assert.equal(result.status,0,result.stderr);
  const saved=readFileSync(output);assert.equal(JSON.parse(saved).features[0].properties.source.sourceId,'original');
  const refused=run();assert.notEqual(refused.status,0);assert.deepEqual(readFileSync(output),saved);
});

test('QGIS normalization retains 64-bit IDs and nested integer properties',t=>{
  const directory=mkdtempSync(join(tmpdir(),'pando-qgis-int64-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const input=join(directory,'in.json'),output=join(directory,'out.json');
  writeFileSync(input,'{"type":"FeatureCollection","features":[{"type":"Feature","id":9223372036854775807,"geometry":{"type":"Point","coordinates":[127,37]},"properties":{"source":"{\\"schemaVersion\\":1,\\"details\\":{\\"externalId\\":9223372036854775806}}"}}]}');
  const result=spawnSync(process.execPath,[resolve('tools/qgis/normalize.mjs'),input,'--output',output],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  const text=readFileSync(output,'utf8');assert.match(text,/"id": 9223372036854775807/);assert.match(text,/"externalId": 9223372036854775806/);
});
