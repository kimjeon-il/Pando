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
  const gpuDrawPasses = source.slice(source.indexOf('function drawBaseSceneContent'), source.indexOf('function renderCanvasHydro'));
  assert.ok(source.includes('let palettePixels = null;'));
  assert.ok(source.includes("const paletteDirty = { base: true, emphasis: true };"));
  assert.ok(source.includes('gl.texSubImage2D('));
  assert.ok(source.includes('function ensurePaletteStorage()'));
  assert.ok(gpuDrawPasses.includes('flushPaletteUpdates();'));
  assert.ok(!gpuDrawPasses.includes('updatePalette();'));
});

test('WebGL locations and frame projection state are cached', () => {
  const gpu = read('assets/js/modules/gpu-map-renderer.js');
  const selection = read('assets/js/modules/selection-pass.js');
  const stroke = read('assets/js/modules/gpu-stroke-renderer.js');
  assert.ok(gpu.includes('let uniformLocationCache = new WeakMap();'));
  assert.ok(gpu.includes('function createFrameContext('));
  assert.ok(gpu.includes('activeFrameContext = createFrameContext(viewState);'));
  assert.equal((gpu.match(/gl\.getUniformLocation\(/g) || []).length, 1);
  assert.equal((gpu.match(/gl\.getAttribLocation\(/g) || []).length, 1);
  assert.equal((selection.match(/gl\.getUniformLocation\(/g) || []).length, 0);
  assert.equal((selection.match(/gl\.getAttribLocation\(/g) || []).length, 0);
  assert.equal((stroke.match(/gl\.getUniformLocation\(/g) || []).length, 1);
  assert.equal((stroke.match(/gl\.getAttribLocation\(/g) || []).length, 1);
});

test('a newly promoted scene cache texture is presented in the same view frame', () => {
  const gpu = read('assets/js/modules/gpu-map-renderer.js');
  const renderWebGl = gpu.slice(gpu.indexOf('function renderWebGl'), gpu.indexOf('function renderCanvasHydro'));
  const finish = renderWebGl.indexOf('sceneColorCache.finishScene(null, viewSignature, projectGeneration)');
  const present = renderWebGl.indexOf('sceneColorCache.composite(pixelWidth, pixelHeight, { clearTarget: true })', finish);
  const interactions = renderWebGl.indexOf('drawInteractionPasses(viewState)');
  assert.ok(finish >= 0, 'scene promotion must remain explicit');
  assert.ok(present > finish, 'the promoted texture must be presented after promotion');
  assert.ok(present < interactions, 'the base scene must be presented before interaction overlays');
  assert.ok(!renderWebGl.includes('{ clearTarget: false, reproject }'));
});

test('hydro and terrain use bounded interaction-aware upload budgets', () => {
  const source = read('assets/js/modules/gpu-map-renderer.js');
  assert.ok(source.includes('Number(renderQuality.uploadBudgetBytes)'));
  assert.ok(source.includes('const next = hydroUploadQueue.shift();'));
  assert.ok(source.includes('const limit = interactionActive ? 1 : Math.max(1, Math.min(4, Math.floor(uploadBudget / (1024 * 1024))));'));
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
  assert.match(renderer, /invalidateGpuFrame\('canvas-data-ready'\);\s+renderCanvasWorker\(Math\.max\(currentRenderRevision, Number\(message\.revision \|\| 0\)\)\);/);
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
  const rendering = read('assets/js/modules/rendering-domain.js');
  const index = read('assets/js/modules/map-object-spatial-index.js');
  assert.ok(rendering.includes('const buildDistributionRenderRows ='));
  assert.ok(rendering.includes('const visibleDistributionRenderRows ='));
  assert.ok(rendering.includes('distributionRenderRowCache'));
  assert.ok(!rendering.includes('territorialBoundaryCache.revision !== state.stateRevision'));
  assert.ok(index.includes("? 'fine'"));
  assert.ok(index.includes("? 'coarse' : 'global'"));
  assert.ok(index.includes('querySphericalCap'));
});

test('interactive vertex drags use a session GPU preview without geometry Worker work', () => {
  const app = read('assets/js/app.js');
  const genericDrag = app.slice(
    app.indexOf('function vertexDragBehavior('),
    app.indexOf('function boundaryTopologyPreviewTargets('),
  );
  const countryDrag = app.slice(
    app.indexOf('function countryBoundaryVertexDragBehavior('),
    app.indexOf('function labelDragBehavior('),
  );
  for (const source of [genericDrag, countryDrag]) {
    assert.ok(source.includes('updateActiveEditPreview('));
    assert.ok(source.includes('renderEditedGeometryPatch('));
    assert.ok(!source.includes('mapEditClient.execute('));
    assert.ok(!source.includes('gpuMapRenderer.render('));
    assert.ok(!source.includes('renderAll('));
  }
});

test('expensive edit workers use revisioned latest-wins scheduling', () => {
  const client = read('assets/js/modules/map-edit-worker-client.js');
  const renderer = read('assets/js/modules/gpu-map-renderer.js');
  const worker = read('assets/js/workers/map-edit-worker.js');
  assert.ok(client.includes('createLatestWorkerJobScheduler'));
  assert.ok(client.includes('geometryRevision'));
  assert.ok(client.includes('targetRevision'));
  assert.ok(renderer.includes("jobKey: 'mesh:country-overrides'"));
  assert.ok(renderer.includes('stopPatchWorkerJobs(reason)'));
  assert.ok(!renderer.includes('settleStalePatchRequests'));
  assert.ok(worker.includes('currentDataRevision'));
  assert.ok(worker.includes('message.targetRevision'));
});
