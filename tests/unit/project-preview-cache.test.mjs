import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectPreviewCache } from '../../assets/js/modules/project-preview-cache.js';

function previewCache(t) {
  const workers = [];
  const warnings = [];
  class FakeWorker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(result) { this.onmessage({ data: { id: this.messages.at(-1).id, ok: true, result } }); }
  }
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  t.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });
  const project = {};
  const stored = { geometryKey: 'same-key', baseSourceSha256: 'baseline' };
  const cache = createProjectPreviewCache({
    storage: { readPreview: async () => stored },
    scheduler: { cancel() {} },
    getGeometry: () => null,
    getBaseline: () => ({ sourceSha256: 'baseline' }),
    onWarning: (message, error) => warnings.push({ message, error }),
  });
  t.after(() => cache.cancel());
  return { cache, project, workers, warnings };
}

async function finishEnsure(worker, pending) {
  worker.reply('same-key');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(worker.messages.at(-1).type, 'validate');
  worker.reply({ valid: true });
  assert.equal(await pending, true);
}

test('a cancelled preview worker error cannot terminate replacement ensure', async t => {
  const { cache, project, workers, warnings } = previewCache(t);
  const first = cache.ensure(project);
  const retiredError = workers[0].onerror;
  cache.cancel();
  assert.equal(await first, false);
  const replacement = cache.ensure(project);
  retiredError({ message: 'late retired import failure' });
  assert.equal(workers[1].terminated, false);
  assert.equal(workers.length, 2);
  await finishEnsure(workers[1], replacement);
  assert.equal(warnings.length, 1, 'only the original cancellation should warn');
  assert.equal(workers[1].terminated, true, 'idle cache workers are released');
});

test('retired preview messages cannot resolve replacement work', async t => {
  const { cache, project, workers } = previewCache(t);
  const first = cache.ensure(project);
  const retiredMessage = workers[0].onmessage;
  cache.cancel();
  assert.equal(await first, false);
  const replacement = cache.ensure(project);
  const request = workers[1].messages[0];
  retiredMessage({ data: { id: request.id, ok: true, result: 'retired-key' } });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(workers[1].terminated, false);
  assert.equal(workers[1].messages.length, 1);
  await finishEnsure(workers[1], replacement);
});

test('an idle-released preview worker cannot crash its replacement', async t => {
  const { cache, project, workers } = previewCache(t);
  const first = cache.ensure(project);
  const retiredError = workers[0].onerror;
  await finishEnsure(workers[0], first);
  assert.equal(workers[0].terminated, true);
  const replacement = cache.ensure(project);
  retiredError({ message: 'late idle worker failure' });
  assert.equal(workers[1].terminated, false);
  await finishEnsure(workers[1], replacement);
});

test('active preview worker failures still warn and settle ensure false', async t => {
  const { cache, project, workers, warnings } = previewCache(t);
  const pending = cache.ensure(project);
  let prevented = false;
  workers[0].onerror({ message: 'NetworkError: importScripts failed', preventDefault: () => { prevented = true; } });
  assert.equal(await pending, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'Project preview cache unavailable');
  assert.equal(warnings[0].error.message, 'NetworkError: importScripts failed');
  assert.equal(prevented, false);
  assert.equal(workers[0].terminated, true);
});

for (const retirement of ['cancel', 'idle']) {
  test(`preview ${retirement} detaches native handlers before termination`, async t => {
    const { cache, project, workers } = previewCache(t);
    const pending = cache.ensure(project);
    const worker = workers[0];
    const capturedMessage = worker.onmessage;
    let handlersAtTermination;
    worker.terminate = () => {
      handlersAtTermination = [worker.onmessage, worker.onerror];
      capturedMessage({ data: { id: worker.messages.at(-1).id, ok: true, result: 'retired result' } });
    };
    if (retirement === 'cancel') {
      cache.cancel();
      assert.equal(await pending, false);
    } else await finishEnsure(worker, pending);
    assert.deepEqual(handlersAtTermination, [null, null]);
  });
}
