import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditPreviewController } from '../../assets/js/modules/edit-preview-controller.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';
import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import { resolveMapInteractionStyle } from '../../assets/js/modules/map-interaction-style.js';

function harness(renderer = 'webgl2', { directFallback = false, objectSuccessor = false, stableView = false } = {}) {
  const preview = createEditPreviewController();
  const ref = { domain: 'hydro', type: 'river', id: 'river-1', key: 'hydro:river:river-1' };
  const boundary = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
  const feature = { type: 'Feature', id: ref.id, properties: {}, geometry: boundary };
  const id = preview.begin({ projectGeneration: 3, targetRefs: [ref], segments: [[[0, 0], [1, 1]]] });
  preview.waitForResult(id);
  preview.handoff(id, objectSuccessor ? { kind: 'object', objectKey: ref.key, geometry: boundary, geometryRevision: 0 }
    : { kind: 'geometry-preview', sessionId: 'new-border', revision: 4 });
  const key = 'interaction:preview:new-border:geometry-preview-new-boundary:0';
  let packet = createEditingRenderPacket({ projectGeneration: 3, preview: {
    sessionId: 'new-border', revision: 4, status: 'ready', delta: { newBoundaries: [boundary] },
  } });
  let result = null, current = true, targetVisible = true, present, vertexCount = 0;
  if (objectSuccessor) packet = createEditingRenderPacket({ projectGeneration: 3, objectVertices: {
    targetRef: ref, mode: 'hydro', handles: [{ key: '0:0', coordinate: [0, 0] }],
  } });
  let svgPath = 'M0,0L1,1', projectedPath = svgPath;
  const frames = [];
  const style = { display: 'block', visibility: 'visible', stroke: 'none', opacity: '1', strokeOpacity: '1', strokeWidth: '2px' };
  const node = { __data__: { key: 'new-border:geometry-preview-new-boundary:0', geometry: boundary }, isConnected: true, ownerDocument: { defaultView: { getComputedStyle: () => ({
    ...style,
  }) } }, getAttribute: name => ({ d: svgPath, 'data-object-key': key,
    'data-gpu-interaction-stroke-keys': 'gpu-border' }[name] || '') };
  const chain = {};
  for (const name of ['attr', 'each', 'remove', 'data', 'exit', 'enter', 'append', 'style', 'call', 'on', 'filter', 'classed']) chain[name] = () => chain;
  let boundaryNodes = [node];
  const vertices = { ...chain, data: values => { vertexCount = values.length; return vertices; } };
  const layer = { node: () => ({ querySelectorAll: () => boundaryNodes }),
    selectAll: selector => selector === 'circle.vertex-handle' ? vertices : chain };
  let directNode = null;
  const root = { querySelector: () => directNode, querySelectorAll: () => [],
    appendChild: value => { directNode = value; },
    ownerDocument: { createElementNS: () => {
      const attributes = new Map();
      return { setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name),
        remove: () => { directNode = null; } };
    } },
  };
  let frameId = 0;
  const prepareView = () => createMapVisualFrame({ frameId: ++frameId, projectGeneration: 3, viewRevision: stableView ? 1 : frameId,
    viewState: { projection: 'flat', size: { width: 800, height: 600 }, dpr: 1,
      translate: [400, 300], scale: 280, rotation: [0, 0, 0], flatCenter: [0, 0] },
    projectCoordinate: coordinate => coordinate, projectPath: () => projectedPath });
  const rendering = createRenderingDomain({
    requestFrame: callback => (frames.push(callback), frames.length),
    prepareView,
    editPreviewController: preview, isEditPreviewCurrent: () => current,
    getEditingRenderPacket: () => packet,
    renderers: { view: () => result },
    countryResources: { gpuMapRenderer: { renderFrame: () => result } },
    interactionResources: { previewLayer: layer, path: () => 'M0,0L1,1',
      featureFromGeometry: geometry => ({ type: 'Feature', properties: {}, geometry }), buildRenderableStrokeFeature: feature => feature },
    selectionResources: { syncGpuInteractionState() {}, path: () => 'M0,0L1,1',
      getInteractionStyle: resolveMapInteractionStyle,
      mapFeatureForObjectRef: () => feature, getCurrentSelectionPacket: () => ({ channels: {} }),
      objectRefVisible: () => targetVisible,
      ...(directFallback ? { selectionLayer: { node: () => root, selectAll: () => chain },
        activeEditPreview: () => preview.packet() } : {}) },
    ...(objectSuccessor ? { editingRenderResources: { vertexLayer: layer,
      getInteractionStyle: () => resolveMapInteractionStyle({ outlineVisible: false }) } } : {}),
    gpuMapRenderer: { getRuntimeState: () => ({ renderer }), renderInteraction: () => result,
      setFramePresentationListener: callback => { present = callback; } },
  });
  const render = coverage => { result = coverage; rendering.invalidateGpuInteraction('upload-complete'); frames.shift()(); };
  const renderBase = coverage => { result = coverage; rendering.invalidateGpuFrame('existing-scene-redraw'); frames.shift()(); };
  const renderCountry = coverage => { result = coverage; rendering.invalidateCountryPatch('successor-country-frame'); frames.shift()(); };
  const renderLabels = () => { result = null; rendering.invalidateLabels('labels-ready'); frames.shift()(); };
  return { preview, rendering, render, renderBase, renderCountry, renderLabels, key, present: value => present(value),
    directNode: () => directNode,
    vertexCount: () => vertexCount, hideTarget: () => { targetVisible = false; current = false; },
    setProjectedPath: value => { projectedPath = value; }, setSvgPath: value => { svgPath = value; },
    addBoundary: () => {
      const extra = { type: 'LineString', coordinates: [[10, 10], [11, 11]] };
      const extraKey = `${key}:extra`;
      boundaryNodes = [...boundaryNodes, { ...node,
        __data__: { key: 'new-border:geometry-preview-new-boundary:1', geometry: extra },
        getAttribute: name => ({ d: svgPath, 'data-object-key': extraKey,
          'data-gpu-interaction-stroke-keys': 'gpu-extra' }[name] || '') }];
      packet = createEditingRenderPacket({ projectGeneration: 3, preview: {
        sessionId: 'new-border', revision: 4, status: 'ready', delta: { newBoundaries: [boundary, extra] },
      } });
      return extraKey;
    },
    visible: () => { style.stroke = 'black'; },
    setPacket: value => { packet = value; }, invalidate: () => { current = false; } };
}

