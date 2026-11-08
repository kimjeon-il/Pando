import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "node:test";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "node:fs";
import * as __merge_dep3 from "node:vm";
import * as __merge_dep4 from "../../../src/map/pointer-targets.js";
import * as __merge_dep5 from "../../../src/rendering/gpu-scene.js";
import * as __merge_dep6 from "../../../src/ui/object-selection-controller.js";
import * as __merge_dep7 from "../../../src/map/map-input-presentation.js";
import * as __merge_dep8 from "../../../src/ui/tooltip-controller.js";
import * as __merge_dep9 from "../../helpers/core-selection.mjs";
import * as __merge_dep10 from "../helpers/dom-node-fixture.mjs";
import * as __merge_dep11 from "../../helpers/timeline-project.mjs";
import * as __merge_dep12 from "../../../src/geometry/spatial-index.js";
import * as __merge_dep13 from "../../../src/map/map-object-spatial-index.js";
import * as __merge_dep14 from "../../../src/document/territorial-units.js";
import * as __merge_dep15 from "../../../src/document/territorial-entity-store.js";
import * as __merge_dep16 from "../../../src/document/territorial-entity-repository.js";
import * as __merge_dep17 from "../../../src/document/territorial-scope.js";
contractSuite("map-hover-async-boundary", () => {
const { describe : contractSuite } = __merge_dep0;
const __dep0 = __merge_dep1;
const __dep1 = __merge_dep2;
const __dep2 = __merge_dep0;
const __dep3 = __merge_dep3;
const __dep4 = __merge_dep4;
const __dep5 = __merge_dep5;
const __dep6 = __merge_dep6;
const __dep7 = __merge_dep7;
const __dep8 = __merge_dep8;
const __dep9 = __merge_dep9;
const __dep10 = __merge_dep10;
contractSuite("map-hover-async-boundary", () => {
const assert = __dep0.default;
const { readFileSync } = __dep1;
const test = __dep2.default;
const vm = __dep3.default;
const { createPointerTargets } = __dep4;
const { createGpuScene } = __dep5;
const { normalizeObjectRef } = __dep6;

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
    accept(index, hover = calls[index].value) {
      if (!calls[index].options?.isCurrent || calls[index].options.isCurrent()) current = { hover };
      calls[index].resolve({ hover });
    },
    packet(index, hover) { calls[index].resolve({ hover }); },
  };
}

test('retired country lookup and duplicate hover state are not exposed', () => {
  const owner = createPointerTargets();
  assert.equal('countryAtScreenPoint' in owner, false);
  assert.equal('lastHoverHit' in owner, false);
});
function pointers(t, { selectableObjectsAt } = {}) {
  const queue = acknowledgements(), errors = [], timers = new Map();
  let generation = 1, picked = hit('A'), pickingFailure;
  const state = { tool: 'select', mapMoving: false }, layout = { viewRevision: 1 };
  t.mock.method(globalThis,'setTimeout',(callback,delay) => { assert.equal(delay,50);const token={};timers.set(token,callback);return token; });
  t.mock.method(globalThis,'clearTimeout',token => timers.delete(token));
  const owner = createPointerTargets();
  owner.connect({ domains: { selectionDomain: queue, projectDomain: { getGeneration: () => generation } },
    projectState: { state }, mapLayout: layout,
    objectPicking: { selectableObjectsAt: selectableObjectsAt || (async () => {
      if(pickingFailure)throw pickingFailure;return picked ? [picked.ref] : [];
    }) },
    feedback: { reportOperationError: (...args) => errors.push(args) } });
  owner.initializeHoverPickFrame();
  return { owner, queue, errors, state, layout, timers,
    pick(value) { picked=value; }, failPick(error) { pickingFailure=error; }, generation(value) { generation=value; },
    fire() { const [token,callback]=timers.entries().next().value;timers.delete(token);return callback(); } };
}

test('ground hover uses the same ordered object lookup for a generic feature', async t => {
  const generic=normalizeObjectRef({domain:'generic',type:'feature',id:'G'});
  const f=pointers(t,{selectableObjectsAt:async()=>[generic]});
  f.owner.queueCountryHoverPick([10,10],[0,0]);
  const pending=f.fire();await Promise.resolve();
  assert.equal(f.queue.calls[0].value.key,generic.key);
  f.queue.accept(0);assert.equal(await pending,true);
});

test('a delayed geographic lookup cannot enter Core after the project or pointer changes', async t => {
  let resolve;
  const f=pointers(t,{selectableObjectsAt:()=>new Promise(done=>{resolve=done;})});
  f.owner.queueCountryHoverPick([10,10],[0,0]);
  const pending=f.fire();f.generation(2);resolve([ref('A')]);await Promise.resolve();
  const calls=f.queue.calls.length;if(calls)f.queue.accept(0);
  assert.equal(await pending,false);assert.equal(calls,0);
});
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
  const pending=f.fire();await Promise.resolve();assert.equal(f.queue.calls.length,1);assert.equal(f.queue.snapshot().hover,null);
  assert.equal(f.queue.calls[0].options.source,'map');assert.equal(f.queue.calls[0].options.isCurrent(),true);
  f.queue.accept(0);assert.equal(await pending,true);assert.equal(f.queue.snapshot().hover.id,'A');
  f.owner.queueCountryHoverPick([11,10],[0,0]);assert.equal(f.timers.size,0,'Retain the original three-pixel threshold.');
});

