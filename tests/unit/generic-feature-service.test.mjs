import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../helpers/generic-feature-command-service.mjs";
import * as __dep3 from "../../shared/frontend/js/modules/generic-feature-normalization.js";
import * as __dep4 from "../../shared/frontend/js/modules/gpu-scene.js";
import * as __dep5 from "../../shared/frontend/js/modules/object-selection-controller.js";
import * as __dep6 from "../helpers/timeline-project.mjs";
import * as __dep7 from "../helpers/gis-core-fixture.mjs";
import * as __dep8 from "../../shared/frontend/js/modules/project-state.js";
import * as __dep9 from "../../shared/frontend/js/modules/project-invariants.js";
import * as __dep10 from "../../tools/gis/project-template-compiler.js";
import * as __dep11 from "../../shared/frontend/js/modules/source-provenance.js";
import * as __dep12 from "../../shared/frontend/js/modules/version-contract.js";
import * as __dep13 from "../helpers/core-gis-compat/gis-import-transaction.mjs";

// Original feature contract: generic-feature-service.test.mjs
contractSuite("generic-feature-service", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { createGenericFeatureService }=__dep2;
const { normalizeGenericFeatureCollection, normalizeGenericFeatureSemantics }=__dep3;


const genericFeature = (id, geometry = { type: 'Point', coordinates: [1, 2] }, properties = {}) => ({
  type: 'Feature', id, geometry, properties: { schemaVersion: 2, name: id, color: '#123456', ...properties },
});

test('Generic normalization rejects old versions and retired top-level semantics', () => {
  for (const properties of [{ schemaVersion: 1 }, { schemaVersion: undefined },
    { schemaVersion: 2, role: 'territory' }, { schemaVersion: 2, ownerId: 'A' }]) {
    const feature = genericFeature('old', undefined, properties), before = structuredClone(feature);
    assert.throws(() => normalizeGenericFeatureSemantics(feature));
    assert.deepEqual(feature, before);
  }
});

test('new v2 Generic Feature uses canonical fallback provenance and rejects duplicate IDs', () => {
  const [normalized] = normalizeGenericFeatureCollection([genericFeature('one', undefined, {
    schemaVersion: 2,
    source: { schemaVersion: 1, kind: 'gis', dataset: 'roads', sourceId: 'r-1', sourceFormat: 'geojson', sourceType: 'road' },
  })]);
  assert.equal(normalized.properties.source.kind, 'gis');
  assert.throws(() => normalizeGenericFeatureCollection([genericFeature('one'), genericFeature('one')]), /중복/);
});

test('generic feature service sends commands without mutating its accepted read model', async () => {
  let genericFeatures = Object.freeze([]);
  const commands = [];
  let acknowledge;
  const service = createGenericFeatureService({
    documentModel: { list: domain => { assert.equal(domain, 'generic'); return genericFeatures; } },
    commandOwner: {
      executeCommand(command) {
        commands.push(command);
        return new Promise(resolve => { acknowledge = resolve; });
      },
    },
  });
  const feature = genericFeature('one', undefined, { schemaVersion: 2, source: {
    kind: 'gis', sourceFormat: 'geojson', sourceId: 'original',
    details: { legacyGenericSemantics: { ownerId: 'country-a', landBinding: 'hard' } },
  } });
  const created = service.add(feature);
  assert.equal(typeof created?.then, 'function');
  assert.equal(service.get('one'), null);
  assert.deepEqual(commands[0], { commandId: 'generic.create', targets: [{ domain: 'generic', id: 'one' }], payload: { feature } });
  const accepted = Object.freeze(normalizeGenericFeatureSemantics(structuredClone(feature)));
  genericFeatures = Object.freeze([accepted]);
  acknowledge({ ok: true, changed: true, before: { genericFeatures: [] }, after: { genericFeatures } });
  assert.equal(await created, accepted);
  const changed = service.updateMetadata('one', 'notes', '  Independent object  ');
  assert.equal(service.get('one'), accepted);
  assert.equal(commands[1].payload.value, '  Independent object  ', 'the Core owns normalization');
  const edited = Object.freeze({ ...accepted, properties: Object.freeze({ ...accepted.properties, notes: 'Independent object' }) });
  genericFeatures = Object.freeze([edited]);acknowledge({ ok: true, changed: true, before: { genericFeatures: [accepted] }, after: { genericFeatures } });
  assert.deepEqual(await changed, { ok: true, changed: true, feature: edited });
  const removed = service.remove('one');
  assert.equal(service.get('one'), edited);
  genericFeatures = Object.freeze([]);acknowledge({ ok: true, changed: true, before: { genericFeatures: [edited] }, after: { genericFeatures } });
  assert.deepEqual(await removed, { ok: true, feature: edited });
  assert.equal(service.list().length, 0);
  assert.deepEqual(commands.map(command => command.commandId), ['generic.create', 'generic.metadata', 'generic.remove']);
});

test('generic service preserves declared no-op and failure results from Core', async () => {
  const feature = Object.freeze(genericFeature('one'));
  const replies = [{ ok: true, changed: false, before: { genericFeatures: [feature] }, after: { genericFeatures: [feature] } },
    { ok: false, changed: false, error: { code: 'not-found', message: 'missing' } },
    { ok: false, changed: false, error: { code: 'invalid', message: 'unsupported field' } }];
  const service = createGenericFeatureService({ documentModel: { list: () => [feature] },
    commandOwner: { executeCommand: async () => replies.shift() } });
  assert.deepEqual(await service.updateMetadata('one', 'name', 'one'), { ok: true, changed: false, feature });
  assert.deepEqual(await service.remove('missing'), { ok: false, code: 'not-found' });
  await assert.rejects(service.updateMetadata('one', 'role', 'old field'), error => error.code === 'invalid' && error.message === 'unsupported field');
});

test('generic creation captures its submitted input and uses the exact ACK projection', async () => {
  const input = genericFeature('one');
  const accepted = Object.freeze(structuredClone(input));
  let acknowledge, dispatched;
  const service = createGenericFeatureService({ documentModel: { list: () => [genericFeature('later')] },
    commandOwner: { executeCommand(command) { dispatched = command;return new Promise(resolve => { acknowledge = resolve; }); } } });
  const pending = service.add(input);
  input.id = 'edited by caller';input.properties.name = 'mutated';
  assert.equal(dispatched.payload.feature.id, 'one');
  assert.equal(dispatched.payload.feature.properties.name, 'one');
  acknowledge({ ok: true, changed: true, before: { genericFeatures: [] }, after: { genericFeatures: [accepted] } });
  assert.equal(await pending, accepted);
});

test('generic imports preserve target order and never locally skip an empty import', async () => {
  const features = [genericFeature('two'), genericFeature('one')], commands = [];
  const service = createGenericFeatureService({ documentModel: { list: () => [] },
    commandOwner: { async executeCommand(command) {
      commands.push(command);
      return { ok: true, changed: true, before: { genericFeatures: [] }, after: { genericFeatures: features } };
    } } });
  assert.deepEqual(await service.addMany(features), features);
  assert.deepEqual(commands[0].targets, [{ domain: 'generic', id: 'two' }, { domain: 'generic', id: 'one' }]);
  assert.deepEqual(await service.addMany([]), []);
  assert.equal(commands[1].commandId, 'generic.import');
  assert.deepEqual(commands[1].payload, { features: [] });
});
});

