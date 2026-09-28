import { expect, test } from '@playwright/test';

test.skip(process.env.PANDOLAB_BENCHMARK_DEM !== '1', 'Run explicitly for a paired terrain release measurement');
test.use({
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
});

async function measure(page, source) {
  let bytes = 0;
  const onResponse = response => {
    const url = response.url();
    if (url.includes('/terrain/v0.13.0/') || url.includes('/terrain/v0.12.6/')) {
      bytes += Number(response.headers()['content-length'] || 0);
    }
  };
  page.on('response', onResponse);
  await page.goto(`/?renderer=webgl2&debug=1&demTerrain=${source === 'dem' ? 'preview' : 'raster'}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRepresentation),
    { timeout: 60_000 }).toBe(source === 'dem' ? 'dem-relief-v1' : 'raster-rgba-v1');
  await page.evaluate(() => {
    const host = window.__PANDOLAB_MAP_HOST__;
    const original = host.getViewState();
    host.setViewState({ projection: 'flat', view: {
      flatCenter: [100, 60], flatZoom: 2.4,
      globeRotation: original.globeRotation, globeZoom: original.globeZoom,
    } });
    host.requestRepaint('terrain-benchmark-start');
  });
  await expect.poll(() => page.evaluate(() => {
    const metrics = window.__PANDOLAB_GPU_METRICS__;
    return !!metrics?.terrainTargetTilesSettled && metrics.terrainTargetLevel === metrics.terrainRenderedLevel;
  }), { timeout: 90_000 }).toBe(true);
  const box = await page.locator('#map').boundingBox();
  const startX = box.x + box.width * 0.3;
  const startY = box.y + box.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY);
  await page.evaluate(() => {
    window.__terrainBenchmark = { active: true, intervals: [], shades: [] };
    let previous = performance.now();
    const sample = now => {
      const benchmark = window.__terrainBenchmark;
      if (!benchmark?.active) return;
      benchmark.intervals.push(now - previous);
      benchmark.shades.push(window.__PANDOLAB_GPU_METRICS__?.terrainShadeBlend ?? null);
      previous = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (let i = 0; i < 180; i += 1) {
    await page.mouse.move(startX + 10 + box.width * 0.3 * (i + 1) / 180, startY);
    await page.waitForTimeout(20);
  }
  const result = await page.evaluate(() => {
    const benchmark = window.__terrainBenchmark;
    benchmark.active = false;
    const intervals = benchmark.intervals.slice(3).sort((a, b) => a - b);
    const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
    return {
      p95FrameMs: Number(intervals[Math.floor(intervals.length * 0.95)].toFixed(2)),
      sampledFrames: intervals.length,
      zeroShadeFrames: benchmark.shades.filter(value => value === 0).length,
      maxDragShadeBlend: Math.max(...benchmark.shades.filter(Number.isFinite)),
      p95CpuSubmitMs: metrics.p95CpuSubmitMs,
      terrainCacheBytes: metrics.terrainCacheBytes,
      terrainPendingDecodedBytes: metrics.terrainPendingDecodedBytes,
      terrainTargetLevel: metrics.terrainTargetLevel,
      terrainRenderedLevel: metrics.terrainRenderedLevel,
      terrainTargetTilesSettled: metrics.terrainTargetTilesSettled,
      terrainSource: metrics.terrainSource,
    };
  });
  await page.mouse.up();
  page.off('response', onResponse);
  return { ...result, transferredTerrainBytes: bytes };
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`paired Russia terrain pan ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize(viewport);
    const raster = await measure(page, 'raster');
    const dem = await measure(page, 'dem');
    console.log(JSON.stringify({ viewport: viewport.width, raster, dem }));
    expect(dem.terrainSource).toBe('preview');
    expect(raster.terrainSource).toBe('raster');
  });
}
