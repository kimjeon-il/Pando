import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectFullWorldRuntime, installFullWorldProbe } from '../full-world-probe.js';

function runtime({ renderer = 'webgl2', blocked = [] } = {}) {
  const handlers = new Map();
  const scope = {
    PANDOLAB_BUILD_META: {
      resourceProfile: 'full-world', dataRevision: 'data-' + 'a'.repeat(32),
      historicalWorld: { sha256: 'c'.repeat(64) },
    },
    __PANDOLAB_STARTUP_METRICS__: {
      preview: { source: 'local' }, geometry: { source: 'local' }, mesh: { source: 'local' },
      readyMs: 1400,
    },
    __PANDOLAB_GPU_METRICS__: { renderer, triangleCount: 2304, countryBaseIndexCount: 258, activeWebGlContextCount: 1 },
    __PANDOLAB_SHELL_NETWORK__: { blocked, workers: [{ name: 'pandolab-data-loader', type: 'module' }] },
    PANDOLAB_TERRITORIAL: { list: () => Array.from({ length: 258 }, (_, id) => ({ id })) },
    PandoLabSphericalCore: { verified: true },
    __PANDOLAB_SHELL_AUTO__: true,
    addEventListener(name, fn) { handlers.set(name, fn); },
    emit(name, detail = {}) { handlers.get(name)?.(detail); },
    setTimeout, clearTimeout, console,
  };
  return scope;
}

test('full-world probe requires canonical world, actual WebGL and original Worker', () => {
  const scope = runtime();
  const report = inspectFullWorldRuntime(scope);
  assert.equal(report.ok, true);
  assert.equal(report.observed.countryCount, 258);
  assert.equal(report.observed.renderer, 'webgl2');
});
test('full-world probe fails canvas fallback and any blocked remote request', () => {
  assert.equal(inspectFullWorldRuntime(runtime({ renderer: 'canvas' })).ok, false);
  assert.equal(inspectFullWorldRuntime(runtime({ blocked: [{ url: 'https://untrusted.invalid' }] })).ok, false);
});
test('full-world probe records actual ready event and writes a result once', async () => {
  const scope = runtime(), reports = [];
  const finished = new Promise(resolve => {
    installFullWorldProbe({ scope, timeoutMs: 300, readyDelayMs: 0,
      reportFn: value => { reports.push(value); resolve(value); },
    });
  });
  scope.emit('pandolab:ready');
  const report = await finished;
  assert.equal(report.ok, true);
  assert.equal(reports.length, 1);
});
test('full-world probe records errors rather than claiming ready', async () => {
  const scope = runtime(), output = new Promise(resolve => {
    installFullWorldProbe({ scope, timeoutMs: 300, reportFn: resolve });
  });
  scope.emit('pandolab:geometry-error', { detail: 'bad geometry' });
  const report = await output;
  assert.equal(report.ok, false);
  assert.equal(report.phase, 'pandolab:geometry-error');
  assert.match(report.error, /bad geometry/);
});
