import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_STATE_FIELDS, applyProjectFields, pickProjectFields } from '../../assets/js/modules/project-state.js';

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

test('legacy projects receive defaults without sharing mutable values', () => {
  const restored = applyProjectFields({ physicalSettings: { terrainVisible: false }, layerVisibility: { countries: true }, view: {} }, {});
  assert.deepEqual(restored.labels, []);
  assert.deepEqual(restored.hydroEdits, []);
  assert.deepEqual(restored.territorialUnits, []);
  assert.deepEqual(restored.territorialRelations, []);
  restored.labels.push({ id: 'new' });
  assert.deepEqual(applyProjectFields({}, {}).labels, []);
});
