import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createObjectCatalog } from '../../assets/js/modules/app-object-catalog.js';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { loadWebOracle } from '../helpers/web-oracle.mjs';

const { createLayerList:createOriginalLayerList }=await loadWebOracle('assets/js/modules/app-layer-list.js');
const { createTerritorialEntityStore:createOriginalStore,createEmptyTerritorialState:createOriginalEmpty }=await loadWebOracle('assets/js/modules/territorial-entity-store.js');
const groups=['countries','subunits','regions','distributions','hydro','genericFeatures','labels','countryLabels'];
function ports(state,world,domains) {
  return { projectState:{ state },domains,layerPresentation:{ LAYER_GROUP_KEYS:groups },
    countries:{ builtinTerritorialScene:() => ({ labelById:new Map([['A',{}]]) }) },
    hydroPresentation:{ HYDRO_LAYER_META:{ rivers_hydro:{ category:'river' } },hydroCategoryKey:value => value },
    territorialModel:{ entityRepository:{ list:({ kind,parentId }={}) => world.filter(feature => (!kind || feature.properties.entityKind===kind)
      && (parentId===undefined || feature.properties.parentId===parentId)) } } };
}

test('the actual Core catalog prunes exact obsolete visibility keys while preserving explicit true and saved checkpoints',async t => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  Object.assign(seed.itemVisibility,{ countries:{ A:true,'ghost-false':false,'ghost-true':true },
    countryLabels:{ A:false,'ghost-label':true },hydro:{ rivers_hydro:false,'ghost-hydro':true } });
  const owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  const expectedState=structuredClone(seed),original=createOriginalLayerList();
  Object.assign(expectedState,createOriginalEmpty());
  // The pinned oracle predates property bindings. This catalog fixture has none;
  // keep its original record contract without changing either source fixture.
  assert.deepEqual(seed.timelineRecords.propertyBindings,[]);
  const oracleSeed={ ...structuredClone(seed),timelineRecords:{ schemaVersion:1,
    lifetimes:seed.timelineRecords.lifetimes,geometryBindings:seed.timelineRecords.geometryBindings,
    parentRelations:seed.timelineRecords.parentRelations } };
  const originalStore=createOriginalStore({ getState:() => expectedState });originalStore.restoreProject(oracleSeed);
  original.connect(ports(expectedState,originalStore.snapshot(),{ selectionDomain:{ prune() {} } }));
  original.pruneLayerItemVisibility();
  const actual=createObjectCatalog();let selectionPrunes=0;
  const state={};
  for(const key of ['itemVisibility','labels','hydroEdits','genericFeatures','distributionLayers'])
    Object.defineProperty(state,key,{ get:() => owner.documentModel.snapshot()[key] });
  actual.connect(ports(state,owner.documentModel.territorialViews(),{ projectDomain:owner.project,
    selectionDomain:{ async prune() { selectionPrunes+=1;return owner.client.selectionApply({ action:'prune',validKeys:null }); } } }));
  const before=owner.client.state();await actual.pruneLayerItemVisibility();
  assert.deepEqual(state.itemVisibility,expectedState.itemVisibility,'original pruning preserves explicit valid true and removes both obsolete true/false');
  assert.equal(selectionPrunes,1);assert.equal(owner.client.state().stateRevision,before.stateRevision);
  assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().presentationDirty,false);
  assert.equal(owner.client.state().canUndo,false);
  await owner.project.executeCommand({ commandId:'presentation.apply',targets:[],payload:{ action:'visibility',key:'countries',visible:false } });
  assert.deepEqual(state.itemVisibility,expectedState.itemVisibility,'unrelated controls retain exact visibility presence');
  assert.deepEqual(owner.documentModel.snapshot().geometries,seed.geometries);
});
