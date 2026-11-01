import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeSvgSceneProxy, rendererOwnsSceneGeometry } from "../../shared/frontend/js/modules/render-channel-ownership.js";
import * as ownership from "../../shared/frontend/js/modules/render-channel-ownership.js";
import { createGpuScene } from "../../shared/frontend/js/modules/gpu-scene.js";
import { createInteractionPackets } from "../../apps/editor/frontend/js/modules/app-interaction-packets.js";
import { createRenderSceneBuilder, buildPolygonGeometryPacket } from "../../shared/frontend/js/modules/render-scene.js";

test('scene ownership stays reserved through recovery without claiming startup ownership', () => {
  for (const renderer of ['webgl2', 'webgl1', 'webgl-recovering', 'canvas-worker', 'canvas2d']) {
    assert.equal(rendererOwnsSceneGeometry(renderer), true);
  }
  for (const renderer of ['', null, 'svg', 'pending', 'disposed']) assert.equal(rendererOwnsSceneGeometry(renderer), false);
});

test('scene proxy clears stale inline paint while preserving the SVG node as a hit target', () => {
  const values = new Map([['fill', '#ff00ff'], ['fill-opacity', '.8'], ['stroke', '#ffff00'], ['stroke-opacity', '1']]);
  const classes = new Set();
  const node = {
    style: { setProperty: (name, value) => values.set(name, value) },
    classList: { add: value => classes.add(value) },
  };
  assert.equal(makeSvgSceneProxy(node), true);
  assert.equal(values.get('fill'), 'transparent');
  assert.equal(values.get('fill-opacity'), '0');
  assert.equal(values.get('stroke'), 'transparent');
  assert.equal(values.get('stroke-opacity'), '0');
  assert.equal(values.get('mix-blend-mode'), 'normal');
  assert.equal(classes.has('gpu-scene-hit-proxy'), true);
});

test('interaction ownership hides only completed channels and restores CSS after failure or renderer transition', () => {
  assert.equal(typeof ownership.applySvgInteractionOwnership, 'function');
  const values = new Map([['fill', '#316fd3'], ['stroke', '#316fd3'], ['fill-opacity', '0.084'], ['pointer-events', 'all']]);
  const classes = new Set();
  const node = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    classList: { toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) } };
  ownership.applySvgInteractionOwnership(node, { fillOwner: 'gpu', strokeOwner: 'svg' });
  assert.equal(values.get('fill'), 'none');
  assert.equal(values.has('stroke'), false);
  assert.equal(values.get('fill-opacity'), '0.084');
  assert.equal(values.get('pointer-events'), 'all');
  assert.equal(classes.has('gpu-interaction-fill-proxy'), true);
  ownership.applySvgInteractionOwnership(node, { fillOwner: 'svg', strokeOwner: 'gpu' });
  assert.equal(values.has('fill'), false);
  assert.equal(values.get('stroke'), 'none');
  ownership.applySvgInteractionOwnership(node, { fillOwner: 'canvas', strokeOwner: 'svg' });
  assert.equal(values.get('fill'), 'none');
  assert.equal(classes.has('canvas-interaction-fill-proxy'), true);
  assert.equal(values.has('stroke'), false);
  ownership.applySvgInteractionOwnership(node, { fillOwner: 'svg', strokeOwner: 'svg' });
  assert.equal(values.has('fill'), false);
  assert.equal(values.has('stroke'), false);
  assert.equal(classes.size, 0);
});

for (const channel of ['preview', 'draft']) test(`${channel} presentation-only updates retain completed GPU channels; actual failure restores SVG`, () => {
  const values = new Map(), classes = new Set();
  const attributes = new Map([['data-gpu-interaction-fill-keys', `${channel}:fill`], ['data-gpu-interaction-stroke-keys', `${channel}:stroke`]]);
  const node = {
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    classList: { toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) },
    getAttribute: key => attributes.get(key), hasAttribute: key => attributes.has(key),
  };
  const scene = createGpuScene();
  const runtime = { renderer: 'webgl2' };
  scene.connect({ rendering: { gpuMapRenderer: { getRuntimeState: () => runtime } },
    mapHostViewB: { interactionSvg: { selectAll: () => ({ each: fn => fn.call(node) }) } } });
  scene.applyGpuInteractionCoverage({ interactionResult: { [`${channel}Results`]: [{ renderedKeys: [`${channel}:fill`, `${channel}:stroke`], missingKeys: [] }] } });
  scene.applyGpuInteractionCoverage(null);
  assert.equal(values.get('fill'), 'none');
  assert.equal(values.get('stroke'), 'none');
  scene.applyGpuInteractionCoverage({ interactionResult: { [`${channel}Results`]: [{ renderedKeys: [`${channel}:stroke`], missingKeys: [`${channel}:fill`] }] } });
  assert.equal(values.has('fill'), false);
  assert.equal(values.get('stroke'), 'none');
  runtime.renderer = 'webgl-recovering';
  assert.equal(rendererOwnsSceneGeometry(runtime.renderer), true, 'scene ownership stays reserved independently of direct controls');
  scene.applyGpuInteractionCoverage(null);
  assert.equal(values.has('fill'), false);
  assert.equal(values.has('stroke'), false);
});

