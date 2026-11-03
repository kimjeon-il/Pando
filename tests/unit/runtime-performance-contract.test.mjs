import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const metrics=read('shared/frontend/js/modules/runtime-performance-metrics.js');
const projectDomain=read('shared/frontend/js/modules/project-domain.js');
test('current shared performance collector exposes diagnostic data without retired UI bootstrap',()=>{
 assert.match(metrics,/installRuntimePerformanceMetrics/);
 assert.match(metrics,/__PANDOLAB_PERFORMANCE_REPORT__/);
 assert.match(metrics,/PerformanceObserverCtor/);
 assert.match(metrics,/type, buffered: true/);
});
test('startup, frame cadence and paint telemetry keep bounded diagnostic fields',()=>{
 for(const name of ['firstLoadWindowMs','MOBILE_SHEET_DRAG','COMMIT_TO_PAINT','estimatedMissedFrames','usedJSHeapSize'])
  assert.ok(metrics.includes(name),name);
});
test('canonical project command instrumentation does not use the retired editor persistence owner',()=>{
 assert.ok(projectDomain.includes('PERFORMANCE_METRIC_NAMES.COMMAND'));
 assert.ok(!projectDomain.includes('apps/editor/frontend'));
});
