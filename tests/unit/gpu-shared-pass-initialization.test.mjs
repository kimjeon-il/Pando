import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import test from 'node:test';

const source = readFileSync(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
const initializeSource = source.slice(source.indexOf('    function initializeSharedGpuPasses() {'),
  source.indexOf('    function handleSharedGpuContextLost() {'));

function fixture({ polygon = () => true, stroke = async () => true } = {}) {
  const frames = [], failures = [], diagnostics = [];
  const create = new Function('frames', 'failures', 'diagnostics', 'polygon', 'stroke', `
    let disposed = false, renderDevice = {}, renderDeviceContextRevision = 1, projectGeneration = 1;
    let lastSelectionRenderResult;
    const sceneColorCache = { initialize: () => true, invalidate() {} };
    const interactionFillCache = sceneColorCache, interactionStrokeCache = sceneColorCache;
    const performanceMetrics = {}, lifecycle = { frame: callback => frames.push(callback) };
    const uploadScheduler = { enqueueUpload: job => Promise.resolve().then(() => job.step().value) };
    const polygonOverlayPass = { initialize: polygon }, strokeRenderer = { initializeProgressively: stroke, isAvailable: () => false };
    const selectionPass = null, prewarmCountryStrokeResources = () => {}, invalidateGpuFrame = () => {};
    const console = { error: (...args) => diagnostics.push(args) }, activateCanvasFallback = reason => failures.push(reason);
    ${initializeSource}
    return { start: initializeSharedGpuPasses, replaceProject: () => projectGeneration++,
      replaceContext: () => { renderDevice = {}; renderDeviceContextRevision++; }, dispose: () => { disposed = true; } };
  `);
  return { ...create(frames, failures, diagnostics, polygon, stroke), failures, diagnostics,
    pendingFrames: () => frames.length,
    paint: () => { frames.shift()(); frames.shift()(); }, settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test('project replacement before shader compilation restarts preparation for the current project', async () => {
  let initialized = 0;
  const app = fixture({ stroke: async () => { initialized++; return true; } });
  app.start(); app.replaceProject(); app.paint(); await app.settle();
  assert.equal(app.pendingFrames(), 1);
  app.paint(); await app.settle();
  assert.equal(initialized, 1); assert.deepEqual(app.failures, []);
});

for (const pass of ['polygon', 'stroke']) {
  test(`required ${pass} initialization false switches to Canvas with diagnostics`, async () => {
    const app = fixture({ [pass]: () => false }); app.start(); app.paint(); await app.settle();
    assert.equal(app.failures.length, 1); assert.match(app.failures[0], new RegExp(pass));
    assert.equal(app.diagnostics.length, 1);
  });
}
test('required pass initialization exception is contained by the renderer boundary', async () => {
  const original = new Error('shader link failed');
  const app = fixture({ polygon: () => { throw original; } }); app.start(); app.paint(); await app.settle();
  assert.deepEqual(app.failures, ['shader link failed']); assert.equal(app.diagnostics[0][1], original);
});
for (const replace of ['replaceProject', 'replaceContext', 'dispose']) {
  test(`cancelled initialization after ${replace} cannot switch the current renderer`, async () => {
    let reject;
    const app = fixture({ stroke: () => new Promise((_resolve, fail) => { reject = fail; }) });
    app.start(); app.paint(); await app.settle(); app[replace](); reject(new Error('old shader failed'));
    await app.settle(); assert.deepEqual(app.failures, []); assert.deepEqual(app.diagnostics, []);
  });
}
