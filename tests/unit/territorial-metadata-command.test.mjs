import { testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import test from 'node:test';
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
globalThis.window = { polygonClipping: globalThis.polygonClipping };
import assert from 'node:assert/strict';
import { createObjectMetadata } from "../../apps/editor/frontend/js/modules/app-object-metadata.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createTerritorialApplicationService } from "../../apps/editor/frontend/js/modules/territorial-service.js";

async function fixture(configure = () => {}, wrapService = service => service) {
  let generation = 1;
  const state={stateRevision:0,selected:{domain:'territorial',type: 'entity',id:'A'},territorialEntities:['A','B'].map(id=>createTerritorialFeature({id,entityKind: 'general',name:id,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}))};
  const effects={history:0,save:0,refresh:0,tree:0,labels:0,base:0,patch:0,palette:0};
  configure(state);
  await initializeTestTerritorialState(state,null,{platformPorts:{
    onProjectChanged:event=>{if(event.reason.startsWith('territorial.'))effects.history++;},
    persistence:{queueProject(){effects.save++;},cancelPending(){}},
  }});
const store=createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const repository=createTerritorialEntityRepository({entityStore:store});
  const history=testCoreProject(state).project;
  const service=createTerritorialApplicationService({ createId: () => globalThis.crypto.randomUUID(),entityRepository:repository,commandOwner:history});
  const owner=createObjectMetadata();
  owner.connect({territorialModel:{entityRepository:repository},projectState:{state},objectModelB:{territorialApplicationService:wrapService(service)},feedback:{setActionStatus(){}},objectDisplay:{invalidateObjectPresentation(){effects.tree++;}},rendering:{gpuMapRenderer:{invalidateCountryPalette(){effects.palette++;}}},domains:{projectDomain:{getGeneration:()=>generation},selectionUiController:{presentPrimary(){effects.refresh++;},applyIntent(){assert.fail('metadata must not change selection or focus');}},renderingDomain:{invalidateLabels(){effects.labels++;},invalidateBaseScene(){effects.base++;},invalidateTerritorialPatch(){effects.patch++;}}}});
  return {owner,state,repository,effects,history,replaceProject:()=>{generation+=1;}};
}

test('metadata acknowledgement waits for the command and never refreshes a later different selection', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { owner, state, effects, repository } = await fixture(undefined, service => ({ ...service,
    updateMetadata: async (...args) => { await held; return service.updateMetadata(...args); },
  }));
  const pending = owner.commitTerritorialMetadata({ domain: 'territorial', type: 'entity', id: 'A' }, 'name', 'Worker result');
  assert.equal(effects.tree, 0); assert.equal(repository.get('A').properties.name, 'A');
  state.selected = { domain: 'territorial', type: 'entity', id: 'B' };
  release();
  assert.equal((await pending).changed, true);
  assert.equal(repository.get('A').properties.name, 'Worker result');
  assert.equal(effects.tree, 1); assert.equal(effects.labels, 1); assert.equal(effects.refresh, 0);
  assert.equal(state.selected.id, 'B');
});

for (const operation of ['metadata','relation']) {
  test(`${operation} completion from a replaced project cannot refresh a reused ID or invalidate the new scene`, async () => {
    let resolve;
    const acknowledgement = new Promise(accept => { resolve = accept; });
    const method = operation === 'metadata' ? 'updateMetadata' : 'changeAdministrativeParent';
    const f = await fixture(undefined, service => ({ ...service,[method]: () => acknowledgement }));
    const ref = { domain: 'territorial',type: 'entity',id: 'A' };
    const pending = operation === 'metadata' ? f.owner.commitTerritorialMetadata(ref,'name','Old result')
      : f.owner.commitTerritorialRelation(ref,'parentId','B');
    f.replaceProject(); resolve({ ok: true,changed: true }); await pending;
    assert.deepEqual(f.effects,{ history: 0,save: 0,refresh: 0,tree: 0,labels: 0,base: 0,patch: 0,palette: 0 });
    assert.equal(f.state.selected.id,'A');
  });
}

