import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHydroViewRequests } from '../../assets/js/modules/hydro-view-requests.js';

test('render frames cannot bypass backoff or exhaustion; stale timers and responses are ignored', () => {
  const timers = new Map();
  let timerId = 0, revision = 0, requests = 0, notifications = 0;
  const gate = createHydroViewRequests({
    schedule: callback => { timers.set(++timerId, callback); return timerId; },
    cancel: id => timers.delete(id),
    retry: () => { if (gate.start('A', revision + 1)) { revision++; requests++; } },
    notify: () => notifications++,
  });
  assert.equal(gate.start('A', ++revision), true); requests++;
  for (let attempt = 0; attempt < 4; attempt++) {
    gate.fail(revision, { retryable: true });
    for (let frame = 0; frame < 100; frame++) assert.equal(gate.start('A', revision + 1), false);
    const entry = timers.entries().next().value;
    if (entry) { timers.delete(entry[0]); entry[1](); }
  }
  assert.equal(requests, 4);
  assert.equal(notifications, 1);
  assert.equal(gate.start('B', ++revision), true);
  assert.equal(gate.start('A', revision + 1), false);
  assert.equal(gate.fail(revision, {}), false);
  gate.retryCurrent();
  assert.equal(gate.start('A', ++revision), true);
  gate.fail(revision, {});
  const stale = [...timers.values()][0];
  gate.reset(); stale();
  assert.equal(requests, 4);
  assert.equal(gate.ready(revision), false);
});

test('switching tile keys invalidates old retry callbacks without clearing failure history', () => {
  const callbacks = [];
  const delays = [];
  let retried = 0;
  const gate = createHydroViewRequests({
    schedule: (callback, delay) => { callbacks.push(callback); delays.push(delay); return callbacks.length; },
    cancel: () => {}, retry: () => retried++, notify: () => {},
  });
  gate.start('A', 1); gate.fail(1, {});
  assert.ok(delays[0] > 350 && delays[0] <= 400);
  gate.start('B', 2);
  callbacks[0]();
  assert.equal(retried, 0);
  assert.equal(gate.start('A', 3), false);
  callbacks.at(-1)();
  assert.equal(retried, 1);
  assert.equal(gate.start('A', 3), true);
  gate.fail(3, {});
  assert.ok(delays.at(-1) > 750 && delays.at(-1) <= 800);
});

function harness({ badRange = false, badFull = false, quota = false, payload = gzipSync(Buffer.from('water')) } = {}) {
  const scope = { self: {}, Response, Uint8Array };
  vm.runInNewContext(readFileSync(new URL('../../assets/js/workers/hydro-shard-store.js', import.meta.url), 'utf8'), scope);
  const spec = { id: 0, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), url: 'shard0' };
  const entries = new Map([['unrelated', new Response('keep')]]);
  const calls = [];
  const cache = {
    match: async key => entries.get(key)?.clone(),
    delete: async key => entries.delete(key),
    put: async (key, value) => { if (quota) throw Error('quota'); entries.set(key, value); },
  };
  const store = scope.self.createHydroShardStore({
    openCache: async () => cache,
    resolveUrl: value => value,
    gunzip: value => new Uint8Array(gunzipSync(value)),
    digest: async value => createHash('sha256').update(value).digest('hex'),
    fetchResponse: async (_url, options) => {
      calls.push(options);
      if (options.headers?.Range) return new Response(payload, { status: 206, headers: { 'Content-Range': badRange ? 'bytes 1-2/3' : `bytes 0-${payload.length - 1}/${payload.length}` } });
      return new Response(badFull ? new Uint8Array(payload.length) : payload);
    },
  });
  const read = () => store.read(spec, [{ id: 7, offset: 0, length: payload.length }], 0, payload.length);
  return { store, entries, calls, read, spec };
}

test('truncated and wrong-hash caches recover once, preserve other entries and share concurrent work', async () => {
  for (const truncated of [true, false]) {
    const h = harness();
    h.entries.set('shard0', new Response(new Uint8Array(truncated ? 2 : h.spec.bytes)));
    const results = await Promise.all([h.read(), h.read()]);
    assert.equal(Buffer.from(results[0][0][1]).toString(), 'water');
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].cache, 'no-store');
    assert.equal(h.entries.has('unrelated'), true);
    await h.store.full(h.spec);
    assert.equal(h.calls.length, 1);
  }
});

test('incorrect Range recovers; quota failure does not prevent use', async () => {
  const h = harness({ badRange: true, quota: true });
  const result = await h.read();
  assert.equal(Buffer.from(result[0][1]).toString(), 'water');
  assert.equal(h.calls.length, 2);
  await h.read();
  assert.equal(h.calls.length, 2);
});

test('failed recovery is terminal and explicit retry resets its limit', async () => {
  const h = harness({ badRange: true, badFull: true });
  await assert.rejects(h.read(), error => error.retryable === false && error.diagnostic.stage === 'hash');
  await assert.rejects(h.read());
  assert.equal(h.calls.length, 2);
  h.store.retry();
  await assert.rejects(h.read());
  assert.equal(h.calls.length, 4);
});

test('invalid gzip with valid file hash fails once after recovery and purges only its shard', async () => {
  const h = harness({ payload: Buffer.from('not gzip') });
  await assert.rejects(h.read(), error => error.retryable === false && error.diagnostic.stage === 'gzip' && error.diagnostic.packId === 7);
  await assert.rejects(h.read());
  assert.equal(h.calls.length, 2);
  assert.equal(h.entries.has('shard0'), false);
  assert.equal(h.entries.has('unrelated'), true);
});
