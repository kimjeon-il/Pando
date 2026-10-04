import { snapshotTestTerritorialState, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { subunitSelectionPolicy, territorialDeletionAllowed, removeTerritorialEntities, boundaryTouchesGeometry } from '../../assets/js/modules/territorial-interaction-policy.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { BUILTIN_SUBUNITS } from '../../assets/js/modules/builtin-subunits.js';

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] };
const country = (id, notes = '') => createTerritorialFeature({ id, entityKind: 'general', notes, geometry });
const unit = (id, parentId = 'KR', locked = false) => createTerritorialFeature({ id, entityKind: 'general', parentId, locked, geometry });
const region = id => createTerritorialFeature({ id, entityKind: 'regional', geometry });

test('territorial deletion requires the canonical store before touching project state', () => {
  const state = { territorialEntities: [] };
  const before = structuredClone(state);
  assert.throws(() => removeTerritorialEntities(state), /엔티티 저장소/);
  assert.deepEqual(state, before);
});

test('multiple subunits require one parent, unlocked objects and a connected selection', () => {
  const units = [unit('a'), unit('b'), unit('c')];
  const adjacent = (a, b) => Math.abs(a.id.charCodeAt(0) - b.id.charCodeAt(0)) === 1;
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, true);
  assert.equal(subunitSelectionPolicy([units[0], units[2]], { adjacent }).valid, false);
  units[1].properties.parentId = 'other';
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, false);
  units[1].properties.parentId = 'KR'; units[1].properties.locked = true;
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, false);
});
test('single and batch deletion never expands into descendants and rechecks changed locks', () => {
  const a = unit('a'), b = unit('b');
  const state = { territorialEntities: [country('KR'), a, b], distributionEntries: [{ mode: 'territorial', territorialUnitId: 'a' }], itemVisibility: { subunits: { a: false } }, labelSettings: { 'territorial:a': {} } };
  initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ getState: () => state });
  store.appendEntities([unit('child', 'a')]);
  assert.equal(territorialDeletionAllowed([a, b], state.territorialEntities), false);
  const before = snapshotTestTerritorialState(state);
  assert.throws(() => removeTerritorialEntities(state, { unitIds: ['a', 'b'] }, 'territorial', { entityStore: store }));
  assert.deepEqual(snapshotTestTerritorialState(state), before);
  store.removeEntities(['child']);
  store.setLocked('b', true);
  assert.throws(() => removeTerritorialEntities(state, { unitIds: ['a', 'b'] }, 'territorial', { entityStore: store }));
  store.setLocked('b', false);
  removeTerritorialEntities(state, { unitIds: ['a'] }, 'territorial', { entityStore: store });
  assert.deepEqual(state.territorialEntities.map(entity => entity.id), ['KR', 'b']);
  assert.deepEqual(state.distributionEntries, []);
  assert.deepEqual(state.labelSettings, {});
});
test('country deletion uses the same territorial cleanup surface and removes dangling references', () => {
  const linkedRegion = region('r');
  const state = {
    territorialEntities: [country('A', 'remove'), country('B', 'keep'), linkedRegion],
    distributionEntries: [
      { id: 'd-a', mode: 'territorial', territorialUnitId: 'A' },
      { id: 'd-r', mode: 'territorial', territorialUnitId: 'r' },
    ],
    labels: [{ id: 'l', countryId: 'A' }],
    genericFeatures: [{ id: 'g', properties: { source: { provenance: { ownerId: 'A', topologyGroup: 'land:A' } } } }],
    itemVisibility: { countries: { A: false }, countryLabels: { A: false }, subunits: {}, regions: {} },
    labelSettings: { 'territorial:A': {} },
  };

  initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ getState: () => state });
  removeTerritorialEntities(state, { countryIds: ['A'] }, 'territorial', { entityStore: store });

  assert.deepEqual(state.territorialEntities.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId).map(feature => feature.id), ['B']);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'B').properties.notes, 'keep');
  assert.equal(state.territorialEntities.find(entity => entity.id === 'r').properties.associatedCountryId, undefined);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'r').properties.parentId, '');
  assert.deepEqual(state.timelineRecords.parentRelations.map(record => record.entityId), ['B', 'r']);
  assert.deepEqual(state.distributionEntries.map(entry => entry.id), ['d-r']);
  assert.equal(state.labels[0].countryId, '');
  assert.deepEqual(state.genericFeatures[0].properties.source.provenance, { ownerId: 'A', topologyGroup: 'land:A' });
  assert.deepEqual(state.itemVisibility.countries, {});
  assert.deepEqual(state.itemVisibility.countryLabels, {});
  assert.deepEqual(state.labelSettings, {});
});

