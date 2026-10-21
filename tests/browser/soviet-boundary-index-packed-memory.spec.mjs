import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
/* global boundaryState: readonly, latestMessage: readonly, queued: readonly, draining: readonly */
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromiumProcessPss, createWorkerMemoryProbe } from './helpers/soviet-memory-attribution.mjs';

const MiB = 1024 * 1024;
const mib = bytes => Number.isFinite(bytes) ? Number((bytes / MiB).toFixed(2)) : null;
test.use({ trace: 'off', viewport: { width: 1440, height: 900 } });

async function setMonth(page, month) {
  await setEditorMonth(page, month);
}
async function settled(page, month, soviet) {
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
    if (!gpu || gpu.renderer !== 'webgl2' || !gpu.canonicalMeshReady || gpu.countrySharedBoundaryReplacementPending)
      return null;
    return { month: window.__testEditorTimeline.month(),
      soviet: !!window.PANDOLAB_TERRITORIAL?.get('state:soviet-union') };
  }), { timeout: 90_000, intervals: [500, 1100, 1800] }).toEqual({ month, soviet });
}

test('1989 Soviet to modern produces matching country contacts with bounded source index memory', async ({ page }, info) => {
  test.setTimeout(500_000);
  const variant = process.env.PANDOLAB_INDEX_VARIANT || 'packed';
  if (!['baseline', 'packed'].includes(variant)) throw new Error('Unknown memory comparison variant');
  const errors = [], started = Date.now(), result = {
    schema: 'pando-soviet-packed-boundary-v1',
    variant, sourceCommit: process.env.PANDOLAB_EXPECT_COMMIT || null,
    environment: 'Ubuntu Chromium WebGL2 SwiftShader, 1440x900; Worker V8 after two GC samples; whole Chromium PSS and WASM linear bytes not additive',
    measurements: {},
  };
  let cdp = null, probe = null;
  page.on('pageerror', error => errors.push(error.message));
  try {
    await gotoEditor(page, '/?perf=1&renderer=webgl2');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => {
      const gpu = window.__PANDOLAB_RENDER_DEBUG__?.snapshot()?.gpu;
      return gpu?.renderer === 'webgl2' && gpu.canonicalMeshReady && !gpu.countrySharedBoundaryReplacementPending;
    }), { timeout: 90_000 }).toBe(true);
    await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
    const modern = await page.evaluate(() => new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
    expect(modern).toMatch(/^\d{4}-\d{2}$/);
    const sovietStart = Date.now();
    await setMonth(page, '1989-06');
    await settled(page, '1989-06', true);
    result.measurements.toSovietMs = Date.now() - sovietStart;
    const modernStart = Date.now();
    await setMonth(page, modern);
    await settled(page, modern, false);
    result.measurements.toModernMs = Date.now() - modernStart;
    const worker = page.workers().find(row => row.url().includes('/country-shared-boundary-worker.js'));
    expect(worker).toBeTruthy();
    await expect.poll(() => worker.evaluate(() => !queued && !draining
      && boundaryState?.stats().contactCount === 339 && (latestMessage?.features?.length ?? 0) === 254),
    { timeout: 90_000, intervals: [600, 1200, 1800] }).toBe(true);
    await page.waitForTimeout(10_000);
    const dimensions = await worker.evaluate(() => {
      if (!boundaryState || !latestMessage || queued || draining)
        throw new Error('Shared boundary index must be idle');
      const rows = boundaryState.preparedStore.values();
      const stats = rows.map(row => row.spatialIndex?.stats?.() ?? null);
      return {
        countries: rows.length, messageCountries: latestMessage.features.length,
        sourceSegments: rows.reduce((sum, row) => sum + row.segments.length, 0),
        sharedSegments: boundaryState.segments().length,
        contacts: boundaryState.stats().contactCount,
        preparationCount: boundaryState.stats().preparationCount,
        packedCountries: stats.filter(s => s?.packed).length,
        packedSourceSegments: stats.reduce((sum, s) => sum + (s?.packed ? s.entries : 0), 0),
        postingCount: stats.reduce((sum, s) => sum + (s?.packed ? s.postings : 0), 0),
        typedStorageMiB: stats.reduce((sum, s) => sum + (s?.packed ? s.typedBytes : 0), 0) / 1048576,
      };
    });
    result.measurements.dimensions = dimensions;
    expect(dimensions.countries).toBe(254);
    expect(dimensions.messageCountries).toBe(254);
    expect(dimensions.sourceSegments).toBe(544163);
    expect(dimensions.sharedSegments).toBe(68616);
    expect(dimensions.contacts).toBe(339);
    if (variant === 'packed') {
      expect(dimensions.packedCountries).toBeGreaterThan(0);
      expect(dimensions.packedSourceSegments).toBeGreaterThan(100000);
    } else expect(dimensions.packedCountries).toBe(0);
    cdp = await page.context().newCDPSession(page);
    probe = await createWorkerMemoryProbe(cdp, { origin: new URL(page.url()).origin, timeoutMs: 24_000 });
    await probe.sample({ collectGarbage: true });
    await page.waitForTimeout(500);
    const sample = await probe.sample({ collectGarbage: true });
    const border = sample.workers.find(row => row.url.endsWith('/country-shared-boundary-worker.js'));
    if (!border?.jsHeap?.available || !border?.wasmLinearMemory?.available)
      throw new Error('Country boundary Worker V8/WASM attribution incomplete');
    const processMemory = await chromiumProcessPss();
    result.measurements.worker = {
      jsMiB: mib(border.jsHeap.usedBytes),
      wasmLinearMiB: mib(border.wasmLinearMemory.allocatedBytes),
      totalWorkerJsMiB: mib(sample.jsUsedBytes),
      totalWorkerWasmMiB: mib(sample.wasmAllocatedBytes),
      complete: sample.jsComplete && sample.wasmComplete,
    };
    result.measurements.chromium = { pssMiB: processMemory.pssMiB, available: processMemory.available };
    result.measurements.elapsedMs = Date.now() - started;
    expect(result.measurements.worker.complete).toBe(true);
    expect(errors).toEqual([]);
    console.log('PACKED_SOVIET_BOUNDARY_MEMORY', JSON.stringify(result));
  } finally {
    if (probe) await probe.dispose();
    if (cdp) await cdp.detach();
    result.pageErrors = errors;
    await mkdir('test-results/soviet-boundary-index-packed', { recursive: true });
    const json = JSON.stringify(result, null, 2);
    await writeFile('test-results/soviet-boundary-index-packed/measurement.json', json);
    await info.attach('soviet-boundary-index-memory.json', { body: Buffer.from(json), contentType: 'application/json' });
  }
});
