import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlace } from '../../assets/js/modules/place-contract.js';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { createGenericCommands } from '../../assets/js/modules/app-generic-commands.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
const source=normalizePlace({source:'synthetic',sourceId:'1',name:'서울',kind:'capital',coordinates:[127,37]});
test('canonical object lookup resolves builtin labels in the existing domain with readonly capabilities',()=>{
  const owner=createObjectCommands();owner.connect({selectionServices:{normalizeObjectRef},projectState:{state:{labels:[]}},labelPresentation:{labelById:id=>id===source.id?source:null}});
  const ref=owner.layerItemObjectRef('labels',source.id);
  assert.equal(ref.domain,'label');assert.equal(ref.type,'capital');assert.equal(owner.objectRefExists(ref),true);assert.ok(Object.isFrozen(source));
  assert.equal(owner.objectDisplayInfo(ref).name,'서울');
});
test('copy creates an independent user label via canonical history and autosave without mutating builtin source',()=>{
  const state={selected:{domain:'label',id:source.id},labels:[],labelSettings:{}},history=[],events=[];
  const owner=createGenericCommands();owner.connect({projectState:{state},labelPresentation:{labelById:()=>source,labelKey:(domain,id)=>`${domain}:${id}`,automaticLabelSettings:()=>({pinned:true})},surfaces:{uid:()=> 'label-copy'},
    domains:{projectDomain:{recordHistory:()=>history.push(structuredClone(state.labels)),queueAutosave:()=>events.push('autosave')},renderingDomain:{invalidateLabels:()=>events.push('render')}},
    layers:{markLayerTreeDirty:()=>events.push('tree')},propertyEditingA:{applyLabelSelectionIntent:()=>events.push('select')},feedback:{setActionStatus:()=>{}}});
  const copy=owner.copySelectedPlaceForEditing();assert.equal(copy.id,'label-copy');assert.equal(copy.sourcePlaceId,source.id);assert.deepEqual(copy.coordinates,source.coordinates);
  copy.coordinates[0]=128;copy.name='편집한 지명';assert.equal(source.coordinates[0],127);assert.equal(source.name,'서울');assert.equal(state.labels.length,1);assert.deepEqual(history,[[]]);assert.ok(events.includes('autosave'));
});
