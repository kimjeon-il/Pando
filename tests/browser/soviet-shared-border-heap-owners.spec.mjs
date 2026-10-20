import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
/* global boundaryState: writable, latestMessage: writable, queued: readonly, draining: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorkerMemoryProbe, chromiumProcessPss } from './helpers/soviet-memory-attribution.mjs';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
const MIB = 1024 * 1024;
const mib = bytes => Number.isFinite(bytes) ? Number((bytes / MIB).toFixed(2)) : null;
const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b)
  ? Number((a - b).toFixed(2)) : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setMonth(page, value) {
  await setEditorMonth(page, value);
}
async function settled(page, month, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (gpu?.renderer !== 'webgl2' || !gpu.canonicalMeshReady
      || gpu.countrySharedBoundaryReplacementPending) return null;
    return { month: window.__testEditorTimeline.month() ?? null,
      soviet: !!window.PANDOLAB_TERRITORIAL.get('state:soviet-union') };
  }), { timeout: 90_000, intervals: [500, 1100, 1800] }).toEqual({ month, soviet });
}
async function dimensions(worker) {
  return worker.evaluate(() => {
    if (!boundaryState || !latestMessage || queued || draining)
      throw new Error('Shared-boundary state not idle or not present');
    const messageRows = latestMessage.features || [];
    const preparedRows = boundaryState.preparedStore.values();
    const byId = new Map(messageRows.map(row => [String(row.id), row.geometry]));
    const countCoordinates = arr => {
      if (!Array.isArray(arr)) return 0;
      if (typeof arr[0] === 'number') return 1;
      let count = 0;
      for (const row of arr) count += countCoordinates(row);
      return count;
    };
    let sourcePoints = 0, preparedEdges = 0, drawableEdges = 0, sameGeometryRefs = 0;
    for (const feature of messageRows) sourcePoints += countCoordinates(feature.geometry?.coordinates);
    for (const item of preparedRows) {
      preparedEdges += item.segments.length;
      drawableEdges += item.renderableSegments.length;
      if (byId.get(item.id) === item.geometry) sameGeometryRefs++;
    }
    return {
      messageFeatures: messageRows.length,
      preparedFeatures: preparedRows.length, sharedGeometryReferences: sameGeometryRefs,
      sourceCoordinatePairs: sourcePoints,
      sourceSegments: preparedEdges, drawableSegments: drawableEdges,
      contacts: boundaryState.stats().contactCount,
      sharedEdges: boundaryState.segments().length,
      queued: !!queued, draining: !!draining,
    };
  });
}
async function sample(cdp, probe, label) {
  // Two full collections to minimize temporary measurement allocations.
  await probe.sample({ collectGarbage: true });
  await delay(450);
  const result = await probe.sample({ collectGarbage: true });
  const row = result.workers.find(w => w.url.endsWith('/country-shared-boundary-worker.js'));
  if (!row?.jsHeap?.available || !row?.wasmLinearMemory?.available)
    throw new Error('CDP shared-boundary measurements incomplete at ' + label);
  await cdp.send('HeapProfiler.collectGarbage');
  const ps = await chromiumProcessPss();
  return {
    label, borderJsMiB: mib(row.jsHeap.usedBytes),
    borderTotalMiB: mib(row.jsHeap.totalBytes),
    borderWasmMiB: mib(row.wasmLinearMemory.allocatedBytes),
    workerJsMiB: mib(result.jsUsedBytes), workerWasmMiB: mib(result.wasmAllocatedBytes),
    pssMiB: ps.pssMiB, count: result.count,
    ownerDiagnostics: row.diagnostics, complete: result.jsComplete && result.wasmComplete,
  };
}
async function detach(worker, root) {
  return worker.evaluate(value => {
    if (queued || draining) throw new Error('Operation active during root detachment');
    if (value === 'latestMessage') {
      const present = !!latestMessage;
      latestMessage = null;
      return { root: value, present, dropped: latestMessage === null,
        stateStillPresent: !!boundaryState };
    }
    if (value === 'boundaryState') {
      const present = !!boundaryState;
      boundaryState = null;
      return { root: value, present, dropped: boundaryState === null,
        latestStillPresent: !!latestMessage };
    }
    throw new Error('Unknown diagnostic root');
  }, root);
}
test('isolated modern shared-border JS retaining roots in both release orders', async ({ browser }, info) => {
  test.setTimeout(1_400_000);
  const results = {
    schema: 'pando-border-owning-roots-v1',
    pinnedMainProductSha: process.env.PANDOLAB_EXPECT_MAIN_SHA || null,
    sourceIsUnmodified: true,
    method: 'Two fresh Chromium contexts, one original-worker root released at a time only after idle; each step requests two Worker V8 GCs',
    accounting: 'CDP Worker V8 used heap deltas, not a full heap-snapshot dominator tree; overlap remains live until all retaining roots are released',
    scenarios: [],
  };
  try {
    for (const order of [
      ['latestMessage', 'boundaryState'],
      ['boundaryState', 'latestMessage'],
    ]) {
      const record = { order, stages: [], detachments: [], pageErrors: [], dimensions: null };
      results.scenarios.push(record);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      let cdp = null, probe = null;
      try {
        const page = await context.newPage();
        page.on('pageerror', err => record.pageErrors.push(err.message));
        await gotoEditor(page, '/?perf=1&renderer=webgl2');
        await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
        await expect.poll(() => page.evaluate(() => {
          const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
          return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady
            && !gpu.countrySharedBoundaryReplacementPending;
        }), { timeout: 90_000 }).toBe(true);
        await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
        const modern = await page.evaluate(() => window.PANDOLAB_BUILD_META?.historicalWorld?.sourceMonth);
        expect(modern).toMatch(/^\d{4}-\d{2}$/);
        await setMonth(page, '1989-06');
        await settled(page, '1989-06', true);
        await setMonth(page, modern);
        await settled(page, modern, false);
        const worker = page.workers().find(w => w.url().includes('/country-shared-boundary-worker.js'));
        expect(worker).toBeTruthy();
        await expect.poll(() => worker.evaluate(() => !queued && !draining
          && boundaryState?.stats().contactCount === 339),
        { timeout: 90_000 }).toBe(true);
        await delay(18_000);
        cdp = await context.newCDPSession(page);
        probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 24_000 });
        await probe.sample({ collectGarbage: true });
        record.dimensions = await dimensions(worker);
        record.stages.push(await sample(cdp, probe, 'roots-intact'));
        for (const root of order) {
          record.detachments.push(await detach(worker, root));
          await delay(1100);
          record.stages.push(await sample(cdp, probe, 'after-' + root));
        }
        record.summary = {
          firstReleaseMiB: delta(record.stages[0].borderJsMiB, record.stages[1].borderJsMiB),
          secondReleaseMiB: delta(record.stages[1].borderJsMiB, record.stages[2].borderJsMiB),
          bothReleasedMiB: delta(record.stages[0].borderJsMiB, record.stages[2].borderJsMiB),
          wasmStable: record.stages.every(x => x.borderWasmMiB === record.stages[0].borderWasmMiB),
        };
        console.log('SOVIET_BORDER_ROOT_RELEASE', JSON.stringify({
          order, dimensions: record.dimensions,
          stages: record.stages.map(x => ({ label: x.label, jsMiB: x.borderJsMiB,
            wasmMiB: x.borderWasmMiB, pssMiB: x.pssMiB })),
          summary: record.summary,
        }));
        expect(record.pageErrors).toEqual([]);
        expect(record.dimensions.messageFeatures).toBe(254);
        expect(record.dimensions.preparedFeatures).toBe(254);
        expect(record.dimensions.sharedGeometryReferences).toBe(254);
        expect(record.detachments.every(x => x.present && x.dropped)).toBe(true);
        expect(record.stages.every(x => x.complete && x.count >= 5)).toBe(true);
        expect(record.stages[0].borderJsMiB).toBeGreaterThan(150);
        expect(record.summary.bothReleasedMiB).toBeGreaterThan(10);
        expect(record.summary.wasmStable).toBe(true);
      } finally {
        if (probe) await probe.dispose();
        if (cdp) await cdp.detach();
        await context.close();
      }
    }
  } finally {
    await mkdir('test-results/soviet-shared-border-owners', { recursive: true });
    const json = JSON.stringify(results, null, 2);
    await writeFile('test-results/soviet-shared-border-owners/measurement.json', json);
    await info.attach('soviet-shared-border-owners.json',
      { body: Buffer.from(json), contentType: 'application/json' });
  }
  expect(results.scenarios.length).toBe(2);
});


async function clearPreparedCategory(worker, category) {
  return worker.evaluate(name => {
    if (!boundaryState || queued || draining)
      throw new Error('Cannot change prepared cache during boundary work');
    const rows = boundaryState.preparedStore.values();
    let referencesRemoved = 0;
    if (name === 'all-state') {
      boundaryState = null;
      return { name, rows: rows.length, referencesRemoved: rows.length };
    }
    for (const row of rows) {
      if (name === 'renderable') {
        referencesRemoved += row.renderableSegments?.length || 0;
        row.renderableSegments = [];
      } else if (name === 'spatial-index') {
        referencesRemoved += row.spatialIndex ? 1 : 0;
        row.spatialIndex = null;
      } else if (name === 'source-segments') {
        referencesRemoved += row.segments?.length || 0;
        row.segments = [];
      } else if (name === 'source-geometry') {
        referencesRemoved += row.feature ? 1 : 0;
        row.feature = null;
        row.geometry = null;
      } else throw new Error('Invalid prepared category');
    }
    return { name, rows: rows.length, referencesRemoved };
  }, category);
}

test('isolated derived geometry, per-feature spatial index and contact retention', async ({ browser }, info) => {
  test.setTimeout(1_400_000);
  const result = {
    schema: 'pando-boundary-prepared-category-release-v1',
    pinnedMainSha: process.env.PANDOLAB_EXPECT_MAIN_SHA || null,
    limitation: 'Sequential release after GC is order-dependent, not a dominator heap snapshot. Categories can share objects.',
    orders: [],
  };
  try {
    for (const sequence of [
      ['renderable', 'spatial-index', 'source-segments', 'source-geometry', 'all-state'],
      ['source-segments', 'spatial-index', 'renderable', 'source-geometry', 'all-state'],
    ]) {
      const record = { sequence, samples: [], operations: [], errors: [] };
      result.orders.push(record);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      let cdp = null, probe = null;
      try {
        const page = await context.newPage();
        page.on('pageerror', error => record.errors.push(error.message));
        await gotoEditor(page, '/?perf=1&renderer=webgl2');
        await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
        await expect.poll(() => page.evaluate(() => {
          const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
          return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady
            && !gpu.countrySharedBoundaryReplacementPending;
        }), { timeout: 90_000 }).toBe(true);
        await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
        const modern = await page.evaluate(() => window.PANDOLAB_BUILD_META?.historicalWorld?.sourceMonth);
        await setMonth(page, '1989-06');
        await settled(page, '1989-06', true);
        await setMonth(page, modern);
        await settled(page, modern, false);
        const worker = page.workers().find(w => w.url().includes('/country-shared-boundary-worker.js'));
        expect(worker).toBeTruthy();
        await expect.poll(() => worker.evaluate(() =>
          !queued && !draining && boundaryState?.stats().contactCount === 339),
        { timeout: 90_000 }).toBe(true);
        await delay(18_000);
        cdp = await context.newCDPSession(page);
        probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 24_000 });
        record.dimensions = await dimensions(worker);
        record.samples.push(await sample(cdp, probe, 'intact'));
        record.operations.push(await detach(worker, 'latestMessage'));
        record.samples.push(await sample(cdp, probe, 'after-latestMessage'));
        for (const category of sequence) {
          record.operations.push(await clearPreparedCategory(worker, category));
          await delay(850);
          record.samples.push(await sample(cdp, probe, 'after-' + category));
        }
        record.freed = record.samples.slice(1).map((row, index) => ({
          step: row.label,
          releasedMiB: delta(record.samples[index].borderJsMiB, row.borderJsMiB),
        }));
        record.totalReleasedMiB = delta(record.samples[0].borderJsMiB, record.samples.at(-1).borderJsMiB);
        console.log('SOVIET_BORDER_DERIVED_RELEASE', JSON.stringify({
          sequence, dimensions: record.dimensions,
          operations: record.operations,
          stages: record.samples.map(x => ({ name: x.label, jsMiB: x.borderJsMiB,
            wasmMiB: x.borderWasmMiB })),
          released: record.freed, totalReleasedMiB: record.totalReleasedMiB,
        }));
        expect(record.errors).toEqual([]);
        expect(record.dimensions.preparedFeatures).toBe(254);
        expect(record.samples.every(row => row.complete)).toBe(true);
        expect(record.operations[0].dropped).toBe(true);
        expect(record.samples.at(-1).borderJsMiB).toBeLessThan(10);
        expect(record.samples.every(row => row.borderWasmMiB === record.samples[0].borderWasmMiB)).toBe(true);
      } finally {
        if (probe) await probe.dispose();
        if (cdp) await cdp.detach();
        await context.close();
      }
    }
  } finally {
    await mkdir('test-results/soviet-shared-border-owners', { recursive: true });
    const raw = JSON.stringify(result, null, 2);
    await writeFile('test-results/soviet-shared-border-owners/derived-ownership.json', raw);
    await info.attach('soviet-shared-border-derived-ownership.json',
      { body: Buffer.from(raw), contentType: 'application/json' });
  }
  expect(result.orders.length).toBe(2);
});
