// Normalize existing Soviet Chromium evidence without introducing a second
// memory probe, changing product code, or claiming that PSS equals GPU VRAM.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const strictSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const requiredNumber = (value, name) => assert.ok(finite(value) !== null, 'PERF_MISSING_METRIC: ' + name);

export function validatePerformanceManifest(manifest, { rootDir = root, checkPaths = true } = {}) {
  assert.equal(manifest?.schema, 'pando-performance-baseline-manifest-v1');
  for (const key of ['frozenProductCommit', 'prePackedCommit', 'packedMeasurementSourceCommit'])
    assert.ok(strictSha(manifest.source?.[key]), 'PERF_BAD_SOURCE_COMMIT: ' + key);
  assert.equal(manifest.measurementPolicy?.thresholdsApproved, false,
    'No performance budget was approved from hosted CI samples');
  assert.equal(manifest.measurementPolicy?.missingData, 'null, never zero');
  assert.ok(Array.isArray(manifest.scope?.viewport) && manifest.scope.viewport.length === 2);
  assert.equal(manifest.scope?.sovietMonth, '1989-06');
  assert.ok(Array.isArray(manifest.suites) && manifest.suites.length >= 7);
  const seen = new Set();
  for (const suite of manifest.suites) {
    assert.ok(typeof suite.id === 'string' && !seen.has(suite.id), 'Duplicate or missing suite ID');
    seen.add(suite.id);
    assert.ok(Array.isArray(suite.tests) && suite.tests.length);
    if (checkPaths) for (const file of [suite.workflow, ...suite.tests]) {
      assert.ok(!file.includes('..') && !file.startsWith('/'), 'Invalid test asset path: ' + file);
      assert.ok(existsSync(resolve(rootDir, file)), 'Missing active test asset: ' + file);
    }
  }
  return { suiteCount: seen.size, measurementBudgetApproved: false, frozenCommit: manifest.source.frozenProductCommit };
}

