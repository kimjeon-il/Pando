import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePerformanceManifest, assemblePerformanceEvidence } from '../../scripts/assemble-performance-evidence.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../config/performance-baseline-v1.json', import.meta.url), 'utf8'));
const sourceCommit = 'a'.repeat(40);
function packed() {
  return { schema: 'pando-soviet-packed-boundary-v1', variant: 'packed', sourceCommit,
    measurements: {
      dimensions: { countries: 254, sourceSegments: 544163, sharedSegments: 68616,
        contacts: 339, packedSourceSegments: 540989, typedStorageMiB: 22.7852 },
      worker: { jsMiB: 194.68, totalWorkerJsMiB: 249.22,
        wasmLinearMiB: 57.63, totalWorkerWasmMiB: 403.5, complete: true },
      chromium: { pssMiB: 1841.82, available: true },
      toSovietMs: 3071, toModernMs: 7935,
    } };
}
function twelveCycles() {
  return { schema: 'pando-main-equivalent-12cycle-memory-v1', testSha: sourceCommit,
    cyclesCompleted: 12, errors: [], initialAutosaves: 0, finalAutosaves: 0,
    summary: { eligibleSettledModernReturns: 11, excludedFromIdleMedians: ['modern-1'],
      comparisons: {
        borderJsMiB: { first4Median: 227.74, last4Median: 227.75 },
        workerJsMiB: { first4Median: 238.57, last4Median: 238.59 },
        workerWasmMiB: { first4Median: 387.5, last4Median: 387.5 },
        strokeGpuMiB: { first4Median: 34.65, last4Median: 41.32 },
      },
      finalIdle: { borderJsMiB: 194.87, workerJsMiB: 205.72,
        workerWasmMiB: 387.5, pssMiB: 1844.01, strokeGpuMiB: 41.32 },
    } };
}

test('all retained performance suites and historical references exist, budgets remain UNSET', () => {
  const result = validatePerformanceManifest(manifest);
  assert.equal(result.frozenCommit, '2279b94f0713f08070a0c5e146be5566de35fc45');
  assert.equal(result.measurementBudgetApproved, false);
  assert.ok(result.suiteCount >= 9);
  assert.equal(manifest.observations.packedPair.runId, 39025083891);
  assert.equal(manifest.observations.packedLongCycle.runId, 39025645298);
  assert.ok(manifest.suites.some(row => row.id === 'cursor-core-wasm'));
  assert.ok(manifest.suites.some(row => row.id === 'boundary-heap-owner-release'
    && row.level === 'destructive-isolated-diagnostic'));
});

test('one-return and long-cycle metrics have distinct units and sampling intervals', () => {
  const result = assemblePerformanceEvidence({ manifest, packed: packed(), longCycle: twelveCycles(), sourceCommit });
  assert.equal(result.schema, 'pando-performance-evidence-v1');
  assert.equal(result.status, 'complete');
  assert.equal(result.oneReturn.borderWorkerJsMiB, 194.68);
  assert.equal(result.oneReturn.chromiumPssMiB, 1841.82);
  assert.equal(result.oneReturn.borderWorkerWasmLinearMiB, 57.63);
  assert.equal(result.oneReturn.contactCount, 339);
  assert.equal(result.twelveCycles.borderWorkerJsFirst4MiB, 227.74);
  assert.equal(result.twelveCycles.borderWorkerJsLast4MiB, 227.75);
  assert.equal(result.twelveCycles.finalIdle30s.borderWorkerJsMiB, 194.87);
  assert.equal(result.twelveCycles.finalIdle30s.gpuStrokeTrackedMiB, 41.32);
  assert.equal(result.twelveCycles.fullAutosaveDelta, 0);
  assert.equal(result.limits.memoryBucketsMustNotBeAdded, true);
  assert.equal(result.limits.gpuTrackedNotVram, true);
  assert.equal(result.limits.acceptanceBudgetApproved, false);
});

test('partial evidence preserves unavailable metrics as null, never fabricated zero', () => {
  const p = packed();
  delete p.measurements.worker.totalWorkerJsMiB;
  delete p.measurements.toSovietMs;
  const result = assemblePerformanceEvidence({ manifest, packed: p, sourceCommit });
  assert.equal(result.status, 'partial');
  assert.equal(result.oneReturn.totalWorkerJsMiB, null);
  assert.equal(result.oneReturn.toSovietMs, null);
  assert.equal(result.twelveCycles, null);
  const cyclesOnly = assemblePerformanceEvidence({ manifest, longCycle: twelveCycles(), sourceCommit });
  assert.equal(cyclesOnly.status, 'partial');
  assert.equal(cyclesOnly.oneReturn, null);
  assert.equal(cyclesOnly.twelveCycles.finalIdle30s.chromiumPssMiB, 1844.01);
});

test('reject stale source provenance, missing worker attribution, and incomplete cycles', () => {
  const first = packed(); first.sourceCommit = 'b'.repeat(40);
  assert.throws(() => assemblePerformanceEvidence({ manifest, packed: first, sourceCommit }), /PERF_SOURCE_MISMATCH/);
  const second = packed(); second.measurements.worker.complete = false;
  assert.throws(() => assemblePerformanceEvidence({ manifest, packed: second, sourceCommit }), /Missing Worker/);
  const third = packed(); third.measurements.dimensions.contacts = 338;
  assert.throws(() => assemblePerformanceEvidence({ manifest, packed: third, sourceCommit }), /PERF_GEOMETRY_REBASE_REQUIRED/);
  const fourth = twelveCycles(); fourth.testSha = 'b'.repeat(40);
  assert.throws(() => assemblePerformanceEvidence({ manifest, longCycle: fourth, sourceCommit }), /PERF_SOURCE_MISMATCH/);
  const fifth = twelveCycles(); fifth.cyclesCompleted = 11;
  assert.throws(() => assemblePerformanceEvidence({ manifest, longCycle: fifth, sourceCommit }), /Incomplete historical month/);
  const sixth = twelveCycles(); sixth.finalAutosaves = 1;
  assert.throws(() => assemblePerformanceEvidence({ manifest, longCycle: sixth, sourceCommit }), /full autosaves/);
  assert.throws(() => assemblePerformanceEvidence({ manifest, sourceCommit }), /PERF_NO_SOURCE_EVIDENCE/);
  assert.throws(() => assemblePerformanceEvidence({ manifest, packed: packed(), sourceCommit: null }), /PERF_SOURCE_COMMIT_REQUIRED/);
});

test('no accepted hardware performance budgets can be invented by changing a fixture', () => {
  const modified = structuredClone(manifest);
  modified.measurementPolicy.thresholdsApproved = true;
  assert.throws(() => validatePerformanceManifest(modified, { checkPaths: false }), /No performance budget/);
  modified.measurementPolicy.thresholdsApproved = false;
  modified.suites.push({ ...modified.suites[0] });
  assert.throws(() => validatePerformanceManifest(modified, { checkPaths: false }), /Duplicate or missing suite ID/);
});
