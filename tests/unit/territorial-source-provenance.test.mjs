import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {normalizeTerritorialIdentity} from "../../shared/frontend/js/modules/territorial-units.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {productionGeoPackage,spatialColumns} from '../helpers/production-geopackage.mjs';
const input=()=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
 const feature=seed.territorialEntities.find(row=>row.id==='A');
 Object.assign(feature.properties,{sourceEntityId:'state:KOR',sourceGeometryVersion:'current'});
 Object.assign(feature.properties.metadata,{sourceLifetime:{validFrom:'1948-08-15',validTo:null},sourceReferenceDate:'2026-10-06'});
 return seed;
};

test('source entity identity and selected version survive the actual Core JSON and GeoPackage boundary independently from object ID',async t=>{
 const owner=await createNodeCoreProject(input());t.after(()=>owner.dispose());
 const receipt=await owner.client.exportSnapshot({format:'pandolab-project-state',version:'fixture',savedAt:'2026-10-04T00:00:00.000Z'});
 const stored=JSON.parse(receipt.storageJson),p=stored.territorialEntities.find(row=>row.id==='A').properties;
 assert.equal(p.schemaVersion,6);assert.equal(p.sourceEntityId,'state:KOR');assert.equal(p.sourceGeometryVersion,'current');
 assert.equal(Object.hasOwn(p,'sourceLibraryId'),false);assert.notEqual('A',p.sourceEntityId);
 const written=await productionGeoPackage('write',new ArrayBuffer(0),stored,receipt.spatialState);
 const columns=spatialColumns(written.buffer,'entities');assert.ok(columns.includes('source_entity_id'));assert.equal(columns.includes('source_library_id'),false);
 const reopened=await productionGeoPackage('read',written.buffer);
 assert.deepEqual(await owner.client.validateImport(JSON.stringify(reopened.metadata.projectState)),stored);
});

test('retired project version and source field reject without changing the active Core document',async t=>{
 const seed=input(),owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());const state=owner.client.state(),before=owner.documentModel.snapshot();
 await assert.rejects(owner.client.validateImport(JSON.stringify({...seed,schemaVersion:9})));
 const identity=structuredClone(seed.territorialEntities[0]);identity.properties.sourceLibraryId='old';
 assert.throws(()=>normalizeTerritorialIdentity(identity),{code:'PL-SCHEMA-FIELD'});
 const changed=structuredClone(seed);changed.territorialEntities[0]=identity;await assert.rejects(owner.client.validateImport(JSON.stringify(changed)));
 assert.equal(owner.documentModel.snapshot(),before);assert.deepEqual(owner.client.state(),state);
});
