import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Explicit P0/P1 benchmark. Not in the normal *.spec.mjs regression suite.
// Compare identical viewports, browsers, pinned library assets, and networks
// on main and work/gis; never substitute synthetic readiness for a real draw.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'off' });

const round = value => Number(Number(value || 0).toFixed(2));
function percentile(values, part) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * part) - 1)]);
}

for (const projection of ['globe', 'flat']) for (const device of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`record actual canonical and screen LOD performance (${projection}/${device.name})`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    test.setTimeout(360_000);
    const errors = [], records = [];
    page.on('pageerror', error => errors.push(String(error.message)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const url = new URL('?debug=1&renderer=webgl2',
      process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`);
    for (const cacheState of ['cold', 'warm']) {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true',
        { timeout: 90_000 });
      await expect.poll(() => page.evaluate(() => {
        const stats = window.__PANDOLAB_VIEWER__?.rendererStats?.();
        return !!(stats?.canonicalMeshReady && stats?.countrySharedBoundaryReady
          && stats?.countriesPublishedGeneration === stats?.projectGeneration
          && stats?.surfaceDraw?.countryIndexCount > 0);
      }), { timeout: 90_000 }).toBe(true);
      for (const zoom of [1, 2, 4, 8, 16, 32, 64]) {
        const start = Date.now();
        await page.evaluate(({ projection, zoom }) => {
          const host = window.__PANDOLAB_MAP_HOST__;
          host.setViewState({ projection, view: { flatCenter: [127.8, 36.5],
            flatZoom: zoom, globeRotation: [-127.8, -36.5, 0],
            globeZoom: zoom } });
          host.requestRepaint('lod-p0-benchmark');
        }, { projection, zoom });
        // The LOD worker can finish *after* the next animation frame. Do not
        // misreport an uncommitted canonical fallback as a measured LOD frame.
        let lodSettled = false;
        try {
          await page.waitForFunction(() => {
            const stats = window.__PANDOLAB_VIEWER__?.rendererStats?.();
            return !!(stats?.screenLodBucket && stats.screenLodLatest?.key === stats.screenLodBucket
              && !stats.screenLodPreparingKey);
          }, null, { timeout: 15000 });
          lodSettled = true;
        } catch { /* The report explicitly records an unsettled candidate. */ }
        const lodAdmissionMs = lodSettled ? Date.now() - start : null;
        const result = await page.evaluate(async ({ cacheState, projection, zoom }) => {
          const frames = [];
          await new Promise(resolve => {
            let previous = null, count = 0;
            const sample = now => {
              if (previous !== null) frames.push(now - previous);
              previous = now;
              if (++count >= 40) resolve();
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          const stats = window.__PANDOLAB_VIEWER__.rendererStats();
          const runtime = window.__PANDOLAB_PERFORMANCE_REPORT__?.();
          const nav = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          return {
            cacheState, projection, zoom, capturedAt: new Date().toISOString(),
            projectGeneration: stats.projectGeneration,
            projectMonth: window.__PANDOLAB_VIEWER__.builtinMonth()?.month,
            renderer: stats.renderer, screenScale: stats.screenScale,
            canonicalReady: stats.canonicalMeshReady,
            activeMeshQuality: stats.activeMeshQuality,
            screenLodBucket: stats.screenLodBucket,
            screenLodLatest: stats.screenLodLatest,
            screenLodFailure: stats.screenLodFailure,
            screenLodWorker: stats.patchWorkerJobs?.displayLod || null,
            screenLodPreparedCount: stats.screenLodPreparedCount || 0,
            screenLodBudgetRejectCount: stats.screenLodBudgetRejectCount || 0,
            renderVertices: stats.renderVertices,
            triangleCount: stats.triangleCount, lineSegmentCount: stats.lineSegmentCount,
            countryMeshRebuildCount: stats.countryMeshRebuildCount,
            countryMeshReuseCount: stats.countryMeshReuseCount,
            p95CpuSubmitMs: stats.p95CpuSubmitMs,
            p99CpuSubmitMs: stats.p99CpuSubmitMs,
            firstCanonicalFrameMs: stats.firstCanonicalFrameMs,
            firstBackgroundFrameMs: stats.firstBackgroundFrameMs,
            firstCountryPublishedMs: stats.firstCountryPublishedMs,
            gpuBytes: stats.meshVariantBytes,
            jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
            networkTransferBytes: resources.reduce((sum, row) => sum + row.transferSize, 0),
            networkEncodedBytes: resources.reduce((sum, row) => sum + row.encodedBodySize, 0),
            networkRequestCount: resources.length,
            navigationLoadEventMs: nav?.loadEventEnd || null,
            runtimeOperations: runtime?.operations || null,
            frameIntervals: frames,
          };
        }, { cacheState, projection, zoom });
        records.push({
          ...result, elapsedZoomMs: Date.now() - start,
          lodSettled, lodAdmissionMs,
          p95FrameIntervalMs: percentile(result.frameIntervals, 0.95),
          p99FrameIntervalMs: percentile(result.frameIntervals, 0.99),
          frameIntervals: undefined,
        });
      }
    }
    const report = { label: process.env.PANDOLAB_BASELINE_LABEL || 'unlabeled',
      projection, viewport: `${device.width}x${device.height}`, device: device.name, measured: true, errors, records };
    await writeFile(info.outputPath(`render-lod-${projection}-${device.name}.json`),
      JSON.stringify(report, null, 2));
    console.log('MAP_LOD_BENCHMARK ' + JSON.stringify(report));
    expect(errors).toEqual([]);
  });
}
