import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off' });

test('regional globe culls offscreen shared-country blocks without losing the presented border', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message)));
  await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
  const sample = () => page.evaluate(() => {
    const viewer = globalThis.__PANDOLAB_VIEWER__, s = viewer?.rendererStats();
    return { ready: viewer?.initialMapPresented(), renderer: s?.renderer,
      quality: s?.activeMeshQuality, borderReady: s?.countrySharedBoundaryReady,
      screenScale: s?.screenScale, generation: s?.projectGeneration,
      published: s?.countriesPublishedGeneration, stroke: s?.stroke,
      borderMode: s?.countryBoundaryMode, pending: s?.countrySharedBoundaryReplacementPending };
  });
  await expect.poll(async () => {
    const s = await sample();
    return s.ready && s.renderer === 'webgl2' && s.borderReady && s.published === s.generation;
  }, { timeout: 120_000 }).toBe(true);
  const before = await sample();
  expect(before.borderMode).toBe('shared');

  await page.evaluate(() => {
    const host = globalThis.__PANDOLAB_MAP_HOST__;
    host.setViewState({ projection: 'globe', view: {
      flatCenter: [12, 48], flatZoom: 32, globeRotation: [-12, -48, 0], globeZoom: 32,
    } });
    host.requestRepaint('p1-country-border-visibility-europe');
  });
  await expect.poll(async () => {
    const s = await sample();
    return s.borderReady && s.published === s.generation && s.stroke?.visibilityCacheMisses > before.stroke.visibilityCacheMisses
      && s.stroke?.culledSegmentInstances > before.stroke.culledSegmentInstances;
  }, { timeout: 120_000 }).toBe(true);
  const after = await sample();
  expect(after.borderMode).toBe('shared');
  expect(after.stroke.failureCount).toBe(before.stroke.failureCount);
  expect(after.stroke.visibilityFrameChanges).toBeGreaterThan(before.stroke.visibilityFrameChanges);
  expect(errors).toEqual([]);
});
