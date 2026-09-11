import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERFORMANCE_METRIC_NAMES,
  createRuntimePerformanceMetrics,
  installRuntimePerformanceMetrics,
} from '../../assets/js/modules/runtime-performance-metrics.js';
import { createProjectCommandPipeline } from '../../assets/js/modules/project-command-pipeline.js';
import { runProjectTransaction } from '../../assets/js/modules/project-transaction.js';
import { createPersistenceService } from '../../assets/js/modules/persistence-service.js';

class FakePerformanceObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.options = null;
    this.disconnected = false;
    FakePerformanceObserver.instances.push(this);
  }

  observe(options) {
    this.options = options;
  }

  disconnect() {
    this.disconnected = true;
  }

  emit(entries) {
    this.callback({ getEntries: () => entries });
  }
}

function createClock() {
  let value = 0;
  return {
    performance: {
      now: () => value,
      memory: {
        usedJSHeapSize: 10,
        totalJSHeapSize: 20,
        jsHeapSizeLimit: 100,
      },
    },
    advance: milliseconds => { value += milliseconds; return value; },
  };
}

test('records operation summaries and advisory startup data without mutating state owners', () => {
  const clock = createClock();
  const globalObject = {
    performance: clock.performance,
    __PANDOLAB_STARTUP_METRICS__: { interactiveMs: 1200, editableMs: 2400 },
  };
  const metrics = createRuntimePerformanceMetrics({
    globalObject,
    performanceObject: clock.performance,
    PerformanceObserverCtor: null,
  });

  clock.advance(10);
  metrics.mark('interactive');
  metrics.record(PERFORMANCE_METRIC_NAMES.AUTOSAVE, 25.25, { outcome: 'indexeddb' });
  metrics.record(PERFORMANCE_METRIC_NAMES.AUTOSAVE, 75.75, { outcome: 'fallback' });
  metrics.sampleMemory('after-save');

  const report = metrics.snapshot();
  assert.equal(report.version, 1);
  assert.equal(report.startup.interactiveMs, 1200);
  assert.equal(report.operations[PERFORMANCE_METRIC_NAMES.AUTOSAVE].count, 2);
  assert.equal(report.operations[PERFORMANCE_METRIC_NAMES.AUTOSAVE].totalMs, 101);
  assert.equal(report.operations[PERFORMANCE_METRIC_NAMES.AUTOSAVE].maxMs, 75.75);
  assert.equal(report.memory[0].label, 'after-save');
});

test('summarizes interaction frame cadence and long tasks', () => {
  FakePerformanceObserver.instances = [];
  const clock = createClock();
  let nextFrameId = 0;
  const frames = new Map();
  const metrics = createRuntimePerformanceMetrics({
    globalObject: { performance: clock.performance },
    performanceObject: clock.performance,
    PerformanceObserverCtor: FakePerformanceObserver,
    requestFrame: callback => { const id = ++nextFrameId; frames.set(id, callback); return id; },
    cancelFrame: id => frames.delete(id),
  });

  const support = metrics.observe();
  assert.equal(support.longtask, true);
  const longTaskObserver = FakePerformanceObserver.instances.find(observer => observer.options.type === 'longtask');
  const token = metrics.beginInteraction(PERFORMANCE_METRIC_NAMES.MOBILE_SHEET_DRAG, { panelId: 'rightPanel' });
  metrics.sampleInteractionFrame(token, clock.advance(16));
  metrics.sampleInteractionFrame(token, clock.advance(18));
  metrics.sampleInteractionFrame(token, clock.advance(50));
  longTaskObserver.emit([{ name: 'self', startTime: 20, duration: 55 }]);
  clock.advance(16);
  metrics.endInteraction(token, { cancelled: false });

  const report = metrics.snapshot();
  const summary = report.operations[PERFORMANCE_METRIC_NAMES.MOBILE_SHEET_DRAG];
  assert.equal(summary.count, 1);
  assert.equal(summary.last.detail.panelId, 'rightPanel');
  assert.equal(summary.last.detail.slowFrameCount, 1);
  assert.ok(summary.last.detail.estimatedMissedFrames >= 2);
  assert.equal(report.longTasks.firstLoadCount, 1);
  assert.equal(report.longTasks.firstLoadTotalMs, 55);
});

test('installs one global report API and reuses it idempotently', () => {
  const clock = createClock();
  const listeners = new Map();
  const globalObject = {
    performance: clock.performance,
    PerformanceObserver: null,
    requestAnimationFrame: callback => { callback(clock.advance(16)); return 1; },
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  };
  const documentRef = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const first = installRuntimePerformanceMetrics({ globalObject, documentRef });
  const second = installRuntimePerformanceMetrics({ globalObject, documentRef });
  assert.equal(first, second);
  assert.equal(typeof globalObject.__PANDOLAB_PERFORMANCE_REPORT__, 'function');
  assert.equal(globalObject.__PANDOLAB_PERFORMANCE_REPORT__().version, 1);
  first.dispose();
});

test('canonical command, transaction and persistence paths publish operation timings', async () => {
  const samples = [];
  globalThis.__PANDOLAB_PERFORMANCE__ = {
    version: 1,
    record: (name, durationMs, detail) => samples.push({ name, durationMs, detail }),
  };
  try {
    const commandPipeline = createProjectCommandPipeline({
      commands: { edit: { execute: () => ({ changed: true }), renderDirty: null } },
      captureSnapshot: () => ({ value: 1 }),
      validateProject: () => true,
    });
    assert.equal(commandPipeline.execute('edit').ok, true);

    const transaction = await runProjectTransaction({
      operationType: 'geometry-test',
      snapshot: { value: 1 },
      prepare: async () => ({ value: 2 }),
      applyCanonical: value => value,
    });
    assert.equal(transaction.ok, true);

    const tasks = new Map();
    const persistence = createPersistenceService({
      storage: {
        writeProject: async () => {},
        writeView: async () => {},
        readProject: async () => null,
        readView: async () => null,
        readFallback: () => null,
        writeFallback: () => {},
        removeFallback: () => {},
        deleteRecords: async () => {},
      },
      scheduler: {
        scheduleIdle: (key, task) => tasks.set(key, task),
        cancel: key => tasks.delete(key),
      },
      canPersist: () => true,
      buildAutosave: () => ({ format: 'pandolab-autosave-delta' }),
      readView: () => ({}),
      validateProject: value => value,
      onDirty: () => {},
      onAutosaveState: () => {},
      onSaved: () => {},
      onFailure: () => {},
    });
    await persistence.persist();

    assert.equal(samples.some(sample => sample.name === PERFORMANCE_METRIC_NAMES.COMMAND), true);
    assert.equal(samples.some(sample => sample.name === PERFORMANCE_METRIC_NAMES.TRANSACTION), true);
    assert.equal(samples.some(sample => sample.name === PERFORMANCE_METRIC_NAMES.AUTOSAVE), true);
  } finally {
    delete globalThis.__PANDOLAB_PERFORMANCE__;
  }
});
