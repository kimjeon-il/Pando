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

const state = {
  countryOverrides: { KOR: { name: '대한민국' } }, sourceInfo: null, labels: [{ id: 'label-1' }], drawings: [], hydroEdits: [{ id: 'river-1' }],
  territorialUnits: [{ id: 'territory-1' }], territorialRelations: [{ id: 'relation-1' }],
  physicalSettings: { terrainVisible: true }, projection: 'flat',
  layerVisibility: { countries: true }, itemVisibility: { A: false }, layerFolders: { countries: true },
  view: { flatZoom: 2 },
};

test('project and autosave share one declared field set', () => {
  const project = pickProjectFields(state);
  assert.deepEqual(Object.keys(project), PROJECT_STATE_FIELDS.map(field => field.name));
  assert.equal('removedLayerItems' in project, false);
  assert.equal('countriesLocked' in project, false);
});

test('history snapshots preserve editable object state through the shared schema', () => {
  const history = pickProjectFields(state, { scope: 'history' });
  assert.deepEqual(history.countryOverrides, state.countryOverrides);
  assert.deepEqual(history.hydroEdits, state.hydroEdits);
  assert.deepEqual(history.territorialUnits, state.territorialUnits);
  assert.deepEqual(history.territorialRelations, state.territorialRelations);
  assert.equal('projection' in history, false);
});

test('shared project fields receive current defaults without sharing mutable values', () => {
  const restored = applyProjectFields({ physicalSettings: { terrainVisible: false }, layerVisibility: { countries: true }, view: {} }, {});
  assert.deepEqual(restored.labels, []);
  assert.deepEqual(restored.hydroEdits, []);
  assert.deepEqual(restored.territorialUnits, []);
  assert.deepEqual(restored.territorialRelations, []);
  restored.labels.push({ id: 'new' });
  assert.deepEqual(applyProjectFields({}, {}).labels, []);
});

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const currentProject = () => ({
  format: 'pandolab-project-state',
  schemaVersion: PROJECT_SCHEMA_VERSION,
  landObjectModel: { schemaVersion: 1 },
  territorialModel: { schemaVersion: 1 },
  distributionModel: { schemaVersion: 1 },
  territorialUnits: [{
    type: 'Feature', id: uuid(1),
    properties: { schemaVersion: 1, unitType: 'territory' },
    geometry: { type: 'Polygon', coordinates: [] },
  }],
  territorialRelations: [{ id: uuid(2), schemaVersion: 1 }],
  distributionLayers: [{ id: uuid(3), schemaVersion: 1, type: 'language' }],
  distributionEntries: [{ id: uuid(4), schemaVersion: 1, layerId: uuid(3) }],
  drawings: [{ type: 'Feature', id: uuid(5), properties: { pandolab_schema_version: 1 } }],
  hydroEdits: [{ type: 'Feature', id: uuid(6), properties: { pandolab_schema_version: 1 } }],
  labels: [{ id: uuid(7) }],
});

test('current project schema accepts only explicit current versions and UUID object IDs', () => {
  assert.equal(assertCurrentProjectSchema(currentProject()).schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.match(createProjectObjectId(), /^[0-9a-f-]{36}$/i);
});

test('missing and old schema versions are rejected instead of migrated', () => {
  const missing = currentProject();
  delete missing.schemaVersion;
  assert.throws(() => assertCurrentProjectSchema(missing), /schemaVersion이 없습니다/);
  const old = currentProject();
  old.schemaVersion = 0;
  assert.throws(() => assertCurrentProjectSchema(old), /지원하지 않습니다/);
});

test('missing duplicate and legacy object identifiers are rejected', () => {
  const missing = currentProject();
  missing.labels[0].id = '';
  assert.throws(() => assertCurrentProjectSchema(missing), /ID가 비어/);
  const duplicate = currentProject();
  duplicate.labels.push({ id: uuid(7) });
  assert.throws(() => assertCurrentProjectSchema(duplicate), /중복/);
  const legacy = currentProject();
  legacy.territorialUnits[0].properties.country_id = 'PL';
  assert.throws(() => assertCurrentProjectSchema(legacy), /과거 필드 country_id/);
});
