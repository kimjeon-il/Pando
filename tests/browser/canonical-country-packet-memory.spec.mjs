import { expect, test } from '@playwright/test';
import {worldAssets} from '../helpers/world-assets.mjs';

test.use({ trace: 'off' });

test('canonical packet materializes cooperatively in an isolated browser harness', async ({ page }) => {
  test.setTimeout(120_000);
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/packet-harness', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body>packet harness</body></html>',
  }));
  await page.goto('/packet-harness');

  const result = await page.evaluate(async packetUrl => {
    const longTasks = [];
    if (typeof globalThis.PerformanceObserver === 'function') {
      try {
        const observer = new globalThis.PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
        observer.observe({ entryTypes: ['longtask'] });
      } catch (_) { /* unsupported */ }
    }
    const heapBefore = Number(performance.memory?.usedJSHeapSize || 0);
    const [{ createCanonicalCountryStore }, response] = await Promise.all([
      import('/assets/js/modules/canonical-country-packet.js'),
      fetch(`/assets/data/${packetUrl}`),
    ]);
    if (!response.ok) throw new Error(`packet request failed: ${response.status}`);
    const compressed = await response.arrayBuffer();
    const decoded = await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
    const store = createCanonicalCountryStore(decoded);
    const slices = [];
    const materialized = await store.materializeCollection({
      budgetMs: 4,
      coordinateBudget: 4096,
      waitForQuiet: async () => {},
      yieldFrame: () => new Promise(resolve => setTimeout(resolve, 0)),
      onSlice: slice => slices.push(slice),
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      compressedBytes: compressed.byteLength,
      decodedBytes: decoded.byteLength,
      retainedBytes: store.byteLength,
      featureCount: materialized.collection.features.length,
      coordinateCount: materialized.metrics.coordinateCount,
      sliceCount: materialized.metrics.sliceCount,
      maxSliceCoordinates: Math.max(...slices.map(slice => slice.coordinateCount)),
      longTaskCount: longTasks.filter(duration => duration >= 50).length,
      heapBefore,
      heapAfter: Number(performance.memory?.usedJSHeapSize || 0),
    };
  }, worldAssets.canonicalCountryPacket.url);

  expect(requests.filter(url => url.includes(worldAssets.canonicalCountryPacket.url))).toHaveLength(1);
  expect(requests.filter(url => url.includes('countries-ne-5.1.1.geojson.gz'))).toHaveLength(0);
  expect(result.compressedBytes).toBeLessThan(5.5 * 1024 * 1024);
  expect(result.decodedBytes).toBeLessThan(10 * 1024 * 1024);
  expect(result.retainedBytes).toBeLessThan(10 * 1024 * 1024);
  expect(result.featureCount).toBe(258);
  expect(result.coordinateCount).toBe(548_454);
  expect(result.sliceCount).toBeGreaterThan(1);
  expect(result.maxSliceCoordinates).toBeLessThanOrEqual(4096);
  expect(result.longTaskCount).toBe(0);
});

test('default world startup uses packed assets without catalog index or entity chunk requests',async({page})=>{
 const requests=[];page.on('request',request=>requests.push(request.url()));
 await page.goto('/');
 await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90_000});
 expect(requests.filter(url=>url.includes('/territorial-entities/'))).toEqual([]);
 expect(requests.filter(url=>url.includes(worldAssets.canonicalCountryPacket.url))).toHaveLength(1);
 expect(requests.filter(url=>url.includes(worldAssets.canonicalMesh.url))).toHaveLength(1);
 expect(await page.evaluate(()=>window.__PANDOLAB_STARTUP_METRICS__.canonicalMaterializedCoordinateCount)).toBe(548_454);
});
