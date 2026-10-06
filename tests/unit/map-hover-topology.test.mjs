import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createPointerTargets } from '../../assets/js/modules/app-pointer-targets.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createMapInputPresentation } from '../../assets/js/modules/map-input-presentation.js';
import { createTooltipController } from '../../assets/js/modules/tooltip-controller.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

const sandbox = {};
vm.runInNewContext(readFileSync(new URL('../../assets/js/vendor/d3.min.js', import.meta.url), 'utf8'), sandbox);
const d3 = sandbox.d3;

function node(name, parent = null) {
  const n = { ...editorNode(), name, parent, listeners: new Map() };
  n.addEventListener = (type, fn, options) => {
    const list = n.listeners.get(type) || [];
    list.push({ fn, capture: options === true || options?.capture === true });
    n.listeners.set(type, list);
  };
  n.removeEventListener = (type, fn) => n.listeners.set(type, (n.listeners.get(type) || []).filter(x => x.fn !== fn));
  n.closest = selector => {
    for (let current = n; current; current = current.parent) {
      if (selector === '#map' && current.name === 'map') return current;
      if (selector === '.territorial-label-item[data-label-id]' && current.name === 'label') return current;
      if (selector === '.user-label' && current.name === 'user-label') return current;
    }
    return null;
  };
  return n;
}

function fixture({ queuedPicks = false, peerKind = 'city' } = {}) {
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
  const ref = { domain: 'territorial', type: 'entity', id: 'DEU' };
  let published = 0, areaPicks = 0;
  const points = [], clicks = [], draftEvents = [];
  const state = { tool: 'select' };
  const draft = {};
  let panning = false;
  const domain = createSelectionDomain({ onHoverChanged: s => {
    published++;
    tip.setMapHover(s.hover?.domain === 'territorial' ? { name: '독일' } : null);
  } });
  let executedPicks = 0;
  const pointers = createPointerTargets();
  pointers.connect({ domains: { selectionDomain: domain }, projectState: { state },
    draftPresentation: { editingDraftSnapshot: () => draft }, mapLayout: { viewRevision: 1 },
    objectPicking: { territorialObjectsAt: () => { executedPicks++; return [{ ref }]; } } });
  pointers.initializeHoverPickFrame();
  const peer = node('user-label', interaction), peerText = node('peer-text', peer);
  peer.__data__ = { id: 'PLACE', kind: peerKind };
  const renderingSource = readFileSync(new URL('../../assets/js/modules/rendering-domain.js', import.meta.url), 'utf8');
  const start = renderingSource.indexOf("    enter.on('mouseenter.hover'", renderingSource.indexOf('  const renderUserLabels ='));
  const end = renderingSource.indexOf("    enter.append('circle')", start);
  // Register the existing peer-label hover owner with real D3, then allow its
  // mousemove to bubble to the shared map input boundary.
  vm.runInNewContext(renderingSource.slice(start, end), { enter: d3.select(peer),
    labels: { isMobile: () => false }, labelState: () => state, selectionDomain: domain,
    labelRef: value => normalizeObjectRef({ domain: 'label', type: value.kind, id: value.id }) });
  const input = createMapInputPresentation({
    getElement: () => map, window, navigator: {}, d3,
    createMapInputController: () => ({ destroy() {}, isPanning: () => panning }),
    getInputSnapshot: () => state, getDraftSnapshot: () => draft,
    isMobile: () => false, isGenericFeatureDraftTool: () => false,
    screenToGeo: () => [10, 49], getTerritorialLabelRef: () => ref,
    cancelCountryHoverPick: pointers.cancelCountryHoverPick, clearHoverHit() {}, dispatchEditingInteraction: (...args) => draftEvents.push(args), mapClickBlocked: () => false,
    handleMapClick: point => clicks.push(point),
    queueCountryHoverPick(point, coord) { areaPicks++; points.push(point); if (queuedPicks) pointers.queueCountryHoverPick(point, coord); else domain.setHover(ref, { source: 'map' }); },
    selectionDomain: domain,
  });
  input.bindSvg(d3.select(overlay));
  const dispatch = (target, type) => {
    const path = [];
    for (let n = target; n; n = n.parent) path.push(n);
    const event = { type, target, pointerType: 'mouse', buttons: 0, clientX: 100, clientY: 120, relatedTarget: null };
    for (const n of path.slice().reverse()) for (const x of n.listeners.get(type) || []) if (x.capture) x.fn.call(n, event);
    for (const n of path) for (const x of n.listeners.get(type) || []) if (!x.capture) x.fn.call(n, event);
  };
  const hover = target => {
    dispatch(target, 'pointermove');
    dispatch(target, 'mousemove');
    return {
      hover: domain.snapshot().hover?.id || null,
      tooltip: tooltip.dataset.kind || null,
      published, areaPicks,
      selectionRevision: domain.snapshot().revision,
    };
  };
  return { hover, label: text, peer: peerText, hit, map, overlay, dispatch, points, clicks, input, domain, state, draft, draftEvents, pointers, executedPicks: () => executedPicks, setPanning: value => { panning = value; } };
}

