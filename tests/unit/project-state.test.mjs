import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_SCHEMA_VERSION,
  PROJECT_STATE_FIELDS,
  applyProjectFields,
  assertCurrentProjectSchema,
  createProjectObjectId,
  pickProjectFields,
} from '../../assets/js/modules/project-state.js';
import { normalizeSourceProvenance } from '../../assets/js/modules/source-provenance.js';

const state = {
  sourceInfo: null, labels: [{ id: 'label-1' }], genericFeatures: [], hydroEdits: [{ id: 'river-1' }],
  territorialRelations: [{ id: 'relation-1' }],
  distributionLayers: [], distributionEntries: [], distributionSettings: { renderMode: 'overlap', activeLayerId: '' },
  labelSettings: { 'territorial:KOR': { pinned: true } }, layerPresentation: { styles: {} },
  physicalSettings: { terrainVisible: true }, projection: 'flat',
  layerVisibility: { countries: true }, itemVisibility: { A: false }, layerFolders: { countries: true },
  view: { flatZoom: 2 },
};

test('project serialization contains document and presentation fields only', () => {
  const project = pickProjectFields(state);
  assert.deepEqual(Object.keys(project), PROJECT_STATE_FIELDS.filter(field => ['document', 'presentation'].includes(field.scope)).map(field => field.name));
  assert.equal('removedLayerItems' in project, false);
  assert.equal('countriesLocked' in project, false);
  assert.equal('projection' in project, false);
  assert.equal('view' in project, false);
  assert.equal('layerFolders' in project, false);
});

test('history snapshots preserve editable object state through the shared schema', () => {
  const history = pickProjectFields(state, { scope: 'history' });
  assert.deepEqual(history.hydroEdits, state.hydroEdits);
  assert.deepEqual(history.territorialRelations, state.territorialRelations);
  assert.equal('labelSettings' in history, false);
  assert.equal('layerVisibility' in history, false);
  assert.equal('projection' in history, false);
});

test('presentation and session scopes stay independent', () => {
  const presentation = pickProjectFields(state, { scope: 'presentation' });
  assert.deepEqual(presentation.labelSettings, state.labelSettings);
  assert.deepEqual(presentation.layerVisibility, state.layerVisibility);
  assert.equal('countryOverrides' in presentation, false);
  assert.equal('projection' in presentation, false);

  const session = pickProjectFields(state, { scope: 'session' });
  assert.equal(session.projection, 'flat');
  assert.deepEqual(session.view, { flatZoom: 2 });
  assert.deepEqual(session.layerFolders, { countries: true });
  assert.equal('layerVisibility' in session, false);
});

test('shared project fields receive current defaults without sharing mutable values', () => {
  const restored = applyProjectFields({ physicalSettings: { terrainVisible: false }, layerVisibility: { countries: true }, view: {} }, {});
  assert.deepEqual(restored.labels, []);
  assert.deepEqual(restored.hydroEdits, []);
  assert.deepEqual(restored.territorialRelations, []);
  restored.labels.push({ id: 'new' });
  assert.deepEqual(applyProjectFields({}, {}).labels, []);
});

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const currentProject = () => ({
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
  territorialModel: { schemaVersion: 4 },
  distributionModel: { schemaVersion: 3 },
  layerPresentation: { schemaVersion: 4, overlayOrder: [], styles: {} },
  territorialEntities: [createTerritorialFeature({id:'DEU',entityKind: 'general',name:'독일',geometry:{type:'Polygon',coordinates:[[[0,0],[0,2],[2,2],[2,0],[0,0]]]}}),
    createTerritorialFeature({id:uuid(1),entityKind: 'general',parentId:'DEU',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}})],
  territorialRelations: [{id:uuid(2),schemaVersion:3,unitId:uuid(1),parentId:'DEU',validFrom:null,validTo:null}],
  distributionLayers: [{ id: uuid(3), schemaVersion: 3, name: '분포', unit: '', valueScale: { mode: 'auto' } }],
  distributionEntries: [{ id: uuid(4), schemaVersion: 3, layerId: uuid(3), mode: 'geometry',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] }, value: 1 }],
  distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true },
  genericFeatures: [{
    type: 'Feature', id: uuid(5), geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { schemaVersion: 2, name: '기타', notes: '', color: '#123456', locked: false, source: normalizeSourceProvenance({ kind: 'unsupported' }) },
  }],
  hydroEdits: [{ type: 'Feature', id: uuid(6), properties: { pandolab_schema_version: 1 } }],
  labels: [{ id: uuid(7) }],
});

