import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinMonthClock} from '../../shared/frontend/js/modules/builtin-month-clock.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
function fixture() {
  const requests = [], commits = [];
  const clock = createBuiltinMonthClock({now: () => new Date(2026, 9, 31, 12),
    applyMonth: (month, controls) => {const done = deferred(); requests.push({month, ...controls, ...done}); return done.promise;},
    onCommitted: month => commits.push(month)});
  return {clock, requests, commits};
}
test('P0 commits visible time only when the presentation callback accepts it', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const pending = clock.selectMonth('1950-12'); assert.equal(clock.month(), null);
  assert.equal(requests[0].commit(), true); assert.equal(clock.month(), '1950-12');
  assert.equal(requests[0].commit(), false); requests[0].resolve(true); await pending;
  assert.deepEqual(commits, ['1950-12']);
});
test('P0 reverse completion cannot commit the older target', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const old = clock.selectMonth('1950-12'), current = clock.selectMonth('1951-12');
  assert.equal(requests[0].isCurrent(), false); assert.equal(requests[0].commit(), false);
  requests[1].commit(); requests[1].resolve(true); assert.equal(await current, true);
  requests[0].resolve(true); assert.equal(await old, false);
  assert.equal(clock.month(), '1951-12'); assert.deepEqual(commits, ['1951-12']);
});
test('P0 a failed target keeps the last committed time and remains an error', async t => {
  const {clock, requests} = fixture(); t.after(() => clock.dispose());
  const first = clock.selectMonth('1950-12'); requests[0].commit(); requests[0].resolve(true); await first;
  const failed = clock.selectMonth('1951-12'), assertion = assert.rejects(failed, /source failed/);
  requests[1].reject(new Error('source failed')); await assertion;
  assert.equal(clock.month(), '1950-12');
});
test('P0 stale failures do not reject or overwrite a newer successful target', async t => {
  const {clock, requests} = fixture(); t.after(() => clock.dispose());
  const old = clock.selectMonth('1950-12'), current = clock.selectMonth('1951-12');
  requests[1].commit(); requests[1].resolve(true); await current;
  requests[0].reject(new Error('stale source failed')); assert.equal(await old, false);
  assert.equal(clock.month(), '1951-12');
});
test('P0 A to B to A cannot publish the abandoned middle state', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const a = clock.selectMonth('1950-12'); requests[0].commit(); requests[0].resolve(true); await a;
  const b = clock.selectMonth('1951-12'), back = clock.selectMonth('1950-12');
  requests[2].commit(); requests[2].resolve(true); await back;
  assert.equal(requests[1].commit(), false); requests[1].resolve(true); await b;
  assert.deepEqual(commits, ['1950-12', '1950-12']);
});
test('P0 suspending builtin mode invalidates late presentation after a file opens', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const pending = clock.selectMonth('1950-12'); clock.suspend();
  assert.equal(requests[0].commit(), false); requests[0].resolve(true);
  assert.equal(await pending, false); assert.deepEqual(commits, []);
});