test('common selection coverage retires the matching boundary in an upload completion frame', () => {
  const h = harness();
  h.render({ selection: { channels: { candidate: { renderedKeys: [h.key] } } } });
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('Canvas interaction submission waits for the accepted Worker frame and SVG successor', () => {
  const h = harness('canvas-worker');
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  assert.equal(h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 99 }), false);
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  assert.equal(h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 }), true);
  // No painted successor was supplied: accepted Canvas alone is insufficient.
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  h.visible();
  h.render({ deferred: true, frameId: 2, viewRevision: 2 });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  assert.equal(h.present({ frameId: 2, viewRevision: 2, projectionRevision: 0, projectGeneration: 3 }), true);
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('missing, failed and unrelated frame coverage keep the moved boundary visible', () => {
  const h = harness();
  for (const selection of [null, { error: 'draw failed', channels: { candidate: { renderedKeys: [h.key] } } },
    { channels: { candidate: { renderedKeys: ['another-boundary'] } } }]) {
    h.render({ selection });
    assert.equal(h.preview.snapshot().status, 'successor-ready');
  }
  h.rendering.dispose();
});

test('a stale render packet cannot acknowledge a new preview session', () => {
  const h = harness();
  h.setPacket(createEditingRenderPacket({ projectGeneration: 3, preview: { sessionId: 'old-border', revision: 4 } }));
  h.render({ selection: { channels: { candidate: { renderedKeys: [h.key] } } } });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  h.invalidate();
  h.render(null);
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('failed preview GPU draws cannot acknowledge a successor through stale rendered keys', () => {
  const h = harness();
  for (const failure of [{ error: 'draw failed' }, { contextLost: true }, { deferred: true }]) {
    h.render({ interactionResult: { previewResults: [{ ...failure, renderedKeys: ['gpu-border'] }] } });
    assert.equal(h.preview.snapshot().status, 'successor-ready');
  }
  h.render({ interactionResult: { previewResults: [{ renderedKeys: ['gpu-border'], missingKeys: ['gpu-border'] }] } });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  h.render({ interactionResult: { previewResults: [{ renderedKeys: ['gpu-border'], missingKeys: [] }] } });
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('failed direct GPU coverage keeps the last moved line in its SVG owner', () => {
  const h = harness('webgl2', { directFallback: true });
  const key = h.preview.packet().packet.key;
  h.render({ interactionResult: { previewResults: [{ error: 'stroke draw failed', renderedKeys: [key] }] } });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  assert.ok(h.directNode(), 'failed coverage must leave the geographic preview drawable');
  assert.equal(h.directNode().getAttribute('d'), 'M0,0L1,1');
  h.rendering.dispose();
});

test('visible SVG successor from a previous projection cannot retire the current geographic preview', () => {
  const h = harness();
  h.visible();
  h.setProjectedPath('M0,0L2,2');
  h.render(null);
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  h.setSvgPath('M0,0L2,2');
  h.render(null);
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('painting only an ownership descendant cannot retire an unavailable moved successor boundary', () => {
  const h = harness();
  const extraKey = h.addBoundary();
  h.render({ selection: { channels: { candidate: { renderedKeys: [extraKey], missingKeys: [h.key] } } } });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  h.render({ selection: { channels: { candidate: { renderedKeys: [extraKey, h.key] } } } });
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('outline-disabled hydro waits for its visible committed editing stroke in an accepted Canvas frame', () => {
  const h = harness('canvas-worker', { objectSuccessor: true });
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 });
  assert.equal(h.preview.snapshot().status, 'successor-ready', 'vertex handles or a frame alone are insufficient');
  h.visible();
  h.render({ deferred: true, frameId: 2, viewRevision: 2 });
  h.present({ frameId: 2, viewRevision: 2, projectionRevision: 0, projectGeneration: 3 });
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('hidden hydro removes editing handles even when its previous render packet is cached', () => {
  const h = harness('canvas-worker', { objectSuccessor: true });
  h.hideTarget();
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 });
  assert.equal(h.preview.snapshot().status, 'idle');
  assert.equal(h.vertexCount(), 0);
  h.rendering.dispose();
});

test('a Canvas base redraw superseding an interaction submission still accepts the actual successor frame', () => {
  const h = harness('canvas-worker');
  h.visible();
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  h.renderBase({ deferred: true, frameId: 2, viewRevision: 2 });
  assert.equal(h.present({ frameId: 2, viewRevision: 2, projectionRevision: 0, projectGeneration: 3 }), true);
  assert.equal(h.preview.snapshot().status, 'idle');
  assert.equal(h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 }), false);
  h.rendering.dispose();
});

test('a Canvas country redraw also enters the existing successor frame acceptance queue', () => {
  const h = harness('canvas-worker');
  h.visible();
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  h.renderCountry({ deferred: true, frameId: 2, viewRevision: 2 });
  assert.equal(h.present({ frameId: 2, viewRevision: 2, projectionRevision: 0, projectGeneration: 3 }), true);
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});

test('an accepted Canvas successor remains identifiable when a same-view redraw is still pending', () => {
  const h = harness('canvas-worker', { stableView: true });
  h.visible();
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  h.render({ deferred: true, frameId: 2, viewRevision: 1 });
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  // Production transport can display frame 1 while frame 2 waits behind it.
  assert.equal(h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 }), true);
  assert.equal(h.preview.snapshot().status, 'idle');
  assert.equal(h.present({ frameId: 2, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 }), true);
  assert.equal(h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 }), false);
  h.rendering.dispose();
});

test('a label-only shell commit cannot discard a Canvas bitmap awaiting presentation', () => {
  const h = harness('canvas-worker', { stableView: true });
  h.visible();
  h.render({ deferred: true, frameId: 1, viewRevision: 1 });
  h.renderLabels();
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  assert.equal(h.present({ frameId: 1, viewRevision: 1, projectionRevision: 0, projectGeneration: 3 }), true);
  assert.equal(h.preview.snapshot().status, 'idle');
  h.rendering.dispose();
});
