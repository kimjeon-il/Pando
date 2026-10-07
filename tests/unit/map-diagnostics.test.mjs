import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedDiagnostic, logMapDiagnostic, withDiagnosticDeadline, withMapDiagnostics } from '../browser/helpers/map-diagnostics.mjs';

test('diagnostic summaries bound arrays, strings, depth and cycles without mutating input', () => {
  const source = { keys: Array.from({ length: 20 }, (_, i) => `key-${i}`), message: 'x'.repeat(1000) };
  source.self = source;
  const result = boundedDiagnostic(source);
  assert.equal(result.keys.count, 20);
  assert.equal(result.keys.items.length, 8);
  assert.ok(result.message.length < 300);
  assert.equal(result.self, '[circular]');
  assert.equal(source.keys.length, 20);
  assert.equal(source.message.length, 1000);
});

test('JSON diagnostics include boundary and phase and impose a total output bound', async () => {
  const lines = [];
  await logMapDiagnostic('selection', 'before', () => ({ values: Array.from({ length: 100 }, () => ({ long: 'x'.repeat(10000) })) }), line => lines.push(line));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length <= 24000);
  const row = JSON.parse(lines[0].slice('[map-diagnostic] '.length));
  assert.equal(row.boundary, 'selection');
  assert.equal(row.phase, 'before');
  assert.equal(row.data.values.count, 100);
});

test('failed diagnostic reads retain the exact original assertion error and run action once', async () => {
  const original = new Error('rendered coverage assertion');
  const lines = [];
  let attempts = 0;
  await assert.rejects(withMapDiagnostics('selection', () => { throw new Error('page closed'); }, async () => {
    attempts += 1;
    throw original;
  }, line => lines.push(line)), error => error === original);
  assert.equal(attempts, 1);
  assert.deepEqual(lines.map(line => JSON.parse(line.slice('[map-diagnostic] '.length)).phase), ['before', 'failed']);
  assert.ok(lines.every(line => line.includes('page closed')));
});

test('failed diagnostic output cannot fail a successful action or mask its result', async () => {
  const result = await withMapDiagnostics('color', () => ({ revision: 1 }), async () => 42, () => { throw new Error('closed output'); });
  assert.equal(result, 42);
});

test('nested diagnostic summaries stop at the depth limit', () => {
  let source = { leaf: true };
  for (let i = 0; i < 20; i++) source = { child: source };
  let result = boundedDiagnostic(source);
  for (let i = 0; i < 8; i++) result = result.child;
  assert.equal(result, '[depth limit]');
});

test('large escaped output stays valid JSON below the log limit', async () => {
  const source = Array.from({ length: 8 }, () => Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, '\\'.repeat(1000)])));
  const lines = [];
  await logMapDiagnostic('large-result', 'failed', () => source, line => lines.push(line));
  assert.ok(lines[0].length < 24000);
  assert.equal(JSON.parse(lines[0].slice('[map-diagnostic] '.length)).truncated, true);
});

test('successful boundary reports before/after once without repeating the action', async () => {
  let revision = 0;
  const lines = [];
  const result = await withMapDiagnostics('color', () => ({ revision }), async () => ++revision, line => lines.push(line));
  assert.equal(result, 1);
  assert.deepEqual(lines.map(line => JSON.parse(line.slice('[map-diagnostic] '.length))), [
    { boundary: 'color', phase: 'before', data: { revision: 0 } },
    { boundary: 'color', phase: 'after', data: { revision: 1 } },
  ]);
});


test('a never-settling failure read cannot hide the exact original assertion', { timeout: 4000 }, async () => {
  const original = new Error('original pixel assertion');
  let reads = 0;
  const lines = [];
  await assert.rejects(withMapDiagnostics('color', () => {
    if (++reads === 1) return { ready: true };
    return new Promise(() => {});
  }, async () => { throw original; }, line => lines.push(line)), error => error === original);
  const failed = JSON.parse(lines.at(-1).slice('[map-diagnostic] '.length));
  assert.equal(failed.phase, 'failed');
  assert.match(failed.data.diagnosticError.message, /Diagnostic read exceeded 1000 ms/);
});

test('a timed-out read contains its later rejection', async () => {
  let rejectRead;
  const pending = new Promise((_, reject) => { rejectRead = reject; });
  await assert.rejects(withDiagnosticDeadline(() => pending, 1), /Diagnostic read exceeded 1 ms/);
  rejectRead(new Error('late page closure'));
  // Flush the already-observed rejection; node:test reports any unhandled one.
  await Promise.resolve();
});

test('diagnostic deadlines clear timers after successful and rejected reads', async t => {
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (...args) => {
    const timer = originalSetTimeout(...args); timers.push(timer); return timer;
  });
  const cleared = t.mock.method(globalThis, 'clearTimeout', timer => originalClearTimeout(timer));
  assert.equal(await withDiagnosticDeadline(() => 42), 42);
  await assert.rejects(withDiagnosticDeadline(() => { throw new Error('read rejected'); }), /read rejected/);
  await assert.rejects(withDiagnosticDeadline(() => new Promise(() => {}), 1), /exceeded/);
  assert.deepEqual(cleared.mock.calls.map(call => call.arguments[0]), timers);
});
