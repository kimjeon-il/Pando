import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const feature = (id, geometry, properties = {}) => ({ type: 'Feature', id, geometry, properties });
const countries = [feature('a', square(0, 0, 4, 4)), feature('b', square(4, 0, 8, 4))];
const child = feature('child', square(0, 0, 2, 2), { unitType: 'subunit', parentId: 'a', sovereignId: 'a' });
const rebase = () => ({ type: 'rebase', dataRevision: 1, features: countries, editSources: {
  sourceRevision: 1, patches: [...countries.map(item => ['country', item]), ['territorial', child]].map(([kind, item]) => ({
    key: kind + ':' + item.id, kind, metadata: { ...item, geometry: undefined }, geometry: item.geometry,
  })),
} });
const execute = (requestId, operation, payload, revisions = { sourceRevision: 1 }) => ({
  type: 'execute', requestId, operation, payload, ...(operation === 'merge' ? payload : {}), dataRevision: 1, ...revisions,
});

// Run the unchanged Worker script and real calculation modules. Only module delivery
// and timer delivery are gated, so state-changing messages can interleave deterministically.
function rawWorker(t, heldModule = '') {
  const script = new URL('../../assets/js/workers/map-edit-worker.js', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const fs = require('node:fs'), vm = require('node:vm');
    global.self = global;
    self.location = new URL(${JSON.stringify(script)});
    global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext('(function(module,exports){' + fs.readFileSync(new URL(url), 'utf8') + '\\n}).call(globalThis,undefined,undefined)'));
    self.postMessage = data => parentPort.postMessage(data);
    let releaseImport, releaseTimer, holdTimer = false, importHeld = false;
    const nativeSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => {
      if (!holdTimer || delay !== 0) return nativeSetTimeout(callback, delay, ...args);
      holdTimer = false;
      releaseTimer = () => callback(...args);
      parentPort.postMessage({ gate: 'timer' });
    };
    vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), {
      filename: self.location.href,
      importModuleDynamically: async specifier => {
        if (!importHeld && ${JSON.stringify(heldModule)} && specifier.endsWith(${JSON.stringify(heldModule)})) {
          importHeld = true;
          await new Promise(resolve => {
            releaseImport = resolve;
            parentPort.postMessage({ gate: 'import' });
          });
        }
        return import(specifier);
      },
    });
    parentPort.on('message', ({ token, message }) => {
      if (message.control === 'release-import') releaseImport();
      else if (message.control === 'release-timer') releaseTimer();
      else if (message.control === 'hold-timer') holdTimer = true;
      else self.onmessage({ data: message });
      parentPort.postMessage({ dispatched: token });
    });
  `, { eval: true, execArgv: ['--experimental-vm-modules'] });
  t.after(() => worker.terminate());
  const inbox = [], listeners = [];
  worker.on('message', message => {
    const index = listeners.findIndex(listener => listener.match(message));
    if (index >= 0) listeners.splice(index, 1)[0].resolve(message);
    else inbox.push(message);
  });
  const next = match => {
    const index = inbox.findIndex(match);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise(resolve => listeners.push({ match, resolve }));
  };
  let sequence = 0;
  return {
    next,
    async send(message) {
      const token = ++sequence;
      worker.postMessage({ token, message });
      await next(value => value.dispatched === token);
    },
    result: requestId => next(value => value.type === 'result' && value.requestId === requestId),
  };
}

test('edit-sync while preview code loads rejects the stale request and retains no receipt', { timeout: 15000 }, async t => {
  const worker = rawWorker(t, 'map-edit-preview-calculations.js');
  await worker.send(rebase());
  await worker.send(execute(1, 'territorial-preview', { operation: 'redraw', beforeIds: ['child'], afterFeatures: [child], removedIds: [] }));
  await worker.next(value => value.gate === 'import');
  await worker.send({ type: 'edit-sync', sourceRevision: 2, patches: [], removedKeys: [] });
  await worker.send({ control: 'release-import' });
  const response = await worker.result(1);
  await worker.send(execute(2, 'territorial-validation', { preparationId: response.result?.preparationId || 'preview:1' }, { sourceRevision: 2 }));
  const receipt = await worker.result(2);
  assert.equal(response.cancelled, true);
  assert.equal(response.ok, false);
  assert.equal(receipt.ok, false, 'stale previews must not mint a receipt for the new source revision');
});

test('edit-sync while query code loads rejects the stale read result', { timeout: 15000 }, async t => {
  const worker = rawWorker(t, 'map-edit-query-calculations.js');
  await worker.send(rebase());
  await worker.send(execute(1, 'territorial-parents', { targetId: 'child', candidateIds: ['a'] }));
  await worker.next(value => value.gate === 'import');
  await worker.send({ type: 'edit-sync', sourceRevision: 2, patches: [], removedKeys: [] });
  await worker.send({ control: 'release-import' });
  const response = await worker.result(1);
  assert.equal(response.cancelled, true);
  assert.equal(response.ok, false);
});

for (const invalidation of ['cancel', 'rebase']) {
  test(`${invalidation} while country commands load leaves no old pending commit`, { timeout: 15000 }, async t => {
    const worker = rawWorker(t, 'map-edit-country-commands.js');
    await worker.send(rebase());
    await worker.send(execute(1, 'merge', { sourceId: 'a', targetIds: ['b'] }));
    await worker.next(value => value.gate === 'import');
    await worker.send(invalidation === 'cancel' ? { type: 'cancel', requestId: 1 } : rebase());
    await worker.send({ control: 'release-import' });
    const response = await worker.result(1);
    assert.equal(response.cancelled, true);
    assert.equal(response.ok, false);
    await worker.send({ type: 'commit', requestId: 1, nextDataRevision: 2 });
    await worker.send(execute(2, 'merge', { sourceId: 'a', targetIds: ['b'] }));
    const fresh = await worker.result(2);
    assert.equal(fresh.ok, true);
    assert.deepEqual(fresh.result.removedIds, ['b']);
  });
}

for (const sharedModule of ['coordinate-bounds.js', 'polygon-clipping-calculation.js']) {
  test(`cancel while ${sharedModule} preloads rejects the request after initialization`, { timeout: 15000 }, async t => {
    const worker = rawWorker(t, sharedModule);
    await worker.send(rebase());
    await worker.send(execute(1, 'merge', { sourceId: 'a', targetIds: ['b'] }));
    await worker.next(value => value.gate === 'import');
    await worker.send({ type: 'cancel', requestId: 1 });
    await worker.send({ control: 'release-import' });
    const response = await worker.result(1);
    assert.equal(response.cancelled, true);
    assert.equal(response.ok, false);
  });
}

for (const invalidation of ['cancel', 'edit-sync', 'rebase']) {
  test(`${invalidation} at a real snap checkpoint cancels resumed work`, { timeout: 15000 }, async t => {
    const worker = rawWorker(t);
    await worker.send(rebase());
    await worker.send(execute(1, 'territorial-parents', { targetId: 'child', candidateIds: ['a'] }));
    assert.equal((await worker.result(1)).ok, true);
    await worker.send({ control: 'hold-timer' });
    await worker.send(execute(2, 'territorial-snap', { coordinate: [0, 0], margin: 0.1 }));
    await worker.next(value => value.gate === 'timer');
    await worker.send(invalidation === 'rebase' ? rebase() : invalidation === 'edit-sync'
      ? { type: 'edit-sync', sourceRevision: 2, patches: [], removedKeys: [] }
      : { type: 'cancel', requestId: 2 });
    await worker.send({ control: 'release-timer' });
    const response = await worker.result(2);
    assert.equal(response.cancelled, true);
    assert.equal(response.ok, false);
  });
}

test('omitted sourceRevision remains valid for source-sensitive operations and previews', { timeout: 15000 }, async t => {
  const worker = rawWorker(t);
  await worker.send(rebase());
  await worker.send(execute(1, 'territorial-snap', { coordinate: [0, 0], margin: 0.1 }, {}));
  const snap = await worker.result(1);
  assert.equal(snap.ok, true);
  assert.ok(snap.result.candidates.length);
  await worker.send(execute(2, 'territorial-edit', { operation: 'create', targetId: 'a', parentId: 'a', sovereignId: 'a',
    draft: square(2, 2, 3, 3), newFeature: feature('new-child', square(2, 2, 3, 3), { unitType: 'subunit', parentId: 'a', sovereignId: 'a' }),
  }, {}));
  const preview = await worker.result(2);
  assert.equal(preview.ok, true);
  assert.equal(preview.result.preview.validation.blocking, false);
});