// Original feature contract: generic-feature-display.test.mjs
contractSuite("generic-feature-display", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { createGpuScene }=__dep4;
const { normalizeObjectRef }=__dep5;
const { normalizeGenericFeatureSemantics }=__dep3;

test('generic display preserves canonical geometry independently of country revisions and source attributes', () => {
  const feature = normalizeGenericFeatureSemantics({
    type: 'Feature', id: 'independent-area',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]] },
    properties: { schemaVersion: 2, name: 'Area', source: {
      kind: 'gis', sourceFormat: 'geojson', sourceId: 'original',
      details: { legacyGenericSemantics: { ownerId: 'country-a', landBinding: 'hard' } },
    } },
  });
  const before = structuredClone(feature);
  const state = { genericFeatures: [feature] };
  const scene = createGpuScene();
  scene.connect({ projectState: { state }, selectionServices: { normalizeObjectRef } });
  const ref = { domain: 'generic', type: 'feature', id: feature.id };
  assert.strictEqual(scene.mapFeatureForObjectRef(ref), feature);
  assert.equal(scene.mapFeatureForObjectRef({ ...ref, id: 'missing' }), null);
  assert.deepEqual(feature, before);
});
});

// Original feature contract: generic-provenance.test.mjs
contractSuite("generic-provenance", () => {
const { projectForStorage }=__dep6;
const { createGisCoreFixture }=__dep7;
const { staticTerritorialInput }=__dep6;
const assert=__dep0.default;
const test=__dep1.default;
const { assertCurrentProjectSchema, PROJECT_SCHEMA_VERSION }=__dep8;
const { validateProjectReferenceIntegrity }=__dep9;
const { createProjectTemplateCompiler }=__dep10;
const { normalizeSourceProvenance }=__dep11;
const { DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION, TERRITORIAL_MODEL_SCHEMA_VERSION }=__dep12;
const { createGisImportTransactionCommitter }=__dep13;

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

test('GIS committer requires the canonical store instead of creating a second state adapter', () => {
  const state = { territorialEntities: [] };
  assert.throws(() => createGisImportTransactionCommitter({ state }), /accepted territorial read projection/);
  assert.deepEqual(state, { territorialEntities: [] });
});

test('generic GeoJSON reimport preserves provenance and arbitrary attributes while replacing only the internal ID', async () => {
  const source = normalizeSourceProvenance({ kind: 'gis', dataset: 'rivers', sourceId: 'upstream-9',
    sourceFormat: 'geojson', details: { licence: 'test', nested: { original: true } } });
  const original = { type: 'Feature', id: uuid(10), geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { schemaVersion: 2, name: 'River', notes: 'memo', color: '#123456', locked: false,
      source, custom: { rank: 2 } } };
  let nextId=11;
  const f=await createGisCoreFixture([],{runtime:{uid:()=>uuid(nextId++)}}),importer=f.committer;
  await importer.importGeoJson({ name: 'export.geojson' }, { parsed: JSON.parse(JSON.stringify(original)) });
  let output=f.documentModel.list('generic');
  assert.equal(output[0].id, uuid(11));
  assert.equal(output[0].properties.source.sourceId, 'upstream-9');
  assert.equal(output[0].properties.source.dataset, 'rivers');
  assert.deepEqual(output[0].properties.source.details.nested, { original: true });
  assert.deepEqual(output[0].properties.source.details.attributes.custom, { rank: 2 });
  assert.equal(output[0].properties.notes, 'memo');
  assert.equal(original.properties.source.sourceId, 'upstream-9');
  const reimport=structuredClone(output[0]);reimport.properties.source=normalizeSourceProvenance({...source,sourceId:''});
  await importer.importGeoJson({name:'export.geojson'},{parsed:reimport});
  output=f.documentModel.list('generic');
  assert.equal(output[1].id,uuid(12));assert.equal(output[1].properties.source.sourceId,uuid(11));
  assert.equal(await f.project.undo(),true);assert.equal(f.documentModel.list('generic').length,1);
  assert.equal(await f.project.redo(),true);assert.equal(f.documentModel.list('generic').length,2);
});
test('external GeoJSON source attributes remain opaque GIS data', async () => {
  let nextId=40;
  const f=await createGisCoreFixture([],{runtime:{uid:()=>uuid(nextId++)}});
  const sources=['OpenStreetMap',null,{type:'survey',id:'source-7'}];
  for(const source of sources) {
    const input={type:'Feature',id:'external-9',geometry:{type:'Point',coordinates:[1,2]},
      properties:{name:'Sample',source}};
    const before=structuredClone(input);
    await f.committer.importGeoJson({name:'external.geojson'},{parsed:input});
    const imported=f.documentModel.list('generic').at(-1);
    assert.equal(imported.properties.source.kind,'gis');
    assert.equal(imported.properties.source.sourceId,'external-9');
    assert.deepEqual(imported.properties.source.details.attributes.source,source);
    assert.deepEqual(input,before);
  }
});

const generic = source => ({
  type: 'Feature', id: uuid(1), geometry: { type: 'Point', coordinates: [1, 2] },
  properties: { schemaVersion: 2, name: 'fallback', notes: '', color: '#123456', locked: false, source },
});
const project = feature => ({
  format: 'pandolab-project-state',
  schemaVersion: PROJECT_SCHEMA_VERSION,
  documentId: uuid(99),
  physicalSourceInfo: {},
  ...projectForStorage().projectFields,
  landObjectModel: {
    schemaVersion: 2,
    coastlineAuthority: 'territorialEntities',
    purpose: 'lossless-fallback',
    directCreation: false,
    sourceProvenanceSchemaVersion: 1,
    canonicalProperties: ['name', 'notes', 'color', 'locked', 'source'],
  },
  territorialModel: { schemaVersion: TERRITORIAL_MODEL_SCHEMA_VERSION },
  distributionModel: { schemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION },
  distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
  layerPresentation: { schemaVersion: LAYER_PRESENTATION_SCHEMA_VERSION, styles: {}, objectStyles: {}, objectOrder: [] },
  territorialEntities: [],
  ...staticTerritorialInput([]),
  genericFeatures: feature ? [feature] : [],
});

test('project schema accepts canonical Generic Feature v2 provenance', () => {
  const current = project(generic(normalizeSourceProvenance({ kind: 'gis', dataset: 'roads', sourceId: 'r-1' })));
  assert.equal(assertCurrentProjectSchema(current), current);
});

test('project schema rejects retired development formats without modifying input', () => {
  const legacy = project();
  legacy.schemaVersion = 3;
  const before = structuredClone(legacy);
  assert.throws(() => assertCurrentProjectSchema(legacy), /schemaVersion 3.*지원하지/);
  assert.deepEqual(legacy, before);
});

test('invalid Generic Feature v2 provenance is rejected by schema and runtime invariants', () => {
  const invalid = generic({ schemaVersion: 1, kind: 'mystery', dataset: '', sourceId: '', sourceFormat: '', sourceType: '', version: '', importedAt: '', details: {} });
  assert.throws(() => assertCurrentProjectSchema(project(invalid)), /source provenance/);
  const result = validateProjectReferenceIntegrity({ genericFeatures: [invalid] });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'PL-INV-GENERIC-SOURCE'));
});

