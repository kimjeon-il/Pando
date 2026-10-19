import { gotoEditor } from './helpers/editor-entry.mjs';
/* global boundaryState: writable, latestMessage: writable, queued: readonly, draining: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorkerMemoryProbe, chromiumProcessPss } from './helpers/soviet-memory-attribution.mjs';

const MiB = 1024 * 1024;
const mib = bytes => Number.isFinite(bytes) ? Number((bytes / MiB).toFixed(2)) : null;
const round = value => Number.isFinite(value) ? Number(value.toFixed(2)) : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

async function setMonth(page, value) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(value);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
}
async function ready(page, value, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (gpu?.renderer !== 'webgl2' || !gpu.canonicalMeshReady
      || gpu.countrySharedBoundaryReplacementPending) return null;
    return { month: document.querySelector('#timelineMonthInput')?.value,
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union') };
  }), { timeout: 90_000, intervals: [500, 1100, 1800] }).toEqual({ month: value, soviet });
}
async function graph(worker) {
  return worker.evaluate(() => {
    if (!boundaryState || !latestMessage || queued || draining)
      throw new Error('Sample only fully idle shared-boundary Worker');
    const owners = boundaryState.__preparedTestOwners;
    const store = boundaryState.preparedStore.__preparedTestOwners;
    const wire = globalThis.__PANDO_PREPARED_TEST_WIRE__;
    if (!owners || !store || !wire) throw new Error('ISOLATED_PREPARED_HOOK_MISSING');
    const rows = [...store.byId.values()];
    const original = new Map(latestMessage.features.map(feature => [String(feature.id), feature.geometry]));
    const indexes = rows.map(row => row.spatialIndex?.stats?.() || {});
    const contacts = [...owners.contacts.values()];
    const count = (collection, predicate) => collection.filter(predicate).length;
    return {
      countries: rows.length, messageCountries: latestMessage.features.length,
      contacts: owners.contacts.size, edges: owners.edges.size,
      upperIndexEntries: store.spatialIndex.values().length,
      sourceRows: rows.reduce((sum, row) => sum + row.segments.length, 0),
      indexedRows: indexes.reduce((sum, stats) => sum + (stats.entries || 0), 0),
      packedIndexes: count(indexes, stats => stats.packed === true),
      packedTypedBytes: indexes.reduce((sum, stats) => sum + (stats.typedBytes || 0), 0),
      wiredPreparedCountries: count(rows, row => wire.has(row)),
      wiredSourceRows: rows.reduce((sum, row) => sum + (wire.has(row) ? row.segments.length : 0), 0),
      geometrySharedWithMessage: count(rows, row => row.geometry === original.get(row.id)),
      geometrySharedWithFeature: count(rows, row => row.geometry === row.feature?.geometry),
      contactSegments: contacts.reduce((sum, row) => sum + row.segments.length, 0),
      contactSourceRefs: contacts.reduce((sum, row) => sum + row.segments.reduce((n, edge) => n + (edge.refs?.length || 0), 0), 0),
    };
  });
}
async function sample(probe, stage) {
  await probe.sample({ collectGarbage: true });
  await delay(400);
  const all = await probe.sample({ collectGarbage: true });
  const boundary = all.workers.find(row => row.url.endsWith('/country-shared-boundary-worker.js'));
  if (!boundary?.jsHeap?.available || !boundary?.wasmLinearMemory?.available)
    throw new Error('Incomplete country boundary Worker sample at ' + stage);
  const process = await chromiumProcessPss();
  return { stage, boundaryJsMiB: mib(boundary.jsHeap.usedBytes),
    boundaryWasmMiB: mib(boundary.wasmLinearMemory.allocatedBytes),
    totalWorkerJsMiB: mib(all.jsUsedBytes), chromiumPssMiB: process.pssMiB,
    complete: all.jsComplete && all.wasmComplete, workerCount: all.count };
}
async function release(worker, category) {
  return worker.evaluate(name => {
    if (!boundaryState || queued || draining)
      throw new Error('Only idle Worker objects may be destructively sampled');
    const owners = boundaryState.__preparedTestOwners;
    const store = boundaryState.preparedStore.__preparedTestOwners;
    const wire = globalThis.__PANDO_PREPARED_TEST_WIRE__;
    if (!owners || !store || !wire) throw new Error('ISOLATED_PREPARED_HOOK_MISSING');
    const rows = [...store.byId.values()];
    switch (name) {
      case 'latestMessage': {
        const removed = latestMessage?.features?.length || 0;
        latestMessage = null;
        return removed;
      }
      case 'wireRows':
        return rows.reduce((sum, row) => sum + Number(wire.drop(row)), 0);
      case 'sourceIndexes':
        for (const row of rows) row.spatialIndex = null;
        return rows.length;
      case 'sourceRows':
        for (const row of rows) row.segments = [];
        return rows.length;
      case 'sourceFeatureGeometry':
        for (const row of rows) {
          row.feature = null;
          row.geometry = null;
          row.renderableSegments = null;
        }
        return rows.length;
      case 'upperIndex': {
        const entries = store.spatialIndex.values();
        for (const row of entries) store.spatialIndex.remove(row.id);
        return entries.length;
      }
      case 'preparedById': {
        const count = store.byId.size;
        store.byId.clear();
        return count;
      }
      case 'contacts': {
        const count = owners.contacts.size;
        owners.contacts.clear();
        owners.contactsByOwner.clear();
        return count;
      }
      case 'edges': {
        const count = owners.edges.size;
        owners.edges.clear();
        return count;
      }
      case 'boundaryState':
        boundaryState = null;
        return 1;
      default: throw new Error('Unknown diagnostic group: ' + name);
    }
  }, category);
}

test('isolate source wire encodings, packed indexes, source objects and top-level ownership in reversed GC orders', async ({ browser }, info) => {
  test.setTimeout(1_800_000);
  test.skip(process.env.PANDO_PREPARED_DIAGNOSTIC_ISOLATED !== '1',
    'Destructive GC experiment requires disposable instrumented source checkout');
  const orders = [
    ['latestMessage', 'wireRows', 'sourceIndexes', 'sourceRows', 'sourceFeatureGeometry',
      'upperIndex', 'preparedById', 'contacts', 'edges', 'boundaryState'],
    ['latestMessage', 'sourceIndexes', 'sourceRows', 'wireRows', 'sourceFeatureGeometry',
      'upperIndex', 'preparedById', 'contacts', 'edges', 'boundaryState'],
    ['latestMessage', 'sourceRows', 'sourceIndexes', 'wireRows', 'sourceFeatureGeometry',
      'upperIndex', 'preparedById', 'contacts', 'edges', 'boundaryState'],
  ];
  const result = { schema: 'pando-prepared-source-retainer-experiment-v1',
    sourceSha: process.env.GITHUB_SHA || null,
    notes: 'Destructive GC deltas are order dependent; neither a unique dominator size nor an independently recoverable RAM total. TypedArray byteLength is not V8 used heap. Windows WebView2 and GPU VRAM not measured.',
    runs: [] };
  try {
    for (const order of orders) {
      const scenario = { order, graph: null, samples: [], releases: [], errors: [] };
      result.runs.push(scenario);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      let probe = null, cdp = null;
      try {
        const page = await context.newPage();
        page.on('pageerror', error => scenario.errors.push(error.message));
        await gotoEditor(page, '/?perf=1&renderer=webgl2');
        await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
        await expect.poll(() => page.evaluate(() => {
          const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
          return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady
            && !gpu.countrySharedBoundaryReplacementPending;
        }), { timeout: 90_000 }).toBe(true);
        await page.locator('#flatBtn').evaluate(button => button.click());
        const modern = await page.evaluate(() => window.PANDOLAB_BUILD_META?.historicalWorld?.sourceMonth);
        expect(modern).toMatch(/^\d{4}-\d{2}$/);
        await setMonth(page, '1989-06');
        await ready(page, '1989-06', true);
        await setMonth(page, modern);
        await ready(page, modern, false);
        const worker = page.workers().find(row => row.url().includes('/country-shared-boundary-worker.js'));
        expect(worker).toBeTruthy();
        await expect.poll(() => worker.evaluate(() => !queued && !draining
          && boundaryState?.stats().contactCount === 339
          && (latestMessage?.features?.length || 0) === 254), { timeout: 90_000 }).toBe(true);
        await delay(12_000);
        scenario.graph = await graph(worker);
        cdp = await context.newCDPSession(page);
        probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 24_000 });
        scenario.samples.push(await sample(probe, 'intact'));
        for (const category of order) {
          const removed = await release(worker, category);
          scenario.samples.push(await sample(probe, 'after-' + category));
          const before = scenario.samples.at(-2).boundaryJsMiB;
          const after = scenario.samples.at(-1).boundaryJsMiB;
          scenario.releases.push({ category, removed, freedMiB: round(before - after), remainingMiB: after });
        }
        console.log('PREPARED_SOURCE_RETAINER', JSON.stringify({
          order, graph: scenario.graph, originalMiB: scenario.samples[0].boundaryJsMiB,
          releases: scenario.releases, finalMiB: scenario.samples.at(-1).boundaryJsMiB,
        }));
        expect(scenario.graph.countries).toBe(254);
        expect(scenario.graph.messageCountries).toBe(254);
        expect(scenario.graph.contacts).toBe(339);
        expect(scenario.graph.edges).toBe(68616);
        expect(scenario.graph.upperIndexEntries).toBe(254);
        expect(scenario.graph.sourceRows).toBe(544163);
        expect(scenario.graph.packedIndexes).toBe(194);
        expect(scenario.graph.geometrySharedWithMessage).toBe(254);
        expect(scenario.graph.geometrySharedWithFeature).toBe(254);
        expect(scenario.graph.wiredPreparedCountries).toBeGreaterThan(0);
        expect(scenario.errors).toEqual([]);
        expect(scenario.samples.every(row => row.complete)).toBe(true);
        expect(scenario.samples.every(row => row.boundaryWasmMiB === scenario.samples[0].boundaryWasmMiB)).toBe(true);
        expect(scenario.samples[0].boundaryJsMiB).toBeGreaterThan(95);
        expect(scenario.samples.at(-1).boundaryJsMiB).toBeLessThan(12);
      } finally {
        if (probe) await probe.dispose();
        if (cdp) await cdp.detach();
        await context.close();
      }
    }
  } finally {
    await mkdir('test-results/soviet-prepared-owners', { recursive: true });
    const json = JSON.stringify(result, null, 2) + '\n';
    await writeFile('test-results/soviet-prepared-owners/measurement.json', json);
    await info.attach('soviet-prepared-source-owners.json', { body: Buffer.from(json),
      contentType: 'application/json' });
  }
  expect(result.runs.length).toBe(3);
});
