import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";

function setup(tool) {
  let resolve, reject, generation = 1;
  const acknowledgement = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  const state = { tool, layerVisibility: {} }, events = [], errors = [];
  const owner = createObjectPicking();
  owner.connect({ projectState: { state }, platform: { d3: { event: {} } },
    mapView: { screenToGeo: () => [1,2] },
    territorySelectionB: { territorySelectionCountryPickingActive: () => false },
    surfaces: { isGenericFeatureDraftTool: value => value === 'polygon', uid: () => 'G' },
    colorModel: { DEFAULT_GENERIC_FEATURE_COLOR: '#8c68d8' }, applicationConstantsA: { GENERIC_FEATURE_SCHEMA_VERSION: 2 },
    draftPresentation: { editingDraftSnapshot: () => ({ inputPhase: 'draw' }) },
    objectModelA: { genericFeatureService: { add: () => acknowledgement } },
    propertyEditingA: { applyGenericSelectionIntent: id => events.push(['select',id]) },
    feedback: { reportOperationError: (...args) => errors.push(args), setActionStatus: (...args) => events.push(['status',...args]) },
    domains: { projectDomain: { getGeneration: () => generation },
      editingDomain: { appendDraftScreenPoint: () => acknowledgement, setTool: value => events.push(['tool',value]) } } });
  return { owner, resolve, reject, events, errors, replace: () => { generation += 1; } };
}

test('map draft append waits for Core and contains the original Worker error at the map operation boundary', async () => {
  const f = setup('polygon'), pending = f.owner.handleMapClick([1,2]);
  assert.deepEqual(f.errors,[]);
  const error = Object.assign(new Error('Draft worker failed'), { code: 'PL-CORE-LOAD' });
  f.reject(error); assert.equal(await pending,false);
  assert.equal(f.errors.length,1); assert.equal(f.errors[0][0],error); assert.equal(f.errors[0][2],'PL-MAP-CLICK-001');
});

test('point creation waits for Core acknowledgement before switching tool and selecting its object', async () => {
  const f = setup('point'), pending = f.owner.handleMapClick([1,2]);
  assert.deepEqual(f.events,[]);
  f.resolve({ id: 'G' }); await pending;
  assert.deepEqual(f.events.slice(0,2),[['tool','select'],['select','G']]);
  assert.deepEqual(f.errors,[]);
});

test('point creation from a replaced project cannot select an old object or reset the new tool', async () => {
  const f = setup('point'), pending = f.owner.handleMapClick([1,2]);
  f.replace(); f.resolve({ id: 'G' }); assert.equal(await pending,false);
  assert.deepEqual(f.events,[]); assert.deepEqual(f.errors,[]);
});

function chooser() {
  let resolve,reject;const acknowledgement=new Promise((accept,fail) => { resolve=accept;reject=fail; });
  const ref=normalizeObjectRef({ domain: 'generic',type: 'feature',id: 'G' }),calls=[],owner=createObjectPicking();
  owner.connect({ projectSession: { objectChooserCandidates: [ref] },projectState: { state: { layerVisibility: { genericFeatures: true } } },
    selectionServices: { normalizeObjectRef },objectLookup: { objectRefExists: () => true },layerPresentation: { isLayerItemVisible: () => true },
    domains: { selectionUiController: { applyIntent: (value,options) => { calls.push([value,options]);return acknowledgement; } } } });
  return { owner,resolve,reject,calls };
}
test('object chooser waits for the canonical selection acknowledgement and retains the captured intent',async () => {
  const f=chooser(),pending=f.owner.chooseObjectCandidate(0,{ toggle: true });let done=false;
  pending.then(() => { done=true; });assert.equal(done,false);assert.equal(f.calls[0][0].id,'G');
  assert.deepEqual(f.calls[0][1],{ mode: 'toggle',scope: 'map' });f.resolve(true);assert.equal(await pending,true);
});
test('object chooser propagates its Worker rejection to the explicit chooser event boundary',async () => {
  const f=chooser(),pending=f.owner.chooseObjectCandidate(0),failure=Object.assign(new Error('Selection worker failed'),{ code: 'STALE_REVISION' });
  f.reject(failure);await assert.rejects(pending,error => error===failure);
});
