import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerritorialFeature,normalizeTerritorialIdentity} from '../../assets/js/modules/territorial-units.js';
import {createProjectSerializer} from '../../assets/js/modules/project-serializer.js';
import {prepareProjectForStorage} from '../../assets/js/modules/project-state.js';
import {staticSerializerSnapshot} from '../helpers/timeline-project.mjs';
import {productionGeoPackage,spatialColumns} from '../helpers/production-geopackage.mjs';
const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
const makeProject=()=>createProjectSerializer({appVersion:'test',distributionModes:['territorial','geometry'],terrainDataset:'test',hydroDataset:'test',readSnapshot:()=>staticSerializerSnapshot({fullAutosave:true,territorialEntities:[createTerritorialFeature({id:'instance-a',entityKind:'general',geometry,sourceEntityId:'state:KOR',sourceGeometryVersion:'current',metadata:{sourceLifetime:{validFrom:'1948-08-15',validTo:null},sourceReferenceDate:'2026-10-06'}})]})}).buildProject();
test('project source entity identity and selected version survive production JSON and GeoPackage independently from object ID',async()=>{
 const project=makeProject();assert.equal(project.schemaVersion,10);
 const p=project.territorialEntities[0].properties;assert.equal(p.schemaVersion,6);assert.equal(p.sourceEntityId,'state:KOR');
 assert.equal(p.sourceGeometryVersion,'current');assert.equal(Object.hasOwn(p,'sourceLibraryId'),false);
 assert.equal(project.territorialEntities[0].id,'instance-a');
 const stored=prepareProjectForStorage(JSON.parse(JSON.stringify(project)));
 const written=await productionGeoPackage('write',new ArrayBuffer(0),stored);
 const columns=spatialColumns(written.buffer,'entities');assert.ok(columns.includes('source_entity_id'));assert.equal(columns.includes('source_library_id'),false);
 const reopened=await productionGeoPackage('read',written.buffer);
 assert.deepEqual(prepareProjectForStorage(reopened.metadata.projectState),stored);
});
test('retired project version and source field fail rather than migrate',()=>{
 const project=makeProject();assert.throws(()=>prepareProjectForStorage({...project,schemaVersion:9}));
 const identity=structuredClone(project.territorialEntities[0]);identity.properties.sourceLibraryId='old';
 assert.throws(()=>normalizeTerritorialIdentity(identity),{code:'PL-SCHEMA-FIELD'});
});