test('serializer publishes Generic Feature as lossless fallback with provenance contract', () => {
  const serializer = createProjectTemplateCompiler({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: '0.30.0',
    baseDataset: 'base',
    genericFeatureSchemaVersion: 2,
    distributionSchemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION,
    distributionModes: ['territorial', 'geometry'],
    terrainDataset: 'terrain',
    hydroDataset: 'hydro',
    readSnapshot: () => ({
      documentId: uuid(99),
      physicalSourceInfo: {},
      territorialEntities: [],
      projectFields: { ...projectForStorage().projectFields, genericFeatures: [], ...staticTerritorialInput([]) },
      entityDelta: { changed: [], removedIds: [] },
      fullAutosave: false,
      terrainManifest: null,
      hydroManifest: null,
    }),
  });
  const output = serializer.buildProject();
  assert.equal(output.landObjectModel.schemaVersion, 2);
  assert.equal(output.landObjectModel.purpose, 'lossless-fallback');
  assert.equal(output.landObjectModel.directCreation, false);
  assert.equal(output.landObjectModel.sourceProvenanceSchemaVersion, 1);
  assert.deepEqual(output.landObjectModel.canonicalProperties, ['name', 'notes', 'color', 'locked', 'source']);
  assert.equal('roles' in output.landObjectModel, false);
});
});