test('generic metadata completion from a replaced project cannot refresh its reused ID or show success', async () => {
  let resolve, generation = 1;
  const acknowledgement = new Promise(accept => { resolve = accept; }), effects = [];
  const state = { selected: { domain: 'generic',type: 'feature',id: 'G' },genericFeatures: [{ id: 'G' }] };
  const owner = createObjectMetadata();
  owner.connect({ projectState: { state },objectModelA: { genericFeatureService: { updateMetadata: () => acknowledgement } },
    domains: { projectDomain: { getGeneration: () => generation } },
    objectDisplay: { invalidateObjectPresentation: () => effects.push('tree') },
    propertyEditingA: { applyGenericSelectionIntent: () => effects.push('selection') },
    feedback: { setActionStatus: () => effects.push('status') } });
  const pending = owner.commitGenericFeatureMeta('name','Old generic result');
  generation += 1; resolve({ ok: true,changed: true }); await pending;
  assert.deepEqual(effects,[]);
});

test('explicit metadata ref updates an unselected entity without selecting or focusing it and no-ops have no effects',async()=>{
  const {owner,state,repository,effects}=await fixture();
  const ref={domain:'territorial',type: 'entity',id:'B'},selected=state.selected;
  assert.equal((await owner.commitTerritorialMetadata(ref,'name','Changed')).changed,true);
  assert.equal(repository.get('B').properties.name,'Changed');
  assert.equal(state.selected,selected);
  assert.deepEqual(effects,{history:1,save:1,refresh:0,tree:1,labels:1,base:0,patch:0,palette:0});
  assert.equal((await owner.commitTerritorialMetadata(ref,'name','Changed')).changed,false);
  assert.deepEqual(effects,{history:1,save:1,refresh:0,tree:1,labels:1,base:0,patch:0,palette:0});
});

test('selected metadata refreshes the common presenter; color and flags invalidate only their actual visual responsibilities',async()=>{
  const {owner,effects}=await fixture();
  const ref={domain:'territorial',type: 'entity',id:'A'};
  await owner.commitTerritorialMetadata(ref,'notes','memo');
  assert.deepEqual(effects,{history:1,save:1,refresh:1,tree:0,labels:0,base:0,patch:0,palette:0});
  await owner.commitTerritorialMetadata(ref,'color','#123456');
  assert.equal(effects.palette,1);assert.equal(effects.patch,1);assert.equal(effects.base,1);assert.equal(effects.labels,0);
  await owner.commitTerritorialMetadata(ref,'flagDataUrl',null);
  assert.equal(effects.labels,1);assert.equal(effects.refresh,3);assert.equal(effects.history,3);
});

test('explicit relation target refreshes the selected parent without changing selection', async () => {
  const { owner, state, repository, effects } = await fixture();
  const selected = state.selected;
  const ref = { domain: 'territorial', type: 'entity', id: 'B' };
  const before = structuredClone(repository.get('B').geometry);
  assert.equal((await owner.commitTerritorialRelation(ref, 'parentId', 'A')).changed, true);
  assert.equal(repository.get('B').properties.parentId, 'A');
  assert.deepEqual(repository.get('B').geometry, before);
  assert.equal(state.selected, selected);
  assert.equal(effects.history, 1);
  assert.equal(effects.refresh, 1, 'The selected parent shows its newly linked child.');
  assert.equal((await owner.commitTerritorialRelation(ref, 'parentId', 'A')).changed, false);
  assert.equal(effects.history, 1);
  assert.equal(effects.refresh, 2, 'The existing relation remains visible after a no-op.');
  assert.equal((await owner.commitTerritorialRelation(ref, 'parentId', '')).changed, true);
  assert.equal(repository.get('B').properties.parentId, '');
  assert.equal(state.selected, selected);
  assert.equal(effects.history, 2);
  assert.equal(effects.refresh, 3, 'The selected parent removes its detached child.');
});

