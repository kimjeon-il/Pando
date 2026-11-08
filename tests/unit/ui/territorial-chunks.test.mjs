import { describe as contractSuite } from 'node:test';
import * as __country_dep0 from "node:assert/strict";
import * as __country_dep1 from "node:fs";
import * as __country_dep2 from "node:crypto";
import * as __country_dep3 from "node:zlib";
import * as __country_dep4 from "../../../tools/data/territorial-chunk-compression.mjs";
import * as __country_dep5 from "node:test";
import * as __country_dep6 from "../../../tools/data/territorial-entity-sources.mjs";
import * as __country_dep7 from "node:path";
import * as __country_dep8 from "../../helpers/frontend-source.mjs";
import * as __country_dep9 from "node:fs/promises";
import * as __country_dep10 from "node:child_process";
import * as __country_dep11 from "../../../src/ui/object-presentation.js";
import * as __country_dep12 from "../../../scripts/lib/territorial-storage-audit.mjs";
contractSuite("territorial-chunks", () => {
const assert = __country_dep0.default;
const fs = __country_dep1.default;
const { createHash } = __country_dep2;
const { gzipSync, gunzipSync } = __country_dep3;
const { selectTerritorialChunkBytes } = __country_dep4;
const test = __country_dep5.default;
const { readTerritorialSources, entityFileName, territorialDataRoot, territorialSourceRoot } = __country_dep6;
const path = __country_dep7.default;








test('index lists all source entities without geometry and compressed chunks retain every source byte contract',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json'),'utf8'));
 const entities=readTerritorialSources();
 assert.equal(index.entities.length,entities.length);
 assert.deepEqual(index.entities.map(e=>e.entityId).sort(),entities.map(e=>e.entityId).sort());
 assert.equal(new Set(entities.map(e=>e.entityId)).size,entities.length);
 for(const entity of entities){
   const item=index.entities.find(e=>e.entityId===entity.entityId);assert.ok(item);
   assert.equal(item.geometryVersionCount,entity.geometryVersions.length);
   assert.equal(item.geometryVersions.some(v=>Object.hasOwn(v,'geometry')),false);
   const stored=fs.readFileSync(path.join(territorialDataRoot,'generated/v2',item.file));
   assert.equal(stored.length,item.compressedBytes);assert.equal(createHash('sha256').update(stored).digest('hex'),item.sha256);
   const bytes=gunzipSync(stored);assert.equal(bytes.length,item.decodedBytes);
   assert.deepEqual(JSON.parse(bytes),entity);
   assert.equal(item.file,`${entityFileName(entity.entityId)}.gz`);
 }
 const snapshotRoot=path.join(territorialSourceRoot,'snapshots');
 const snapshots=fs.readdirSync(snapshotRoot).filter(file=>file.endsWith('.json')).sort()
   .map(file=>JSON.parse(fs.readFileSync(path.join(snapshotRoot,file),'utf8')));
 assert.ok(snapshots.length>0,'Missing source snapshots');
 assert.equal(new Set(snapshots.map(snapshot=>snapshot.id)).size,snapshots.length);
 assert.deepEqual(index.snapshots,snapshots,'Every source snapshot must be published without changing its date or entity selection');
 assert.equal(index.views.length,1);
 assert.equal(index.views[0].id,'world:catalog');
 assert.equal(Object.hasOwn(index.views[0],'referenceDate'),false);
 assert.equal(index.views[0].selections.length,258);
});

test('unchanged compressed chunk bytes are reused rather than recompressed with a different zlib level',()=>{
 const content=Buffer.from('the same country source payload\\n');
 const previous=gzipSync(content,{level:1,mtime:0});
 const preserved=selectTerritorialChunkBytes(content,previous);
 assert.equal(preserved.changed,false);
 assert.strictEqual(preserved.stored,previous);
 assert.deepEqual(gunzipSync(preserved.stored),content);
 const edited=Buffer.from('an updated country source payload\\n');
 const regenerated=selectTerritorialChunkBytes(edited,previous);
 assert.equal(regenerated.changed,true);
 assert.deepEqual(gunzipSync(regenerated.stored),edited);
 assert.throws(()=>selectTerritorialChunkBytes(content,Buffer.from('corrupt zip')), /incorrect header|invalid|gzip|Z_DATA_ERROR/i);
});
});
contractSuite("territorial-store-boundary", () => {
const { repositoryFrontendUrl } = __country_dep8;
const test = __country_dep5.default;
const assert = __country_dep0.default;
const { readFile } = __country_dep9;
const { execFileSync } = __country_dep10;
const { createObjectPresentation } = __country_dep11;







const read = name => readFile(repositoryFrontendUrl(`assets/js/modules/${name}`), 'utf8');
const viewerMap = () => readFile(new URL("../../../src/app/viewer-map.js", import.meta.url), 'utf8');
const viewerComposition = () => readFile(new URL("../../../src/app/viewer-composition.js", import.meta.url), 'utf8');

test('presentation does not expose retired transaction or validation APIs', () => {
  const presentation = createObjectPresentation();
  assert.equal(Object.hasOwn(presentation, 'runTerritorialUnitTransaction'), false);
  assert.equal(Object.hasOwn(presentation, 'validateTerritorialUnitRelations'), false);
});

test('every production territorial storage access is classified at its function owner', () => {
  const output = execFileSync(process.execPath, ['scripts/check-territorial-storage.mjs'], { encoding: 'utf8' });
  assert.match(output, /no unclassified or forbidden writes/);
});

test('Viewer territorial repository and selection share the accepted C++ document owner', async () => {
  const [map, composition, service] = await Promise.all([viewerMap(), viewerComposition(),
    readFile(new URL("../../helpers/core-command-services/territorial-service.mjs", import.meta.url), 'utf8')]);
  assert.match(map, /createTerritorialEntityStore\(\{documentModel:documentSession\.documentModel,commandOwner:documentSession\.commandOwner/);
  assert.match(map, /createTerritorialEntityRepository\(\{entityStore\}\)/);
  assert.match(composition, /createProjectDomain\(\{productMode,readOnly:true,commandOwner:documentSession\.commandOwner,documentModel:documentSession\.documentModel/);
  assert.match(service, /commandOwner\.executeCommand/);
  assert.doesNotMatch(service, /\bcountryCommands\b|\bunitCommands\b/);
});

test('current Viewer callers do not write raw territorial collections or retired Store APIs', async () => {
  const sources = await Promise.all([viewerMap(), viewerComposition(), read('builtin-session.js')]);
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:dependencies\.projectState\.)?state\.territorialEntities\s*(?:=|\.push\s*\(|\.splice\s*\()/);
    assert.doesNotMatch(source, /\bentityStore\.(?:applyChanges|setField|setLocked|appendEntities|removeEntities|replaceEntities|restoreProject|transaction)\s*\(/);
  }
  assert.match(sources[2], /sourceBytes/);
});

test('territorial Store exposes only accepted views and session-month queries', async () => {
  const store = await read('territorial-entity-store.js');
  assert.match(store, /documentModel\.territorialViews/);
  assert.match(store, /commandOwner\.setTimelineCursor/);
  assert.doesNotMatch(store, /\b(?:function|const)\s+(?:appendEntities|removeEntities|replaceEntities|applyChanges|setField|setLocked|restoreProject|transaction)\b/);
  assert.doesNotMatch(store, /function\s+(?:appendCountries|appendUnits|removeCountries|removeUnits|replaceCountries|replaceUnits|replaceCountryOverrides)\b/);
});
});
contractSuite("territorial-storage-audit", () => {
const test = __country_dep5.default;
const assert = __country_dep0.default;
const fs = __country_dep1.default;
const { auditTerritorialStorage, unclassifiedTerritorialAccesses } = __country_dep12;





const writes = source => auditTerritorialStorage(source).filter(entry => entry.access === 'write');
test('a classified reader cannot write and a neighbouring unclassified function cannot borrow its exception', () => {
  const entries = auditTerritorialStorage('function read(state) { state.territorialEntities.push({}); } function other(state) { return state.territorialEntities; }', 'app.js');
  const failures = unclassifiedTerritorialAccesses(entries, { owners: [{ file: 'app.js', functions: ['read'], access: ['read'] }] });
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(entry => [entry.function, entry.access]).sort(), [['other', 'read'], ['read', 'write']]);
});
test('storage audit follows destructuring, local array/entity aliases and optional chains', () => {
  const found = writes(`function bad(state) {
    const { territorialEntities: units } = state;
    units.push({});
    const feature = units.find(item => item.id === 'A');
    feature.geometry = {};
    const countries = state?.territorialEntities;
    countries.splice(0, 1);
    for (const country of countries) country.properties.name = 'changed';
    Object.assign(feature.properties, { name: 'changed' });
  }`);
  assert.equal(found.length, 5);
  assert.ok(found.every(entry => entry.function === 'bad'));
});
test('storage audit distinguishes detached containers, shared elements, deep copies and local rebinding', () => {
  const found = writes(`function edit(state) {
    const countries = state.territorialEntities.slice();
    countries.push({});
    countries[0].geometry = {};
    const copied = structuredClone(state.territorialEntities);
    copied.push({});
    let item = state.territorialEntities[0];
    item = { properties: {} };
    item.properties.name = 'detached';
    state.territorialEntities.map(item => ({ ...item })).push({});
  }`);
  // A copied array still aliases its original elements.
  assert.equal(found.length, 1);
  assert.match(found[0].expression, /countries\[0\]/);
});
test('store/repository getters and scope shadowing cannot hide illegal mutations', () => {
  const found = writes(`function bad(entityStore, entityRepository, state) {
    const item = entityRepository.get('A');
    item.geometry = {};
    (0, entityStore.snapshot)().push(item);
    const units = state.territorialEntities;
    function unrelated() { const units = []; units.push({}); }
    unrelated();
    units.reverse();
  }`);
  assert.equal(found.length, 3);
  assert.ok(found.every(entry => entry.function === 'bad'));
});

test('nested destructuring and local returned/getter aliases remain tracked', () => {
  assert.equal(writes(`function bad(state, entityStore) {
    const { territorialEntities: features } = state;
    features.pop();
    const getUnits = entityStore.snapshot;
    getUnits().push({});
    function selected() { return state.territorialEntities[0]; }
    selected().geometry = {};
  }`).length, 3);
});

test('candidate write ownership requires a fresh detached initializer', () => {
  const file = 'apps/editor/'+'frontend/js/modules/library-geometry-context.js';
  const policy = { owners: [{ file, functions: ['prepare'], access: ['read', 'write'], detachedCandidate: true }] };
  const source = (initializer, prefix = '', declaration = 'const') => `${prefix}
    function prepare(input, documentModel) {
      ${declaration} project = ${initializer};
      project.territorialEntities.push({});
      return project;
    }`;
  const check = value => {
    const entries = auditTerritorialStorage(value, file);
    assert.equal(entries.length, 2, 'both the raw access and mutation stay in the inventory');
    return unclassifiedTerritorialAccesses(entries, policy);
  };
  assert.deepEqual(check(source('structuredClone(input)')), []);
  assert.deepEqual(check(source('createInitialDocument({appVersion:"test"})',
    'import {createInitialDocument} from "../../../../../src/document/initial-document.js";')), []);
  for (const value of [
    source('input'),
    source('input.project'),
    source('documentModel.snapshot()'),
    source('structuredClone(input)', 'function structuredClone(value) { return value; }'),
    source('createInitialDocument(input)', 'import {createInitialDocument} from "./untrusted-document.js";'),
    source('structuredClone(input)', '', 'let'),
    'const project = structuredClone({}); function prepare() { project.territorialEntities.push({}); }',
    'function factory(input) { const project = structuredClone(input); return function prepare() { project.territorialEntities.push({}); }; }',
    'function prepare(input) { const project = structuredClone(input); return () => project.territorialEntities.push({}); }',
  ]) {
    assert.deepEqual(check(value).map(entry => entry.access).sort(), ['read', 'write']);
  }
});

const currentPolicy = JSON.parse(fs.readFileSync(new URL("../../../scripts/contracts/territorial-storage-access.json", import.meta.url), 'utf8'));
const currentOwners = [
  ['src/ui/app-map-settings.js', 'mapDisplayAvailability', false],
  ['src/document/project-session.js', 'pruneViewingItems', false],
  ['src/document/timeline-records.js', 'timelineObjectCatalog', false],
  ['src/data/builtin-world-loader.js', 'assembleBuiltinWorld', true],
];

test('current projection readers and detached source builders have explicit storage owners', () => {
  const entries = currentOwners.flatMap(([file, name]) => auditTerritorialStorage(
    fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'), file)
    .filter(entry => entry.function === name));
  assert.ok(entries.length >= 1, 'Canonical projection readers must remain audited');
  assert.equal(entries.filter(entry => entry.access === 'write').length, 2,
    'Only canonical detached source builders retain the classified writes');
  assert.deepEqual(unclassifiedTerritorialAccesses(entries, currentPolicy), []);
});

test('current reader permissions and detached builders cannot authorize active document mutations', () => {
  for (const [file, name, candidate] of currentOwners) {
    const entries = auditTerritorialStorage(`function ${name}(project) {
      const rows = project.territorialEntities;
      rows.push({});
    }`, file);
    const failures = unclassifiedTerritorialAccesses(entries, currentPolicy);
    assert.deepEqual(failures.map(entry => entry.access).sort(), candidate ? ['read', 'write'] : ['write']);
    const neighbour = auditTerritorialStorage('function unrelated(input) { const project = structuredClone(input); project.territorialEntities.push({}); }', file);
    assert.equal(unclassifiedTerritorialAccesses(neighbour, currentPolicy).length, 2);
  }
});
});
