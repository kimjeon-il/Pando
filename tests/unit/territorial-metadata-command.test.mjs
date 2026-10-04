import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectMetadata } from '../../assets/js/modules/app-object-metadata.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialApplicationService } from '../../assets/js/modules/territorial-service.js';

function fixture() {
  const state={stateRevision:0,selected:{domain:'territorial',type: 'entity',id:'A'},territorialEntities:['A','B'].map(id=>createTerritorialFeature({id,entityKind: 'general',name:id,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}))};
  const effects={history:0,save:0,refresh:0,tree:0,labels:0,base:0,patch:0,palette:0};
  initializeTestTerritorialState(state);
const store=createTerritorialEntityStore({getState:()=>state});
  const repository=createTerritorialEntityRepository({entityStore:store});
  const service=createTerritorialApplicationService({entityStore:store,entityRepository:repository,commandPipeline:{runMutation(_meta,mutate){effects.history++;const value=mutate();state.stateRevision++;effects.save++;return {ok:true,value};}}});
  const owner=createObjectMetadata();
  owner.connect({territorialModel:{entityRepository:repository},projectState:{state},objectModelB:{territorialApplicationService:service},feedback:{setActionStatus(){}},layers:{markLayerTreeDirty(){effects.tree++;}},rendering:{gpuMapRenderer:{invalidateCountryPalette(){effects.palette++;}}},domains:{selectionUiController:{presentPrimary(){effects.refresh++;},applyIntent(){assert.fail('metadata must not change selection or focus');}},renderingDomain:{invalidateLabels(){effects.labels++;},invalidateBaseScene(){effects.base++;},invalidateTerritorialPatch(){effects.patch++;}}}});
  return {owner,state,repository,effects};
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
