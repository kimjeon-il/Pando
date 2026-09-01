import { expect, test } from '@playwright/test';

async function openDebugMap(page, viewport) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize(viewport);
  await page.goto('/?debug=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => !!window.__PANDOLAB_VIEW_DEBUG__)).toBe(true);
  return errors;
}

function expectPairClose(actual, expected, tolerance = 1e-8) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(Math.abs(Number(value) - Number(expected[index]))).toBeLessThanOrEqual(tolerance));
}

async function zoomAndPan(page) {
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.58, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -520);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom)).toBeGreaterThan(1);
}

test('whole-map view is zoom-only in flat and globe projections', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openDebugMap(page, { width: 1440, height: 900 });

  await page.evaluate(() => document.getElementById('flatBtn')?.click());
  await zoomAndPan(page);
  const flatBefore = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  await expect(page.locator('#resetViewBtn')).toHaveAttribute('aria-label', '전체 지도 보기');
  await page.locator('#resetViewBtn').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().flatZoom)).toBe(1);
  const flatAfter = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  expectPairClose(flatAfter.flatCenter, flatBefore.flatCenter);
  await page.locator('#resetViewBtn').click();
  expectPairClose((await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot())).flatCenter, flatBefore.flatCenter);

  await page.evaluate(() => document.getElementById('globeBtn')?.click());
  await zoomAndPan(page);
  const globeBefore = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  await page.locator('#resetViewBtn').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().globeZoom)).toBe(1);
  const globeAfter = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  expectPairClose(globeAfter.globeRotation, globeBefore.globeRotation);
  expect(errors).toEqual([]);
});

test('object focus uses the actual viewport center with the editor panel open', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openDebugMap(page, { width: 1440, height: 900 });
  await page.evaluate(() => document.getElementById('flatBtn')?.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().projection)).toBe('flat');
  const countryId = 'DEU';
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select('country', id), countryId);
  await expect(page.locator('#rightPanel')).toBeVisible();
  await page.locator('#focusSelectedObjectBtn').click();

  const countryFocus = await page.evaluate(id => {
    const feature = window.PANDOLAB_TERRITORIAL.get(id);
    const anchor = window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor(id);
    return {
      anchor,
      anchorScreen: anchor ? window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(anchor) : null,
      bounds: window.__PANDOLAB_VIEW_DEBUG__.featureBounds(feature),
      size: window.__PANDOLAB_VIEW_DEBUG__.snapshot().size,
    };
  }, countryId);
  const countryCenterX = countryFocus.anchorScreen?.[0]
    ?? (countryFocus.bounds[0][0] + countryFocus.bounds[1][0]) / 2;
  const countryCenterY = countryFocus.anchorScreen?.[1]
    ?? (countryFocus.bounds[0][1] + countryFocus.bounds[1][1]) / 2;
  expect(Math.abs(countryCenterX - countryFocus.size.width / 2)).toBeLessThan(2);
  expect(Math.abs(countryCenterY - countryFocus.size.height / 2)).toBeLessThan(2);

  expect(errors).toEqual([]);
});

test('mobile focus and whole-map view use the same viewport-center and zoom-only rules', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const errors = await openDebugMap(page, { width: 390, height: 844 });
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
    await page.evaluate(() => document.getElementById('focusSelectedObjectBtn')?.click());
    const focused = await page.evaluate(() => {
      const feature = window.PANDOLAB_TERRITORIAL.get('DEU');
      const anchor = window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor('DEU');
      const bounds = window.__PANDOLAB_VIEW_DEBUG__.featureBounds(feature);
      return {
        screen: anchor ? window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(anchor) : [
          (bounds[0][0] + bounds[1][0]) / 2,
          (bounds[0][1] + bounds[1][1]) / 2,
        ],
        snapshot: window.__PANDOLAB_VIEW_DEBUG__.snapshot(),
      };
    });
    expect(Math.abs(focused.screen[0] - focused.snapshot.size.width / 2)).toBeLessThan(1.5);
    expect(Math.abs(focused.screen[1] - focused.snapshot.size.height / 2)).toBeLessThan(1.5);

    const cameraBeforeReset = focused.snapshot.projection === 'globe' ? focused.snapshot.globeRotation : focused.snapshot.flatCenter;
    await expect(page.locator('#mobileWorldBtn')).toHaveAttribute('aria-label', '전체 지도 보기');
    await page.evaluate(() => document.getElementById('mobileWorldBtn')?.click());
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom)).toBe(1);
    const reset = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
    expectPairClose(reset.projection === 'globe' ? reset.globeRotation : reset.flatCenter, cameraBeforeReset);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
