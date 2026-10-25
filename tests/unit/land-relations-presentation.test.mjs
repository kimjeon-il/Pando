import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import {createLandRelations} from "../../apps/editor/frontend/js/modules/app-land-relations.js";
import {createCountryCommandCalculator} from "../../apps/editor/frontend/js/modules/map-edit-country-commands.js";
import {createTerritorialFeature,territorialRootId,TERRITORIAL_COVERAGE_MODES} from "../../shared/frontend/js/modules/territorial-units.js";
import {DISTRIBUTION_MODES} from "../../shared/frontend/js/modules/distribution-model.js";
import {testCoreProject,initializeTestTerritorialState} from '../helpers/timeline-project.mjs';

const square=(x0,y0,x1,y1)=>({type:'Polygon',coordinates:[[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]]]});
const feature=(id,geometry,parentId='')=>createTerritorialFeature({id,name:id,entityKind:'general',parentId,geometry});
function landPlans() {
  const owner=createLandRelations();
  owner.connect({territorialModel:{territorialRootId,TERRITORIAL_COVERAGE_MODES,DISTRIBUTION_MODES}});
  return owner;
}
async function fixture() {
  const entities=[feature('source',square(0,0,10,10)),feature('other',square(20,0,30,10)),
    feature('kept',square(1,1,2,2),'source'),feature('moved',square(1,7,2,8),'source'),
    feature('moved-child',square(1.1,7.1,1.9,7.9),'moved'),feature('crossed',square(3,3,4,7),'source'),
    feature('unrelated',square(21,1,22,2),'other')];
  const state={territorialEntities:entities,
    itemVisibility:{objects:{source:false,kept:false,moved:false,'moved-child':false,crossed:false,unrelated:false}},
    layerPresentation:normalizeLayerPresentation({objectStyles:Object.fromEntries(['source','kept','moved','moved-child','crossed','unrelated']
      .map((id,index)=>[`territorial:entity:${id}`,{opacity:(index+1)/10}]))})};
  await initializeTestTerritorialState(state);
  return {state,...testCoreProject(state)};
}
function splitPlan(views) {
  const selected=square(0,5,10,10),next=feature('new',selected);
  const {result}=createCountryCommandCalculator().calculate({operation:'new-country',sourceIds:['source'],
    transferredGeometry:selected,newFeature:next},new Map(views.filter(row=>!row.properties.parentId).map(row=>[row.id,row])));
  const updates=new Map(result.features.map(row=>[row.id,row]));
  const proposed=[...views.map(row=>updates.get(row.id)||row),updates.get('new')];
  const dependents=landPlans().planTransferLandDependents({territorialViews:proposed,transferredGeometry:selected,
    sourceOwnerIds:['source'],targetOwnerId:'new'});
  return {features:[...result.features,...dependents.features],removedIds:[...result.removedIds,...dependents.removedIds]};
}

test('dependent geometry planning reads immutable proposal views and preserves the existing split calculation',async()=>{
  globalThis.window=globalThis;
  const f=await fixture(),before=f.project.snapshot(),clock=f.client.state(),plan=splitPlan(f.entityStore.snapshot());
  assert.deepEqual(plan.removedIds,['moved','moved-child']);
  assert.equal(plan.features.some(row=>row.id==='kept'),true);assert.equal(plan.features.some(row=>row.id==='crossed'),true);
  assert.equal(plan.features.some(row=>row.id==='unrelated'),true);
  assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock,'geometry planning never publishes or owns history');
  const original=globalThis.polygonClipping;
  try {
    globalThis.polygonClipping={...original,difference(){throw new Error('dependent apply failed');}};
    assert.throws(()=>splitPlan(f.entityStore.snapshot()),/dependent apply failed/);
  } finally {globalThis.polygonClipping=original;}
  assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock);
});

test('one split candidate cleans authored child appearance and preserves independent viewing through Undo',async()=>{
  globalThis.window=globalThis;
  const f=await fixture(),before=f.project.snapshot(),clock=f.client.state(),plan=splitPlan(f.entityStore.snapshot());
  const operation={commandId:'territorial.patch',targets:[...plan.features.map(row=>row.id),...plan.removedIds]
    .map(id=>({domain:'territorial',id})),payload:plan};
  const envelope={commandId:'territorial.new-country',targets:[],payload:{operations:[operation]}};
  const cancelled=await f.project.prepareCommand(envelope);
  assert.equal(cancelled.ok,true);assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock);
  assert.equal(cancelled.preview.territorialViews.some(row=>row.id==='moved'),false);
  assert.equal(await f.project.cancelCandidate(cancelled.candidateId),true);
  assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock);
  const prepared=await f.project.prepareCommand(envelope);
  const committed=await f.project.confirmCandidate(prepared.candidateId,prepared.state.epoch);
  assert.equal(committed.ok,true);assert.equal(f.client.state().stateRevision,clock.stateRevision+1);
  const after=f.project.snapshot();
  for(const id of ['moved','moved-child']) {
    assert.equal(f.entityRepository.get(id),null);assert.equal(f.state.itemVisibility.objects[id],false);
    assert.equal(Object.hasOwn(f.state.layerPresentation.objectStyles,`territorial:entity:${id}`),false);
  }
  for(const id of ['kept','crossed','unrelated']) {
    assert.equal(f.state.itemVisibility.objects[id],false);
    assert.deepEqual(f.state.layerPresentation.objectStyles[`territorial:entity:${id}`],before.layerPresentation.objectStyles[`territorial:entity:${id}`]);
  }
  assert.equal(f.state.itemVisibility.objects.source,false);
  assert.deepEqual(f.state.layerPresentation.objectStyles['territorial:entity:source'],before.layerPresentation.objectStyles['territorial:entity:source']);
  assert.equal(await f.project.undo(),true);assert.equal(f.client.state().canUndo,false);assert.deepEqual(f.project.snapshot(),before);
  assert.equal(await f.project.redo(),true);assert.deepEqual(f.project.snapshot(),after);
});

test('reassignment calculates changed distribution references without mutating accepted rows or unrelated entries',()=>{
  globalThis.window=globalThis;
  const views=[feature('target',square(0,0,10,10)),feature('donor',square(0,0,10,10)),
    feature('child',square(1,1,2,2),'donor'),feature('grandchild',square(1.1,1.1,1.9,1.9),'child')];
  const entries=[{id:'moved-entry',mode:'territorial',territorialUnitId:'donor'},
    {id:'kept-entry',mode:'territorial',territorialUnitId:'child'},{id:'geometry-entry',mode:'geometry',territorialUnitId:''}];
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const before=structuredClone({views,entries});freeze(views);freeze(entries);
  const plan=landPlans().planReassignLandDependents({territorialViews:views,distributionEntries:entries,removedOwnerIds:['donor'],targetOwnerId:'target'});
  assert.equal(plan.features.find(row=>row.id==='child').properties.parentId,'target');
  assert.equal(plan.features.find(row=>row.id==='grandchild').properties.parentId,'child');
  assert.deepEqual(plan.distributionEntries,[{...entries[0],territorialUnitId:'target'}]);
  assert.deepEqual({views,entries},before);assert.deepEqual(plan.removedIds,[]);
});
