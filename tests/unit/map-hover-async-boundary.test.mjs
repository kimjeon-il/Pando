import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPointerTargets } from "../../shared/frontend/js/modules/pointer-targets.js";
import { createGpuScene } from "../../shared/frontend/js/modules/gpu-scene.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";

const ref = id => normalizeObjectRef({ domain: 'territorial', type: 'entity', id });
const hit = id => ({ ref: ref(id), feature: { id, geometry: { type: 'Point', coordinates: [0,0] } } });
function acknowledgements() {
  let current = { hover: null };
  const calls = [];
  return { calls, snapshot: () => current,
    setHover(value, options) {
      let resolve, reject;
      const promise = new Promise((yes,no) => { resolve = yes; reject = no; });
      calls.push({ value, options, resolve, reject });
      return promise;
    },
    accept(index, hover = calls[index].value) { current = { hover }; calls[index].resolve(current); },
    packet(index, hover) { calls[index].resolve({ hover }); },
  };
}
function pointers(t) {
  const queue = acknowledgements(), errors = [], timers = new Map();
  let generation = 1, picked = hit('A'), pickingFailure;
  const state = { tool: 'select', mapMoving: false }, layout = { viewRevision: 1 }, draft = { dragging: false };
  t.mock.method(globalThis,'setTimeout',(callback,delay) => { assert.equal(delay,50);const token={};timers.set(token,callback);return token; });
  t.mock.method(globalThis,'clearTimeout',token => timers.delete(token));
  const owner = createPointerTargets({isDraggingDraft:()=>draft.dragging});
  owner.connect({ domains: { selectionDomain: queue, projectDomain: { getGeneration: () => generation } },
    projectState: { state }, mapLayout: layout, draftPresentation: { editingDraftSnapshot: () => draft },
    objectPicking: { territorialObjectsAt: () => { if(pickingFailure)throw pickingFailure;return picked ? [picked] : []; } },
    feedback: { reportOperationError: (...args) => errors.push(args) } });
  owner.initializeHoverPickFrame();
  return { owner, queue, errors, state, layout, draft, timers,
    pick(value) { picked=value; }, failPick(error) { pickingFailure=error; }, generation(value) { generation=value; },
    fire() { const [token,callback]=timers.entries().next().value;timers.delete(token);return callback(); } };
}
function gpu() {
  const queue = acknowledgements(), publications = [], errors = [], state = { tool: 'select', mapMoving: false };
  let generation = 1, mobile = false;
  const owner = createGpuScene();
  owner.connect({ domains: { selectionDomain: queue, projectDomain: { getGeneration: () => generation } },
    projectState: { state }, mapLayout: { viewRevision: 1 }, surfaces: { isMobile: () => mobile },
    selectionServices: { normalizeObjectRef }, interactionStateCommands: { setHoverHit: value => publications.push(value) },
    feedback: { reportOperationError: (...args) => errors.push(args) } });
  return { owner, queue, publications, errors, state,
    generation(value) { generation=value; }, mobile(value) { mobile=value; } };
}

test('ground hover keeps the 50 ms pick and publishes its hit only after Core acknowledges',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);
  assert.equal(f.queue.calls.length,0);assert.equal(f.timers.size,1);
  const pending=f.fire();assert.equal(f.queue.calls.length,1);assert.equal(f.owner.lastHoverHit,null);
  assert.deepEqual(f.queue.calls[0].options,{ source: 'map' });
  f.queue.accept(0);assert.equal(await pending,true);assert.equal(f.owner.lastHoverHit.ref.id,'A');
  f.owner.queueCountryHoverPick([11,10],[0,0]);assert.equal(f.timers.size,0,'Retain the original three-pixel threshold.');
});

test('ground cancellation clears an in-flight enter even before the first accepted hover',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);const enter=f.fire();
  const leave=f.owner.cancelCountryHoverPick({ clear: true });assert.equal(f.queue.calls.length,2);
  f.queue.accept(0);assert.equal(await enter,false);assert.equal(f.owner.lastHoverHit,null);
  f.queue.accept(1,null);assert.equal(await leave,true);assert.equal(f.owner.lastHoverHit,null);
  assert.equal(f.owner.lastHoverPickPoint,null);assert.equal(f.owner.lastHoverPickViewRevision,-1);
});

test('newer ground picks, cancellation, camera and project changes discard delayed display hits',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);const first=f.fire();
  f.pick(hit('B'));f.owner.queueCountryHoverPick([20,10],[0,0]);const second=f.fire();
  f.queue.accept(0);assert.equal(await first,false);assert.equal(f.owner.lastHoverHit,null);
  f.queue.accept(1);assert.equal(await second,true);assert.equal(f.owner.lastHoverHit.ref.id,'B');
  for (const invalidate of [() => f.owner.cancelCountryHoverPick(),() => { f.layout.viewRevision++; },() => f.generation(2)]) {
    f.owner.queueCountryHoverPick([30+f.queue.calls.length*10,10],[0,0]);const pending=f.fire(),index=f.queue.calls.length-1;
    invalidate();f.queue.accept(index);assert.equal(await pending,false);assert.equal(f.owner.lastHoverHit.ref.id,'B');
  }
});

test('ground stale rejections are contained and unexpected picking or Core errors retain diagnostics',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);let pending=f.fire();
  f.queue.calls[0].reject(Object.assign(new Error('old epoch'),{ code: 'STALE_REVISION' }));
  assert.equal(await pending,false);assert.deepEqual(f.errors,[]);assert.equal(f.owner.lastHoverHit,null);
  f.owner.queueCountryHoverPick([20,10],[0,0]);pending=f.fire();
  const failure=new Error('Core transport failed');f.queue.calls[1].reject(failure);
  assert.equal(await pending,false);assert.equal(f.errors[0][0],failure);assert.equal(f.errors[0][2],'PL-MAP-HOVER-001');
  const pickingFailure=new Error('Picking failed');f.failPick(pickingFailure);
  f.owner.queueCountryHoverPick([30,10],[0,0]);assert.equal(await f.fire(),false);
  assert.equal(f.errors[1][0],pickingFailure);assert.equal(f.queue.calls.length,2);
});

