import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { createObjectPicking } from '../../assets/js/modules/app-object-picking.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { TERRITORIAL_UNIT_TYPES } from '../../assets/js/modules/territorial-units.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
function fixture({ fail = false, child = false } = {}) {
  const state = { countriesData: { type: 'FeatureCollection', features: ['A', 'B'].map(id => ({ type: 'Feature', id, properties: { name: id }, geometry })) },
    countryOverrides: {}, territorialUnits: [{ type: 'Feature', id: 'S', properties: { unitType: 'subunit', name: 'S', sovereignId: child ? 'A' : 'B', parentId: child ? 'A' : 'B' }, geometry }],
    territorialRelations: [], distributionLayers: [], distributionEntries: [], hydroEdits: [], genericFeatures: [], labels: [], labelSettings: {},
    physicalSettings: { hiddenHydroIds: {} }, stateRevision: 0, itemVisibility: {}, layerPresentation: {}, boundaryPreparation: null };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore, getRevision: () => state.stateRevision });
  const territorialApplicationService = createTerritorialApplicationService({ entityStore, entityRepository,
    commandPipeline: { runMutation: (_, mutate) => ({ ok: true, value: mutate() }) } });
  const refs = [{ domain: 'territorial', type: 'country', id: 'A' }, { domain: 'territorial', type: 'subunit', id: 'S' }];
  let confirm; let histories = 0; let saves = 0; const patches = [], diagnostics = [];
  const owner = createObjectCommands();
  owner.connect({ projectState: { state }, selectionServices: { normalizeObjectRef },
    territorialModel: { entityStore, entityRepository, TERRITORIAL_UNIT_TYPES, DISTRIBUTION_MODES: { TERRITORIAL: 'territorial' } },
    objectModelB: { territorialApplicationService },
    presentation: { countryName: feature => feature.properties.name }, territorialServicesB: { territorialTypeLabel: () => '하위단위' },
    objectPresentation: { territorialEntityName: feature => feature.properties.name, administrativeCountryName: () => 'B' },
    projectRestore: { openConfirmModal: options => { confirm = options; } }, snapshots: { snapshotEditable: () => structuredClone(state) },
    projectSnapshots: { restoreEditable: snapshot => { Object.assign(state, snapshot); } },
    spatialQuery: { markCountryGeometriesChanged: ids => patches.push([...ids]) },
    feedback: { setActionStatus() {}, reportOperationError(error, message, code) { diagnostics.push({error,message,code}); } }, layers: { markLayerTreeDirty() {} }, domainControllers: { objectPropertyController: { show() {} } },
    landRelations: { reassignGenericFeatureParents() {} },
    domains: { selectionDomain: { snapshot: () => ({ selection: { items: refs } }), clear() {} },
      renderingDomain: { invalidateTerritorialPatch() { if (fail) throw Error('apply failed'); } },
      selectionUiController: { clear() {} },
      projectDomain: { getGeneration: () => state.projectGeneration || 0, commitHistorySnapshot() { histories++; }, queueAutosave() { saves++; } } },
  });
  return { owner, state, entityStore, entityRepository, patches, diagnostics, confirm: () => confirm, histories: () => histories, saves: () => saves };
}
test('mixed country/subunit batch deletion uses the real Store, preserves cancel and records one history', () => {
  const f = fixture();
  f.owner.requestObjectDeletion();
  assert.equal(f.confirm().danger, true);
  assert.equal(f.entityStore.countryFeature('A').id, 'A', 'opening/cancelling confirmation must not mutate');
  f.confirm().onConfirm();
  assert.equal(f.entityStore.countryFeature('A'), null);
  assert.equal(f.entityRepository.get('S'), null);
  assert.equal(f.entityStore.countryFeature('B').id, 'B');
  assert.deepEqual(f.patches, [['A']]);
  assert.equal(f.histories(), 1); assert.equal(f.saves(), 1);
});
test('batch deletion rechecks locks/children and rolls back a failed application', () => {
  const locked = fixture(); locked.owner.requestObjectDeletion(); locked.entityStore.setLocked('country', 'A', true); locked.state.stateRevision++;
  assert.equal(locked.confirm().onConfirm(), false); assert.ok(locked.entityStore.countryFeature('A')); assert.equal(locked.histories(), 0);
  const parent = fixture({ child: true }); parent.owner.requestObjectDeletion(); assert.equal(parent.confirm(), undefined);
  const failed = fixture({ fail: true }); const before = structuredClone(failed.state);
  failed.owner.requestObjectDeletion(); assert.equal(failed.confirm().onConfirm(), false);
  assert.deepEqual(failed.state, before); assert.ok(failed.entityRepository.get('A')); assert.equal(failed.histories(), 0); assert.equal(failed.saves(), 0);
  assert.equal(failed.diagnostics[0].error.message, 'apply failed');
  assert.equal(failed.diagnostics[0].code, 'PL-TERRITORIAL-DELETE-001');
});

test('deletion confirmation cannot apply after the project generation changes', () => {
  const f = fixture();
  assert.equal(f.owner.requestObjectDeletion(), true);
  f.state.projectGeneration = 1;
  assert.equal(f.confirm().onConfirm(), false);
  assert.ok(f.entityRepository.get('A'));
  assert.ok(f.entityRepository.get('S'));
  assert.equal(f.histories(), 0);
  assert.equal(f.saves(), 0);
});

test('one object lock guard handles countries and units with explicit refs and rejects wrong identities', () => {
  const f = fixture();
  const refs = ['A', 'S'].map(id => ({ domain: 'territorial', type: id === 'A' ? 'country' : 'subunit', id }));
  assert.equal(f.owner.requireObjectsUnlocked(refs), true);
  f.entityStore.setLocked('subunit', 'S', true);
  f.state.stateRevision++;
  assert.equal(f.owner.requireObjectsUnlocked(refs), false);
  f.entityStore.setLocked('subunit', 'S', false);
  f.entityStore.setLocked('country', 'A', true);
  f.state.stateRevision++;
  assert.equal(f.owner.requireObjectsUnlocked(refs), false);
  assert.equal(f.owner.requireObjectsUnlocked([{ domain: 'territorial', type: 'country', id: 'S' }]), false);
});
test('country construction cannot publish overrides before the owning transaction commits', () => {
  const state = { countryOverrides: {} };
  const owner = createObjectPicking();
  owner.connect({ projectState: { state }, surfaces: { uid: () => 'NEW' }, platform: { deepClone: structuredClone } });
  const feature = owner.createCountryFeature('새 국가', null, geometry);
  assert.equal(feature.id, 'NEW'); assert.deepEqual(feature.geometry, geometry); assert.notEqual(feature.geometry, geometry);
  assert.deepEqual(state.countryOverrides, {});
});
