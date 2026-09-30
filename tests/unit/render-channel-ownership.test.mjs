import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeSvgSceneProxy, rendererOwnsSceneGeometry } from '../../assets/js/modules/render-channel-ownership.js';
import * as ownership from '../../assets/js/modules/render-channel-ownership.js';
import { createGpuScene } from '../../assets/js/modules/app-gpu-scene.js';
import { createInteractionPackets } from '../../assets/js/modules/app-interaction-packets.js';

test('every runtime scene renderer owns visual map geometry', () => {
  for (const renderer of ['webgl2', 'webgl1', 'canvas-worker', 'canvas2d']) {
    assert.equal(rendererOwnsSceneGeometry(renderer), true);
  }
  for (const renderer of ['', null, 'svg']) assert.equal(rendererOwnsSceneGeometry(renderer), false);
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

test('presentation-only updates retain completed GPU channels; actual failure restores SVG', () => {
  const values = new Map(), classes = new Set();
  const attributes = new Map([['data-gpu-interaction-fill-keys', 'preview:fill'], ['data-gpu-interaction-stroke-keys', 'preview:stroke']]);
  const node = {
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    classList: { toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) },
    getAttribute: key => attributes.get(key), hasAttribute: key => attributes.has(key),
  };
  const scene = createGpuScene();
  const runtime = { renderer: 'webgl2' };
  scene.connect({ rendering: { gpuMapRenderer: { getRuntimeState: () => runtime } },
    mapHostViewB: { interactionSvg: { selectAll: () => ({ each: fn => fn.call(node) }) } } });
  scene.applyGpuInteractionCoverage({ interactionResult: { previewResults: [{ renderedKeys: ['preview:fill', 'preview:stroke'], missingKeys: [] }] } });
  scene.applyGpuInteractionCoverage(null);
  assert.equal(values.get('fill'), 'none');
  assert.equal(values.get('stroke'), 'none');
  scene.applyGpuInteractionCoverage({ interactionResult: { previewResults: [{ renderedKeys: ['preview:stroke'], missingKeys: ['preview:fill'] }] } });
  assert.equal(values.has('fill'), false);
  assert.equal(values.get('stroke'), 'none');
  runtime.renderer = 'webgl-recovering';
  scene.applyGpuInteractionCoverage(null);
  assert.equal(values.has('fill'), false);
  assert.equal(values.has('stroke'), false);
});

test('rejoining unchanged interaction packets preserves ownership until geometry changes', () => {
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
  packets.connect({ preferences: {}, renderScene: {
    createRenderSceneBuilder: () => ({ build: data => data }),
    selectionGeometryRevision: () => revision, featureFromGeometry: geometry => ({ type: 'Feature', geometry }), syncGpuInteractionState() {},
  }, domains: { renderingDomain: { invalidateGpuInteraction() {} } } });
  packets.initializeInteractionSceneBuilder();
  packets.initializeCurrentGpuInteractionFillItems();
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), true);
  ownership.applySvgInteractionOwnership(node, { fillOwner: 'gpu', strokeOwner: 'gpu' });
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), false);
  assert.equal(values.get('fill'), 'none');
  assert.equal(values.get('stroke'), 'none');
  revision += 1;
  assert.equal(packets.syncGpuInteractionLayer('draft', layer), true);
  assert.equal(values.has('fill'), false);
  assert.equal(values.has('stroke'), false);
});

test('persistent territorial paint and derived boundaries have only the scene renderer as visual owner', async () => {
  const source = await readFile(new URL('../../assets/js/modules/rendering-domain.js', import.meta.url), 'utf8');
  const territorialStart = source.indexOf('const renderTerritorialUnits');
  const territorialEnd = source.indexOf('const renderGenericFeatures', territorialStart);
  const territorial = source.slice(territorialStart, territorialEnd);
  assert.match(territorial, /style\('fill', 'transparent'\)/);
  assert.doesNotMatch(territorial, /style\('fill', feature => resolveFill/);
  assert.match(source, /if \(plan\.fill && !sceneOwnsFills\)/);
  assert.match(source, /if \(fillOwner === 'svg' && !sceneOwnsFills\)/);
  assert.doesNotMatch(source, /append\('path'\)\.attr\('class', 'territorial-internal-boundary'\)/);
  assert.doesNotMatch(source, /append\('path'\)\.attr\('class', 'generic-feature-boundary'\)/);
  assert.doesNotMatch(source, /append\('path'\)\.attr\('class', 'distribution-boundary'\)/);
});
