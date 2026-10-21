import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
/* global boundaryState: writable, latestMessage: writable, queued: readonly, draining: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorkerMemoryProbe, chromiumProcessPss } from './helpers/soviet-memory-attribution.mjs';

test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });
const MiB = 1024 * 1024;
const round = n => Number.isFinite(n) ? Number(n.toFixed(2)) : null;
const mib = n => Number.isFinite(n) ? round(n / MiB) : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function month(page, value) {
  await setEditorMonth(page, value);
}
async function ready(page, value, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (gpu?.renderer !== 'webgl2' || !gpu.canonicalMeshReady
      || gpu.countrySharedBoundaryReplacementPending) return null;
    return { month: window.__testEditorTimeline.month(),
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union') };
  }), { timeout: 90_000, intervals: [500, 1100, 1800] }).toEqual({ month: value, soviet });
}
async function graph(worker) {
  return worker.evaluate(() => {
    if (!boundaryState || !latestMessage || queued || draining)
      throw new Error('Owner breakdown must sample a fully idle Worker');
    const state = boundaryState.__retainerTestOwners;
    const prepared = boundaryState.preparedStore.__retainerTestOwners;
    if (!state || !prepared) throw new Error('ISOLATED_RETAINER_HOOK_MISSING');
    let contactSegments = 0, edgeContributionSlots = 0, singleEdgeContributions = 0;
    let edgeValuesAliasContributions = 0, edgeValuesCopied = 0;
    for (const contact of state.contacts.values()) contactSegments += contact.segments.length;
    for (const edge of state.edges.values()) {
      if (edge.contributions) {
        edgeContributionSlots += edge.contributions.size;
        if ([...edge.contributions.values()].includes(edge.value)) edgeValuesAliasContributions++;
        else edgeValuesCopied++;
      } else {
        singleEdgeContributions++;
        edgeContributionSlots++;
        edgeValuesAliasContributions++;
      }
    }
    const ids = new Map(latestMessage.features.map(feature => [String(feature.id), feature.geometry]));
    return {
      originalCountries: latestMessage.features.length,
      retainedCountries: prepared.byId.size,
      contactCount: state.contacts.size, contactSegmentCount: contactSegments,
      contactByOwnerCount: state.contactsByOwner.size,
      edgeCount: state.edges.size, edgeContributionSlots, singleEdgeContributions,
      edgeValuesAliasContributions, edgeValuesCopied,
      upperIndexCount: prepared.spatialIndex.values().length,
      sourceSegments: [...prepared.byId.values()].reduce((sum, row) => sum + row.segments.length, 0),
      geometriesShareMessage: [...prepared.byId.values()].filter(row => ids.get(row.id) === row.geometry).length,
    };
  });
}
async function collect(probe, label) {
  await probe.sample({ collectGarbage: true });
  await delay(400);
  const all = await probe.sample({ collectGarbage: true });
  const row = all.workers.find(worker => worker.url.endsWith('/country-shared-boundary-worker.js'));
  if (!row?.jsHeap?.available || !row?.wasmLinearMemory?.available)
    throw new Error('Incomplete shared-boundary Worker V8/WASM reading at ' + label);
  const ps = await chromiumProcessPss();
  return { label, jsMiB: mib(row.jsHeap.usedBytes),
    wasmMiB: mib(row.wasmLinearMemory.allocatedBytes),
    allWorkerJsMiB: mib(all.jsUsedBytes), chromiumPssMiB: ps.pssMiB,
    complete: all.jsComplete && all.wasmComplete, workerCount: all.count };
}
async function release(worker, category) {
  return worker.evaluate(name => {
    if (!boundaryState || queued || draining) throw new Error('Workers must be idle before destructive test');
    const x = boundaryState.__retainerTestOwners;
    const y = boundaryState.preparedStore.__retainerTestOwners;
    if (!x || !y) throw new Error('ISOLATED_RETAINER_HOOK_MISSING');
    let removed = 0;
    switch (name) {
      case 'latestMessage':
        removed = latestMessage?.features?.length ?? 0;
        latestMessage = null;
        break;
      case 'contacts':
        removed = x.contacts.size; x.contacts.clear(); break;
      case 'contactsByOwner':
        removed = x.contactsByOwner.size; x.contactsByOwner.clear(); break;
      case 'edges':
        removed = x.edges.size; x.edges.clear(); break;
      case 'upperIndex':
        for (const row of y.spatialIndex.values()) {
          y.spatialIndex.remove(row.id);
          removed++;
        }
        break;
      case 'preparedById':
        removed = y.byId.size; y.byId.clear(); break;
      case 'boundaryState':
        boundaryState = null; removed = 1; break;
      default: throw new Error('Invalid diagnostic retaining owner: ' + name);
    }
    return { category: name, removed };
  }, category);
}

test('isolated contact-edge, upper index and source geometry retaining roots in three GC release orders', async ({ browser }, info) => {
  test.setTimeout(1_800_000);
  // General browser smoke suites discover all *.spec.mjs files. This
  // destructive diagnostic must be skipped unless isolated CI has installed
  // the temporary closure-owner hooks in a disposable checkout.
  test.skip(process.env.PANDO_RETENTION_DIAGNOSTIC_ISOLATED !== '1',
    'Requires isolated disposable Worker with injected retaining-root hooks');
  const report = {
    schema: 'pando-shared-boundary-retainer-graph-v1',
    source: process.env.GITHUB_SHA || null,
    scope: 'Country shared-border Worker 1989-06 to current; C++/WASM and shipped product source unchanged in git',
    method: 'Isolated temporary JS closure-root references, explicit V8 GC after sequential category clearing, independent Chromium contexts and reversed orders',
    limitations: 'Order-dependent release delta is NOT unique dominator/retained size. Shared segment references may remain live through contacts/edges and source indexes. Chromium PSS includes other processes. Test intentionally destroys state only after completion and then discards its context.',
    runs: [],
  };
  const orders = [
    ['latestMessage', 'contacts', 'contactsByOwner', 'edges', 'upperIndex', 'preparedById', 'boundaryState'],
    ['latestMessage', 'edges', 'contactsByOwner', 'contacts', 'preparedById', 'upperIndex', 'boundaryState'],
    ['latestMessage', 'upperIndex', 'preparedById', 'contactsByOwner', 'edges', 'contacts', 'boundaryState'],
  ];
  try {
    for (const order of orders) {
      const scenario = { order, samples: [], removals: [], graph: null, errors: [] };
      report.runs.push(scenario);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      let cdp = null, probe = null;
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
        await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
        const current = await page.evaluate(() => new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
        expect(current).toMatch(/^\d{4}-\d{2}$/);
        await month(page, '1989-06'); await ready(page, '1989-06', true);
        await month(page, current); await ready(page, current, false);
        const worker = page.workers().find(w => w.url().includes('/country-shared-boundary-worker.js'));
        expect(worker).toBeTruthy();
        await expect.poll(() => worker.evaluate(() => !queued && !draining
          && boundaryState?.stats().contactCount === 339), { timeout: 90_000 }).toBe(true);
        await delay(12_000);
        scenario.graph = await graph(worker);
        cdp = await context.newCDPSession(page);
        probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 24_000 });
        scenario.samples.push(await collect(probe, 'intact'));
        for (const category of order) {
          scenario.removals.push(await release(worker, category));
          scenario.samples.push(await collect(probe, 'after-' + category));
        }
        scenario.release = scenario.samples.slice(1).map((sample, index) =>
          ({ category: order[index], freedMiB: round(scenario.samples[index].jsMiB - sample.jsMiB),
            remainingMiB: sample.jsMiB }));
        scenario.freedTotalMiB = round(scenario.samples[0].jsMiB - scenario.samples.at(-1).jsMiB);
        console.log('SOVIET_RETAINER_GRAPH', JSON.stringify({
          order, graph: scenario.graph, initialMiB: scenario.samples[0].jsMiB,
          release: scenario.release, freedTotalMiB: scenario.freedTotalMiB,
          wasmStable: scenario.samples.every(row => row.wasmMiB === scenario.samples[0].wasmMiB),
        }));
        expect(scenario.graph.originalCountries).toBe(254);
        expect(scenario.graph.retainedCountries).toBe(254);
        expect(scenario.graph.contactCount).toBe(339);
        expect(scenario.graph.upperIndexCount).toBe(254);
        expect(scenario.graph.sourceSegments).toBe(544163);
        expect(scenario.graph.geometriesShareMessage).toBe(254);
        expect(scenario.graph.edgeCount).toBeGreaterThan(60000);
        expect(scenario.errors).toEqual([]);
        expect(scenario.samples.every(s => s.complete)).toBe(true);
        expect(scenario.samples.every(s => s.wasmMiB === scenario.samples[0].wasmMiB)).toBe(true);
        expect(scenario.samples[0].jsMiB).toBeGreaterThan(100);
        expect(scenario.samples.at(-1).jsMiB).toBeLessThan(10);
        expect(scenario.freedTotalMiB).toBeGreaterThan(90);
      } finally {
        if (probe) await probe.dispose();
        if (cdp) await cdp.detach();
        await context.close();
      }
    }
  } finally {
    await mkdir('test-results/soviet-retainer-graph', { recursive: true });
    const json = JSON.stringify(report, null, 2);
    await writeFile('test-results/soviet-retainer-graph/measurement.json', json);
    await info.attach('soviet-retainer-graph.json', { body: Buffer.from(json), contentType: 'application/json' });
  }
  expect(report.runs.length).toBe(3);
});