test('ground cancellation clears an in-flight enter even before the first accepted hover',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);const enter=f.fire();await Promise.resolve();
  const leave=f.owner.cancelCountryHoverPick({ clear: true });assert.equal(f.queue.calls.length,2);
  f.queue.accept(0);assert.equal(await enter,false);assert.equal(f.queue.snapshot().hover,null);
  f.queue.accept(1,null);assert.equal(await leave,true);assert.equal(f.queue.snapshot().hover,null);
  assert.equal(f.owner.lastHoverPickPoint,null);assert.equal(f.owner.lastHoverPickViewRevision,-1);
});

test('newer ground picks, cancellation, camera and project changes discard delayed display hits',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);const first=f.fire();await Promise.resolve();
  f.pick(hit('B'));f.owner.queueCountryHoverPick([20,10],[0,0]);const second=f.fire();await Promise.resolve();
  assert.equal(f.queue.calls[0].options.isCurrent(),false);
  f.queue.accept(0);assert.equal(await first,false);assert.equal(f.queue.snapshot().hover,null);
  f.queue.accept(1);assert.equal(await second,true);assert.equal(f.queue.snapshot().hover.id,'B');
  for (const invalidate of [() => f.owner.cancelCountryHoverPick(),() => { f.layout.viewRevision++; },() => f.generation(2)]) {
    f.owner.queueCountryHoverPick([30+f.queue.calls.length*10,10],[0,0]);const pending=f.fire();await Promise.resolve();const index=f.queue.calls.length-1;
    invalidate();f.queue.accept(index);assert.equal(await pending,false);assert.equal(f.queue.snapshot().hover.id,'B');
  }
});

test('ground stale rejections are contained and unexpected picking or Core errors retain diagnostics',async t => {
  const f=pointers(t);f.owner.queueCountryHoverPick([10,10],[0,0]);let pending=f.fire();await Promise.resolve();
  f.queue.calls[0].reject(Object.assign(new Error('old epoch'),{ code: 'STALE_REVISION' }));
  assert.equal(await pending,false);assert.deepEqual(f.errors,[]);assert.equal(f.queue.snapshot().hover,null);
  f.owner.queueCountryHoverPick([20,10],[0,0]);pending=f.fire();await Promise.resolve();
  const failure=new Error('Core transport failed');f.queue.calls[1].reject(failure);
  assert.equal(await pending,false);assert.equal(f.errors[0][0],failure);assert.equal(f.errors[0][2],'PL-MAP-HOVER-001');
  const pickingFailure=new Error('Picking failed');f.failPick(pickingFailure);
  f.owner.queueCountryHoverPick([30,10],[0,0]);assert.equal(await f.fire(),false);
  assert.equal(f.errors[1][0],pickingFailure);assert.equal(f.queue.calls.length,2);
});

test('GPU object hover publishes accepted geometry only after the Core acknowledgement',async () => {
  const f=gpu(), value=hit('A');const pending=f.owner.setMapHover(value.feature,value.ref);
  assert.deepEqual(f.publications,[]);f.queue.accept(0);assert.equal(await pending,true);
  assert.equal(f.publications[0].feature,value.feature);assert.equal(f.publications[0].ref.key,value.ref.key);
});

