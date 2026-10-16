import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schedulePhysicalAfterCanonical } from '../../assets/js/modules/deferred-physical-startup.js';

test('physical resources are not loaded before canonical readiness and idle', () => {
  const callbacks = new Map(), idle = [];
  const scope = {
    addEventListener(event, fn, options) {
      assert.equal(options.once, true);
      callbacks.set(event, fn);
    },
    requestIdleCallback(fn, options) {
      assert.equal(options.timeout, 1500);
      idle.push(fn);
    },
  };
  let loads = 0;
  schedulePhysicalAfterCanonical({ scope, load: () => { loads++; } });
  assert.equal(loads, 0);
  callbacks.get('pandolab:ready')();
  assert.equal(loads, 0);
  assert.equal(idle.length, 1);
  idle[0]();
  idle[0]();
  assert.equal(loads, 1, 'duplicate idle invocation must not schedule a second physical load');
});

test('a WebView without requestIdleCallback still loads physical data after ready', () => {
  const callbacks = new Map(), timers = [];
  const scope = {
    addEventListener(name, fn) { callbacks.set(name, fn); },
    setTimeout(fn, delay) { assert.equal(delay, 0); timers.push(fn); },
  };
  let count = 0;
  schedulePhysicalAfterCanonical({ scope, load: () => { count++; } });
  assert.equal(timers.length, 0);
  callbacks.get('pandolab:ready')();
  assert.equal(count, 0);
  timers[0]();
  assert.equal(count, 1);
});
test('the scheduler rejects a missing event source or loader', () => {
  assert.throws(() => schedulePhysicalAfterCanonical({ scope: {} }), /event source/);
});