// Reflect app-map-host's actual sibling SVG topology. Real D3 listeners see
// capture/bubble propagation from the hit node; tests never call a handler directly.
test('label hover in the sibling interaction SVG reaches the canonical tooltip and not the ground picker', () => {
  const f = fixture();
  assert.deepEqual(f.hover(f.label), { hover: 'DEU', tooltip: 'country', published: 1, areaPicks: 0, selectionRevision: 0 });
});

test('ground hover shares the map owner and uses actual map-local D3 pointer coordinates', () => {
  const f = fixture();
  assert.deepEqual(f.hover(f.hit), { hover: 'DEU', tooltip: 'country', published: 1, areaPicks: 1, selectionRevision: 0 });
  assert.deepEqual(f.points.map(point => [...point]), [[60, 60]]);
  f.dispatch(f.hit, 'click');
  assert.deepEqual(f.clicks.map(point => [...point]), [[60, 60]], 'ground clicks retain one overlay-SVG owner');
});

test('rebinding and disposing remove the shared-map hover listeners without duplicating picks', () => {
  const f = fixture(); f.input.bindSvg(d3.select(f.overlay));
  assert.equal(f.hover(f.hit).areaPicks, 1);
  f.input.dispose(); f.domain.setHover(null);
  assert.equal(f.hover(f.label).hover, null);
  assert.equal(f.hover(f.hit).areaPicks, 1);
});

test('shared-map mouseleave clears hover and draft movement retains one map-local dispatch', () => {
  const f = fixture(); f.hover(f.label);
  // Browsers emit both; D3 uses mouseout to emulate leave without a native probe.
  f.dispatch(f.map, 'mouseout'); f.dispatch(f.map, 'mouseleave');
  assert.equal(f.domain.snapshot().hover, null);
  f.draftEvents.length = 0;
  f.state.tool = 'annex-territory';
  f.state.territorySelectionSession = { tool: 'annex-territory', stage: 'selection', activePhase: 'drawing', activeMethod: 'line' };
  Object.assign(f.draft, { inputPhase: 'draw', coords: [[0, 0]] });
  f.hover(f.label);
  assert.equal(f.draftEvents.length, 1);
  assert.equal(f.draftEvents[0][0], 'draft-hover-move');
  assert.deepEqual([...f.draftEvents[0][1].screenPoint], [60, 60]);
  f.setPanning(true); f.hover(f.hit);
  assert.equal(f.draftEvents.length, 1, 'panning cannot add draft points');
  assert.equal(f.domain.size(), 0);
});

for (const peerKind of ['city', 'label']) for (const moveWithinLabel of [false, true]) test(`shared hover preserves ${peerKind} labels and cancels stale queued country picks (move=${moveWithinLabel})`, async t => {
  const f = fixture({ queuedPicks: true, peerKind });
  t.after(() => { f.pointers.cancelCountryHoverPick(); f.input.dispose(); });
  f.hover(f.hit);
  assert.equal(f.domain.snapshot().hover, null, 'ground pick is still queued');
  f.dispatch(f.peer, 'mouseover'); f.dispatch(f.peer, 'mouseenter');
  assert.equal(f.domain.snapshot().hover.key, `label:${peerKind}:PLACE`);
  if (moveWithinLabel) assert.equal(f.hover(f.peer).tooltip, null);
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(f.domain.snapshot().hover.key, `label:${peerKind}:PLACE`, 'a stale ground result must not overwrite peer-label hover');
  assert.equal(f.executedPicks(), 0);
  assert.equal(f.hover(f.peer).areaPicks, 1, 'movement within a peer label must not queue new ground picks');
  f.dispatch(f.peer, 'mouseout'); f.dispatch(f.peer, 'mouseleave');
  assert.equal(f.domain.snapshot().hover, null);
  f.hover(f.hit);
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(f.domain.snapshot().hover.key, 'territorial:entity:DEU');
  assert.equal(f.executedPicks(), 1);
  assert.equal(f.hover(f.label).tooltip, 'country');
  assert.equal(f.domain.size(), 0); assert.equal(f.domain.snapshot().revision, 0);
});
