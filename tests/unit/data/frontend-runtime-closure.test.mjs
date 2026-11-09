import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {collectRuntimeDataAssets} from '../../../src/data/runtime-manifest-assets.js';
import {runtimeArchiveIndex} from '../../../tools/data/library-runtime-index.mjs';
import {encodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {materializeRuntimeView} from '../../../tools/data/library-runtime.mjs';
import {makePrivate} from '../../../tools/data/library-content.mjs';
import {librarySharedCheckout} from '../../../tools/data/library-context.mjs';

const root='assets/data/world/current.json';
test('selected GIS source prepares its coordinate dependencies without materializing unrelated sources',()=>{
 const prefix='assets/data/territorial-entities/source/',country=prefix+'countries/state-AAA.json';
 const encoded=encodeTerritorialSource({schemaVersion:2,entityId:'state:AAA',geometryVersions:[{versionId:'v1',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]});
 const [file,bytes]=[...encoded.geometries][0],files={[country]:{},[prefix+file]:{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},[prefix+'countries/state-BBB.json']:{}},reads=[];
 const scope=runtimeArchiveIndex({files},(_entry,p)=>{reads.push(p);return Buffer.from(JSON.stringify(encoded.descriptor));},{purpose:'gis',prefixes:[country]});
 assert.deepEqual(Object.keys(scope.files).sort(),[country,prefix+file].sort());assert.deepEqual(reads,[country]);
 delete files[prefix+file];assert.throws(()=>runtimeArchiveIndex({files},()=>Buffer.from(JSON.stringify(encoded.descriptor)),{purpose:'gis',prefixes:[country]}),/geometry/);
});
test('runtime closure selects current payloads without reading provenance, reports or unused editions',()=>{
 const payload='assets/data/world/objects/current.bin';
 const source='assets/data/territorial-entities/source/countries/original.json';
 const reads=[];
 const paths=collectRuntimeDataAssets({availablePaths:[root,payload,source,'reports/development/private.md','assets/data/world/objects/old.bin'],
  readManifest:path=>{reads.push(path);assert.equal(path,root);return {source:{url:source},assets:{canonical:{url:'world/objects/current.bin'}}};}});
 assert.deepEqual([...paths].sort(),[root,payload].sort());
 assert.deepEqual(reads,[root]);
});

test('different preparation scopes never reuse a completed view or copy excluded original inputs',t=>{
 const directory=mkdtempSync(join(tmpdir(),'pando-preparation-scope-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const put=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
 put(join(directory,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision:'a'.repeat(40),mounts:['assets/data']}));
 const checkout=join(directory,'.library-data/repository'),files={};
 for(const [path,bytes]of [[root,Buffer.from(JSON.stringify({assets:{}}))],['assets/data/original/source.json',Buffer.from('private original')]]){
  put(join(checkout,path),bytes);
  files[path]={stored:path,encoding:'identity',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 }
 const index={schemaVersion:1,files};
 const viewer=materializeRuntimeView({root:directory,index,purpose:'viewer'});
 const gis=materializeRuntimeView({root:directory,index,purpose:'gis',prefixes:['assets/data/original']});
 assert.notEqual(viewer,gis);
 assert.equal(existsSync(join(viewer,'assets/data/original/source.json')),false);
 assert.equal(readFileSync(join(gis,'assets/data/original/source.json'),'utf8'),'private original');
 assert.equal(materializeRuntimeView({root:directory,index,purpose:'viewer'}),viewer);
});
test('runtime closure rejects missing and escaping resources before preparing a view',()=>{
 for(const url of ['world/objects/missing.bin','../source.json'])assert.throws(()=>collectRuntimeDataAssets({availablePaths:[root],
  readManifest:()=>({assets:{canonical:{url}}})}),/missing|invalid|unsafe/i);
});

test('Viewer preparation uses the same manifest closure and validates stored payload identities',()=>{
 const payload='assets/data/world/objects/current.bin',source='assets/data/territorial-entities/source/countries/source.json';
 const entries={
  [root]:{stored:'manifest'},[payload]:{stored:'payload',sha256:'a'.repeat(64),bytes:7},[source]:{stored:'source'},
 };
 const manifest={assets:{canonical:{url:'world/objects/current.bin',sha256:'a'.repeat(64),compressedBytes:7}},source:{url:source}};
 const read=entry=>{assert.equal(entry,entries[root]);return Buffer.from(JSON.stringify(manifest));};
 const selected=runtimeArchiveIndex({files:entries},read,{purpose:'viewer'});
 assert.deepEqual(Object.keys(selected.files).sort(),[root,payload].sort());
 assert.equal(entries[source].stored,'source','archive metadata is not changed');
 assert.throws(()=>runtimeArchiveIndex({files:{...entries,[payload]:{...entries[payload],sha256:'b'.repeat(64)}}},read,{purpose:'viewer'}),/integrity|identity/i);
});

test('GIS scope identity includes private edits and new outputs and preserves the pinned archive',t=>{
 const directory=mkdtempSync(join(tmpdir(),'pando-private-scope-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const put=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
 put(join(directory,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision:'a'.repeat(40),mounts:['assets/data']}));
 const logical='assets/data/selected/input.json',bytes=Buffer.from('pinned');
 put(join(directory,'.library-data/repository',logical),bytes);
 const index={files:{[logical]:{stored:logical,encoding:'identity',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}};
 const options={root:directory,index,purpose:'gis',prefixes:['assets/data/selected']};
 const before=materializeRuntimeView(options);
 makePrivate(librarySharedCheckout(directory),join(before,logical));
 put(join(before,logical),'edited');
 put(join(before,'assets/data/selected/new.json'),'new output');
 put(join(before,'assets/data/unselected/private.json'),'unrelated WIP');
 const after=materializeRuntimeView({...options,source:before});
 assert.notEqual(after,before);
 assert.equal(readFileSync(join(after,logical),'utf8'),'edited');
 assert.equal(readFileSync(join(after,'assets/data/selected/new.json'),'utf8'),'new output');
 assert.equal(existsSync(join(after,'assets/data/unselected/private.json')),false);
 assert.equal(index.files[logical].sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(materializeRuntimeView({...options,source:after}),after,'identical private scope is reusable');
 put(join(after,logical),'another private edit');
 const restored=materializeRuntimeView({...options,source:before});
 assert.notEqual(restored,after,'an edited cache cannot satisfy its former completed identity');
 assert.equal(readFileSync(join(restored,logical),'utf8'),'edited');
 assert.equal(readFileSync(join(after,logical),'utf8'),'another private edit','preserve the other edition');
});

test('Hydro byte ranges preserve whole-container identity and reject ranges outside the container',()=>{
 const manifest='assets/data/hydro/v0.13.4/manifest.json',payload='assets/data/hydro/v0.13.4/hydro.bin';
 const files={[manifest]:{},[payload]:{sha256:'a'.repeat(64),bytes:10}};
 const value={container:{url:'hydro.bin',sha256:'a'.repeat(64),bytes:10},
  index:{url:'hydro.bin',sha256:'b'.repeat(64),offset:0,bytes:4},shards:[]};
 assert.deepEqual(Object.keys(runtimeArchiveIndex({files},()=>Buffer.from(JSON.stringify(value))).files).sort(),[manifest,payload].sort());
 value.index.offset=8;
 assert.throws(()=>runtimeArchiveIndex({files},()=>Buffer.from(JSON.stringify(value))),/range/i);
});

test('pinned Viewer materialization follows selected project catalog roles without leaking the default place collection',()=>{
 const source=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));
 const alt='assets/data/places/alternate-world.json';
 const project={...source,projectId:'alternate-world',resources:{...source.resources,places:{catalog:alt}}};
 const specs={
  [source.resources.world.catalog]:{assets:{}},
  [source.resources.territorial.catalog]:{entities:[]},
  [source.resources.rivers.catalog]:{container:{url:'shared-hydro.bin'},shards:[]},
  [source.resources.places.catalog]:{shards:{old:{url:'old-city.bin'}}},
  [alt]:{shards:{new:{url:'new-city.bin'}}},
  [source.resources.preparedMeshes.catalog]:{meshes:{}},
  [source.resources.terrain.catalog]:{tiles:{}},
  [source.resources.physicalLand.catalog]:{asset:{url:'assets/data/land.bin'}},
  [source.resources.placeLifetimes.catalog]:{entries:[]},
 };
 const hydroBin=source.resources.rivers.catalog.replace(/manifest\\.json$/,'shared-hydro.bin');
 const paths=[...Object.keys(specs),'assets/data/land.bin',hydroBin,'assets/data/places/new-city.bin','assets/data/places/old-city.bin'];
 const entries=Object.fromEntries(paths.map(path=>[path,{stored:path}]));
 const read=entry=>Buffer.from(JSON.stringify(specs[entry.stored]));
 const selected=runtimeArchiveIndex({files:entries},read,{projectManifest:project}).files;
 assert.ok(selected[alt]);
 assert.ok(selected['assets/data/places/new-city.bin']);
 assert.equal(selected[source.resources.places.catalog],undefined);
 assert.equal(selected['assets/data/places/old-city.bin'],undefined);
 assert.ok(selected[source.resources.territorial.catalog]);
 assert.ok(selected[hydroBin]);
});