test('GPU stale leave preserves another hover and uses the original public expected key',async () => {
  const f=gpu(), a=hit('A'), b=hit('B');
  const enter=f.owner.setMapHover(b.feature,b.ref);f.queue.accept(0);await enter;
  const leave=f.owner.setMapHover(null,a.ref);assert.equal(f.queue.calls[1].options.expectedKey,a.ref.key);
  f.queue.accept(1,b.ref);assert.equal(await leave,false);assert.equal(f.publications.length,1);
  const clear=f.owner.setMapHover(null,b.ref);f.queue.accept(2,null);assert.equal(await clear,true);
  assert.equal(f.publications.at(-1),null);
});

test('GPU delayed hover results cannot replace newer display ownership or cross project and movement boundaries',async () => {
  const f=gpu(), a=hit('A'), b=hit('B');
  const first=f.owner.setMapHover(a.feature,a.ref),second=f.owner.setMapHover(b.feature,b.ref);
  f.queue.accept(1);assert.equal(await second,true);f.queue.packet(0,a.ref);assert.equal(await first,false);
  assert.equal(f.publications.length,1);assert.equal(f.publications[0].ref.id,'B');
  const replaced=f.owner.setMapHover(a.feature,a.ref);f.generation(2);f.queue.accept(2);assert.equal(await replaced,false);
  const moving=f.owner.setMapHover(a.feature,a.ref);f.state.mapMoving=true;f.queue.accept(3);assert.equal(await moving,false);
  assert.equal(f.publications.length,1);
});

test('GPU obsolete hover failures are contained and unexpected failures reach the operation reporter',async () => {
  const f=gpu(), a=hit('A');let pending=f.owner.setMapHover(a.feature,a.ref);
  f.queue.calls[0].reject(Object.assign(new Error('cancelled'),{ cancelled: true }));assert.equal(await pending,false);assert.deepEqual(f.errors,[]);
  pending=f.owner.setMapHover(a.feature,a.ref);const failure=new Error('unavailable owner');
  f.queue.calls[1].reject(failure);assert.equal(await pending,false);assert.equal(f.errors[0][0],failure);assert.equal(f.errors[0][2],'PL-MAP-HOVER-001');
  assert.deepEqual(f.publications,[]);
});

test('missing Core hover dependencies fail through the responsible operation and do not publish display ownership',async () => {
  const f=gpu(),a=hit('A');f.queue.setHover=undefined;
  assert.equal(await f.owner.setMapHover(a.feature,a.ref),false);
  assert.ok(f.errors[0][0] instanceof TypeError);assert.equal(f.errors[0][2],'PL-MAP-HOVER-001');
  assert.deepEqual(f.publications,[]);
});

