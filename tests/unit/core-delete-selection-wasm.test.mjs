import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWebOracle } from '../helpers/web-oracle.mjs';
import { createNodeSelection } from '../helpers/core-selection.mjs';
import { createGenericFeatureService } from "../../apps/editor/frontend/js/modules/generic-feature-service.js";
import { createObjectDeletion } from "../../apps/editor/frontend/js/modules/app-object-deletion.js";
const originalSelection=await loadWebOracle('assets/js/modules/selection-domain.js');
const originalDeletion=await loadWebOracle('assets/js/modules/app-object-deletion.js');
const A={ domain: 'territorial',type: 'entity',id: 'A' },B={ domain: 'territorial',type: 'entity',id: 'B' },G={ domain: 'generic',type: 'feature',id: 'G' };
const feature={ type: 'Feature',id: 'G',geometry: { type: 'Point',coordinates: [1,2] },
  properties: { schemaVersion: 2,name: 'G',notes: '',color: '#8c68d8',locked: false,source: { kind: 'drawn',license: '',details: {} } } };
function ports(domain,service,projectDomain = null) {
  return { projectState: { state: { get selected() { return domain.primary(); } } },
    readinessUi: { requireCanonicalData: () => true },objectModelA: { genericFeatureService: service },
    landRelations: { reassignGenericFeatureParents() {} },objectDisplay: { invalidateObjectPresentation() {} },
    objectPresentation: { genericFeatureName: row=>row.properties.name },feedback: { setActionStatus() {} },
    domains: { projectDomain,selectionUiController: { clear: options=>domain.clear(options),presentPrimary: () => false } } };
}
function original() {
  const rows=[],known=new Set(['A','B','G']),domain=originalSelection.createSelectionDomain({
    projectDomain: { getGeneration: () => 1 },refExists: ref=>known.has(ref.id) });
  const deletion=originalDeletion.createObjectDeletion();
  deletion.connect(ports(domain,{ get: id=>known.has(id)?feature:null,remove(id,{beforeRemove}) { beforeRemove();known.delete(id);return {ok:true,feature}; } }));
  const capture=action=>{action();rows.push(structuredClone(domain.snapshot()));};
  capture(()=>domain.replace(A,{scope:'delete'}));capture(()=>domain.toggle(G,{scope:'delete'}));
  capture(()=>deletion.deleteSelected());capture(()=>known.add('G'));
  capture(()=>domain.selectRange(B,[A,G,B],{scope:'delete'}));domain.dispose();return rows;
}
test('actual primary deletion clears the original multi-selection and anchors before same-ID recreation and range selection',async () => {
  const expected=original(),owner=await createNodeSelection({genericIds:['G'],labelIds:[],distributionIds:[]});
  const domain=owner.domain,service=createGenericFeatureService({ documentModel: owner.documentModel,commandOwner: owner.project }),deletion=createObjectDeletion();
  deletion.connect(ports(domain,service,owner.project));
  const actions=[()=>domain.replace(A,{scope:'delete'}),()=>domain.toggle(G,{scope:'delete'}),()=>deletion.deleteSelected(),
    ()=>service.add(feature),()=>domain.selectRange(B,[A,G,B],{scope:'delete'})];
  try {
    for(const [index,action] of actions.entries()) {await action();assert.deepEqual(domain.snapshot(),expected[index],`original deletion transition ${index}`);}
    assert.deepEqual(domain.snapshot().selection.items.map(ref=>ref.id),['B']);
  } finally {owner.dispose();}
});
