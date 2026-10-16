import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

test('preview Worker preserves canonical validator coordinates for topology repair', async t => {
  const script = new URL('../../assets/js/workers/project-preview-worker.js', import.meta.url).href;
  const coreAdapter = new URL('../helpers/node-core-wasm-loader.mjs', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const fs = require('node:fs'), vm = require('node:vm');
    global.self = global;
    self.location = new URL(${JSON.stringify(script)});
    global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext(
      '(function(module,exports){' + fs.readFileSync(new URL(url, self.location), 'utf8') + '\\n}).call(globalThis,undefined,undefined)'));
    self.postMessage = data => parentPort.postMessage({ result: data });
    vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), {
      filename: self.location.href,
      importModuleDynamically: async specifier => {
        const url = new URL(specifier, self.location);
        if (url.pathname.endsWith('/core-wasm-loader.js')) return import(${JSON.stringify(coreAdapter)});
        if (url.pathname.endsWith('/project-preview-topology.js')) {
          const shared = await import(url.href);
          const adapter = new vm.SyntheticModule(['buildTopologyPreview','inspectTopologyPreviewFeatures','previewContainmentIssue'], function () {
            this.setExport('inspectTopologyPreviewFeatures',shared.inspectTopologyPreviewFeatures);
            this.setExport('previewContainmentIssue',shared.previewContainmentIssue);
            this.setExport('buildTopologyPreview', (features, options) => {
              const candidate = self.topojson.topology({ countries: { type: 'FeatureCollection', features } });
              parentPort.postMessage({ issues: options.inspectCandidate(candidate) });
              throw new Error('Inspection captured before mesh generation');
            });
          });
          await adapter.link(() => {});
          await adapter.evaluate();
          return adapter;
        }
        return import(url.href);
      },
    });
    parentPort.on('message', data => self.onmessage({ data }));
  `, { eval: true, execArgv: ['--experimental-vm-modules'] });
  t.after(() => worker.terminate());
  const inspected = new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', message => {
      if (message.issues) resolve(message.issues);
      else if (message.result && !message.result.ok) reject(new Error(message.result.message));
    });
  });
  worker.postMessage({ id: 1, type: 'build', source: { project: {}, territorialViews: [] },
    baseline: { sourceSha256: 'test' }, entities: [{ type: 'Feature', id: 'crossing',
      properties: { entityKind: 'general' }, geometry: { type: 'Polygon',
        coordinates: [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]] } }] });
  const issues = await inspected;
  const intersection = issues.find(issue => issue.reason === 'self-intersection');
  assert.ok(intersection, 'the real validator must detect the crossing');
  assert.deepEqual(intersection.ids, ['crossing']);
  assert.deepEqual(intersection.point, [2, 2], 'repair must receive the actual crossing location');
});