function labelHandlers() {
  const source=readFileSync(new URL("../../../src/rendering/label-presentation.js",import.meta.url),'utf8');
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
});
contractSuite("map-hover-topology", () => {
const { readFileSync } = __dep1;
const assert = __dep0.default;
const test = __dep2.default;
const vm = __dep3.default;
const { createPointerTargets } = __dep4;
const { normalizeObjectRef } = __dep6;
const { createMapInputPresentation } = __dep7;
const { createTooltipController } = __dep8;
const { createNodeSelection } = __dep9;
const { editorNode } = __dep10;

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../../../assets/js-vendor/d3.min.js", import.meta.url), 'utf8'), sandbox);
const d3 = sandbox.d3;

function node(name, parent = null) {
  const n = { ...editorNode(), name, parent, listeners: new Map() };
  n.addEventListener = (type, fn, options) => {
    const list = n.listeners.get(type) || [];
    list.push({ fn, capture: options === true || options?.capture === true });
    n.listeners.set(type, list);
  };
  n.removeEventListener = (type, fn) => n.listeners.set(type, (n.listeners.get(type) || []).filter(x => x.fn !== fn));
  n.compareDocumentPosition = other => {
    for (let current = n.parent; current; current = current.parent) if (current === other) return 8;
    for (let current = other.parent; current; current = current.parent) if (current === n) return 16;
    return 1;
  };
  n.closest = selector => {
    for (let current = n; current; current = current.parent) {
      if (selector === '#map' && current.name === 'map') return current;
      if (selector === '.territorial-label-item[data-label-id]' && current.name === 'label') return current;
      if (selector === '.user-label' && current.name === 'user-label') return current;
      if (selector === '.draft-interactive' && ['draft-segment', 'draft-insert', 'draft-vertex'].includes(current.name)) return current;
      if (selector === 'path.draft-segment-hit' && current.name === 'draft-segment') return current;
      if (selector === 'g.draft-insert-handle' && current.name === 'draft-insert') return current;
    }
    return null;
  };
  return n;
}

async function fixture(t,{ queuedPicks = false, peerKind = 'city' } = {}) {
  const document = node('document');
  document.documentElement = editorNode();
  document.createElement = editorNode;
  document.getElementById = () => null;
  const map = node('map', document);
  const rect = { left: 40, top: 60, width: 1000, height: 800 };
  map.getBoundingClientRect = () => rect; map.clientLeft = 0; map.clientTop = 0;
  const overlay = node('overlaySvg', map), interaction = node('interactionSvg', map);
  overlay.getBoundingClientRect = () => rect; overlay.clientLeft = 0; overlay.clientTop = 0;
  const label = node('label', interaction);
  label.dataset.labelId = 'DEU';
  const text = node('text', label), hit = node('ground', overlay);
  const window = node('window');
  Object.assign(window, { clearTimeout() {}, matchMedia: () => ({ matches: true }), innerWidth: 1366, innerHeight: 900 });
  const tooltip = editorNode();
  tooltip.id = 'uiTooltip';
  const tip = createTooltipController({ document, window, tooltip, clamp: (v, a, b) => Math.max(a, Math.min(v, b)) });
  tip.bind();
  const ref = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'DEU' });
  let published = 0, areaPicks = 0;
  const points = [], clicks = [];
  const state = { tool: 'select', view: { globeZoom: 1, flatZoom: 1 } };
  let panning = false;
  const owner=await createNodeSelection({territorialIds:['DEU'],genericIds:[],labelIds:['PLACE'],distributionIds:[],onHoverChanged: s => {
    published++;
    tip.setMapHover(s.hover?.domain === 'territorial' ? { name: '독일' } : null);
  } }),domain=owner.domain;
  const hoverTimers=new Map(),originalTimer=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
    if(delay!==50)return originalTimer(callback,delay,...args);
    const token={};hoverTimers.set(token,()=>callback(...args));return token;
  });
  t.mock.method(globalThis,'clearTimeout',token=>{if(!hoverTimers.delete(token))originalClear(token);});
  const settle=async()=>{await owner.client.selectionSnapshot();};
  const runQueuedPicks=async()=>{for(const[token,callback]of hoverTimers){hoverTimers.delete(token);await callback();}await settle();};
  let executedPicks = 0;
  const pointers = createPointerTargets();
  pointers.connect({ domains: { selectionDomain: domain,projectDomain:owner.project }, projectState: { state },
    feedback:{reportOperationError:error=>{throw error;}},
    mapLayout: { viewRevision: 1 },
    objectPicking: { selectableObjectsAt: async () => { executedPicks++; return [ref]; } } });
  pointers.initializeHoverPickFrame();
  const peer = node('user-label', interaction), peerText = node('peer-text', peer);
  peer.__data__ = { id: 'PLACE', kind: peerKind };
  const renderingSource = readFileSync(new URL("../../../src/rendering/label-presentation.js", import.meta.url), 'utf8');
  const start = renderingSource.indexOf("    enter.on('mouseenter.hover'", renderingSource.indexOf('  const renderUserLabels ='));
  const end = renderingSource.indexOf("    enter.append('circle')", start);
  // Register the existing peer-label hover owner with real D3, then allow its
  // mousemove to bubble to the shared map input boundary.
  vm.runInNewContext(renderingSource.slice(start, end), { enter: d3.select(peer),
    labels: { isMobile: () => false }, labelState: () => state, selectionDomain: domain,
    reportDiagnostic:entry=>{throw entry.error;},
    labelRef: value => normalizeObjectRef({ domain: 'label', type: value.kind, id: value.id }) });
  const input = createMapInputPresentation({ window, navigator: {}, getRevision: () => 1,
    createMapInputController: () => ({ destroy() {}, isPanning: () => panning }),
    mapInteractionGate: {},
    ports: { platform: { d3, $: id => id === 'map' ? map : null }, rendering: { gpuMapRenderer: {} },
      projectState: { state, mapWorkScheduler: {} }, domains: { selectionDomain: domain, projectDomain: owner.project },
      renderQuality: {}, pointerInteractionB: {}, navigation: {}, surfaces: { isMobile: () => false },
      mapView: { screenToGeo: () => [10, 49] }, interactionStateCommands: { setHoverHit() {} },
      feedback: { reportOperationError: error => { throw error; } },
      objectPicking: { handleMapClick: point => clicks.push(point), getTerritorialLabelRef: () => ref },
      pointerInteractionA: { cancelCountryHoverPick: pointers.cancelCountryHoverPick, mapClickBlocked: () => false,
        queueCountryHoverPick(point, coord) { areaPicks++; points.push(point); if (queuedPicks) pointers.queueCountryHoverPick(point, coord); else domain.setHover(ref, { source: 'map' }); } },
    },
  });
  input.bindSvg(d3.select(overlay));
  const dispatch = (target, type, extra = {}) => {
    const path = [];
    for (let n = target; n; n = n.parent) path.push(n);
    const event = { type, target, pointerType: 'mouse', buttons: 0, clientX: 100, clientY: 120, relatedTarget: null,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...extra };
    for (const n of path.slice().reverse()) for (const x of n.listeners.get(type) || []) if (x.capture) x.fn.call(n, event);
    for (const n of path) {
      for (const x of n.listeners.get(type) || []) if (!x.capture) x.fn.call(n, event);
      if (event.cancelBubble) break;
    }
    return event;
  };
  const hover = async target => {
    dispatch(target, 'pointermove');
    dispatch(target, 'mousemove');
    await settle();
    return {
      hover: domain.snapshot().hover?.id || null,
      tooltip: tooltip.dataset.kind || null,
      published, areaPicks,
      selectionRevision: domain.snapshot().revision,
    };
  };
  t.after(async()=>{await pointers.cancelCountryHoverPick();input.dispose();await settle();owner.dispose();});
  return { hover,settle,runQueuedPicks,label: text, peer: peerText, hit, map, overlay, interaction, dispatch, points, clicks, input, domain, state, pointers, executedPicks: () => executedPicks, setPanning: value => { panning = value; } };
}

