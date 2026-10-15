import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectPreviewCache } from '../../assets/js/modules/project-preview-cache.js';

function previewCache(t, options = {}) {
  const workers = [];
  const warnings = [];
  const waiting=new Map();
  const ready=index=>workers[index] ? Promise.resolve(workers[index]):new Promise(resolve=>waiting.set(index,resolve));
  class FakeWorker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this);options.onWorkerCreated?.(this);waiting.get(workers.length-1)?.(this); }
    postMessage(message) { this.messages.push(message); options.onPostMessage?.(this, message); }
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
    storage: { readPreview: async () => stored, ...options.storage },
    scheduler: { cancel() {} },
    getGeometry: options.getGeometry || (() => null),
    getBaseline: () => ({ sourceSha256: 'baseline' }),
    getPreviewSource:options.getPreviewSource || (async project=>({project,territorialViews:[]})),
    onWarning: (message, error) => warnings.push({ message, error }),
  });
  t.after(() => cache.cancel());
  return { cache, project, workers, warnings,ready };
}

function barrier() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}

const autoReply = (worker, message) => globalThis.queueMicrotask(() => {
  if (!worker.terminated) worker.reply(message.type === 'key' ? 'same-key'
    : { geometryKey: 'same-key', baseSourceSha256: 'baseline' });
});

async function finishEnsure(worker, pending) {
  worker.reply('same-key');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(worker.messages.at(-1).type, 'validate');
  worker.reply({ valid: true });
  assert.equal(await pending, true);
}

test('a cancelled preview worker error cannot terminate replacement ensure', async t => {
  const { cache, project, workers, warnings,ready } = previewCache(t);
  const first = cache.ensure(project);
  await ready(0);
  const retiredError = workers[0].onerror;
  cache.cancel();
  assert.equal(await first, false);
  const replacement = cache.ensure(project);
  await ready(1);
  retiredError({ message: 'late retired import failure' });
  assert.equal(workers[1].terminated, false);
  assert.equal(workers.length, 2);
  await finishEnsure(workers[1], replacement);
  assert.equal(warnings.length, 0, 'superseded preview preparation is expected cancellation');
  assert.equal(workers[1].terminated, true, 'idle cache workers are released');
});

test('retired preview messages cannot resolve replacement work', async t => {
  const { cache, project, workers,ready } = previewCache(t);
  const first = cache.ensure(project);
  await ready(0);
  const retiredMessage = workers[0].onmessage;
  cache.cancel();
  assert.equal(await first, false);
  const replacement = cache.ensure(project);
  await ready(1);
  const request = workers[1].messages[0];
  retiredMessage({ data: { id: request.id, ok: true, result: 'retired-key' } });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(workers[1].terminated, false);
  assert.equal(workers[1].messages.length, 1);
  await finishEnsure(workers[1], replacement);
});

test('an idle-released preview worker cannot crash its replacement', async t => {
  const { cache, project, workers,ready } = previewCache(t);
  const first = cache.ensure(project);
  await ready(0);
  const retiredError = workers[0].onerror;
  await finishEnsure(workers[0], first);
  assert.equal(workers[0].terminated, true);
  const replacement = cache.ensure(project);
  await ready(1);
  retiredError({ message: 'late idle worker failure' });
  assert.equal(workers[1].terminated, false);
  await finishEnsure(workers[1], replacement);
});

test('active preview worker failures still warn and settle ensure false', async t => {
  const { cache, project, workers, warnings,ready } = previewCache(t);
  const pending = cache.ensure(project);
  await ready(0);
  let prevented = false;
  workers[0].onerror({ message: 'NetworkError: importScripts failed', preventDefault: () => { prevented = true; } });
  assert.equal(await pending, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'Project preview cache unavailable');
  assert.equal(warnings[0].error.message, 'NetworkError: importScripts failed');
  assert.equal(prevented, true);
  assert.equal(workers[0].terminated, true);
});

for (const retirement of ['cancel', 'idle']) {
  test(`preview ${retirement} isolates late native errors before termination`, async t => {
    const { cache, project, workers,ready } = previewCache(t);
    const pending = cache.ensure(project);
    await ready(0);
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
    assert.equal(handlersAtTermination[0], null);
    assert.equal(typeof handlersAtTermination[1], 'function');
    let prevented = false;
    handlersAtTermination[1]({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'late native errors remain inside the preview cache boundary');
  });
}

test('async geometry is awaited and previews the same persisted project', async t => {
  const requested = barrier(), geometry = barrier(), writes = [];
  let currentProject;
  const { cache, project, workers } = previewCache(t, {
    onPostMessage: autoReply,
    storage: { readPreview: async () => null, readProject: async () => currentProject,
      writePreview: async value => writes.push(value) },
    getGeometry: async () => { requested.release(); return geometry.wait; },
  });
  currentProject = project;
  const pending = cache.ensure(project);
  await requested.wait;
  assert.deepEqual(workers[0].messages.map(row => row.type), ['key']);
  const entities = [{ id: 'A', geometry: { type: 'Point', coordinates: [1,2] } }];
  geometry.release({ project, entities });
  assert.equal(await pending, true);
  assert.deepEqual(workers[0].messages.find(row => row.type === 'build').entities, entities);
  assert.equal(writes.length, 1);
});

test('cancelled async geometry cannot restart a retired preview worker', async t => {
  const requested = barrier(), geometry = barrier(), writes = [];
  const { cache, project, workers } = previewCache(t, {
    onPostMessage: autoReply,
    storage: { readPreview: async () => null, readProject: async () => project,
      writePreview: async value => writes.push(value) },
    getGeometry: async () => { requested.release(); return geometry.wait; },
  });
  const pending = cache.ensure(project);
  await requested.wait;
  cache.cancel();
  geometry.release({ project, entities: [{ id: 'old' }] });
  assert.equal(await pending, false);
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].messages.map(row => row.type), ['key']);
  assert.deepEqual(writes, []);
});

test('late preview read after project cancellation never installs a validation worker', async t => {
  const reading = barrier(), preview = barrier(), created = barrier();
  const { cache, project, workers } = previewCache(t, {
    onWorkerCreated: () => created.release(),
    storage: { readPreview: async () => { reading.release(); return preview.wait; } },
  });
  const pending = cache.restore(project);
  await reading.wait;
  cache.cancel();
  preview.release({ geometryKey: 'old-key', baseSourceSha256: 'baseline' });
  const result = await Promise.race([pending.then(() => 'completed'), created.wait.then(() => 'late-worker')]);
  if (result === 'late-worker') cache.cancel();
  assert.equal(result, 'completed');
  assert.equal(await pending, null);
  assert.equal(workers.length, 0);
});

test('cancelled Core source inspection cannot create a preview Worker or write display data',async t=>{
  const requested=barrier(),source=barrier(),writes=[];
  const {cache,project,workers}=previewCache(t,{getPreviewSource:async()=>{requested.release();return source.wait;},
    storage:{writePreview:async value=>writes.push(value)}});
  const pending=cache.ensure(project);await requested.wait;cache.cancel();
  source.release({project,territorialViews:[]});
  assert.equal(await pending,false);assert.deepEqual(workers,[]);assert.deepEqual(writes,[]);
});
