import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('country palettes keep storage and use dirty-domain sub-image uploads', () => {
  const source = read('assets/js/modules/gpu-map-renderer.js');
  const renderWebGl = source.slice(source.indexOf('function renderWebGl'), source.indexOf('function renderCanvasHydro'));
  assert.ok(source.includes('let palettePixels = null;'));
  assert.ok(source.includes("const paletteDirty = { base: true, emphasis: true };"));
  assert.ok(source.includes('gl.texSubImage2D('));
  assert.ok(source.includes('function ensurePaletteStorage()'));
  assert.ok(renderWebGl.includes('flushPaletteUpdates();'));
  assert.ok(!renderWebGl.includes('updatePalette();'));
});

test('WebGL locations and frame projection state are cached', () => {
  const gpu = read('assets/js/modules/gpu-map-renderer.js');
  const selection = read('assets/js/modules/selection-emphasis.js');
  assert.ok(gpu.includes('let uniformLocationCache = new WeakMap();'));
  assert.ok(gpu.includes('function createFrameContext('));
  assert.ok(gpu.includes('activeFrameContext = createFrameContext(viewState);'));
  assert.equal((gpu.match(/gl\.getUniformLocation\(/g) || []).length, 1);
  assert.equal((gpu.match(/gl\.getAttribLocation\(/g) || []).length, 1);
  assert.equal((selection.match(/gl\.getUniformLocation\(/g) || []).length, 2);
  assert.equal((selection.match(/gl\.getAttribLocation\(/g) || []).length, 5);
});

test('hydro and terrain use bounded interaction-aware upload budgets', () => {
  const source = read('assets/js/modules/gpu-map-renderer.js');
  assert.ok(source.includes('interactionActive ? 512 * 1024 : 4 * 1024 * 1024'));
  assert.ok(source.includes('const limit = interactionActive ? 1 : 2;'));
  assert.ok(source.includes('performance.now() - startedAt < 4'));
  assert.ok(source.includes("hydroWorker?.postMessage({ type: 'interaction', active: interactionActive });"));
});

test('Canvas Worker persists independently revisioned view and style state', () => {
  const renderer = read('assets/js/modules/gpu-map-renderer.js');
  const worker = read('assets/js/workers/canvas-render-worker.js');
  for (const type of ["type: 'view'", "type: 'style'", "type: 'physical-style'", "type: 'patch'"]) {
    assert.ok(renderer.includes(type), `missing renderer message ${type}`);
  }
  assert.ok(renderer.includes('canvasWorkerPendingMessage = message;'));
  assert.ok(worker.includes("message.type === 'view'"));
  assert.ok(worker.includes("message.type === 'style'"));
  assert.ok(worker.includes("message.type === 'physical-style'"));
  assert.ok(worker.includes('incomingRevision < styleRevision'));
  assert.ok(worker.includes('incomingRevision < physicalStyleRevision'));
});

test('map edit worker clones only objects modified by the operation', () => {
  const source = read('assets/js/workers/map-edit-worker.js');
  assert.ok(source.includes('const working = new Map(countries);'));
  assert.ok(!source.includes("new Map([...countries].map"));
  assert.ok(source.includes('const nextTarget = clone(target);'));
  assert.ok(source.includes('const next = clone(source);'));
  assert.ok(source.includes('const next = clone(donor);'));
});

test('large-data overlays use domain caches and multi-tier culling', () => {
  const app = read('assets/js/app.js');
  const index = read('assets/js/modules/map-object-spatial-index.js');
  assert.ok(app.includes('function buildDistributionRenderRows()'));
  assert.ok(app.includes('function visibleDistributionRenderRows()'));
  assert.ok(app.includes('distributionRenderRowCache'));
  assert.ok(!app.includes('territorialBoundaryCache.revision !== state.stateRevision'));
  assert.ok(index.includes("? 'fine'"));
  assert.ok(index.includes("? 'coarse' : 'global'"));
  assert.ok(index.includes('querySphericalCap'));
});