// Reflect app-map-host's actual sibling SVG topology. Real D3 listeners see
// capture/bubble propagation from the hit node; tests never call a handler directly.
test('label hover in the sibling interaction SVG reaches the canonical tooltip and not the ground picker', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.hover(f.label), { hover: 'DEU', tooltip: 'country', published: 1, areaPicks: 0, selectionRevision: 0 });
});

test('ground hover shares the map owner and uses actual map-local D3 pointer coordinates', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.hover(f.hit), { hover: 'DEU', tooltip: 'country', published: 1, areaPicks: 1, selectionRevision: 0 });
  assert.deepEqual(f.points.map(point => [...point]), [[60, 60]]);
  f.dispatch(f.hit, 'click');
  assert.deepEqual(f.clicks.map(point => [...point]), [[60, 60]], 'ground clicks retain one overlay-SVG owner');
});

test('rebinding and disposing remove the shared-map hover listeners without duplicating picks', async t => {
  const f = await fixture(t); f.input.bindSvg(d3.select(f.overlay));
  assert.equal((await f.hover(f.hit)).areaPicks, 1);
  f.input.dispose(); await f.domain.setHover(null);
  assert.equal((await f.hover(f.label)).hover, null);
  assert.equal((await f.hover(f.hit)).areaPicks, 1);
});

test('shared-map mouseleave clears hover without a stale map pick', async t => {
  const f = await fixture(t); await f.hover(f.label);
  // Browsers emit both; D3 uses mouseout to emulate leave without a native probe.
  f.dispatch(f.map, 'mouseout'); f.dispatch(f.map, 'mouseleave');
  await f.settle();
  assert.equal(f.domain.snapshot().hover, null);
  assert.equal(f.domain.size(), 0);
});