test('territorial deletion delegates physical collection writes to the entity store', () => {
  const state = {
    territorialEntities: [country('A'), country('B'), region('r', 'A')],
    distributionEntries: [],
    labels: [],
    genericFeatures: [],
    itemVisibility: { countries: {}, countryLabels: {}, subunits: {}, regions: {} },
    labelSettings: {},
  };
  let writes = 0;
  initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({
    getState: () => state,
    onEntitiesReplaced() { writes += 1; },
  });

  removeTerritorialEntities(
    state,
    { countryIds: ['A'] },
    'territorial',
    { entityStore: store },
  );

  assert.deepEqual(state.territorialEntities.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId).map(feature => feature.id), ['B']);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'r').properties.associatedCountryId, undefined);
  assert.equal(writes, 1);
});

test('deletion clears the actual native and synthetic scene IDs without touching another country label', () => {
  const native = BUILTIN_SUBUNITS.find(row => row.sourceCountryId === 'ALD');
  for (const sourceCountryPresent of [false, true]) {
    const displayId = sourceCountryPresent ? `territorial:entity:${native.id}` : 'ALD';
    const state = {
      territorialEntities: [country('FIN'), ...(sourceCountryPresent ? [country('ALD')] : []), { ...unit(native.id, 'FIN'), properties: {
        ...unit(native.id, 'FIN').properties,
        metadata: { builtinSubunit: { sourceCountryId: 'ALD' } },
      } }, region('r')],
      labelSettings: { [`territorial:${native.id}`]: {}, 'territorial:r': {}, 'territorial:FIN': { pinned: true } },
      itemVisibility: { countryLabels: { [displayId]: false, 'territorial:entity:r': false, FIN: false } },
      layerPresentation: { objectStyles: { [`territorial:entity:${native.id}`]: {}, 'territorial:entity:r': {}, 'territorial:entity:FIN': {} } },
    };
    initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ getState: () => state });
    removeTerritorialEntities(state, { unitIds: [native.id, 'r'] }, 'territorial', { entityStore: store });
    assert.deepEqual(state.labelSettings, { 'territorial:FIN': { pinned: true } });
    assert.deepEqual(state.itemVisibility.countryLabels, { FIN: false });
    assert.deepEqual(state.layerPresentation.objectStyles, { 'territorial:entity:FIN': {} });
  }
});

test('country deletion rejects current administrative children before changing state', () => {
  const state = {
    territorialEntities: [country('A'), unit('child', 'A')],
    distributionEntries: [],
    labels: [],
    genericFeatures: [],
    itemVisibility: { countries: {}, countryLabels: {}, subunits: {}, regions: {} },
    labelSettings: {},
  };
  initializeTestTerritorialState(state);
  const before = snapshotTestTerritorialState(state);
const store = createTerritorialEntityStore({ getState: () => state });
  assert.throws(() => removeTerritorialEntities(state, { countryIds: ['A'] }, 'territorial', { entityStore: store }), /하위 영역/);
  assert.deepEqual(snapshotTestTerritorialState(state), before);
});

test('locked boundary checks include interior points of differently segmented edges', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  assert.equal(boundaryTouchesGeometry(geometry, [1, 0]), true);
  assert.equal(boundaryTouchesGeometry(geometry, [3, 0]), false);
});
