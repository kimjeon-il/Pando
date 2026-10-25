import {createTestViewingSession} from '../helpers/viewing-project.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createObjectCatalog } from "../../shared/frontend/js/modules/object-catalog.js";
import { createNodeCoreProject } from '../helpers/core-project.mjs';
const groups=['objects','distributions','hydro','genericFeatures','labels','objectLabels'];
function ports(state,world,domains) {
  return { projectState:{ state },domains,layerPresentation:{ LAYER_GROUP_KEYS:groups },
    countries:{ builtinTerritorialScene:() => ({ labelById:new Map([['A',{}]]) }) },
    hydroPresentation:{ HYDRO_LAYER_META:{ rivers_hydro:{ category:'river' } },hydroCategoryKey:value => value },
    territorialModel:{ entityRepository:{ list:({ kind,parentId }={}) => world.filter(feature => (!kind || feature.properties.entityKind===kind)
      && (parentId===undefined || feature.properties.parentId===parentId)) } } };
}

test('the catalog prunes obsolete project IDs while preserving lazy builtin overrides and saved checkpoints',async t => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const itemVisibility=Object.assign({},{ objects:{ A:true,'ghost-false':false,'ghost-true':true },
    objectLabels:{ A:false,'ghost-label':true },hydro:{ rivers_hydro:false,'ghost-hydro':true } });
  const owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  const expected={distributions:{},genericFeatures:{},...structuredClone(itemVisibility),objects:{A:true},objectLabels:{A:false}};
  const actual=createObjectCatalog();let selectionPrunes=0;
  const viewing=createTestViewingSession(owner);t.after(viewing.dispose);const state=viewing.session.state;
  viewing.session.setViewingPresentation({itemVisibility:expected});
  viewing.session.setViewingPresentation({itemVisibility:{...expected,...itemVisibility}});
  actual.connect({...ports(state,owner.documentModel.territorialViews(),{ projectDomain:owner.project,
    selectionDomain:{ async prune() { selectionPrunes+=1;return owner.client.selectionApply({ action:'prune',validKeys:null }); } } }),projectSession:viewing.session});
  const before=owner.client.state();await actual.pruneLayerItemVisibility();
  assert.deepEqual(state.itemVisibility,expected,'current pruning preserves explicit valid true and removes obsolete true/false');
  assert.equal(selectionPrunes,1);assert.equal(owner.client.state().stateRevision,before.stateRevision);
  assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().presentationDirty,false);
  assert.equal(owner.client.state().canUndo,false);
  viewing.session.applyViewingPresentation({action:'visibility',key:'objects',visible:false});
  assert.deepEqual(state.itemVisibility,expected,'unrelated controls retain exact visibility presence');
  assert.deepEqual(owner.documentModel.snapshot().geometries,seed.geometries);
});
