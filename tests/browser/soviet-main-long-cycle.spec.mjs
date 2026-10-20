import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromiumProcessPss, createWorkerMemoryProbe } from './helpers/soviet-memory-attribution.mjs';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
const CYCLES = 12, MIB = 1024 * 1024;
const miB = value => Number.isFinite(value) ? Number((value / MIB).toFixed(2)) : null;
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : Number(((sorted[i - 1] + sorted[i]) / 2).toFixed(2));
};
const diff = (after, before) => Number.isFinite(after) && Number.isFinite(before)
  ? Number((after - before).toFixed(2)) : null;
async function setMonth(page, value) {
  await setEditorMonth(page, value);
}
async function settled(page, month, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (gpu?.renderer !== 'webgl2' || !gpu.canonicalMeshReady || gpu.countrySharedBoundaryReplacementPending) return null;
    return { month: window.__testEditorTimeline.month() ?? null,
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union') };
  }), { timeout: 90_000, intervals: [450, 1100, 1800] }).toEqual({ month, soviet });
}
async function geometryFingerprint(page) {
  return page.evaluate(() => {
    const geometry = window.PANDOLAB_TERRITORIAL.get('state:soviet-union')?.geometry;
    if (!geometry) return null;
    const text = JSON.stringify(geometry);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return { jsonLength: text.length, fnv32: hash >>> 0 };
  });
}
async function sample(page, cdp, probe, label) {
  const workerMemory = await probe.sample({ collectGarbage: true });
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  const main = await cdp.send('Runtime.getHeapUsage');
  const app = await page.evaluate(() => {
    const snap = window.__PANDOLAB_RENDER_DEBUG__.snapshot(), gpu = snap.gpu;
    return {
      month: window.__testEditorTimeline.month() ?? null,
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union'),
      pending: gpu.countrySharedBoundaryReplacementPending,
      renderer: gpu.renderer,
      segments: gpu.countrySharedBoundarySegmentCount,
      strokeBytes: gpu.stroke?.activeBufferBytes ?? null,
      gpuBudget: gpu.stroke?.resourceBudget ?? null,
      cacheBytes: snap.renderScene?.cacheBytes ?? null,
      autosaves: window.__PANDOLAB_PERFORMANCE_REPORT__?.()?.operations?.['autosave.persist']?.count || 0,
      editedVertices: document.querySelectorAll('circle.country-vertex').length,
    };
  });
  const chromium = await chromiumProcessPss();
  const workersByName = Object.fromEntries(workerMemory.workers.map(w => [w.url.split('/').at(-1), {
    jsMiB: miB(w.jsHeap?.available ? w.jsHeap.usedBytes : null),
    wasmLinearMiB: miB(w.wasmLinearMemory?.available ? w.wasmLinearMemory.allocatedBytes : null),
    diagnostics: w.diagnostics || null, error: w.error || null,
  }]));
  return {
    label, at: new Date().toISOString(), app, chromium, workerMemory, workersByName,
    mainJs: { usedBytes: main.usedSize, totalBytes: main.totalSize },
    values: {
      pssMiB: chromium.pssMiB ?? null,
      rendererPssMiB: chromium.roles?.renderer?.pssKiB == null ? null : miB(chromium.roles.renderer.pssKiB * 1024),
      mainJsMiB: miB(main.usedSize), workerJsMiB: miB(workerMemory.jsUsedBytes),
      workerWasmMiB: miB(workerMemory.wasmAllocatedBytes),
      borderJsMiB: workersByName['country-shared-boundary-worker.js']?.jsMiB ?? null,
      borderWasmMiB: workersByName['country-shared-boundary-worker.js']?.wasmLinearMiB ?? null,
      strokeGpuMiB: miB(app.strokeBytes),
    },
  };
}
function summarize(phases) {
  const modern = phases.filter(row => /^modern-[1-9]\d*$/.test(row.label));
  // Full boundary readiness can change between the UI poll and the memory sample.
  // Retain pending phases as evidence, but only compare post-GC idle snapshots.
  const settled = modern.filter(row => {
    const border = row.workersByName['country-shared-boundary-worker.js']?.diagnostics;
    return row.app.pending === false && row.workerMemory.jsComplete && row.workerMemory.wasmComplete
      && border?.queued === false && border?.draining === false
      && !row.workerMemory.workers.some(w => w.url.endsWith('/project-preview-worker.js'));
  });
  const names = ['pssMiB', 'rendererPssMiB', 'mainJsMiB', 'workerJsMiB',
    'workerWasmMiB', 'borderJsMiB', 'borderWasmMiB', 'strokeGpuMiB'];
  return {
    totalCompletedModernReturns: modern.length,
    eligibleSettledModernReturns: settled.length,
    excludedFromIdleMedians: modern.filter(row => !settled.includes(row)).map(row => row.label),
    coldStartup: phases.find(row => row.label === 'modern-0')?.values ?? null,
    comparisons: Object.fromEntries(names.map(name => {
      const first4 = median(settled.slice(0, 4).map(row => row.values[name]));
      const last4 = median(settled.slice(-4).map(row => row.values[name]));
      return [name, { first4Median: first4, last4Median: last4,
        last4MinusFirst4: diff(last4, first4), first: modern[0]?.values[name] ?? null,
        last: modern.at(-1)?.values[name] ?? null }];
    })),
    modernSeries: modern.map(row => ({ label: row.label, ...row.values,
      pendingAtSample: row.app.pending,
      autosaves: row.app.autosaves, workerCount: row.workerMemory.count,
      workersComplete: row.workerMemory.jsComplete && row.workerMemory.wasmComplete,
      previewWorkers: row.workerMemory.workers.filter(w => w.url.endsWith('/project-preview-worker.js')).length,
      borderQueued: row.workersByName['country-shared-boundary-worker.js']?.diagnostics?.queued ?? null,
      borderDraining: row.workersByName['country-shared-boundary-worker.js']?.diagnostics?.draining ?? null })),
  };
}

