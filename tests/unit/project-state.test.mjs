import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_STATE_FIELDS, applyProjectFields, pickProjectFields } from '../../assets/js/modules/project-state.js';

const state = {
  countryOverrides: { KOR: { name: '대한민국' } }, sourceInfo: null, labels: [{ id: 'label-1' }], drawings: [],
  countryRegions: [{ id: 'region-1' }],
  drawingFolders: [{ id: 'folder-1', name: '가져온 경계', origin: 'geojson', autoPrune: true }],
  physicalSettings: { terrainVisible: true }, removedLayerItems: { countries: ['A'] }, projection: 'flat',
  layerVisibility: { countries: true }, itemVisibility: { A: false }, layerFolders: { countries: true },
  countriesLocked: true, view: { flatZoom: 2 },
};

test('project and autosave share one declared field set', () => {
  const project = pickProjectFields(state);
  assert.deepEqual(Object.keys(project), PROJECT_STATE_FIELDS.map(field => field.name));
  assert.deepEqual(project.removedLayerItems, { countries: ['A'] });
});

test('history snapshots preserve removed layer items through the shared schema', () => {
  const history = pickProjectFields(state, { scope: 'history' });
  assert.deepEqual(history.removedLayerItems, state.removedLayerItems);
  assert.deepEqual(history.drawingFolders, state.drawingFolders);
  assert.deepEqual(history.countryRegions, state.countryRegions);
  assert.equal('projection' in history, false);
});

test('legacy projects receive defaults without sharing mutable values', () => {
  const restored = applyProjectFields({ physicalSettings: { terrainVisible: false }, layerVisibility: { countries: true }, view: {} }, {});
  assert.deepEqual(restored.removedLayerItems, {});
  assert.deepEqual(restored.labels, []);
  assert.deepEqual(restored.drawingFolders, []);
  assert.deepEqual(restored.countryRegions, []);
  restored.labels.push({ id: 'new' });
  assert.deepEqual(applyProjectFields({}, {}).labels, []);
});
