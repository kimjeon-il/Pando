import { projectForStorage } from '../helpers/timeline-project.mjs';
import {createGisCoreFixture} from '../helpers/gis-core-fixture.mjs';
import {staticTerritorialInput} from '../helpers/timeline-project.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrentProjectSchema, PROJECT_SCHEMA_VERSION } from "../../shared/frontend/js/modules/project-state.js";
import { validateProjectReferenceIntegrity } from "../../shared/frontend/js/modules/project-invariants.js";
import { createProjectSerializer } from "../../apps/editor/frontend/js/modules/project-serializer.js";
import { normalizeSourceProvenance } from "../../shared/frontend/js/modules/source-provenance.js";
import { DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION, TERRITORIAL_MODEL_SCHEMA_VERSION } from "../../shared/frontend/js/modules/version-contract.js";
import { createGisImportTransactionCommitter } from "../../apps/editor/frontend/js/modules/gis-import-transaction.js";

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
  layerPresentation: { schemaVersion: LAYER_PRESENTATION_SCHEMA_VERSION, overlayOrder: [], styles: {} },
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
  const serializer = createProjectSerializer({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: '0.30.0',
    baseDataset: 'base',
    genericFeatureSchemaVersion: 2,
    distributionSchemaVersion: DISTRIBUTION_MODEL_SCHEMA_VERSION,
    distributionModes: ['territorial', 'geometry'],
    terrainDataset: 'terrain',
    hydroDataset: 'hydro',
    readSnapshot: () => ({
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