test('12 repeated 1989 Soviet/current month round trips retain bounded worker state on main sources', async ({ page }, testInfo) => {
  test.setTimeout(1_900_000);
  const phases = [], durations = [], errors = [], workersCreated = [];
  const result = {
    schema: 'pando-main-equivalent-12cycle-memory-v1',
    mainProductSha: process.env.PANDOLAB_EXPECT_MAIN_SHA || null,
    testSha: process.env.GITHUB_SHA || null,
    environment: 'Ubuntu-24.04 Chromium SwiftShader WebGL2, 1440x900; PSS from /proc/smaps_rollup; per-worker JS from CDP Runtime.getHeapUsage; WASM linear bytes (not C++ live heap)',
    limitations: 'PSS cannot be assigned to individual Workers and is not VRAM. GC does not compel allocator to release RSS. Startup and first warmup may not represent a plateau.',
    cyclesPlanned: CYCLES, cyclesCompleted: 0, phases, durations, errors, workersCreated,
  };
  page.on('pageerror', e => errors.push(e.message));
  page.on('worker', worker => {
    const row = { url: new URL(worker.url()).pathname, opened: new Date().toISOString(), closed: null };
    workersCreated.push(row);
    worker.on('close', () => { row.closed = new Date().toISOString(); });
  });
  let cdp = null, probe = null;
  try {
    await gotoEditor(page, '/?perf=1&renderer=webgl2');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => {
      const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
      return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
    }), { timeout: 90_000 }).toBe(true);
    await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
    const modernMonth = await page.evaluate(() => window.PANDOLAB_BUILD_META?.historicalWorld?.sourceMonth);
    expect(modernMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(modernMonth).not.toBe('1989-06');
    result.modernMonth = modernMonth;
    await page.waitForTimeout(1500);
    cdp = await page.context().newCDPSession(page);
    probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 18_000 });
    phases.push(await sample(page, cdp, probe, 'modern-0'));
    const startAutosaves = phases[0].app.autosaves;
    result.initialAutosaves = startAutosaves;

    for (let n = 1; n <= CYCLES; n += 1) {
      let started = Date.now();
      await setMonth(page, '1989-06');
      await settled(page, '1989-06', true);
      await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
      await expect.poll(() => page.evaluate(() =>
        window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu?.selection?.segmentCount || 0),
      { timeout: 60_000 }).toBeGreaterThan(0);
      if (n === 1) result.firstSovietGeometry = await geometryFingerprint(page);
      if (n === CYCLES) result.lastSovietGeometry = await geometryFingerprint(page);
      await page.waitForTimeout(6000);
      phases.push(await sample(page, cdp, probe, 'soviet-' + n));
      const sovietMs = Date.now() - started;
      started = Date.now();
      await setMonth(page, modernMonth);
      await settled(page, modernMonth, false);
      await page.waitForTimeout(6000);
      phases.push(await sample(page, cdp, probe, 'modern-' + n));
      durations.push({ cycle: n, toSovietMs: sovietMs, toModernMs: Date.now() - started });
      result.cyclesCompleted = n;
      const row = phases.at(-1);
      console.log('SOVIET_MAIN_LONG_CYCLE', JSON.stringify({
        n, pss: row.values.pssMiB, mainJs: row.values.mainJsMiB, workerJs: row.values.workerJsMiB,
        workerWasm: row.values.workerWasmMiB, borderJs: row.values.borderJsMiB,
        autosaves: row.app.autosaves, workerCount: row.workerMemory.count,
        jsComplete: row.workerMemory.jsComplete, wasmComplete: row.workerMemory.wasmComplete,
      }));
    }
    await page.waitForTimeout(30_000);
    phases.push(await sample(page, cdp, probe, 'modern-final-30s'));
    result.summary = summarize(phases);
    result.summary.finalIdle = phases.at(-1).values;
    result.summary.finalIdleMinusModern12 = {
      pssMiB: diff(phases.at(-1).values.pssMiB, phases.at(-2).values.pssMiB),
      workerJsMiB: diff(phases.at(-1).values.workerJsMiB, phases.at(-2).values.workerJsMiB),
    };
    result.finalAutosaves = phases.at(-1).app.autosaves;
    expect(result.firstSovietGeometry).toEqual(result.lastSovietGeometry);
    expect(result.cyclesCompleted).toBe(CYCLES);
    expect(result.summary.totalCompletedModernReturns).toBe(CYCLES);
    expect(errors).toEqual([]);
    expect(result.finalAutosaves).toBe(startAutosaves);
    expect(phases.every(row => row.chromium.available && row.workerMemory.count >= 5)).toBe(true);
    expect(phases.every(row => row.app.renderer === 'webgl2')).toBe(true);
    expect(phases.at(-1).app.pending).toBe(false);
    expect(result.summary.eligibleSettledModernReturns).toBeGreaterThanOrEqual(8);
    expect(phases.every(row => !row.workerMemory.workers.some(w => w.url.endsWith('/project-preview-worker.js')))).toBe(true);
    expect(phases.at(-1).workerMemory.jsComplete && phases.at(-1).workerMemory.wasmComplete).toBe(true);
  } finally {
    result.summary ||= summarize(phases);
    const output = JSON.stringify(result, null, 2);
    await mkdir('test-results/soviet-main-long-cycle', { recursive: true });
    await writeFile('test-results/soviet-main-long-cycle/measurement.json', output);
    await testInfo.attach('main-12cycle-memory.json', { body: Buffer.from(output), contentType: 'application/json' });
    console.log('SOVIET_MAIN_12CYCLE_RESULT', JSON.stringify({
      completed: result.cyclesCompleted, summary: result.summary, errors, startAutosaves: result.initialAutosaves,
      finalAutosaves: result.finalAutosaves,
    }));
    if (probe) await probe.dispose();
    if (cdp) await cdp.detach();
  }
});
