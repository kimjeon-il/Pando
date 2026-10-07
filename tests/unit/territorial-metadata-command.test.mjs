import { initializeTestTerritorialState, snapshotTestTerritorialState, restoreTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import test from 'node:test';
import { createHistoryService } from '../../assets/js/modules/history-service.js';
import { createProjectCommandPipeline } from '../../assets/js/modules/project-command-pipeline.js';
import '../../assets/js/vendor/polygon-clipping.min.js';
globalThis.window = { polygonClipping: globalThis.polygonClipping };
import assert from 'node:assert/strict';
import { createObjectMetadata } from '../../assets/js/modules/app-object-metadata.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture(configure = () => {}) {
  const state={stateRevision:0,selected:{domain:'territorial',type: 'entity',id:'A'},territorialEntities:['A','B'].map(id=>createTerritorialFeature({id,entityKind: 'general',name:id,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}))};
  const effects={history:0,save:0,refresh:0,tree:0,labels:0,base:0,patch:0,palette:0};
  configure(state);
  initializeTestTerritorialState(state);
const store=createTerritorialEntityStore({getState:()=>state});
  const repository=createTerritorialEntityRepository({entityStore:store});
  const historyStore = { history: [], historyMeta: [], future: [], futureMeta: [] };
  const snapshot = () => snapshotTestTerritorialState(state);
  const restore = value => restoreTestTerritorialState(state, value);
  const history = createHistoryService({ store: historyStore, maxEntries: 30, snapshot, restore, normalizeMetadata: value => value });
  const commandPipeline = createProjectCommandPipeline({
    captureSnapshot: snapshot, restoreSnapshot: restore,
    recordHistory: (meta, value) => { effects.history++; history.commitSnapshot(value, meta); },
    discardHistory: () => { effects.history--; history.discardLast(); }, validateProject: () => true,
    advanceRevision: () => ++state.stateRevision, queueAutosave: () => { effects.save++; },
  });
  const service=createTerritorialApplicationService({ createId: () => globalThis.crypto.randomUUID(),entityStore:store,entityRepository:repository,commandPipeline});
  const owner=createObjectMetadata();
  owner.connect({territorialModel:{entityRepository:repository},projectState:{state},objectModelB:{territorialApplicationService:service},feedback:{setActionStatus(){}},layers:{markLayerTreeDirty(){effects.tree++;}},rendering:{gpuMapRenderer:{invalidateCountryPalette(){effects.palette++;}}},domains:{selectionUiController:{presentPrimary(){effects.refresh++;},applyIntent(){assert.fail('metadata must not change selection or focus');}},renderingDomain:{invalidateLabels(){effects.labels++;},invalidateBaseScene(){effects.base++;},invalidateTerritorialPatch(){effects.patch++;}}}});
  return {owner,state,repository,effects,history,historyStore};
}

test('explicit metadata ref updates an unselected entity without selecting or focusing it and no-ops have no effects',()=>{
  const {owner,state,repository,effects}=fixture();
  const ref={domain:'territorial',type: 'entity',id:'B'},selected=state.selected;
  assert.equal(owner.commitTerritorialMetadata(ref,'name','Changed').changed,true);
  assert.equal(repository.get('B').properties.name,'Changed');
  assert.equal(state.selected,selected);
  assert.deepEqual(effects,{history:1,save:1,refresh:0,tree:1,labels:1,base:0,patch:0,palette:0});
  assert.equal(owner.commitTerritorialMetadata(ref,'name','Changed').changed,false);
  assert.deepEqual(effects,{history:1,save:1,refresh:0,tree:1,labels:1,base:0,patch:0,palette:0});
});

test('selected metadata refreshes the common presenter; color and flags invalidate only their actual visual responsibilities',()=>{
  const {owner,effects}=fixture();
  const ref={domain:'territorial',type: 'entity',id:'A'};
  owner.commitTerritorialMetadata(ref,'notes','memo');
  assert.deepEqual(effects,{history:1,save:1,refresh:1,tree:0,labels:0,base:0,patch:0,palette:0});
  owner.commitTerritorialMetadata(ref,'color','#123456');
  assert.equal(effects.palette,1);assert.equal(effects.patch,1);assert.equal(effects.base,1);assert.equal(effects.labels,0);
  owner.commitTerritorialMetadata(ref,'flagDataUrl',null);
  assert.equal(effects.labels,1);assert.equal(effects.refresh,3);assert.equal(effects.history,3);
});

