import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createPointerTargets } from "../../shared/frontend/js/modules/pointer-targets.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createMapInputPresentation } from "../../shared/frontend/js/modules/map-input-presentation.js";
import { createTooltipController } from "../../shared/frontend/js/modules/tooltip-controller.js";
import {createNodeSelection} from '../helpers/core-selection.mjs';
import { createTestEditingDomain as createEditingDomain } from '../helpers/editing-domain.mjs';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../../shared/frontend/js/vendor/d3.min.js", import.meta.url), 'utf8'), sandbox);
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

async function fixture(t,{ queuedPicks = false, peerKind = 'city', editing = null } = {}) {
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
  const points = [], clicks = [], draftEvents = [];
  const state = { tool: 'select', view: { globeZoom: 1, flatZoom: 1 } };
  const draft = {};
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
  const pointers = createPointerTargets({isDraggingDraft:()=>draft.dragging});
  pointers.connect({ domains: { selectionDomain: domain,projectDomain:owner.project }, projectState: { state },
    feedback:{reportOperationError:error=>{throw error;}},
    draftPresentation: { editingDraftSnapshot: () => draft }, mapLayout: { viewRevision: 1 },
    objectPicking: { selectableObjectsAt: async () => { executedPicks++; return [ref]; } } });
  pointers.initializeHoverPickFrame();
  const peer = node('user-label', interaction), peerText = node('peer-text', peer);
  peer.__data__ = { id: 'PLACE', kind: peerKind };
  const renderingSource = readFileSync(new URL("../../shared/frontend/js/modules/label-presentation.js", import.meta.url), 'utf8');
  const start = renderingSource.indexOf("    enter.on('mouseenter.hover'", renderingSource.indexOf('  const renderUserLabels ='));
  const end = renderingSource.indexOf("    enter.append('circle')", start);
  // Register the existing peer-label hover owner with real D3, then allow its
  // mousemove to bubble to the shared map input boundary.
  vm.runInNewContext(renderingSource.slice(start, end), { enter: d3.select(peer),
    labels: { isMobile: () => false }, labelState: () => state, selectionDomain: domain,
    reportDiagnostic:entry=>{throw entry.error;},
    labelRef: value => normalizeObjectRef({ domain: 'label', type: value.kind, id: value.id }) });
  const input = createMapInputPresentation({ productMode: 'editor', window, navigator: {}, getRevision: () => 1,
    createMapInputController: () => ({ destroy() {}, isPanning: () => panning }),
    mapInteractionGate: {}, editing: { getDraftSnapshot: () => editing ? editing.snapshot().draft : draft,
      domain: editing || { clearDraftHover: async () => false,cancelActiveGesture: async () => false },
      isGenericFeatureDraftTool: () => false, dispatchInteraction: (...args) => draftEvents.push(args) },
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
  return { hover,settle,runQueuedPicks,label: text, peer: peerText, hit, map, overlay, interaction, dispatch, points, clicks, input, domain, state, draft, draftEvents, pointers, executedPicks: () => executedPicks, setPanning: value => { panning = value; } };
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

test('shared-map mouseleave clears hover and draft movement retains one map-local dispatch', async t => {
  const f = await fixture(t); await f.hover(f.label);
  // Browsers emit both; D3 uses mouseout to emulate leave without a native probe.
  f.dispatch(f.map, 'mouseout'); f.dispatch(f.map, 'mouseleave');
  await f.settle();
  assert.equal(f.domain.snapshot().hover, null);
  f.draftEvents.length = 0;
  f.state.tool = 'annex-territory';
  f.state.territorySelectionSession = { tool: 'annex-territory', stage: 'selection', activePhase: 'drawing', activeMethod: 'line' };
  Object.assign(f.draft, { inputPhase: 'draw', coords: [[0, 0]] });
  await f.hover(f.label);
  assert.equal(f.draftEvents.length, 1);
  assert.equal(f.draftEvents[0][0], 'draft-hover-move');
  assert.deepEqual([...f.draftEvents[0][1].screenPoint], [60, 60]);
  f.setPanning(true); await f.hover(f.hit);
  assert.equal(f.draftEvents.length, 1, 'panning cannot add draft points');
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

async function draftFixture(t, tool) {
  const pendingInteractions=[];
  const editing = createEditingDomain({ draftServices: {
    getToolConfig: () => ({ shape: 'line' }), projectCoordinate: point => point, screenToCoordinate: point => point,
  } });
  await editing.setTool(tool);
  await editing.replaceDraftCoordinates([[0, 0], [100, 0]], { inputPhase: 'refine' });
  const f = await fixture(t,{ editing: { ...editing,clearDraftHover(reason) {
    const operation=editing.clearDraftHover(reason);pendingInteractions.push(operation);return operation;
  } } }); f.state.tool = tool;
  const root = node('draft-layer', f.interaction);
  const segment = node('draft-segment', root), handle = node('draft-insert', root), vertex = node('draft-vertex', root);
  for (const item of [segment, handle, vertex]) item.parentNode = root;
  segment.__data__ = handle.__data__ = { segmentIndex: 0 };
  vertex.__data__ = { index: 1 };
  const handleHit = node('handle-hit', handle), vertexHit = node('vertex-hit', vertex);
  const events = [];
  const source = readFileSync(new URL("../../apps/editor/frontend/js/modules/editing-presentation.js", import.meta.url), 'utf8');
  const context = {
    d3, segment, handle, vertex, interaction: { d3 }, layer: { node: () => root }, isMobile: () => false,
    getPacket:()=>editing.createRenderPacket(),
    localEditingPoint: () => d3.mouse(f.overlay),
    stop: () => { d3.event.preventDefault(); d3.event.stopPropagation(); },
    publishEditingInteraction: event => {
      events.push(event.type);
      const packet = editing.createRenderPacket();
      const operation=editing.handleInteraction({ ...event, projectGeneration: packet.projectGeneration, packetRevision: packet.revision });
      pendingInteractions.push(operation);return operation;
    },
  };
  // Use the renderer's actual control handlers with real D3 registration and
  // propagation through the sibling interaction SVG into the common map.
  let start = source.indexOf("      .on('mousemove', d =>", source.indexOf("joinEditingNodes(layer, 'path.draft-segment-hit'"));
  let end = source.indexOf('    const vertices =', start);
  vm.runInNewContext('d3.select(segment)' + source.slice(start, end), context);
  start = source.indexOf("      .on('click', function()", source.indexOf('  const renderDraftInsertionHandle ='));
  end = source.indexOf('    return true;', start);
  vm.runInNewContext('d3.select(handle)' + source.slice(start, end), context);
  start = source.indexOf("      .on('click', d =>", source.indexOf('    const vertices =', end));
  end = source.indexOf('    vertices.each', start);
  vm.runInNewContext('d3.select(vertex)' + source.slice(start, end), context);
  t.after(() => { f.input.dispose(); editing.dispose(); });
  const settle=() => Promise.all(pendingInteractions.splice(0));
  return { ...f, editing, segment, handle, handleHit, vertexHit, events,
    async hover(target) { const result=await f.hover(target);await settle();return result; },
    async dispatch(...args) { const event=f.dispatch(...args);await f.settle();await settle();return event; } };
}

for (const tool of ['draw-territorial-unit', 'river']) test(`shared map preserves ${tool} segment, insertion and vertex control ownership`, async t => {
  const f = await draftFixture(t, tool);
  const before = f.editing.snapshot().draft;
  await f.hover(f.segment);
  const target = { segmentIndex: 0, coordinate: [60, 0] };
  assert.deepEqual(f.editing.snapshot().draft.insertTarget, target);
  await f.dispatch(f.segment, 'mouseout', { relatedTarget: f.handleHit });
  await f.hover(f.handleHit);
  assert.deepEqual(f.editing.snapshot().draft.insertTarget, target, 'bubbling movement must preserve the handle target');
  assert.deepEqual(f.events, ['draft-segment-hover']);
  const click = await f.dispatch(f.handleHit, 'click');
  assert.equal(click.defaultPrevented, true); assert.equal(click.cancelBubble, true);
  assert.deepEqual(f.editing.snapshot().draft.coords, [[0, 0], [60, 0], [100, 0]]);
  assert.equal(f.editing.snapshot().draft.historyCount, before.historyCount + 1);
  await f.hover(f.vertexHit); await f.dispatch(f.vertexHit, 'click');
  assert.equal(f.editing.snapshot().draft.selectedVertexIndex, 1);
  assert.deepEqual(f.events, ['draft-segment-hover', 'draft-insert-request', 'draft-vertex-select']);
  assert.equal(f.editing.snapshot().draft.historyCount, before.historyCount + 1);
  assert.deepEqual(f.clicks, []); assert.deepEqual(f.draftEvents, []);
  assert.equal(f.domain.size(), 0); assert.equal(f.domain.snapshot().revision, 0);
  assert.equal(await f.editing.performDraftUndo(), true);
  assert.deepEqual(f.editing.snapshot().draft.coords, before.coords);
});

test('draft controls retain leave cleanup and the map still clears insertion during panning', async t => {
  const f = await draftFixture(t, 'draw-territorial-unit');
  await f.hover(f.segment);
  assert.notEqual(f.editing.snapshot().draft.insertTarget, null);
  await f.dispatch(f.segment, 'mouseout', { relatedTarget: f.handleHit });
  await f.dispatch(f.handle, 'mouseout', { relatedTarget: f.hit });
  assert.equal(f.editing.snapshot().draft.insertTarget, null);
  await f.hover(f.segment);
  assert.notEqual(f.editing.snapshot().draft.insertTarget, null);
  f.setPanning(true); await f.hover(f.hit);
  assert.equal(f.editing.snapshot().draft.insertTarget, null);
  assert.deepEqual(f.editing.snapshot().draft.coords, [[0, 0], [100, 0]]);
});
