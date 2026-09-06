import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrentProjectSchema, PROJECT_SCHEMA_VERSION } from '../../assets/js/modules/project-state.js';
import { validateProjectReferenceIntegrity } from '../../assets/js/modules/project-invariants.js';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { normalizeSourceProvenance } from '../../assets/js/modules/source-provenance.js';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
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
  distributionModel: { schemaVersion: 2 },
  layerPresentation: { schemaVersion: 3, overlayOrder: [], styles: {} },
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
    distributionSchemaVersion: 2,
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
