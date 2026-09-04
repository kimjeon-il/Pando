import assert from 'node:assert/strict';
import test from 'node:test';

import { createStartupTaskGate } from '../../assets/js/modules/startup-task-gate.js';

function createClock() {
  let current = 0;
  let nextId = 0;
  const timers = new Map();
  const setTimer = (callback, delay = 0) => {
    const id = ++nextId;
    timers.set(id, { callback, due: current + delay });
    return id;
  };
  const clearTimer = id => timers.delete(id);
  const advance = async milliseconds => {
    current += milliseconds;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const ready = [...timers.entries()].filter(([, timer]) => timer.due <= current);
      for (const [id, timer] of ready) {
        timers.delete(id);
        timer.callback();
        progressed = true;
        await Promise.resolve();
      }
    }
  };
  return { advance, clearTimer, now: () => current, setTimer };
}

test('canonical work waits for paint and a complete quiet window', async () => {
  const clock = createClock();
  const calls = [];
  const gate = createStartupTaskGate({
    quietWindowMs: 500,
    requestIdleCallback: callback => { callback(); return 1; },
    cancelIdleCallback: () => {},
    isInputPending: () => false,
    isDocumentHidden: () => false,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
  });
  gate.queue('geometry', () => calls.push('geometry'));
  await clock.advance(1000);
  assert.deepEqual(calls, []);
  gate.markInteractivePaint();
  await clock.advance(499);
  assert.deepEqual(calls, []);
  await clock.advance(1);
  assert.deepEqual(calls, ['geometry']);
});

test('input restarts the quiet window and duplicate task keys are ignored', async () => {
  const clock = createClock();
  const calls = [];
  const gate = createStartupTaskGate({
    quietWindowMs: 500,
    requestIdleCallback: callback => { callback(); return 1; },
    cancelIdleCallback: () => {},
    isInputPending: () => false,
    isDocumentHidden: () => false,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
  });
  gate.markInteractivePaint();
  assert.equal(gate.queue('geometry', () => calls.push('first')), true);
  assert.equal(gate.queue('geometry', () => calls.push('duplicate')), false);
  await clock.advance(499);
  gate.noteInput({ active: true });
  await clock.advance(500);
  assert.deepEqual(calls, []);
  gate.noteInput({ active: false });
  await clock.advance(499);
  assert.deepEqual(calls, []);
  await clock.advance(1);
  assert.deepEqual(calls, ['first']);
});

test('running tasks can cooperatively wait for a new quiet window and yield a frame', async () => {
  const clock = createClock();
  let settled = false;
  let frameCount = 0;
  const gate = createStartupTaskGate({
    quietWindowMs: 500,
    requestIdleCallback: callback => { callback(); return 1; },
    cancelIdleCallback: () => {},
    isInputPending: () => false,
    isDocumentHidden: () => false,
    requestFrame: callback => { frameCount += 1; callback(); return frameCount; },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
  });
  gate.markInteractivePaint();
  const quiet = gate.waitForQuiet().then(() => { settled = true; });
  await clock.advance(499);
  assert.equal(settled, false);
  gate.noteInput({ active: false });
  await clock.advance(499);
  assert.equal(settled, false);
  await clock.advance(1);
  await quiet;
  assert.equal(settled, true);
  await gate.yieldFrame();
  assert.equal(frameCount, 1);
});