test('GPU object hover publishes accepted geometry only after the Core acknowledgement',async () => {
  const f=gpu(), value=hit('A');const pending=f.owner.setMapHover('territorialUnit','A',value.feature,value.ref);
  assert.deepEqual(f.publications,[]);f.queue.accept(0);assert.equal(await pending,true);
  assert.equal(f.publications[0].feature,value.feature);assert.equal(f.publications[0].ref.key,value.ref.key);
});

test('GPU stale leave preserves another hover and uses the original public expected key',async () => {
  const f=gpu(), a=hit('A'), b=hit('B');
  const enter=f.owner.setMapHover('territorialUnit','B',b.feature,b.ref);f.queue.accept(0);await enter;
  const leave=f.owner.setMapHover('','',null,a.ref);assert.equal(f.queue.calls[1].options.expectedKey,a.ref.key);
  f.queue.accept(1,b.ref);assert.equal(await leave,false);assert.equal(f.publications.length,1);
  const clear=f.owner.setMapHover('','',null,b.ref);f.queue.accept(2,null);assert.equal(await clear,true);
  assert.equal(f.publications.at(-1),null);
});

test('GPU delayed hover results cannot replace newer display ownership or cross project and movement boundaries',async () => {
  const f=gpu(), a=hit('A'), b=hit('B');
  const first=f.owner.setMapHover('territorialUnit','A',a.feature,a.ref),second=f.owner.setMapHover('territorialUnit','B',b.feature,b.ref);
  f.queue.accept(1);assert.equal(await second,true);f.queue.packet(0,a.ref);assert.equal(await first,false);
  assert.equal(f.publications.length,1);assert.equal(f.publications[0].ref.id,'B');
  const replaced=f.owner.setMapHover('territorialUnit','A',a.feature,a.ref);f.generation(2);f.queue.accept(2);assert.equal(await replaced,false);
  const moving=f.owner.setMapHover('territorialUnit','A',a.feature,a.ref);f.state.mapMoving=true;f.queue.accept(3);assert.equal(await moving,false);
  assert.equal(f.publications.length,1);
});

test('GPU obsolete hover failures are contained and unexpected failures reach the operation reporter',async () => {
  const f=gpu(), a=hit('A');let pending=f.owner.setMapHover('territorialUnit','A',a.feature,a.ref);
  f.queue.calls[0].reject(Object.assign(new Error('cancelled'),{ cancelled: true }));assert.equal(await pending,false);assert.deepEqual(f.errors,[]);
  pending=f.owner.setMapHover('territorialUnit','A',a.feature,a.ref);const failure=new Error('unavailable owner');
  f.queue.calls[1].reject(failure);assert.equal(await pending,false);assert.equal(f.errors[0][0],failure);assert.equal(f.errors[0][2],'PL-MAP-HOVER-001');
  assert.deepEqual(f.publications,[]);
});

test('missing Core hover dependencies fail through the responsible operation and do not publish display ownership',async () => {
  const f=gpu(),a=hit('A');f.queue.setHover=undefined;
  assert.equal(await f.owner.setMapHover('territorialUnit','A',a.feature,a.ref),false);
  assert.ok(f.errors[0][0] instanceof TypeError);assert.equal(f.errors[0][2],'PL-MAP-HOVER-001');
  assert.deepEqual(f.publications,[]);
});

function labelHandlers() {
  const source=readFileSync(new URL("../../shared/frontend/js/modules/label-presentation.js",import.meta.url),'utf8');
  const start=source.indexOf("    enter.on('mouseenter.hover'",source.indexOf('  const renderUserLabels ='));
  const end=source.indexOf("    enter.append('circle')",start),handlers={},queue=acknowledgements(),diagnostics=[];
  const enter={on(type,handler){handlers[type]=handler;return enter;}};
  vm.runInNewContext(source.slice(start,end),{enter,labels:{isMobile:()=>false},labelState:()=>({tool:'select',mapMoving:false}),
    selectionDomain:queue,labelRef:value=>normalizeObjectRef({domain:'label',type:value.kind,id:value.id}),
    reportDiagnostic:value=>diagnostics.push(value)});
  return {handlers,queue,diagnostics};
}
test('renderer label enter and guarded leave await the required current Core selection port',async () => {
  const f=labelHandlers(), label={id:'L',kind:'city'};
  const enter=f.handlers['mouseenter.hover'](label);f.queue.accept(0);await enter;
  const leave=f.handlers['mouseleave.hover'](label);assert.equal(f.queue.calls[1].options.expectedKey,'label:city:L');
  f.queue.accept(1,null);await leave;assert.deepEqual(f.diagnostics,[]);
});
test('renderer label hover catches obsolete failures and reports the original unexpected error',async () => {
  const f=labelHandlers(),label={id:'L',kind:'city'};
  let pending=f.handlers['mouseenter.hover'](label);f.queue.calls[0].reject(Object.assign(new Error('old document'),{code:'PL-CORE-STALE'}));
  await pending;assert.deepEqual(f.diagnostics,[]);
  pending=f.handlers['mouseleave.hover'](label);const failure=new Error('label transport failed');f.queue.calls[1].reject(failure);
  await pending;assert.equal(f.diagnostics[0].error,failure);assert.equal(f.diagnostics[0].operation,'label-hover');
});
