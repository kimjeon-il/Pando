import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const uiRuntime = read('assets/js/modules/ui-runtime.js');
const persistence = read('assets/js/modules/persistence-service.js');
const transaction = read('assets/js/modules/project-transaction.js');
const commandPipeline = read('assets/js/modules/project-command-pipeline.js');
const metrics = read('assets/js/modules/runtime-performance-metrics.js');

test('runtime performance collector is installed once from the canonical UI runtime', () => {
  assert.match(uiRuntime, /installRuntimePerformanceMetrics/);
  assert.match(uiRuntime, /installRuntimePerformanceMetrics\(\{ globalObject: window, documentRef \}\)/);
  assert.match(metrics, /__PANDOLAB_PERFORMANCE_REPORT__/);
  assert.match(metrics, /PerformanceObserverCtor/);
  assert.match(metrics, /type, buffered: true/);
});

test('performance report covers startup long tasks, mobile sheet cadence and commit-to-paint', () => {
  assert.match(metrics, /firstLoadWindowMs/);
  assert.match(metrics, /MOBILE_SHEET_DRAG: 'mobile-sheet\.drag'/);
  assert.match(metrics, /COMMIT_TO_PAINT: 'ui\.commit-to-paint'/);
  assert.match(metrics, /estimatedMissedFrames/);
  assert.match(metrics, /usedJSHeapSize/);
});

test('edit transactions, ordinary project commands and autosave publish timings without owning domain state', () => {
  assert.match(transaction, /PERFORMANCE_METRIC_NAMES\.TRANSACTION/);
  assert.match(transaction, /stageDurations/);
  assert.match(commandPipeline, /PERFORMANCE_METRIC_NAMES\.COMMAND/);
  assert.match(persistence, /PERFORMANCE_METRIC_NAMES\.AUTOSAVE/);
  assert.match(persistence, /buildMs/);
  assert.match(persistence, /indexedDbMs/);
  assert.match(persistence, /fallbackMs/);
});
