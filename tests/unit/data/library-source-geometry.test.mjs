import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeTerritorialSource,decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {normalizeTerritorialSourceDescriptor,writeTerritorialSource,readTerritorialSource,updateTerritorialSource} from '../../../tools/data/territorial-entity-sources.mjs';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeTerritorialLibraryEntity} from '../../../tools/gis/territorial-library.js';
import {factorTerritorialSourceGeometryStorage} from '../../../tools/data/territorial-source-migration.mjs';
const entity=()=>({schemaVersion:2,entityId:'state:AAA',entityKind:'general',names:{en:'A'},lifetime:{validFrom:'1900-03-17',validTo:null},
 geometryVersions:[{versionId:'first',geometry:{type:'Polygon',coordinates:[[[0,0],[1.1234567890123457,0],[1,1],[0,0]]]},validFrom:null,validTo:null,sourceId:'original'}]});
test('explicit authoring conversion proves every ordered source and deduplicates coordinates across objects',()=>{
 const a=entity(),b=entity();b.entityId='state:BBB';
 const sources=new Map([['countries/state-AAA.json',Buffer.from(JSON.stringify(a))],['countries/state-BBB.json',Buffer.from(JSON.stringify(b))]]);
 const result=factorTerritorialSourceGeometryStorage(sources);
 assert.equal(result.verification.entities,2);assert.equal(result.verification.geometryPayloads,1);assert.equal(result.verification.exactOrderedDocuments,true);
 for(const value of [a,b])assert.equal(JSON.stringify(decodeTerritorialSource(JSON.parse(result.files.get('countries/'+value.entityId.replace(':','-')+'.json')),p=>result.files.get(p))),JSON.stringify(value));
 assert.equal(JSON.parse(sources.get('countries/state-AAA.json')).storageLayout,undefined);
 const wrong=new Map(sources);wrong.set('countries/state-AAA.json',Buffer.from(JSON.stringify({...a,entityId:'state:WRONG'})));
 assert.throws(()=>factorTerritorialSourceGeometryStorage(wrong),/identity/);
});
test('source descriptors separate exact coordinates and logical versions from shared content identity',()=>{
 const value=entity(),before=structuredClone(value),a=encodeTerritorialSource(value);
 const second=entity();second.entityId='state:BBB';second.geometryVersions[0].versionId='another';
 const b=encodeTerritorialSource(second),left=a.descriptor.geometryVersions[0].geometryResource,right=b.descriptor.geometryVersions[0].geometryResource;
 assert.equal(Object.hasOwn(a.descriptor.geometryVersions[0],'geometry'),false);
 assert.deepEqual(left.logicalRef,{id:'state:AAA:first',version:1});
 assert.notDeepEqual(left.logicalRef,right.logicalRef);assert.equal(left.file,right.file);assert.equal(left.sha256,right.sha256);
 const decoded=decodeTerritorialSource(a.descriptor,path=>a.geometries.get(path));
 assert.deepEqual(decoded,value);assert.equal(JSON.stringify(decoded),JSON.stringify(value),'unchanged compiler input retains its exact key order');assert.deepEqual(value,before);
});

test('updating one entity validates global membership without loading unrelated geometry',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-source-selected-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const a=entity(),b=entity();a.lineageId='a';b.lineageId='b';b.entityId='state:BBB';b.geometryVersions[0].geometry.coordinates[0][1][0]=3;
 for(const value of [a,b])writeTerritorialSource(value,root);
 mkdirSync(join(root,'lineages'));
 for(const value of [a,b])writeFileSync(join(root,'lineages',value.lineageId+'.json'),JSON.stringify({schemaVersion:2,lineageId:value.lineageId,names:value.names,entityRefs:[value.entityId],relations:[]}));
 const bResource=encodeTerritorialSource(b).descriptor.geometryVersions[0].geometryResource;
 unlinkSync(join(root,bResource.file));
 const before=readFileSync(join(root,encodeTerritorialSource(a).descriptor.geometryVersions[0].geometryResource.file));
 const updated=updateTerritorialSource(a.entityId,value=>({...value,names:{en:'renamed'}}),root);
 assert.equal(updated.names.en,'renamed');assert.deepEqual(readTerritorialSource(a.entityId,root),updated);
 assert.deepEqual(readFileSync(join(root,encodeTerritorialSource(a).descriptor.geometryVersions[0].geometryResource.file)),before);
 assert.throws(()=>readTerritorialSource(b.entityId,root),/ENOENT/);
});
test('metadata-only updates preserve every geometry filename and byte; geometry changes affect only their payload',()=>{
 const value=entity(),a=encodeTerritorialSource(value);value.names.en='new name';value.description='description';const b=encodeTerritorialSource(value);
 assert.deepEqual([...a.geometries],[...b.geometries]);assert.deepEqual(a.descriptor.geometryVersions,b.descriptor.geometryVersions);
 value.geometryVersions[0].geometry.coordinates[0][1][0]=2;const c=encodeTerritorialSource(value);
 assert.notEqual(c.descriptor.geometryVersions[0].geometryResource.file,a.descriptor.geometryVersions[0].geometryResource.file);
 assert.deepEqual(c.descriptor.geometryVersions[0].geometryResource.logicalRef,a.descriptor.geometryVersions[0].geometryResource.logicalRef);
});
for(const kind of ['missing','hash','path','logical identity','inline'])test('source geometry rejects '+kind+' before publishing a partial entity',()=>{
 const {descriptor,geometries}=encodeTerritorialSource(entity()),resource=descriptor.geometryVersions[0].geometryResource;
 if(kind==='hash')geometries.set(resource.file,Buffer.from('{}'));
 if(kind==='path')resource.file='../escape.json';
 if(kind==='logical identity')resource.logicalRef.id='another';
 if(kind==='inline')descriptor.geometryVersions[0].geometry=entity().geometryVersions[0].geometry;
 assert.throws(()=>decodeTerritorialSource(descriptor,path=>kind==='missing'?undefined:geometries.get(path)),/geometry|descriptor|resource|identity|hash/i);
});

test('metadata normalization uses the canonical date/name rules without coordinate payloads',()=>{
 const {descriptor}=encodeTerritorialSource(entity()),normalized=normalizeTerritorialSourceDescriptor(descriptor);
 assert.deepEqual(normalized.names,descriptor.names);assert.deepEqual(normalized.geometryVersions,descriptor.geometryVersions);
 assert.deepEqual(normalized.lifetime,{validFrom:'1900-03-17',validTo:null});
 descriptor.lifetime.validFrom='1900-13-17';assert.throws(()=>normalizeTerritorialSourceDescriptor(descriptor));
});

test('actual source writes are idempotent and metadata changes perform zero geometry writes',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-source-geometry-write-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const value=entity();assert.deepEqual(writeTerritorialSource(value,root),{descriptorWrites:1,geometryWrites:1});
 assert.deepEqual(readTerritorialSource(value.entityId,root),normalizeTerritorialLibraryEntity(value));
 const file=join(root,'geometries',readdirSync(join(root,'geometries'))[0]),before=readFileSync(file),stamp=statSync(file).mtimeMs;
 assert.deepEqual(writeTerritorialSource(value,root),{descriptorWrites:0,geometryWrites:0});
 value.names.en='new';assert.deepEqual(writeTerritorialSource(value,root),{descriptorWrites:1,geometryWrites:0});
 assert.deepEqual(readFileSync(file),before);assert.equal(statSync(file).mtimeMs,stamp);
});