test('explicit relation target changes an unselected child through one command without changing selection', () => {
  const { owner, state, repository, effects } = fixture();
  const selected = state.selected;
  const ref = { domain: 'territorial', type: 'entity', id: 'B' };
  const before = structuredClone(repository.get('B').geometry);
  assert.equal(owner.commitTerritorialRelation(ref, 'parentId', 'A').changed, true);
  assert.equal(repository.get('B').properties.parentId, 'A');
  assert.deepEqual(repository.get('B').geometry, before);
  assert.equal(state.selected, selected);
  assert.equal(effects.history, 1);
  assert.equal(effects.refresh, 1);
  assert.equal(owner.commitTerritorialRelation(ref, 'parentId', 'A').changed, false);
  assert.equal(effects.history, 1);
  assert.equal(owner.commitTerritorialRelation(ref, 'parentId', '').changed, true);
  assert.equal(repository.get('B').properties.parentId, '');
  assert.equal(state.selected, selected);
  assert.equal(effects.history, 2);
});

for (const parentId of ['B', 'missing']) test(`explicit relation target rejects ${parentId} without model/history/selection changes`, () => {
  const { owner, state, repository, effects } = fixture();
  const before = structuredClone(repository.list());
  const selected = state.selected;
  assert.equal(owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'B' }, 'parentId', parentId).ok, false);
  assert.deepEqual(repository.list(), before);
  assert.equal(state.selected, selected);
  assert.equal(effects.history, 0);
});

for (const condition of ['locked-child', 'regional-parent', 'locked-descendant']) test(`relation command protects ${condition} without creating history`, () => {
  const { owner, state, repository, effects } = fixture(state => {
    if (condition === 'locked-child') state.territorialEntities[1].properties.locked = true;
    if (condition === 'regional-parent') state.territorialEntities[0].properties.entityKind = 'regional';
    if (condition === 'locked-descendant') state.territorialEntities.push(createTerritorialFeature({
      id: 'C', entityKind: 'general', parentId: 'B', locked: true, geometry: state.territorialEntities[1].geometry,
    }));
  });
  const before = structuredClone(repository.list()), selected = state.selected;
  assert.equal(owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'B' }, 'parentId', 'A').ok, false);
  assert.equal(effects.history, 0); assert.equal(effects.save, 0);
  assert.deepEqual(repository.list(), before); assert.equal(state.selected, selected);
});

test('relation command rejects an ancestor cycle after a successful child add', () => {
  const { owner, state, repository, effects } = fixture();
  const selected = state.selected;
  owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'B' }, 'parentId', 'A');
  const before = structuredClone(repository.list());
  assert.equal(owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'A' }, 'parentId', 'B').ok, false);
  assert.deepEqual(repository.list(), before); assert.equal(state.selected, selected);
  assert.equal(effects.history, 1); assert.equal(effects.save, 1);
});

test('child add and remove each occupy one real history entry and support Undo/Redo', () => {
  const { owner, state, repository, history, historyStore } = fixture();
  const ref = { domain: 'territorial', type: 'entity', id: 'B' };
  const before = structuredClone(repository.get('B'));
  owner.commitTerritorialRelation(ref, 'parentId', 'A');
  assert.equal(historyStore.history.length, 1);
  history.undo();
  assert.deepEqual(repository.get('B'), before);
  history.redo();
  assert.equal(repository.get('B').properties.parentId, 'A');
  owner.commitTerritorialRelation(ref, 'parentId', '');
  assert.equal(historyStore.history.length, 2);
  history.undo();
  assert.equal(repository.get('B').properties.parentId, 'A');
  history.redo();
  assert.deepEqual(repository.get('B'), before);
  assert.equal(state.selected.id, 'A');
});

test('relation command rejects an out-of-parent partition using the real edit kernel before recording history', () => {
  const { owner, state, repository, effects } = fixture(state => {
    const geometry = { type: 'Polygon', coordinates: [[[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]]] };
    state.territorialEntities[1].geometry = geometry;
    state.territorialEntities.push(createTerritorialFeature({ id: 'C', entityKind: 'general', parentId: 'B', coverageMode: 'partition', geometry }));
  });
  const selected = state.selected, before = structuredClone(repository.list());
  const result = owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'C' }, 'parentId', 'A');
  assert.equal(result.code, 'invalid-parent-geometry');
  assert.equal(effects.history, 0); assert.equal(effects.save, 0);
  assert.deepEqual(repository.list(), before); assert.equal(state.selected, selected);
});
