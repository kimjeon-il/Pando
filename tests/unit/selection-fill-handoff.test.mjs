import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';
import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';

// Only the DOM/D3 adapter and render device are doubles; selection planning,
// staging, coordinator invalidation and accepted-frame reconciliation are real.
function svgFixture() {
  let stages = 0;
  const document = { createElementNS: (_namespace, tagName) => {
    if (tagName === 'g') stages++;
    const attributes = new Map();
    const node = { tagName, ownerDocument: document, childNodes: [], parentNode: null,
      get firstChild() { return this.childNodes[0] || null; },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      appendChild(child) { child.remove(); child.parentNode = this; this.childNodes.push(child); return child; },
      insertBefore(child, before) { child.remove(); child.parentNode = this; this.childNodes.splice(Math.max(0, this.childNodes.indexOf(before)), 0, child); },
      replaceChildren(...children) { for (const child of [...this.childNodes]) child.remove(); for (const child of children) this.appendChild(child); },
      remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; },
      querySelectorAll(selector) {
        const matches = candidate => selector.split(',').some(part => {
          const tag = part.trim().match(/^[a-z]+/)?.[0];
          const classes = [...part.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
          const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
          return (!tag || candidate.tagName === tag) && classes.every(name => candidate.classList.contains(name))
            && attrs.every(([, name, value]) => candidate.getAttribute(name) !== null && (value === undefined || candidate.getAttribute(name) === value));
        });
        return this.childNodes.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    };
    node.classList = { contains: name => (attributes.get('class') || '').split(/\s+/).includes(name) };
    return node;
  } };
  const select = nodes => {
    nodes = Array.isArray(nodes) ? nodes : [nodes];
    const chain = {
      node: () => nodes[0], nodes: () => nodes,
      selectAll: selector => select(nodes.flatMap(node => node.querySelectorAll(selector))),
      append: tag => select(nodes.map(node => node.appendChild(document.createElementNS('', tag)))),
      datum: value => { for (const node of nodes) node.__data__ = value; return chain; },
      attr: (name, value) => { for (const node of nodes) node.setAttribute(name, typeof value === 'function' ? value.call(node, node.__data__) : value); return chain; },
      filter: callback => select(nodes.filter(node => callback.call(node, node.__data__))),
      each: callback => { for (const node of nodes) callback.call(node, node.__data__); return chain; },
      remove: () => { for (const node of nodes) node.remove(); return chain; },
    };
    return chain;
  };
  return { document, d3: { select }, root: () => document.createElementNS('', 'g'), stages: () => stages };
}

function harness(t) {
  const svg = svgFixture(), selected = svg.root(), hovered = svg.root(), queued = [];
  const feature = id => ({ type: 'Feature', id, properties: { entityKind: 'general', parentId: '' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const features = new Map(['DEU', 'FRA'].map(id => [id, feature(id)]));
  const state = { territorialEntities: [...features.values()] };
  const selection = createSelectionDomain();
  const selectionPass = createSelectionPass();
  selectionPass.handleContextLost();
  selection.replace({ domain: 'territorial', type: 'entity', id: 'DEU' });
  selection.setHover({ domain: 'territorial', type: 'entity', id: 'FRA' });
  const snapshot = selection.snapshot(), modelBefore = structuredClone(state);
  // The real renderer starts in pending before a scene renderer takes ownership.
  // Keep stale SVG presentation coverage separate from context recovery.
  let renderer = 'pending', presented, currentFrame, interactionRenders = 0;
  const result = () => renderer === 'canvas-worker' ? { deferred: true, frameId: currentFrame.frameId } : null;
  const rendering = createRenderingDomain({
    requestFrame: callback => queued.push(callback), selectionDomain: selection,
    prepareView: ({ frameId }) => (currentFrame = createMapVisualFrame({ frameId, projectGeneration: 3, viewRevision: 1,
      viewState: { projection: 'flat', size: { width: 300, height: 200 }, translate: [150, 100], scale: 40, dpr: 1 },
      projectPath: () => 'M0,0L1,0L1,1Z' })),
    renderers: { view: result },
    gpuMapRenderer: { getRuntimeState: () => ({ renderer }), setFramePresentationListener: callback => { presented = callback; },
      renderInteraction: () => { interactionRenders++; return result(); } },
    selectionResources: { document: svg.document, d3: svg.d3, selectionPass,
      selectionLayer: svg.d3.select(selected), hoverLayer: svg.d3.select(hovered),
      getState: () => state, getInteractionStyle: resolveMapInteractionStyle,
      territorialEntityById: id => features.get(id), territorialDisplayFeature: id => features.get(id),
      mapFeatureForObjectRef: ref => features.get(ref.id), countryOutlineFeature: value => value,
    },
  });
  t.after(() => { rendering.dispose(); selection.dispose(); });
  const render = method => { rendering[method]('selection-fill-handoff'); assert.ok(queued.length); queued.shift()();
    assert.equal(rendering.getSelectionRenderStats().failureCount, 0); return currentFrame; };
  const nodes = selector => [...selected.querySelectorAll(selector), ...hovered.querySelectorAll(selector)];
  const verifyCanonical = () => { assert.strictEqual(selection.snapshot(), snapshot); assert.deepEqual(state, modelBefore); };
  const accept = (frame, overrides = {}) => presented({ frameId: frame.frameId, viewRevision: frame.viewRevision,
    projectionRevision: frame.projectionRevision, projectGeneration: frame.projectGeneration, renderer, ...overrides });
  return { render, nodes, accept, verifyCanonical, stages: svg.stages, rendering,
    interactionRenders: () => interactionRenders, setRenderer: value => { renderer = value; } };
}

const fillSelector = '.map-selection-fill, .map-hover-fill';
const outlineSelector = '.map-selection-outline, .map-hover-outline';

test('first accepted Canvas Worker frame retires pending-startup fills while preserving selection and outline fallback', t => {
  const h = harness(t);
  h.render('invalidateGpuContext');
  assert.equal(h.nodes(fillSelector).length, 2, 'pending startup provides temporary selection and hover emphasis');
  assert.equal(h.nodes(outlineSelector).length, 2);
  h.setRenderer('canvas-worker');
  const first = h.render('invalidateGpuFrame');
  const later = h.render('invalidateGpuFrame');
  h.render('invalidateLabels');
  assert.equal(h.nodes(fillSelector).length, 2, 'submission is not accepted presentation');
  assert.equal(h.accept(first, { projectGeneration: 99 }), false);
  assert.equal(h.nodes(fillSelector).length, 2, 'rejected frames cannot take ownership');
  assert.equal(h.accept(first), true);
  assert.equal(h.nodes(fillSelector).length, 0, 'first accepted bitmap must retire both SVG fills');
  assert.equal(h.nodes(outlineSelector).length, 2, 'Canvas needs the existing SVG outline fallback');
  assert.ok(h.nodes(outlineSelector).every(node => node.getAttribute('fill') === 'none'));
  assert.equal(h.rendering.getStats().lastCommittedVisualFrameId, first.frameId);
  const stages = h.stages();
  assert.equal(h.accept(later), true);
  assert.equal(h.stages(), stages, 'a newer same-view frame does not rebuild the settled owner');
  h.verifyCanonical();
});

test('deferred view changes retain pending-startup emphasis until acceptance, then stable Canvas views reuse their SVG outlines', t => {
  const h = harness(t);
  h.render('invalidateGpuContext');
  h.setRenderer('canvas-worker');
  const first = h.render('invalidateView');
  assert.equal(h.nodes(fillSelector).length, 2);
  assert.equal(h.accept(first), true);
  assert.equal(h.nodes(fillSelector).length, 0);
  const outlines = h.nodes(outlineSelector), stages = h.stages(), renders = h.interactionRenders();
  const next = h.render('invalidateView');
  assert.equal(h.accept(next), true);
  assert.equal(h.stages(), stages, 'stable owner must not rebuild selection staging');
  assert.deepEqual(h.nodes(outlineSelector), outlines, 'view reuse preserves outline nodes');
  assert.equal(h.interactionRenders(), renders, 'presentation must not submit another scene frame');
  h.verifyCanonical();
});

test('synchronous Canvas2D scene redraw reconciles pending-startup fill ownership without a selection change', t => {
  const h = harness(t);
  h.render('invalidateGpuContext');
  assert.equal(h.nodes(fillSelector).length, 2);
  h.setRenderer('canvas2d');
  h.render('invalidateGpuFrame');
  assert.equal(h.nodes(fillSelector).length, 0);
  assert.equal(h.nodes(outlineSelector).length, 2);
  const outlines = h.nodes(outlineSelector), stages = h.stages();
  h.render('invalidateView');
  assert.equal(h.stages(), stages);
  assert.deepEqual(h.nodes(outlineSelector), outlines);
  h.verifyCanonical();
});

async function directFallbackHarness(t, { canvasWorker = false, pendingGeometry = false } = {}) {
  const globals = ['window', 'document', 'Worker', 'OffscreenCanvas', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const svg = svgFixture(), selected = svg.root(), hovered = svg.root();
  const queued = [], timers = new Map(), workers = [], backgroundFrames = new Map();
  let rendering, canvas, contextLost = false, scenePaints = 0, nextId = 0;
  t.after(() => {
    rendering?.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const gl = new Proxy({ getContextAttributes: () => ({ stencil: true }), isContextLost: () => contextLost,
    getShaderParameter: () => true, getProgramParameter: () => true, getParameter: () => 4096,
    getExtension: () => null, getAttribLocation: () => 0, getUniformLocation: () => ({}),
  }, { get: (target, name) => name in target ? target[name] : String(name).startsWith('create') ? () => ({}) : () => {} });
  const createCanvas = () => {
    const listeners = new Map();
    const node = { ownerDocument: document, width: 300, height: 200, style: {}, isConnected: true,
      setAttribute() {}, replaceWith(replacement) { canvas = replacement; },
      addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type),
      dispatch: type => listeners.get(type)?.({ currentTarget: node, preventDefault() {} }),
    };
    const context = new Proxy({ canvas: node }, { get: (target, name) => name in target ? target[name] : () => {} });
    node.getContext = kind => ['webgl2', 'webgl', 'experimental-webgl'].includes(kind) ? gl : context;
    return node;
  };
  const document = { ...svg.document, addEventListener() {}, removeEventListener() {}, createElement: () => createCanvas() };
  class FakeWorker {
    constructor(url, options) { this.name = options.name; this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  Object.assign(globalThis, { document, window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    Worker: FakeWorker, OffscreenCanvas: canvasWorker ? class { constructor() { return createCanvas(); } } : undefined,
    requestAnimationFrame: callback => { const id = ++nextId; backgroundFrames.set(id, callback); return id; },
    cancelAnimationFrame: id => backgroundFrames.delete(id),
  });
  const features = ['DEU', 'FRA'].map(id => ({ type: 'Feature', id, properties: { entityKind: 'general', parentId: '' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }));
  const byId = id => features.find(feature => feature.id === id);
  const state = { projection: 'flat', countryVisualPhase: 'canonical', size: { width: 300, height: 200 }, view: { flatZoom: 1, globeZoom: 1 },
    territorialEntities: features, pendingCountryRenderIds: new Set(), physicalSettings: { terrainVisible: false, terrainStyle: 'physical' },
    physicalLoadState: {}, layerVisibility: { countries: true, rivers: false, lakes: false }, itemVisibility: { countries: {} },
    hydroEdits: [], stateRevision: 0,
  };
  const theme = { defaultLand: '#eee', baseLandAlpha: 1, countryColorAlpha: 1, borderAlpha: 1,
    border: '#777', strokes: { country: { width: 1, alpha: 1 } } };
  const selection = createSelectionDomain(), selectionPass = createSelectionPass();
  selection.replace({ domain: 'territorial', type: 'entity', id: 'DEU' });
  selection.setHover({ domain: 'territorial', type: 'entity', id: 'FRA' });
  const snapshot = selection.snapshot(), model = structuredClone(features), scheduledReasons = [];
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => new URL(path, 'https://example.test/assets/js/'),
    isMobile: () => false, isSafeKoreanErrorMessage: () => true, mapTheme: () => theme, getSystemTheme: () => 'light',
    deepClone: structuredClone, hydroVisibilityThreshold: () => 0, mapWorkScheduler: { cancel() {} },
    createCountryFillResolver: () => () => ({ color: '#eee', fillAlpha: 0 }),
    renderCountryFeatures: () => features, renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    countryOutlineFeature: value => value, isLayerItemVisible: () => true, setActionStatus() {},
    renderViewFrame: () => rendering.invalidateGpuFrame('view-frame'),
    scheduleGpuFrame: reason => { scheduledReasons.push(reason); rendering.invalidateGpuFrame(reason); },
    scheduleGpuInteractionFrame: reason => { scheduledReasons.push(reason); rendering.invalidateGpuInteraction(reason); },
    rendererUi: { createCanvas, setEngineStatus() {}, getMapElement: () => null,
      onContextStateChange: phase => rendering.invalidateGpuContext(phase) },
  });
  canvas = createCanvas(); renderer.attach(canvas);
  rendering = createRenderingDomain({ gpuMapRenderer: renderer, selectionDomain: selection,
    requestFrame: callback => queued.push(callback),
    prepareView: ({ frameId }) => createMapVisualFrame({ frameId, viewRevision: 1, projectGeneration: 0,
      viewState: { ...state, translate: [150, 100], scale: 40, dpr: 1 }, projectPath: () => 'M0,0L1,0L1,1Z',
      createCanvasPath: context => { if (context.canvas === canvas) scenePaints++; return () => {}; } }),
    renderers: { view: frame => renderer.renderFrame(frame) },
    selectionResources: { document: svg.document, d3: svg.d3, selectionPass,
      selectionLayer: svg.d3.select(selected), hoverLayer: svg.d3.select(hovered), getState: () => state,
      getInteractionStyle: resolveMapInteractionStyle, territorialEntityById: byId, territorialDisplayFeature: byId,
      mapFeatureForObjectRef: ref => byId(ref.id), countryOutlineFeature: value => value },
  });
  assert.equal(await renderer.initialize({ allowPreview: false }), true);
  renderer.setSelectionPass(selectionPass);
  assert.equal(renderer.getRuntimeState().renderer, 'webgl2');
  contextLost = true; canvas.dispatch('webglcontextlost');
  assert.equal(renderer.getRuntimeState().renderer, 'webgl-recovering');
  assert.equal(queued.length, 1); queued.shift()();
  // Initial country emphasis can invalidate its own interaction packet once.
  if (queued.length) queued.shift()();
  const nodes = selector => [...selected.querySelectorAll(selector), ...hovered.querySelectorAll(selector)];
  assert.equal(rendering.getSelectionRenderStats().failureCount, 0);
  assert.equal(state.pendingCountryRenderIds.size, 0);
  assert.equal(renderer.getStats().pendingCountryCount, 0);
  assert.equal(queued.length, 0);
  scheduledReasons.length = 0;
  return { renderer, rendering, nodes, queued, scheduledReasons, scenePaints: () => scenePaints,
    currentCanvas: () => canvas, recoveryPending: () => [...timers.values()].some(timer => timer.delay === 5000),
    restore: async () => { contextLost = false; await canvas.dispatch('webglcontextrestored'); },
    transition: async () => {
      const recovery = [...timers.values()].find(timer => timer.delay === 5000);
      assert.ok(recovery); recovery.callback();
      if (canvasWorker) {
        assert.equal(renderer.getRuntimeState().renderer, 'canvas-worker');
        const worker = workers.find(worker => worker.name === 'pandolab-canvas-renderer');
        assert.ok(worker);
        assert.equal(scenePaints, 0, 'no Canvas Worker bitmap has been presented');
        if (pendingGeometry) {
          await renderer.applyCountryPatch({ ids: ['DEU'], features: [byId('DEU')], removedIds: [] });
          assert.equal(renderer.getStats().pendingCountryCount, 1);
          assert.equal(state.pendingCountryRenderIds.size, 1);
        }
        worker.onerror({ message: 'test worker failure' });
      }
    },
    verifyCanonical: () => { assert.strictEqual(selection.snapshot(), snapshot); assert.deepEqual(features, model);
      assert.equal(state.pendingCountryRenderIds.size, 0); assert.equal(renderer.getStats().pendingCountryCount, 0); },
  };
}

test('real context loss reserves scene fills until same-canvas WebGL restoration', async t => {
  const h = await directFallbackHarness(t);
  const recoveringCanvas = h.currentCanvas();
  assert.equal(h.renderer.getRuntimeState().renderer, 'webgl-recovering');
  assert.equal(h.renderer.getRenderDevice(), null, 'reserved scene ownership does not imply a usable GPU device');
  assert.equal(h.nodes(fillSelector).length, 0, 'context loss must not recreate selection or hover scene fills in SVG');
  assert.equal(h.nodes(outlineSelector).length, 2, 'lost GPU stroke coverage keeps both SVG outlines');
  assert.ok(h.nodes(outlineSelector).every(node => node.getAttribute('fill') === 'none'));
  assert.equal(h.recoveryPending(), true);
  h.verifyCanonical();

  await h.restore();
  assert.equal(h.renderer.getRuntimeState().renderer, 'webgl2');
  assert.ok(h.renderer.getRenderDevice());
  assert.strictEqual(h.currentCanvas(), recoveringCanvas, 'restoration happens before timeout replaces the canvas');
  assert.equal(h.recoveryPending(), false, 'successful restoration cancels the fallback timeout');
  assert.equal(h.queued.length, 1, 'restoration itself schedules the selection redraw');
  h.queued.shift()();
  assert.equal(h.nodes(fillSelector).length, 0);
  assert.equal(h.nodes(outlineSelector).length, 2, 'unprepared GPU strokes still need SVG outlines after restoration');
  assert.ok(h.nodes(outlineSelector).every(node => node.getAttribute('fill') === 'none'));
  assert.equal(h.rendering.getSelectionRenderStats().failureCount, 0);
  assert.equal(h.queued.length, 0);
  h.verifyCanonical();
});

for (const canvasWorker of [false, true]) test(`real ${canvasWorker ? 'Worker failure' : 'context recovery timeout'} presents its first Canvas2D frame through selection ownership`, async t => {
  const h = await directFallbackHarness(t, { canvasWorker });
  assert.equal(h.nodes(fillSelector).length, 0, 'scene fills remain reserved during recovery');
  await h.transition();
  assert.equal(h.renderer.getRuntimeState().renderer, 'canvas2d');
  assert.equal(h.scenePaints(), 0, 'activation must not paint outside the canonical presentation boundary');
  assert.deepEqual(h.scheduledReasons, ['canvas-fallback-ready']);
  assert.equal(h.nodes(fillSelector).length, 0, 'fallback activation does not return scene fills to SVG');
  assert.equal(h.queued.length, 1);
  // Only internally scheduled transition work may run. The test does not
  // request another redraw or manufacture a selection/user interaction.
  h.queued.shift()();
  assert.equal(h.scenePaints(), 1, 'the transition presents exactly one Canvas2D scene');
  assert.equal(h.nodes(fillSelector).length, 0, 'first Canvas2D presentation preserves reserved scene-fill ownership');
  assert.equal(h.nodes(outlineSelector).length, 2);
  assert.ok(h.nodes(outlineSelector).every(node => node.getAttribute('fill') === 'none'));
  assert.equal(h.rendering.getSelectionRenderStats().failureCount, 0);
  assert.equal(h.queued.length, 0, 'no redundant follow-up scene or interaction frame');
  h.verifyCanonical();
});

test('Worker failure acknowledges pending geometry only after its scheduled Canvas2D paint', async t => {
  const h = await directFallbackHarness(t, { canvasWorker: true, pendingGeometry: true });
  await h.transition();
  assert.equal(h.scenePaints(), 0);
  assert.equal(h.renderer.getStats().pendingCountryCount, 1, 'activation cannot acknowledge an unpainted geometry revision');
  h.queued.shift()();
  assert.equal(h.scenePaints(), 1);
  assert.equal(h.renderer.getStats().pendingCountryCount, 0);
  assert.equal(h.nodes(fillSelector).length, 0);
  assert.equal(h.nodes(outlineSelector).length, 2);
  assert.equal(h.queued.length, 1, 'displayed geometry schedules its existing pending-overlay cleanup');
  h.queued.shift()();
  assert.equal(h.queued.length, 0);
  h.verifyCanonical();
});
