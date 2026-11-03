import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { handleEditorMapClick } from '../../apps/editor/frontend/js/modules/editor-map-click.js';
import { editorNode } from './helpers/dom-node-fixture.mjs';

function setup(tool) {
  let resolve, reject, generation = 1;
  const acknowledgement = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  const state = { tool, layerVisibility: {} }, events = [], errors = [];
  let ports;
  const owner = createObjectPicking({ openEditor: true, handleEditingClick: point => handleEditorMapClick(point, ports) });
  ports = { projectState: { state }, platform: { d3: { event: {} } },
    mapView: { screenToGeo: () => [1,2] },
    territorySelectionB: { territorySelectionCountryPickingActive: () => false },
    surfaces: { isGenericFeatureDraftTool: value => value === 'polygon', uid: () => 'G' },
    colorModel: { DEFAULT_GENERIC_FEATURE_COLOR: '#8c68d8' }, applicationConstantsA: { GENERIC_FEATURE_SCHEMA_VERSION: 2 },
    draftPresentation: { editingDraftSnapshot: () => ({ inputPhase: 'draw' }) },
    objectModelA: { genericFeatureService: { add: () => acknowledgement } },
    propertyEditingA: { applyGenericSelectionIntent: id => events.push(['select',id]) },
    feedback: { reportOperationError: (...args) => errors.push(args), setActionStatus: (...args) => events.push(['status',...args]) },
    domains: { projectDomain: { getGeneration: () => generation },
      editingDomain: { snapshot: () => ({ vertexPlacement: false }),
        appendDraftScreenPoint: () => acknowledgement, setTool: value => events.push(['tool',value]) } } };
  owner.connect(ports);
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

async function chooser(t) {
  const previousDocument=globalThis.document,previousFrame=globalThis.requestAnimationFrame;
  globalThis.document={createElement:editorNode};globalThis.requestAnimationFrame=()=>0;
  t.after(()=>{globalThis.document=previousDocument;globalThis.requestAnimationFrame=previousFrame;});
  let resolve,reject;const acknowledgement=new Promise((accept,fail) => { resolve=accept;reject=fail; });
  const refs=['G','H'].map(id=>normalizeObjectRef({ domain: 'generic',type: 'feature',id })),calls=[],owner=createObjectPicking({openEditor:true});
  const nodes=new Map(['objectChooser','objectChooserList','map'].map(id=>[id,editorNode()]));
  owner.connect({ projectState: { state: { tool:'select',layerVisibility: { genericFeatures: true },
      genericFeatures:refs.map(ref=>({id:ref.id,geometry:{type:'Point',coordinates:[1,2]}})) } },
    selectionServices: { normalizeObjectRef },
    objectOperationsA: { objectRefVisible: ref=>refs.some(item=>item.key===ref.key),objectDisplayInfo:ref=>({name:ref.id,type:'feature'}) },
    layerPresentation:{isLayerItemVisible:()=>true},renderScene:{OVERLAY_GROUPS:['genericFeatures']},
    rendering:{selectionPerformanceMetrics:{}},mapLayout:{viewRevision:1},
    mapView:{screenToGeo:point=>point,activeProjection:()=>point=>point},
    spatialRecords:{indexedMapObjectCandidates:()=>refs,geometryBoundsCache:new WeakMap()},
    cutGeometry:{coordinateBounds:([x,y])=>[x,y,x,y]},labelPresentation:{currentMapZoom:()=>1},
    landRelations:{pointInCountryFeature:()=>assert.fail('Point picking must not query polygon interiors')},
    surfaces:{isMobile:()=>false},platform:{$:id=>nodes.get(id),clamp:(value,min,max)=>Math.max(min,Math.min(value,max))},
    domains: { projectDomain:{getGeneration:()=>1},selectionDomain:{has:()=>false},
      selectionUiController: { applyIntent: (value,options) => { calls.push([value,options]);return acknowledgement; } } } });
  assert.equal(await owner.handleObjectSelectionAt([1,2],{sourceEvent:{}}),true);
  assert.equal(nodes.get('objectChooserList').children.length,2);
  assert.deepEqual(calls,[],'opening the overlap chooser must not select before acknowledgement');
  return { owner,resolve,reject,calls };
}
test('object chooser waits for the canonical selection acknowledgement and retains the captured intent',async t => {
  const f=await chooser(t),pending=f.owner.chooseObjectCandidate(0,{ toggle: true });let done=false;
  pending.then(() => { done=true; });assert.equal(done,false);assert.equal(f.calls[0][0].id,'G');
  assert.deepEqual(f.calls[0][1],{ mode: 'toggle',scope: 'map',openEditor:true });f.resolve(true);assert.equal(await pending,true);
});
test('object chooser propagates its Worker rejection to the explicit chooser event boundary',async t => {
  const f=await chooser(t),pending=f.owner.chooseObjectCandidate(0),failure=Object.assign(new Error('Selection worker failed'),{ code: 'STALE_REVISION' });
  f.reject(failure);await assert.rejects(pending,error => error===failure);
});
