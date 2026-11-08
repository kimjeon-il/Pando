import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRuntimePerformanceMetrics, installRuntimePerformanceMetrics, PERFORMANCE_METRIC_NAMES,
} from "../../../src/runtime/runtime-performance-metrics.js";

function fakePerformance() {
  let at = 100;
  return {
    clock: {now: () => at, advance: ms => { at += ms; }},
    performance: {
      now: () => at,
      memory: {usedJSHeapSize: 1024, totalJSHeapSize: 2048, jsHeapSizeLimit: 4096},
      getEntriesByType: kind => kind === 'paint' ? [{name:'first-contentful-paint',startTime:at}] : [],
    },
  };
}

test('current performance telemetry records measured commands and frame timing, not source tokens', () => {
  const {clock,performance} = fakePerformance();
  const metrics = createRuntimePerformanceMetrics({
    globalObject: {performance}, performanceObject: performance,
    PerformanceObserverCtor: null, requestFrame: null, maxSamples: 3,
  });
  const token = metrics.beginInteraction(PERFORMANCE_METRIC_NAMES.COMMAND, {operation:'rebuild'});
  assert.ok(token);
  assert.equal(metrics.sampleInteractionFrame(token,clock.now()),true);
  clock.advance(18);
  assert.equal(metrics.sampleInteractionFrame(token,clock.now()),true);
  clock.advance(52);
  const completed = metrics.endInteraction(token, {outcome:'accepted'});
  assert.ok(completed.durationMs > 0);
  const snapshot = metrics.snapshot(), command = snapshot.operations[PERFORMANCE_METRIC_NAMES.COMMAND];
  assert.equal(command.count,1);
  assert.equal(command.last.detail.outcome,'accepted');
  assert.ok(command.last.detail.frameCount >= 2);
  assert.ok(command.last.detail.estimatedMissedFrames >= 0);
  assert.equal(snapshot.activeInteractions,0);
  assert.ok(snapshot.browser.paint['first-contentful-paint'] > 0);
  metrics.dispose();
  assert.equal(metrics.record('after-dispose',1),null);
});

test('telemetry samples are bounded and missing data is never fabricated', () => {
  const {clock,performance} = fakePerformance();
  const noMemory = {...performance, memory:undefined};
  const collector = createRuntimePerformanceMetrics({
    globalObject:{performance:noMemory},performanceObject:noMemory,PerformanceObserverCtor:null,maxSamples:2,
  });
  assert.equal(collector.sampleMemory('unsupported'),null);
  for(let i=0;i<6;i++){clock.advance(5);collector.record('render',i*5,{frame:i});}
  const report=collector.snapshot();
  assert.equal(report.operations.render.count,2);
  assert.deepEqual(report.operations.render.samples.map(row=>row.detail.frame),[4,5]);
  assert.deepEqual(report.memory,[]);
  collector.dispose();
});

test('the public diagnostic report follows the installed current runtime and reuses its instance', () => {
  const {clock,performance} = fakePerformance();
  const listenerMap=new Map();
  const globalObject={
    performance,
    __PANDOLAB_STARTUP_METRICS__:{interactiveMs:24,readyMs:60},
    addEventListener:(type,handler)=>listenerMap.set(type,handler),
    removeEventListener:type=>listenerMap.delete(type),
  };
  const first=installRuntimePerformanceMetrics({globalObject,documentRef:null});
  assert.strictEqual(installRuntimePerformanceMetrics({globalObject,documentRef:null}),first);
  assert.strictEqual(globalObject.__PANDOLAB_PERFORMANCE__,first);
  assert.equal(typeof globalObject.__PANDOLAB_PERFORMANCE_REPORT__,'function');
  clock.advance(20);
  listenerMap.get('pandolab:ready')();
  const output=globalObject.__PANDOLAB_PERFORMANCE_REPORT__();
  assert.equal(output.startup.readyMs,60);
  assert.ok(output.marks.some(mark=>mark.name==='ready'));
  assert.ok(output.memory.length>0);
  first.dispose();
  assert.equal(listenerMap.size,0);
});
