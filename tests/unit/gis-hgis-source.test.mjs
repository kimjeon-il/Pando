import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalHgis, normalizeHgisSource, preserveHgis, wfsUrl, LAYER }
  from '../../tools/fetch-german-empire-1914-source.mjs';

const polygon={type:'Polygon',coordinates:[[[10,50],[11,50],[11,51],[10,50]]]};
const fixture=()=>({type:'FeatureCollection',features:[
 ...Array.from({length:26},(_,i)=>({type:'Feature',id:'ignored'+i,
   geometry:structuredClone(polygon),properties:{z:i,a:'state-'+i}})),
 {type:'Feature',geometry:{type:'Point',coordinates:[0,0]}},
]});
test('only the 26 HGIS states are retained without altering original coordinates or properties',()=>{
 const source=fixture(),before=structuredClone(source),actual=normalizeHgisSource(source);
 assert.equal(actual.features.length,26);
 assert.deepEqual(actual.features[0].geometry,polygon);
 assert.deepEqual(actual.features[0].properties,{z:0,a:'state-0'});
 assert.equal(actual.crs.properties.name,'EPSG:4326');
 assert.deepEqual(source,before);
});
test('Python-style key order and Unicode-preserving canonical source are stable',()=>{
 const content=canonicalHgis(fixture());
 assert.ok(content.includes('"properties":{"a":"state-0","z":0}'));
 assert.equal(canonicalHgis(JSON.parse(content)),content);
});
test('WFS fetch query is explicit CRS and source layer',()=>{
 const url=new URL(wfsUrl('https://test.example/wfs'));
 assert.equal(url.searchParams.get('srsName'),'EPSG:4326');
 assert.equal(url.searchParams.get('typeName'),LAYER);
});
test('missing polygon and out-of-bounds coordinates are rejected',()=>{
 const missing=fixture();missing.features.splice(1,1);
 assert.throws(()=>normalizeHgisSource(missing),/26 HGIS/);
 const wrong=fixture();wrong.features[0].geometry.coordinates[0][0][0]=181;
 assert.throws(()=>normalizeHgisSource(wrong),/longitude/);
});
test('existing licensed original never overwritten by a different download',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hgis-fetch-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const output=join(dir,'hgis.geojson'),input=fixture();
 preserveHgis(input,{output,writer:(p,b,o)=>writeFileSync(p,b,o)});
 const old=readFileSync(output);
 assert.equal(preserveHgis(input,{output}).unchanged,true);
 input.features[0].properties.z=999;
 assert.throws(()=>preserveHgis(input,{output}),/do not overwrite/);
 assert.deepEqual(readFileSync(output),old);
});
test('offline CLI source import and byte comparison without network calls',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hgis-fetch-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'source.json'),output=join(dir,'output.json');
 writeFileSync(input,JSON.stringify(fixture()));
 const script=new URL('../../tools/fetch-german-empire-1914-source.mjs',import.meta.url);
 const run=(...args)=>spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
 assert.equal(run('--from-file',input,'--output',output).status,0);
 assert.equal(run('--from-file',input,'--output',output,'--check').status,0);
 assert.equal(JSON.parse(readFileSync(output,'utf8')).features.length,26);
});
