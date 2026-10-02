import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrentProjectSchema, PROJECT_SCHEMA_VERSION } from '../../assets/js/modules/project-state.js';
import { validateProjectReferenceIntegrity } from '../../assets/js/modules/project-invariants.js';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { normalizeSourceProvenance } from '../../assets/js/modules/source-provenance.js';
import { DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';
import { createGisImportTransactionCommitter } from '../../assets/js/modules/gis-import-transaction.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { normalizeGenericFeatureSemantics } from '../../assets/js/modules/generic-feature-service.js';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

test('GIS committer requires the canonical store instead of creating a second state adapter', () => {
  const state = {};
  assert.throws(() => createGisImportTransactionCommitter({ state }), /엔티티 저장소/);
  assert.deepEqual(state, {});
});

test('generic GeoJSON reimport preserves provenance and arbitrary attributes while replacing only the internal ID', async () => {
  const source = normalizeSourceProvenance({ kind: 'gis', dataset: 'rivers', sourceId: 'upstream-9',
    sourceFormat: 'geojson', details: { licence: 'test', nested: { original: true } } });
  const original = { type: 'Feature', id: uuid(10), geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { schemaVersion: 2, name: 'River', notes: 'memo', color: '#123456', locked: false,
      source, custom: { rank: 2 } } };
  const state = {};
  let output;
  const importer = createGisImportTransactionCommitter({ state, uid: () => uuid(11), deepClone: structuredClone,
    entityStore: createTerritorialEntityStore({ getState: () => state }),
    GENERIC_FEATURE_SCHEMA_VERSION: 2, DEFAULT_GENERIC_FEATURE_COLOR: '#999999', normalizeGenericFeatureSemantics,
    validateStructuredGeometry: () => [], genericFeatureService: { addMany: values => { output = values; } },
    activeLayerFolderKeys: () => ['genericFeatures'], markLayerTreeDirty() {}, setActionStatus() {} });
  await importer.importGeoJson({ name: 'export.geojson' }, { parsed: JSON.parse(JSON.stringify(original)) });
  assert.equal(output[0].id, uuid(11));
  assert.equal(output[0].properties.source.sourceId, 'upstream-9');
  assert.equal(output[0].properties.source.dataset, 'rivers');
  assert.deepEqual(output[0].properties.source.details.nested, { original: true });
  assert.deepEqual(output[0].properties.source.details.legacyProperties.custom, { rank: 2 });
  assert.equal(output[0].properties.notes, 'memo');
  assert.equal(original.properties.source.sourceId, 'upstream-9');
  output[0].properties.source = normalizeSourceProvenance({ ...source, sourceId: '' });
  await importer.importGeoJson({ name: 'export.geojson' }, { parsed: output[0] });
  assert.equal(output[0].properties.source.sourceId, uuid(11));
});
const generic = source => ({
  type: 'Feature', id: uuid(1), geometry: { type: 'Point', coordinates: [1, 2] },
  properties: { schemaVersion: 2, name: 'fallback', notes: '', color: '#123456', locked: false, source },
});
const project = feature => ({
  format: 'pandolab-project-state',
  schemaVersion: PROJECT_SCHEMA_VERSION,
  landObjectModel: {
    schemaVersion: 2,
    coastlineAuthority: 'countries',
    purpose: 'lossless-fallback',
    directCreation: false,
    sourceProvenanceSchemaVersion: 1,
    canonicalProperties: ['name', 'notes', 'color', 'locked', 'source'],
  },
  territorialModel: { schemaVersion: 2 },
  distributionModel: { schemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION },
  distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
  layerPresentation: { schemaVersion: LAYER_PRESENTATION_SCHEMA_VERSION, overlayOrder: [], styles: {} },
  countriesData: { type: 'FeatureCollection', features: [] },
  genericFeatures: feature ? [feature] : [],
});

test('project schema accepts canonical Generic Feature v2 provenance', () => {
  const current = project(generic(normalizeSourceProvenance({ kind: 'gis', dataset: 'roads', sourceId: 'r-1' })));
  assert.equal(assertCurrentProjectSchema(current), current);
});

test('project schema migrates Generic Feature v1 from project schema 3', () => {
  const legacy = project();
  legacy.schemaVersion = 3;
  legacy.landObjectModel = { schemaVersion: 1, coastlineAuthority: 'countries', roles: ['generic'] };
  legacy.genericFeatures = [{
    type: 'Feature', id: uuid(1), geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { schemaVersion: 1, name: 'legacy', role: 'territory', ownerId: '', color: '#123456' },
  }];
  const result = assertCurrentProjectSchema(legacy);
  assert.equal(result, legacy);
  assert.equal(legacy.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(legacy.landObjectModel.schemaVersion, 2);
  assert.equal(legacy.genericFeatures[0].properties.schemaVersion, 2);
  assert.equal(legacy.genericFeatures[0].properties.source.kind, 'legacy');
  assert.equal(legacy.genericFeatures[0].properties.source.details.legacyGenericSemantics.role, 'territory');
});

test('invalid Generic Feature v2 provenance is rejected by schema and runtime invariants', () => {
  const invalid = generic({ schemaVersion: 1, kind: 'mystery', dataset: '', sourceId: '', sourceFormat: '', sourceType: '', version: '', importedAt: '', details: {} });
  assert.throws(() => assertCurrentProjectSchema(project(invalid)), /source provenance/);
  const result = validateProjectReferenceIntegrity({ genericFeatures: [invalid] });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'PL-INV-GENERIC-SOURCE'));
});

test('serializer publishes Generic Feature as lossless fallback with provenance contract', () => {
  const serializer = createProjectSerializer({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: '0.30.0',
    baseDataset: 'base',
    genericFeatureSchemaVersion: 2,
    distributionSchemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION,
    distributionTypes: ['language'],
    distributionModes: ['territorial', 'geometry'],
    terrainDataset: 'terrain',
    hydroDataset: 'hydro',
    readSnapshot: () => ({
      countriesData: { type: 'FeatureCollection', features: [] },
      projectFields: { genericFeatures: [] },
      countryDelta: { changed: [], removedIds: [] },
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