export function assemblePerformanceEvidence({ manifest, packed = null, longCycle = null, sourceCommit = null }) {
  validatePerformanceManifest(manifest, { checkPaths: false });
  assert.ok(strictSha(sourceCommit), 'PERF_SOURCE_COMMIT_REQUIRED: do not use an unbound performance result');
  assert.ok(packed || longCycle, 'PERF_NO_SOURCE_EVIDENCE');
  if (packed?.sourceCommit) assert.equal(packed.sourceCommit, sourceCommit, 'PERF_SOURCE_MISMATCH: packed');
  if (longCycle?.testSha) assert.equal(longCycle.testSha, sourceCommit, 'PERF_SOURCE_MISMATCH: longCycle');
  const result = {
    schema: 'pando-performance-evidence-v1',
    sourceCommit,
    referenceCommit: manifest.source.frozenProductCommit,
    scenario: {
      sovietMonth: manifest.scope.sovietMonth, modernMonth: manifest.scope.modernMonth,
      viewport: manifest.scope.viewport, platform: manifest.scope.platform,
      browser: manifest.scope.browser,
    },
    status: packed && longCycle ? 'complete' : 'partial',
    oneReturn: null, twelveCycles: null,
    units: { memory: 'MiB', time: 'ms' },
    limits: {
      memoryBucketsMustNotBeAdded: true,
      chromiumPssNotWorkerAttribution: true,
      wasmLinearNotLiveCppHeap: true,
      gpuTrackedNotVram: true,
      acceptanceBudgetApproved: false,
    },
  };

  if (packed) {
    assert.equal(packed.schema, 'pando-soviet-packed-boundary-v1');
    assert.equal(packed.variant, 'packed', 'Do not treat the pre-optimization variant as current');
    const m = packed.measurements, dims = m?.dimensions;
    assert.equal(m?.worker?.complete, true, 'Missing Worker V8/WASM attribution');
    assert.equal(m?.chromium?.available, true, 'Missing Linux Chromium PSS');
    for (const [field, expected] of Object.entries({
      countries: manifest.datasets.modernCountries,
      sourceSegments: manifest.datasets.modernSourceSegments,
      sharedSegments: manifest.datasets.modernSharedSegments,
      contacts: manifest.datasets.modernCountryContacts,
    })) assert.equal(dims?.[field], expected, 'PERF_GEOMETRY_REBASE_REQUIRED: ' + field);
    for (const [key, value] of Object.entries({
      borderJs: m.worker.jsMiB, borderWasm: m.worker.wasmLinearMiB,
      pss: m.chromium.pssMiB, toModern: m.toModernMs,
    })) requiredNumber(value, key);
    result.oneReturn = {
      sourceCommit: packed.sourceCommit || sourceCommit,
      borderWorkerJsMiB: finite(m.worker.jsMiB),
      totalWorkerJsMiB: finite(m.worker.totalWorkerJsMiB),
      borderWorkerWasmLinearMiB: finite(m.worker.wasmLinearMiB),
      totalWorkerWasmLinearMiB: finite(m.worker.totalWorkerWasmMiB),
      chromiumPssMiB: finite(m.chromium.pssMiB),
      toSovietMs: finite(m.toSovietMs), toModernMs: finite(m.toModernMs),
      sourceSegments: dims.sourceSegments, sharedSegments: dims.sharedSegments,
      contactCount: dims.contacts, packedSourceSegments: dims.packedSourceSegments,
      typedStorageMiB: finite(dims.typedStorageMiB),
      interpretation: 'One returned current-world Worker sample after two CDP GC rounds; not a 12-cycle median.',
    };
  }
  if (longCycle) {
    assert.equal(longCycle.schema, 'pando-main-equivalent-12cycle-memory-v1');
    assert.equal(longCycle.cyclesCompleted, 12, 'Incomplete historical month round trips');
    assert.deepEqual(longCycle.errors, [], 'Actual page errors in long-cycle test');
    assert.ok(longCycle.summary?.eligibleSettledModernReturns >= 8, 'Insufficient settled Worker samples');
    assert.equal(longCycle.initialAutosaves, longCycle.finalAutosaves, 'Month changes must not create full autosaves');
    const mid = longCycle.summary.comparisons, final = longCycle.summary.finalIdle;
    for (const [key, value] of Object.entries({
      borderMedianFirst: mid?.borderJsMiB?.first4Median,
      borderMedianLast: mid?.borderJsMiB?.last4Median,
      wasmMedianFirst: mid?.workerWasmMiB?.first4Median,
      wasmMedianLast: mid?.workerWasmMiB?.last4Median,
      borderJs30s: final?.borderJsMiB,
      pss30s: final?.pssMiB,
    })) requiredNumber(value, key);
    result.twelveCycles = {
      sourceCommit: longCycle.testSha || sourceCommit,
      settledModernReturns: longCycle.summary.eligibleSettledModernReturns,
      excludedFromIdleMedians: longCycle.summary.excludedFromIdleMedians || [],
      borderWorkerJsFirst4MiB: finite(mid.borderJsMiB.first4Median),
      borderWorkerJsLast4MiB: finite(mid.borderJsMiB.last4Median),
      totalWorkerJsFirst4MiB: finite(mid.workerJsMiB?.first4Median),
      totalWorkerJsLast4MiB: finite(mid.workerJsMiB?.last4Median),
      workerWasmFirst4MiB: finite(mid.workerWasmMiB.first4Median),
      workerWasmLast4MiB: finite(mid.workerWasmMiB.last4Median),
      gpuStrokeTrackedLast4MiB: finite(mid.strokeGpuMiB?.last4Median),
      finalIdle30s: {
        borderWorkerJsMiB: finite(final.borderJsMiB),
        totalWorkerJsMiB: finite(final.workerJsMiB),
        workerWasmLinearMiB: finite(final.workerWasmMiB),
        chromiumPssMiB: finite(final.pssMiB),
        gpuStrokeTrackedMiB: finite(final.strokeGpuMiB),
      },
      fullAutosaveDelta: longCycle.finalAutosaves - longCycle.initialAutosaves,
      interpretation: 'Post-GC settled-phase medians and separate 30-second final idle; not interchangeable with a fresh one-return sample.',
    };
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  const sourceCommit = option('--source');
  const manifestPath = option('--manifest') || 'config/performance-baseline-v1.json';
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  validatePerformanceManifest(manifest);
  const readOptional = key => option(key) ? JSON.parse(readFileSync(resolve(option(key)), 'utf8')) : null;
  const result = assemblePerformanceEvidence({
    manifest, packed: readOptional('--packed'), longCycle: readOptional('--long'),
    sourceCommit,
  });
  const target = option('--out');
  const output = JSON.stringify(result, null, 2) + '\n';
  if (target) { mkdirSync(dirname(resolve(target)), { recursive: true }); writeFileSync(resolve(target), output); }
  console.log(output);
}