test('current project schema accepts only explicit current versions and UUID object IDs', () => {
  assert.equal(assertCurrentProjectSchema(currentProject()).schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.match(createProjectObjectId(), /^[0-9a-f-]{36}$/i);
});

test('territorial model header rejects retired types and unknown entity kinds', () => {
  const retired = currentProject();
  retired.territorialModel.types = ['country', 'subunit', 'region'];
  assert.throws(() => assertCurrentProjectSchema(retired), /types/);
  const invalid = currentProject();
  invalid.territorialModel.kinds = ['general', 'country'];
  assert.throws(() => assertCurrentProjectSchema(invalid), /kinds/);
});



test('distribution boundary visibility is a shared optional presentation setting', () => {
  const current = currentProject();
  current.distributionSettings = { renderMode: 'single', activeLayerId: uuid(3), boundaryVisible: false };
  assert.deepEqual(assertCurrentProjectSchema(current).distributionSettings, current.distributionSettings);

  const prior = currentProject();
  prior.distributionSettings = { renderMode: 'overlap', activeLayerId: '' };
  assert.deepEqual(assertCurrentProjectSchema(prior).distributionSettings, prior.distributionSettings);
});

test('canonical river and lake presentation groups are accepted while hydro output is rejected', () => {
  const legacyHydroInput = currentProject();
  legacyHydroInput.layerVisibility = { hydro: false };
  legacyHydroInput.itemVisibility = { hydro: {} };
  legacyHydroInput.layerPresentation.styles = { hydro: { opacity: 0.5, boundaryVisible: false } };
  assert.throws(() => assertCurrentProjectSchema(legacyHydroInput), /지원하지 않는 필드 hydro/);
  const canonical = currentProject();
  canonical.layerVisibility = { rivers: true, lakes: false };
  canonical.itemVisibility = { hydro: {} };
  canonical.layerPresentation.styles = { rivers: { opacity: 0.7 }, lakes: { opacity: 0.8, boundaryVisible: true } };
  assert.equal(assertCurrentProjectSchema(canonical).schemaVersion, PROJECT_SCHEMA_VERSION);
});







test('missing duplicate and unsupported object fields are rejected', () => {
  const missing = currentProject();
  missing.labels[0].id = '';
  assert.throws(() => assertCurrentProjectSchema(missing), /ID가 비어/);
  const duplicate = currentProject();
  duplicate.labels.push({ id: uuid(7) });
  assert.throws(() => assertCurrentProjectSchema(duplicate), /중복/);
  const unsupported = currentProject();
  unsupported.territorialEntities[1].properties.unknownField = 'PL';
  assert.throws(() => assertCurrentProjectSchema(unsupported), /지원하지 않는 필드 unknownField/);
  const badGeneric = currentProject();
  badGeneric.genericFeatures[0].properties.role = 'subunit';
  assert.throws(() => assertCurrentProjectSchema(badGeneric), /지원하지 않는 필드 role/);
});

test('session state and unsupported model fields are rejected from project files', () => {
  for (const field of ['projection', 'view', 'layerFolders', 'selectedDistributionLayerId']) {
    const project = currentProject();
    project[field] = field === 'projection' ? 'flat' : {};
    assert.throws(() => assertCurrentProjectSchema(project), new RegExp(`지원하지 않는 필드 ${field}`));
  }
  const unsupportedLayer = currentProject();
  unsupportedLayer.distributionLayers[0].unknownField = true;
  assert.throws(() => assertCurrentProjectSchema(unsupportedLayer), /지원하지 않는 필드 unknownField/);
  const unsupportedSettings = currentProject();
  unsupportedSettings.distributionSettings = { renderMode: 'overlap', unknownField: uuid(3) };
  assert.throws(() => assertCurrentProjectSchema(unsupportedSettings), /지원하지 않는 필드 unknownField/);
});
