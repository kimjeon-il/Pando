import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep3 from "../../../src/document/generic-feature-normalization.js";
import * as __dep4 from "../../../src/rendering/gpu-scene.js";
import * as __dep5 from "../../../src/ui/object-selection-controller.js";
import {readPortabilityProjectSeed} from '../../helpers/portability-project-seed.mjs';
import {createEmptyTerritorialState} from '../../../src/document/territorial-entity-store.js';
import {pickProjectFields} from '../../../src/document/project-state.js';
import * as __dep8 from "../../../src/document/project-state.js";
import * as __dep9 from "../../../src/document/project-invariants.js";
import * as __dep10 from "../../../tools/gis/project-template-compiler.js";
import * as __dep11 from "../../../src/document/source-provenance.js";
import * as __dep12 from "../../../src/runtime/version-contract.js";
// Original feature contract: generic-feature-service.test.mjs
contractSuite("generic-feature-service", () => {
const assert=__dep0.default;
const test=__dep1.default;

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
  const raw=genericFeature('one',undefined,{source:{kind:'gis',sourceId:'r-1',sourceFormat:'geojson'}});
  const before=structuredClone(raw),[normalized]=normalizeGenericFeatureCollection([raw]);
  assert.notEqual(normalized,raw);
  assert.deepEqual(raw,before);
  assert.equal(normalized.properties.source.kind,'gis');
  assert.equal(normalized.properties.source.sourceId,'r-1');
  assert.equal(normalized.properties.locked,false);
  assert.throws(() => normalizeGenericFeatureCollection([genericFeature('one'), genericFeature('one')]), /중복/);
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

const assert=__dep0.default;
const test=__dep1.default;
const { assertCurrentProjectSchema, PROJECT_SCHEMA_VERSION }=__dep8;
const { validateProjectReferenceIntegrity }=__dep9;
const { createProjectTemplateCompiler }=__dep10;
const { normalizeSourceProvenance }=__dep11;
const { DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION }=__dep12;


const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

const generic = source => ({
  type: 'Feature', id: uuid(1), geometry: { type: 'Point', coordinates: [1, 2] },
  properties: { schemaVersion: 2, name: 'fallback', notes: '', color: '#123456', locked: false, source },
});
const project = feature => {
  const state=createEmptyTerritorialState();
  return {...readPortabilityProjectSeed(),...state,geometries:state.geometries.snapshot(),
    labels:[],genericFeatures:feature?[feature]:[],hydroEdits:[],distributionLayers:[],distributionEntries:[],
    labelSettings:{},layerPresentation:{schemaVersion:LAYER_PRESENTATION_SCHEMA_VERSION,styles:{},objectStyles:{},objectOrder:[]}};
};

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
      projectFields: pickProjectFields({...project(),geometries:createEmptyTerritorialState().geometries}),
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
