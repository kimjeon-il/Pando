import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'off' });

test('dynamic country LOD never publishes an obsolete viewport or replaces canonical picking', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message)));
  await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', {
    timeout: 90_000,
  });
  const frame = () => page.evaluate(() => {
    const viewer = globalThis.__PANDOLAB_VIEWER__, s = viewer.rendererStats();
    return {
      ready: viewer.initialMapPresented(),
      canonicalReady: s.canonicalMeshReady,
      projectGeneration: s.projectGeneration,
      publishedGeneration: s.countriesPublishedGeneration,
      active: s.activeMeshQuality,
      canonicalBytes: s.meshVariantBytes?.canonical,
      source: s.screenLodSourceKey,
      target: s.screenLodTargetKey,
      preparing: s.screenLodPreparingKey,
      latest: s.screenLodLatest,
      failure: s.screenLodFailure,
    };
  });
  await expect.poll(async () => {
    const value = await frame();
    return value.ready && value.canonicalReady
      && value.publishedGeneration === value.projectGeneration;
  }, { timeout: 90_000 }).toBe(true);

  const applyView = async (longitude, zoom) => page.evaluate(({ longitude, zoom }) => {
    const host = globalThis.__PANDOLAB_MAP_HOST__;
    // The production Viewer is globe-only. Pan the actual supported globe
    // projection so LOD source/viewport admission is exercised, not rejected.
    host.setViewState({
      projection: 'globe', view: {
        globeRotation: [-longitude, -30, 0], globeZoom: zoom,
      },
    });
    host.requestRepaint('country-screen-lod-test');
  }, { longitude, zoom });

  // Compare two regional windows at identical scale. Their LOD keys must
  // cover different visible country sets or fall back to full-world mode.
  await applyView(10, 32);
  await expect.poll(async () => (await frame()).target, { timeout: 40_000 })
    .toMatch(/:/);
  const europe = await frame();
  await applyView(130, 32);
  await expect.poll(async () => {
    const current = await frame();
    return current.target && current.target !== europe.target;
  }, { timeout: 40_000 }).toBe(true);
  const eastAsia = await frame();
  expect(eastAsia.projectGeneration).toBe(europe.projectGeneration);
  expect(eastAsia.source).toBe(europe.source);

  // No previously created derivative is eligible for this new viewport.
  await expect.poll(async () => {
    const s = await frame();
    return s.canonicalReady && s.publishedGeneration === s.projectGeneration
      && ['canonical', 'lod'].includes(s.active);
  }, { timeout: 60_000 }).toBe(true);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  expect(pageErrors).toEqual([]);
});