for (const parentId of ['B', 'missing']) test(`explicit relation target rejects ${parentId} without model/history/selection changes`, async () => {
  const { owner, state, repository, effects } = await fixture();
  const before = structuredClone(repository.list());
  const selected = state.selected;
  assert.equal((await owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'B' }, 'parentId', parentId)).ok, false);
  assert.deepEqual(repository.list(), before);
  assert.equal(state.selected, selected);
  assert.equal(effects.history, 0);
});

for (const condition of ['locked-child', 'regional-parent', 'locked-descendant']) test(`relation command protects ${condition} without creating history`, async () => {
  const { owner, state, repository, effects } = await fixture(state => {
    if (condition === 'locked-child') state.territorialEntities[1].properties.locked = true;
    if (condition === 'regional-parent') state.territorialEntities[0].properties.entityKind = 'regional';
    if (condition === 'locked-descendant') state.territorialEntities.push(createTerritorialFeature({
      id: 'C', entityKind: 'general', parentId: 'B', locked: true, geometry: state.territorialEntities[1].geometry,
    }));
  });
  const before = structuredClone(repository.list()), selected = state.selected;
  assert.equal((await owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'B' }, 'parentId', 'A')).ok, false);
  assert.equal(effects.history, 0); assert.equal(effects.save, 0);
  assert.deepEqual(repository.list(), before); assert.equal(state.selected, selected);
});

test('relation command rejects an ancestor cycle after a successful child add', async () => {
  const { owner, state, repository, effects } = await fixture();
  const selected = state.selected;
  await owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'B' }, 'parentId', 'A');
  const before = structuredClone(repository.list());
  assert.equal((await owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'A' }, 'parentId', 'B')).ok, false);
  assert.deepEqual(repository.list(), before); assert.equal(state.selected, selected);
  assert.equal(effects.history, 1); assert.equal(effects.save, 1);
});

test('child add and remove each occupy one real history entry and support Undo/Redo', async () => {
  const { owner, state, repository, history, effects } = await fixture();
  const ref = { domain: 'territorial', type: 'entity', id: 'B' };
  const before = structuredClone(repository.get('B'));
  await owner.commitTerritorialRelation(ref, 'parentId', 'A');
  assert.equal(effects.history, 1);
  assert.equal(await history.undo(),true);
  assert.deepEqual(repository.get('B'), before);
  assert.equal(await history.redo(),true);
  assert.equal(repository.get('B').properties.parentId, 'A');
  await owner.commitTerritorialRelation(ref, 'parentId', '');
  assert.equal(effects.history, 2);
  assert.equal(await history.undo(),true);
  assert.equal(repository.get('B').properties.parentId, 'A');
  assert.equal(await history.redo(),true);
  assert.deepEqual(repository.get('B'), before);
  assert.equal(state.selected.id, 'A');
  assert.equal(await history.undo(),true);
  assert.equal(await history.undo(),true);
  assert.equal(await history.undo(),false,'two accepted relation commands occupy exactly two history units');
});

test('relation command rejects an out-of-parent partition in Core before recording history', async () => {
  const { owner, state, repository, effects } = await fixture(state => {
    const geometry = { type: 'Polygon', coordinates: [[[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]]] };
    state.territorialEntities[1].geometry = geometry;
    state.territorialEntities.push(createTerritorialFeature({ id: 'C', entityKind: 'general', parentId: 'B', coverageMode: 'partition', geometry }));
  });
  const selected = state.selected, before = structuredClone(repository.list());
  await assert.rejects(
    owner.commitTerritorialRelation({ domain: 'territorial', type: 'entity', id: 'C' }, 'parentId', 'A'),
    { code: 'GEOMETRY_OUTSIDE_PARENT' },
  );
  assert.equal(effects.history, 0); assert.equal(effects.save, 0);
  assert.deepEqual(repository.list(), before); assert.equal(state.selected, selected);
});
