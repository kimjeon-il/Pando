import test from 'node:test';
import assert from 'node:assert/strict';
import { createGisImportTransactionCommitter } from '../../assets/js/modules/gis-import-transaction.js';

function harness(fail = false) {
  const state = { countriesData: { features: [{ id: 'A' }] }, countryOverrides: {}, territorialUnits: [], sourceInfo: null };
  const before = structuredClone(state);
  const history = [], events = [];
  const noop = () => {};
  const commit = createGisImportTransactionCommitter({
    state, deepClone: structuredClone, importedCountryOverrides: () => ({}), applyImportedPackageAssets: (_meta, values) => values,
    validateGisCountryCollection: async () => ({ overlapAreaKm2: 0 }), reindexCountries: data => data,
    snapshotEditable: () => structuredClone(state), restoreCountryEditSnapshot: snapshot => Object.assign(state, structuredClone(snapshot)),
    normalizeProjectObjects: noop, markLayerTreeDirty: noop, pruneLayerItemVisibility: noop,
    transferLandDependents: () => { events.push('transfer'); },
    assertProjectReferenceIntegrity: snapshot => {
      events.push('validate');
      assert.equal(snapshot.territorialUnits.length, 1);
      if (fail) throw new Error('invalid relation');
    },
    appendImportedSourceInfo: (_before, next) => next, scheduleCountryLabelAnchors: noop, markCountryGeometriesChanged: noop,
    commitHistorySnapshot: snapshot => { events.push('history'); history.push(snapshot); },
    selectionUiController: { clear: noop }, renderingDomain: { invalidateCountryPatch: noop }, queueAutosave: noop, setActionStatus: noop,
  });
  const result = { countriesData: { features: [{ id: 'NEW' }] }, preparedTerritorialUnits: [{ id: 'CHILD', properties: { parentId: 'NEW', sovereignId: 'NEW' } }],
    landTransfers: [{ targetId: 'NEW', geometry: {}, donorIds: ['A'] }], sourceInfo: { sourceId: 'library' } };
  const plan = { countriesData: { features: [{ id: 'NEW' }] }, affectedIds: ['A', 'NEW'], counts: { added: 2 } };
  return { state, before, history, events, run: () => commit.commitGisMerge(result, plan), result };
}

test('country transfer and library children validate together and commit one reversible snapshot', async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.events, ['transfer', 'validate', 'history']);
  assert.equal(h.history.length, 1);
  assert.deepEqual(h.history[0], h.before);
  const after = JSON.parse(JSON.stringify(h.state));
  Object.assign(h.state, structuredClone(h.history[0]));
  assert.deepEqual(h.state, h.before);
  Object.assign(h.state, after);
  assert.equal(h.state.territorialUnits[0].properties.sovereignId, 'NEW');
});

test('child validation failure restores countries, children and source; does not record history', async () => {
  const h = harness(true);
  await assert.rejects(h.run(), /invalid relation/);
  assert.deepEqual(h.state, h.before);
  assert.equal(h.history.length, 0);
});

test('cancelled or stale request cannot commit after async country validation', async () => {
  const h = harness();
  h.result.assertCurrent = () => { throw new Error('cancelled'); };
  await assert.rejects(h.run(), /cancelled/);
  assert.deepEqual(h.state, h.before);
  assert.equal(h.history.length, 0);
});