test('rejoining unchanged interaction packets preserves ownership until geometry changes', async t => {
  const values = new Map(), classes = new Set(['selected-candidate']), attributes = new Map();
  let revision = 1;
  const node = {
    __data__: { key: 'candidate', geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] } },
    dataset: {}, closest: () => null,
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    classList: { contains: key => classes.has(key), toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) },
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
  };
  const layer = { selectAll: () => ({ each: fn => fn.call(node) }) };
  const packets = createInteractionPackets();
  const preparations = [];
  const previousWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(request) {
      if (request.type !== 'request') return;
      assert.equal(request.operation, 'geometry.prepare');
      preparations.push(request.payload.items);
      globalThis.queueMicrotask(() => this.onmessage?.({ data: { ...request, type: 'result', ok: true,
        result: { packets: request.payload.items.map(item => ({ cacheKey: item.cacheKey, packet: buildPolygonGeometryPacket(item.geometry) })) } } }));
    }
    terminate() { this.onmessage = null; }
  };
  t.after(() => { packets.initializeInteractionSceneBuilder(); globalThis.Worker = previousWorker; });
  packets.connect({ preferences: {}, platform: { runtimeAssetUrl: path => path }, feedback: { reportOperationError: error => { throw error; } },
    projectState: { state: { projection: 'flat' } }, renderScene: {
    createRenderSceneBuilder,
    selectionGeometryRevision: () => revision, featureFromGeometry: geometry => ({ type: 'Feature', geometry }), syncGpuInteractionState() {},
  }, domains: { renderingDomain: { invalidateGpuInteraction() {} } } });
  packets.initializeInteractionSceneBuilder();
  packets.initializeCurrentGpuInteractionFillItems();
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), false, 'fill preparation is asynchronous');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(packets.currentGpuDraftPackets.length);
  assert.equal(preparations.length, 1, 'the initial fill and outline share one preparation');
  const initialPackets = packets.currentGpuDraftPackets;
  ownership.applySvgInteractionOwnership(node, { fillOwner: 'gpu', strokeOwner: 'gpu' });
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), false);
  assert.equal(values.get('fill'), 'none');
  assert.equal(values.get('stroke'), 'none');
  assert.equal(preparations.length, 1, 'rejoining completed fill and outline must reuse their prepared mesh');
  assert.deepEqual(packets.currentGpuDraftPackets, initialPackets);
  revision += 1;
  node.__data__.geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), true);
  assert.equal(values.has('fill'), false);
  assert.equal(values.has('stroke'), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(preparations.length, 2, 'changed geometry requires one new preparation');
  assert.ok(packets.currentGpuDraftPackets.length);
  assert.notDeepEqual(packets.currentGpuDraftPackets, initialPackets);
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), false, 'the replacement also retains its completed preparation');
  assert.equal(preparations.length, 2);
  assert.equal(values.has('fill'), false, 'preparation alone does not claim a completed GPU paint');
  assert.equal(values.has('stroke'), false);
});

test('persistent territorial paint and derived boundaries have only the scene renderer as visual owner', async () => {
  const source = await readFile(new URL("../../shared/frontend/js/modules/rendering-domain.js", import.meta.url), 'utf8');
  const content = await readFile(new URL('../../shared/frontend/js/modules/map-content-presentation.js', import.meta.url), 'utf8');
  const territorialStart = content.indexOf('const renderTerritorialUnits');
  const territorialEnd = content.indexOf('const renderGenericFeatures', territorialStart);
  assert.ok(territorialStart >= 0 && territorialEnd > territorialStart);
  const territorial = content.slice(territorialStart, territorialEnd);
  assert.match(source, /createMapContentPresentation\(/);
  assert.match(territorial, /polygons\.push\(/);
  assert.match(territorial, /replaceGpuSceneDomain\?\.\('territorial-units', \{ polygons, strokes \}\)/);
  assert.doesNotMatch(territorial, /append\('path'\)/);
  assert.doesNotMatch(territorial, /style\('fill', feature => resolveFill/);
  assert.match(source, /if \(plan\.fill && !sceneOwnsFills\)/);
  assert.match(source, /if \(fillOwner === 'svg' && !sceneOwnsFills\)/);
  assert.doesNotMatch(source + content, /append\('path'\)\.attr\('class', 'territorial-internal-boundary'\)/);
  assert.doesNotMatch(source + content, /append\('path'\)\.attr\('class', 'generic-feature-boundary'\)/);
  assert.doesNotMatch(source + content, /append\('path'\)\.attr\('class', 'distribution-boundary'\)/);
});
