import { describe as contractSuite } from 'node:test';
import * as __gpkg_dep0 from "node:test";
import * as __gpkg_dep1 from "../../helpers/production-geopackage.mjs";
import * as __gpkg_dep2 from "../../fixtures/timeline-storage-cases.mjs";
import * as __gpkg_dep3 from "node:assert/strict";
import * as __gpkg_dep4 from "../../../tools/gis/project-template-compiler.js";
import * as __gpkg_dep5 from "../../../src/document/project-state.js";
import * as __gpkg_dep6 from "../../helpers/timeline-project.mjs";
import * as __gpkg_dep7 from "../../../src/document/territorial-units.js";
import * as __gpkg_dep8 from "node:fs/promises";
import * as __gpkg_dep9 from "../../../src/document/timeline-storage.js";
import * as __gpkg_dep10 from "../../../src/document/generic-feature-normalization.js";
import * as __gpkg_dep11 from "node:fs";
import * as __gpkg_dep12 from "../../helpers/core-project.mjs";
contractSuite("timeline-geopackage", () => {
const { describe : contractSuite } = __gpkg_dep0;
const __dep0 = __gpkg_dep1;
const __dep1 = __gpkg_dep2;
const __dep2 = __gpkg_dep0;
const __dep3 = __gpkg_dep3;
const __dep4 = __gpkg_dep4;
const __dep5 = __gpkg_dep5;
const __dep6 = __gpkg_dep6;
const __dep7 = __gpkg_dep7;
const __dep8 = __gpkg_dep8;
const __dep9 = __gpkg_dep9;
contractSuite("timeline-geopackage", () => {
const { productionGeoPackage : request, spatialLayerCount, coreFileProjection } = __dep0;
const { timelineStorageCases } = __dep1;
const test = __dep2.default;
const assert = __dep3.default;
const { createProjectTemplateCompiler } = __dep4;
const { prepareProjectForStorage } = __dep5;
const { projectForStorage, staticSerializerSnapshot } = __dep6;
const { createTerritorialFeature } = __dep7;
const { readFile } = __dep8;
const { prepareProjectForActivation } = __dep5;

const writeProject=async project=>{const receipt=await coreFileProjection(project);return request('write',new ArrayBuffer(0),receipt.project,receipt.spatialState);};
const serialize = snapshot => createProjectTemplateCompiler({ appVersion: '0.34.0', baseDataset: 'base',
  distributionModes: ['territorial','geometry'], terrainDataset: 'terrain', hydroDataset: 'hydro', readSnapshot: () => snapshot }).buildProject();

for (const kind of ['complex','static','empty']) test(`production GeoPackage worker round-trips ${kind} v14 project`, async () => {
  const snapshot = kind === 'complex' ? projectForStorage() : staticSerializerSnapshot({ fullAutosave: true,
    territorialEntities: kind === 'empty' ? [] : [createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A',
      geometry: { type: 'Polygon', coordinates: [[[179,0],[-179,0],[-179,1],[179,0]]] }, metadata: { capital: '서울', source: 'original' } })] });
  const project = serialize(snapshot);
  const written = await writeProject(project);
  const read = await request('read', written.buffer);
  assert.deepEqual(prepareProjectForStorage(read.metadata.projectState), prepareProjectForStorage(project));
  const count = spatialLayerCount(written.buffer);
  assert.equal(kind === 'complex' || kind === 'empty' ? count === 0 : count > 0, true);
});

for (const row of timelineStorageCases().filter(row => row.expected === 'OK')) test(`production file matrix: ${row.name}`, async () => {
  const project = serialize(projectForStorage(row));
  const written = await writeProject(project);
  const read = await request('read', written.buffer);
  assert.deepEqual(prepareProjectForStorage(read.metadata.projectState), prepareProjectForStorage(project));
});


test('production GeoPackage file pipeline preserves each validation owner error code', async () => {
  const project = serialize(projectForStorage());
  await assert.rejects(request('write', new ArrayBuffer(0), project), { code:'PL-GPKG-SPATIAL-PROJECTION' });
  const unsupported = { ...project, sovereignty:{} }, unsupportedBefore = structuredClone(unsupported);
  assert.throws(() => prepareProjectForStorage(unsupported), { code:'PL-SCHEMA-FIELD' });
  await assert.rejects(writeProject(unsupported), { code:'UNSUPPORTED_FIELD' });
  assert.deepEqual(unsupported, unsupportedBefore);
  const invalid = structuredClone(project); invalid.geometries.push(structuredClone(invalid.geometries[0]));
  const invalidBefore = structuredClone(invalid);
  await assert.rejects(writeProject(invalid), { code:'DUPLICATE_ID' });
  assert.deepEqual(invalid, invalidBefore);
});

const exchangeFile = name => new URL(`../../fixtures/timeline-exchange/${name}`, import.meta.url);
const exchangeJson = async name => JSON.parse(await readFile(exchangeFile(name), 'utf8'));
const exchangeContent = project => ({ territorialEntities: project.territorialEntities,
  timelineRecords: project.timelineRecords, geometries: project.geometries });

for (const kind of ['static', 'complex', 'calendar-boundaries']) test(`fixed ${kind} JSON and real GeoPackage match the independent exchange oracle`, async () => {
  const expected = await exchangeJson(`${kind}.expected.json`);
  const project = await exchangeJson(`${kind}.json`);
  assert.deepEqual(exchangeContent(prepareProjectForStorage(project)), expected);
  const bytes = await readFile(exchangeFile(`${kind}.gpkg`));
  const read = await request('read', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.deepEqual(exchangeContent(prepareProjectForStorage(read.metadata.projectState)), expected);
  const written = await writeProject(project);
  const reread = await request('read', written.buffer);
  assert.deepEqual(exchangeContent(prepareProjectForStorage(reread.metadata.projectState)), expected);
  if (kind !== 'static') assert.equal(spatialLayerCount(written.buffer), 0);
  assert.deepEqual(exchangeContent(prepareProjectForActivation(project)), expected);
});

for (const [name, mutate, code] of [
  ['year zero', p => { p.timelineRecords.lifetimes[0].validFrom = '0000-02'; }, 'TIMELINE_INTERVAL'],
  ['1900 is not leap', p => { p.timelineRecords.geometryBindings.find(r => r.id === 'B:new').validFrom = '1900-02-29'; }, 'TIMELINE_INTERVAL'],
  ['shared inclusive boundary', p => { p.timelineRecords.geometryBindings.find(r => r.id === 'A:new').validFrom = '+12000-02-28'; }, 'TIMELINE_OVERLAP'],
  ['missing leap day', p => { p.timelineRecords.geometryBindings.find(r => r.id === 'A:new').validFrom = '+12000-03'; }, 'TIMELINE_GAP'],
]) test(`production calendar exchange rejects ${name} without changing its input`, async () => {
  const project = await exchangeJson('calendar-boundaries.json'); mutate(project);
  const before = structuredClone(project);
  assert.throws(() => prepareProjectForStorage(project), { code });
  await assert.rejects(writeProject(project), { code });
  assert.deepEqual(project, before);
});
});
contractSuite("timeline-storage", () => {
const assert = __dep3.default;
const test = __dep2.default;
const { snapshotTimelineStorage, restoreTimelineStorage } = __dep9;
const { timelineStorageCases } = __dep1;

for (const row of timelineStorageCases()) test(`storage: ${row.name}`, () => {
  const before=structuredClone(row.input), catalog=structuredClone(row.entities);
  if(row.expected==='OK') {
    const restored=restoreTimelineStorage(row.input,row.entities);
    const saved=snapshotTimelineStorage(restored.records,restored.geometries,row.entities);
    assert.equal(saved.schemaVersion,1);
    assert.equal(saved.geometries.length,row.input.geometries.length,'no unbound versions may be pruned');
    for(const version of row.input.geometries) assert.deepEqual(restored.geometries.get({id:version.id,version:version.version}),version.geojson);
    assert.deepEqual(saved,JSON.parse(JSON.stringify(saved)));
    const reopened=restoreTimelineStorage(JSON.parse(JSON.stringify(saved)),row.entities);
    assert.deepEqual(snapshotTimelineStorage(reopened.records,reopened.geometries,row.entities),saved);
    if(saved.geometries.length) {
      assert.throws(()=>{saved.geometries[0].version=10;},TypeError);
      assert.ok(Object.isFrozen(saved.records));
    }
  } else assert.throws(()=>restoreTimelineStorage(row.input,row.entities),{code:row.expected});
  assert.deepEqual(row.input,before);assert.deepEqual(row.entities,catalog);
});
test('a failed candidate restore leaves the previously loaded storage unchanged', () => {
  const row=timelineStorageCases()[0];let current=restoreTimelineStorage(row.input,row.entities);
  const previous=current, saved=snapshotTimelineStorage(current.records,current.geometries,row.entities);
  const bad=structuredClone(row.input);bad.geometries.splice(0,1);
  assert.throws(()=>{current=restoreTimelineStorage(bad,row.entities);},{code:'TIMELINE_GEOMETRY'});
  assert.equal(current,previous);
  assert.deepEqual(snapshotTimelineStorage(current.records,current.geometries,row.entities),saved);
});
test('old storage checkpoints stay intact after appending a new geometry version', () => {
  const row=timelineStorageCases()[0];const current=restoreTimelineStorage(row.input,row.entities);
  const before=snapshotTimelineStorage(current.records,current.geometries,row.entities);
  current.geometries.insert({id:'shape',version:3},row.input.geometries[0].geojson);
  const after=snapshotTimelineStorage(current.records,current.geometries,row.entities);
  assert.equal(before.geometries.length,4);assert.equal(after.geometries.length,5);
  const undone=restoreTimelineStorage(before,row.entities);
  assert.equal(undone.geometries.get({id:'shape',version:3}),null);
  assert.deepEqual(snapshotTimelineStorage(undone.records,undone.geometries,row.entities),before);
});
test('save validates records against real stored polygon versions', () => {
  const row=timelineStorageCases()[0];const current=restoreTimelineStorage(row.input,row.entities);
  const records=structuredClone(current.records);records.geometryBindings[0].geometryRef={id:'label',version:1};
  assert.throws(()=>snapshotTimelineStorage(records,current.geometries,row.entities),{code:'TIMELINE_GEOMETRY'});
});
test('store and entity catalog are required dependencies', () => {
  const row=timelineStorageCases()[0];const current=restoreTimelineStorage(row.input,row.entities);
  assert.throws(()=>snapshotTimelineStorage(current.records,null,row.entities),{code:'TIMELINE_CONTEXT'});
  assert.throws(()=>restoreTimelineStorage(row.input,undefined),{code:'TIMELINE_CONTEXT'});
});
});
});
contractSuite("core-gpkg-file-boundary", () => {
const { normalizeGenericFeatureSemantics } = __gpkg_dep10;
const assert = __gpkg_dep3.default;
const test = __gpkg_dep0.default;
const { readFileSync } = __gpkg_dep11;
const { createNodeCoreProject } = __gpkg_dep12;
const { productionGeoPackage, spatialLayerCount, spatialColumns } = __gpkg_dep1;

for(const name of ['static','complex'])test(`Core ${name} file export supplies same-epoch spatial facts to the byte encoder`,async t=>{
  const seed=JSON.parse(readFileSync(new URL(`../../fixtures/timeline-exchange/${name}.json`,import.meta.url),'utf8'));
  if(name==='static') seed.genericFeatures.push(normalizeGenericFeatureSemantics({type:'Feature',id:'ac7332ab-e9e8-4f20-a14e-b7291ddf5f1d',
    geometry:{type:'Point',coordinates:[0,0]},properties:{schemaVersion:2,name:'Point',source:{kind:'user'}}}));
  const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());const before=owner.client.state();
  const result=await owner.client.exportSnapshot({format:'pandolab-project-state',version:seed.version,savedAt:seed.savedAt});
  const body=JSON.parse(result.storageJson);
  assert.deepEqual(owner.client.state(),before);assert.deepEqual(result.state,before);
  assert.equal(result.spatialState===null,name==='complex');
  const file=await productionGeoPackage('write',new ArrayBuffer(0),body,result.spatialState);
  assert.equal(spatialLayerCount(file.buffer)>0,name==='static');
  if(name==='static') for(const table of ['generic_features_point']) {
    const columns=spatialColumns(file.buffer,table);
    assert.ok(columns.includes('properties_json'));
    for(const retired of ['role','owner_id','parent_id','topology_group','land_binding']) assert.equal(columns.includes(retired),false);
  }
  const accepted=await owner.client.validateImport(JSON.stringify((await productionGeoPackage('read',file.buffer)).metadata.projectState));
  const reopened=await createNodeCoreProject(accepted);t.after(()=>reopened.dispose());
  assert.deepEqual(JSON.parse(await reopened.client.storageSnapshot()),body);
  assert.equal(Object.hasOwn(body,'spatialState'),false);assert.equal(Object.hasOwn(body,'checkpoint'),false);
});

test('the project byte encoder rejects a missing Core spatial receipt instead of resolving the model in JavaScript',async()=>{
  const body=JSON.parse(readFileSync(new URL("../../fixtures/timeline-exchange/static.json",import.meta.url),'utf8'));
  await assert.rejects(productionGeoPackage('write',new ArrayBuffer(0),body),{code:'PL-GPKG-SPATIAL-PROJECTION'});
});
});
