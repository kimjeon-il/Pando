import { testCoreProject, initializeTestTerritorialState, snapshotTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectCommands } from "../../apps/editor/frontend/js/modules/app-object-commands.js";
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createTerritorialApplicationService } from "../../apps/editor/frontend/js/modules/territorial-service.js";
import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import {createSelectionDomain} from "../../shared/frontend/js/modules/selection-domain.js";
import {webSelectionRefToCore,coreSelectionRefToWeb} from "../../shared/frontend/js/modules/core-object-ref.js";

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
async function fixture({ fail = false, child = false } = {}) {
  const state = { territorialEntities: [...['A','B'].map(id=>createTerritorialFeature({id,entityKind: 'general',name:id,geometry})),createTerritorialFeature({id:'S',entityKind: 'general',name:'S',parentId:child?'A':'B',geometry})],
    distributionLayers: [], distributionEntries: [], hydroEdits: [], genericFeatures: [], labels: [], labelSettings: {},
    physicalSettings: { hiddenHydroIds: {} }, stateRevision: 0, itemVisibility: {}, layerPresentation: normalizeLayerPresentation({}), boundaryPreparation: null };
  let confirm,histories=0,saves=0;const patches=[],diagnostics=[];
  await initializeTestTerritorialState(state,null,{platformPorts:{
    onProjectChanged:event=>{if(event.reason==='objects.remove')histories++;},persistence:{queueProject(){saves++;}},
  }});
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const core=testCoreProject(state),projectDomain={...core.project,getGeneration:()=>state.projectGeneration || 0};
  const territorialApplicationService=createTerritorialApplicationService({createId:()=>globalThis.crypto.randomUUID(),entityRepository,commandOwner:core.project});
  const refs = [{ domain: 'territorial', type: 'entity', id: 'A' }, { domain: 'territorial', type: 'entity', id: 'S' }];
  const selectionDomain=createSelectionDomain({commandOwner:core.client,projectDomain,
    refAdapter:{toCore:webSelectionRefToCore,fromCore:coreSelectionRefToWeb}});
  await selectionDomain.setMany(refs,{primary:refs[0]});
  const owner = createObjectCommands();
  owner.connect({ projectState: { state }, selectionServices: { normalizeObjectRef },
    territorialModel: { entityStore, entityRepository,  DISTRIBUTION_MODES: { TERRITORIAL: 'territorial' } },
    objectModelB: { territorialApplicationService },
    presentation: { countryName: feature => feature.properties.name },
    objectPresentation: { territorialEntityName: feature => feature.properties.name, territorialRootName: () => 'B' },
    projectRestore: { openConfirmModal: options => { confirm = options; } },
    spatialQuery: { markCountryGeometriesChanged: ids => patches.push([...ids]) },
    feedback: { setActionStatus() {}, reportOperationError(error, message, code) { diagnostics.push({error,message,code}); } }, objectDisplay: { invalidateObjectPresentation() {} }, domainControllers: { objectPropertyController: { show() {} } },
    domains: { selectionDomain,
      renderingDomain: { invalidateCountryPatch(){},invalidateOverlayGeometry(){},invalidateSelection(){},invalidateLabels(){},
        invalidateTerritorialPatch() { if (fail) throw Error('apply failed'); } },
      selectionUiController: {presentPrimary(){}},projectDomain },
  });
  return { owner,state,entityStore,entityRepository,patches,diagnostics,core,selectionDomain,service:territorialApplicationService,
    confirm:()=>confirm,histories:()=>histories,saves:()=>saves };
}
test('mixed country/subunit batch deletion uses the real Store, preserves cancel and records one history', async () => {
  const f = await fixture();
  f.owner.requestObjectDeletion();
  assert.equal(f.confirm().danger, true);
  assert.equal((f.entityStore.snapshot().find(entity => String(entity.id) === String('A') && entity.properties.entityKind === 'general' && !entity.properties.parentId) || null).id, 'A', 'opening/cancelling confirmation must not mutate');
  assert.equal(await f.confirm().onConfirm(),true);
  assert.equal((f.entityStore.snapshot().find(entity => String(entity.id) === String('A') && entity.properties.entityKind === 'general' && !entity.properties.parentId) || null), null);
  assert.equal(f.entityRepository.get('S'), null);
  assert.equal((f.entityStore.snapshot().find(entity => String(entity.id) === String('B') && entity.properties.entityKind === 'general' && !entity.properties.parentId) || null).id, 'B');
  assert.deepEqual(f.patches, [['A']]);
  assert.equal(f.histories(), 1); assert.equal(f.saves(), 1);
});
test('batch deletion rechecks locks/children and rolls back a failed application', async () => {
  const locked = await fixture();locked.owner.requestObjectDeletion();await locked.service.setLocked('A',true);
  assert.equal(await locked.confirm().onConfirm(),false);assert.ok(locked.entityRepository.get('A'));assert.equal(locked.histories(),0);
  const parent = await fixture({ child: true }); parent.owner.requestObjectDeletion(); assert.equal(parent.confirm(), undefined);
  const failed = await fixture({ fail: true }); const before = snapshotTestTerritorialState(failed.state);
  failed.owner.requestObjectDeletion();assert.equal(await failed.confirm().onConfirm(),false);
  assert.deepEqual(snapshotTestTerritorialState(failed.state), before); assert.ok(failed.entityRepository.get('A')); assert.equal(failed.histories(), 0); assert.equal(failed.saves(), 0);
  assert.equal(failed.diagnostics[0].error.message, 'apply failed');
  assert.equal(failed.diagnostics[0].code, 'PL-TERRITORIAL-DELETE-001');
});

test('deletion confirmation cannot apply after the project generation changes', async () => {
  const f = await fixture();
  assert.equal(f.owner.requestObjectDeletion(), true);
  f.state.projectGeneration = 1;
  assert.equal(await f.confirm().onConfirm(),false);
  assert.ok(f.entityRepository.get('A'));
  assert.ok(f.entityRepository.get('S'));
  assert.equal(f.histories(), 0);
  assert.equal(f.saves(), 0);
});

test('one object lock guard handles countries and units with explicit refs and rejects wrong identities', async () => {
  const f = await fixture();
  const refs = ['A', 'S'].map(id => ({ domain: 'territorial', type: 'entity', id }));
  assert.equal(f.owner.requireObjectsUnlocked(refs), true);
  await f.service.setLocked('S',true);
  assert.equal(f.owner.requireObjectsUnlocked(refs), false);
  await f.service.setLocked('S',false);
  await f.service.setLocked('A',true);
  assert.equal(f.owner.requireObjectsUnlocked(refs), false);
  assert.equal(f.owner.requireObjectsUnlocked([{ domain: 'territorial', type: 'country', id: 'S' }]), false);
});
test('country construction remains detached until its owning Core command commits', () => {
  const state = {};
  const owner = createObjectPicking();
  owner.connect({ projectState: { state }, surfaces: { uid: () => 'NEW' }, platform: { deepClone: structuredClone } });
  const feature = owner.createCountryFeature('새 국가', null, geometry);
  assert.equal(feature.id, 'NEW'); assert.deepEqual(feature.geometry, geometry); assert.notEqual(feature.geometry, geometry);
  assert.deepEqual(state,{});
});
