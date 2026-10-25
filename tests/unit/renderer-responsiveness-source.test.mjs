import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('country palettes keep storage and use dirty-domain sub-image uploads', () => {
  const source = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const gpuDrawPasses = source.slice(source.indexOf('function drawBaseSceneContent'), source.indexOf('function renderCanvasHydro'));
  assert.ok(source.includes('let palettePixels = null;'));
  assert.ok(source.includes("const paletteDirty = { base: true, emphasis: true };"));
  assert.ok(source.includes('gl.texSubImage2D('));
  assert.ok(source.includes('function ensurePaletteStorage()'));
  assert.ok(gpuDrawPasses.includes('flushPaletteUpdates();'));
  assert.ok(!gpuDrawPasses.includes('updatePalette();'));
});

test('WebGL locations and frame projection state are cached', () => {
  const gpu = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const visualFrame = read('shared/frontend/js/modules/map-visual-frame.js');
  const selection = read('shared/frontend/js/modules/selection-pass.js');
  const stroke = read('shared/frontend/js/modules/gpu-stroke-renderer.js');
  assert.ok(gpu.includes('let uniformLocationCache = new WeakMap();'));
  assert.ok(visualFrame.includes('function createMapVisualFrame'));
  assert.ok(gpu.includes('activeFrameContext = visualFrame;'));
  assert.ok(!gpu.includes('function createFrameContext('));
  assert.equal((gpu.match(/gl\.getUniformLocation\(/g) || []).length, 1);
  assert.equal((gpu.match(/gl\.getAttribLocation\(/g) || []).length, 1);
  assert.equal((selection.match(/gl\.getUniformLocation\(/g) || []).length, 0);
  assert.equal((selection.match(/gl\.getAttribLocation\(/g) || []).length, 0);
  assert.equal((stroke.match(/gl\.getUniformLocation\(/g) || []).length, 1);
  assert.equal((stroke.match(/gl\.getAttribLocation\(/g) || []).length, 1);
});

test('a newly promoted scene cache texture is presented in the same view frame', () => {
  const gpu = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const renderWebGl = gpu.slice(gpu.indexOf('function renderWebGl'), gpu.indexOf('function renderCanvasHydro'));
  const finish = renderWebGl.indexOf('sceneColorCache.finishScene(null, viewSignature, projectGeneration)');
  const present = renderWebGl.indexOf('sceneColorCache.composite(pixelWidth, pixelHeight, { clearTarget: true })', finish);
  const interactions = renderWebGl.indexOf('drawGpuInteractionPass(');
  assert.ok(finish >= 0, 'scene promotion must remain explicit');
  assert.ok(present > finish, 'the promoted texture must be presented after promotion');
  assert.ok(present < interactions, 'the base scene must be presented before interaction overlays');
  assert.ok(!renderWebGl.includes('{ clearTarget: false, reproject }'));
});

test('visible terrain shares the upload budget while background hydro waits for quiet input', async () => {
  const { createGpuUploadScheduler } = await import("../../shared/frontend/js/modules/gpu-upload-scheduler.js");
  const frames = [], submitted = [];
  let now = 0;
  const scheduler = createGpuUploadScheduler({ requestFrame: callback => (frames.push(callback), frames.length),
    cancelFrame() {}, now: () => now, isHidden: () => false, isInputPending: () => false, getByteBudget: () => 512 * 1024 });
  scheduler.noteInput(true);
  const pending = ['hydro', 'terrain'].map(key => scheduler.enqueueUpload({ key, allowDuringInteraction: key === 'terrain', step: ({ byteBudget }) => {
    submitted.push([key, byteBudget]); return { bytes: byteBudget, done: true };
  } }));
  frames.shift()();
  assert.deepEqual(submitted, [['terrain', 262144]]);
  scheduler.noteInput(false); now = 500; frames.shift()();
  await Promise.all(pending);
  assert.deepEqual(submitted, [['terrain', 262144], ['hydro', 262144]]);
  scheduler.dispose();
});

test('physical data and visibility changes invalidate the cached base scene', () => {
  const source = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const terrain = read('shared/frontend/js/modules/gpu-terrain-preparation.js');
  assert.match(source, /function invalidatePhysicalScene\([\s\S]*?sceneColorCache\.invalidate\(reason\);[\s\S]*?invalidateGpuFrame\(reason\);/);
  assert.match(source, /function setTerrainManifest\([\s\S]*?invalidatePhysicalScene\('terrain-manifest'\);/);
  assert.match(source, /function invalidateHydroVisibility\([\s\S]*?queueHydroRender\('hydro-visibility'\);/);
  assert.match(source, /function queueHydroRender\([\s\S]*?invalidatePhysicalScene\(reason\);/);
  assert.ok(terrain.includes('function terrainNeighbourSpecs(level, specs)'));
  assert.ok(terrain.includes("invalidate('terrain-tile-ready')"));
  assert.ok(terrain.includes('terrainRetentionKeys.has(item[0])'));
  assert.match(terrain, /const frameDpr = Math\.max\(1, Number\(frameContext\.dpr\)\);/);
  assert.match(terrain, /physicalScale \/ frameDpr\) \* sourceDpr/);
});

test('Canvas Worker persists independently revisioned view and style state', () => {
  const renderer = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const worker = read('shared/frontend/js/workers/canvas-render-worker.js');
  for (const type of ["type: 'view'", "type: 'style'", "type: 'physical-style'", "type: 'patch'"]) {
    assert.ok(renderer.includes(type), `missing renderer message ${type}`);
  }
  assert.ok(renderer.includes('canvasWorker.queueFrame('));
  assert.ok(renderer.includes("invalidateGpuFrame('canvas-data-ready');"));
  assert.doesNotMatch(renderer, /renderCanvasWorker\(Math\.max\(currentRenderRevision/);
  assert.ok(renderer.includes('canvasWorker.queueFrame(canvasWorkerViewMessage(visualFrame));'));
  assert.ok(renderer.includes('frameId: frame.frameId'));
  assert.ok(worker.includes("message.type === 'view'"));
  assert.ok(worker.includes("message.type === 'style'"));
  assert.ok(worker.includes("message.type === 'physical-style'"));
  assert.ok(worker.includes('incomingRevision < styleRevision'));
  assert.ok(worker.includes('incomingRevision < physicalStyleRevision'));
  assert.ok(worker.includes('message.terrainDpr || dpr'));
  assert.ok(worker.includes('terrainProtectedKeys.has(key)'));
  assert.ok(!renderer.includes('canDisplay && message.bitmap && message.terrainComplete !== false'));
});

test('map edit calculation preserves originals and shares untouched country objects', async () => {
  await import("../../shared/frontend/js/vendor/polygon-clipping.min.js");
  const { createCountryCommandCalculator } = await import("../../apps/editor/frontend/js/modules/map-edit-country-commands.js");
  const { normalizePolygonGeometry } = await import("../../shared/frontend/js/modules/map-edit-geometry.js");
  const square = x => normalizePolygonGeometry({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
  const countries = new Map(['source', 'target', 'untouched'].map((id, index) => [id, { type: 'Feature', id, properties: {}, geometry: square(index) }]));
  const before = structuredClone(countries);
  const { result, afterFeatures } = createCountryCommandCalculator().calculate({ operation: 'merge', sourceId: 'source', targetIds: ['target'] }, countries);
  assert.deepEqual(countries, before);
  assert.deepEqual(result.removedIds, ['target']);
  assert.notEqual(result.features[0], countries.get('source'));
  assert.equal(afterFeatures.find(feature => feature.id === 'untouched'), countries.get('untouched'));
});

test('large-data overlays use domain caches and multi-tier culling', () => {
  const rendering = read('shared/frontend/js/modules/rendering-domain.js');
  const index = read('shared/frontend/js/modules/map-object-spatial-index.js');
  assert.ok(rendering.includes('const buildDistributionRenderRows ='));
  assert.ok(rendering.includes('const visibleDistributionRenderRows ='));
  assert.ok(rendering.includes('distributionRenderRowCache'));
  assert.ok(!rendering.includes('territorialBoundaryCache.revision !== state.stateRevision'));
  assert.ok(index.includes("? 'fine'"));
  assert.ok(index.includes("? 'coarse' : 'global'"));
  assert.ok(index.includes('querySphericalCap'));
});

test('interactive vertex drags use a session GPU preview without geometry Worker work', () => {
  const editing = read('apps/editor/frontend/js/modules/editing-domain.js');
  const rendering = read('shared/frontend/js/modules/rendering-domain.js');
  const gestureMove = editing.slice(editing.indexOf('const applyGestureMove ='), editing.indexOf('const flushPendingMove ='));
  assert.ok(gestureMove.includes('geometry.previewObjectGesture?.('));
  assert.ok(gestureMove.includes('geometry.moveBoundaryGesture?.('));
  assert.ok(!gestureMove.includes('mapEditClient.execute('));
  assert.ok(rendering.includes("type: `${kind}-drag-move`"));
  assert.ok(rendering.includes('publishEditingInteraction({'));
  assert.ok(!rendering.includes('gpuMapRenderer.render('));
  assert.ok(!rendering.includes('renderAll('));
});

test('expensive edit workers use revisioned latest-wins scheduling', () => {
  const client = read('apps/editor/frontend/js/modules/map-edit-worker-client.js');
  const renderer = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const worker = read('apps/editor/frontend/js/workers/map-edit-worker.js');
  assert.ok(client.includes('createLatestWorkerJobScheduler'));
  assert.ok(client.includes('geometryRevision'));
  assert.ok(client.includes('targetRevision'));
  assert.ok(renderer.includes("jobKey: 'mesh:country-overrides'"));
  assert.ok(renderer.includes('stopPatchWorkerJobs(reason)'));
  assert.ok(!renderer.includes('settleStalePatchRequests'));
  assert.ok(worker.includes('currentDataRevision'));
  assert.ok(worker.includes('message.targetRevision'));
});