for (const peerKind of ['city', 'label']) for (const moveWithinLabel of [false, true]) test(`shared hover preserves ${peerKind} labels and cancels stale queued country picks (move=${moveWithinLabel})`, async t => {
  const f = await fixture(t,{ queuedPicks: true, peerKind });
  t.after(() => { f.pointers.cancelCountryHoverPick(); f.input.dispose(); });
  await f.hover(f.hit);
  assert.equal(f.domain.snapshot().hover, null, 'ground pick is still queued');
  f.dispatch(f.peer, 'mouseover'); f.dispatch(f.peer, 'mouseenter');
  await f.settle();
  assert.equal(f.domain.snapshot().hover.key, `label:${peerKind}:PLACE`);
  if (moveWithinLabel) assert.equal((await f.hover(f.peer)).tooltip, null);
  await f.runQueuedPicks();
  assert.equal(f.domain.snapshot().hover.key, `label:${peerKind}:PLACE`, 'a stale ground result must not overwrite peer-label hover');
  assert.equal(f.executedPicks(), 0);
  assert.equal((await f.hover(f.peer)).areaPicks, 1, 'movement within a peer label must not queue new ground picks');
  f.dispatch(f.peer, 'mouseout'); f.dispatch(f.peer, 'mouseleave');
  await f.settle();
  assert.equal(f.domain.snapshot().hover, null);
  await f.hover(f.hit);
  await f.runQueuedPicks();
  assert.equal(f.domain.snapshot().hover.key, 'territorial:entity:DEU');
  assert.equal(f.executedPicks(), 1);
  assert.equal((await f.hover(f.label)).tooltip, 'country');
  assert.equal(f.domain.size(), 0); assert.equal(f.domain.snapshot().revision, 0);
});
});
});
contractSuite("app-spatial-canonical-picking", () => {
const { testCoreProject, initializeTestTerritorialState } = __merge_dep11;
const assert = __merge_dep1.default;
const test = __merge_dep0.default;
const { createSpatialIndex } = __merge_dep12;
const { createMapObjectSpatialIndex } = __merge_dep13;
const { createTerritorialFeature } = __merge_dep14;
const { createTerritorialEntityStore } = __merge_dep15;
const { createTerritorialEntityRepository } = __merge_dep16;
const { createTerritorialScopeResolver } = __merge_dep17;

const square = x => ({ type: 'Polygon', coordinates: [[[x, 0], [x, 10], [x + 10, 10], [x + 10, 0], [x, 0]]] });

test('territorial spatial candidates and display follow canonical store hydration', async () => {
  const preview = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(20) });
  const canonical = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0) });
  const state = { territorialEntities: [preview], countryVisualPhase: 'preview',
    labels: [], genericFeatures: [], hydroEdits: [] };
  await initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state, clipper: () => null });
  const spatial = createSpatialIndex();
  spatial.connect({ projectState: { state }, territorialModel: { entityRepository }, objectModelB: { territorialScope },
    domains: { renderingDomain: { getDistributionRenderRows: () => [] } },
    spatialFactories: { createMapObjectSpatialIndex }, cutGeometry: { coordinateBounds: coordinates => {
      const points = coordinates.flat(2);
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    } } });
  spatial.initializeGeometryBoundsCache();
  spatial.initializeMapObjectSpatialIndex();
  const candidates = x => spatial.mapObjectSpatialIndex.query([x + 4, 4, x + 6, 6], { domains: ['territorial'] }).map(row => row.id);
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(candidates(20), ['A']);
  assert.deepEqual(candidates(0), []);

  await testCoreProject(state).project.admit(testCoreProject(state).project.snapshot(),{ features:[canonical],preserveCursor:true });
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(territorialScope.displayFeature('A').geometry, canonical.geometry);
  assert.deepEqual(candidates(0), ['A']);
  assert.deepEqual(candidates(20), []);
  state.countryVisualPhase = 'canonical';
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(candidates(0), ['A']);
  state.countryVisualPhase = 'preview';
  spatial.rebuildMapObjectSpatialIndex();
  assert.deepEqual(candidates(0), ['A']);
  assert.deepEqual(candidates(20), []);
  assert.deepEqual(entityRepository.get('A').geometry, canonical.geometry);
});
});
