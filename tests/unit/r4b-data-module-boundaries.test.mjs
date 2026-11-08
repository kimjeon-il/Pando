import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createTerritorialFeature} from "../../src/document/territorial-units.js";
import {fingerprintProjectBaseline} from "../../src/document/project-baseline-fingerprint.js";
import {normalizeGenericFeatureCollection,normalizeGenericFeatureSemantics,GENERIC_FEATURE_SCHEMA_VERSION} from "../../src/document/generic-feature-normalization.js";
import {normalizeTerritorialLibraryEntity,selectGeometryVersion} from '../../tools/gis/territorial-library.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const coords=right=>({type:'Polygon',coordinates:[[[0,0],[0,1],[right,1],[right,0],[0,0]]]});
const feature=id=>createTerritorialFeature({id,entityKind:'general',name:id,geometry:coords(1)});

test('R4-B baseline fingerprint is deterministic over metadata, shapes, order and source objects',async()=>{
 const first=feature('A'),second=feature('B');
 const digest=await fingerprintProjectBaseline([first,second]);
 assert.match(digest,/^[a-f0-9]{64}$/);
 const reordered=await fingerprintProjectBaseline([second,{...first,properties:Object.fromEntries(Object.entries(first.properties).reverse())}]);
 assert.equal(digest,reordered);
 assert.notEqual(digest,await fingerprintProjectBaseline([first,{...second,geometry:coords(2)}]));
 const snapshot=structuredClone([first,second]);
 await fingerprintProjectBaseline(snapshot);
 assert.deepEqual(snapshot,[first,second]);
});

test('R4-B Generic Feature normalization is data-only and does not mutate clone inputs',()=>{
 const raw={type:'Feature',id:'reference:1',geometry:{type:'Point',coordinates:[1,2]},
   properties:{schemaVersion:GENERIC_FEATURE_SCHEMA_VERSION,name:'Source',source:{kind:'gis',sourceId:'survey',sourceFormat:'geojson'}}};
 const before=structuredClone(raw);
 const [normalized]=normalizeGenericFeatureCollection([raw]);
 assert.notEqual(normalized,raw);
 assert.deepEqual(raw,before);
 assert.equal(normalized.properties.source.kind,'gis');
 assert.equal(normalized.properties.source.sourceId,'survey');
 assert.equal(normalized.properties.locked,false);
 assert.throws(()=>normalizeGenericFeatureCollection([raw,raw]),/중복/);
 assert.throws(()=>normalizeGenericFeatureSemantics({...raw,properties:{schemaVersion:2,role:'territory'}}),
   {code:'PL-GENERIC-SCHEMA'});
 const source=read('src/document/generic-feature-normalization.js');
 assert.doesNotMatch(source,/executeCommand|commandOwner|generic\.create|generic\.remove|window\.|document\./);
});

test('R4-B historical country source keeps day-precision revisions and canonical GIS ownership',()=>{
 const raw={schemaVersion:2,entityId:'state:Sample',entityKind:'general',names:{ko:'Sample'},
   lifetime:{validFrom:'1948-08-15',validTo:null},geometryVersions:[
     {versionId:'old',validFrom:'1948-08-15',validTo:'1953-07-26',geometry:coords(1)},
     {versionId:'new',validFrom:'1953-07-27',validTo:null,geometry:coords(1)}]};
 const before=structuredClone(raw);
 const normalized=normalizeTerritorialLibraryEntity(raw);
 assert.equal(selectGeometryVersion(normalized,'1953-07-26').versionId,'old');
 assert.equal(selectGeometryVersion(normalized,'1953-07-27').versionId,'new');
 assert.deepEqual(raw,before);
});

test('R4-B data sources never depend on legacy editor entrypoints or mutation adapters',()=>{
 for(const name of ['tools/gis/project-template-compiler.js',
   'src/document/generic-feature-normalization.js',
   'src/document/project-baseline-fingerprint.js']){
   const body=read(name);
   assert.doesNotMatch(body,/apps\/editor\/frontend|legacy-project-autosave|generic-feature-command-service/);
 }
 for(const removed of ['tools/gis/project-serializer.js','tools/gis/generic-feature-service.js'])
   assert.equal(existsSync(resolve(root,removed)),false,removed);
 assert.ok(read('tools/builtin-world-compiler.mjs').includes("from \"./gis/project-template-compiler.js\""));
 assert.ok(read('tests/helpers/core-startup.mjs').includes("from \"../../src/document/project-baseline-fingerprint.js\""));
});
