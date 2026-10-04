import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 }, trace: 'off', actionTimeout: 10_000,
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

async function savedPresentation(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('projects', 'readonly').objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

test('general view menu keeps upper and lower settings independent across keyboard navigation, layout changes and reload', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = process.env.PANDOLAB_TEST_SITE_URL
    ? new URL('?debug=1&demTerrain=raster', process.env.PANDOLAB_TEST_SITE_URL).href : '/?debug=1&demTerrain=raster';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#mapDisplayBtn').click();
  const general = page.locator('[data-map-display-row="general"]');
  const upper = page.locator('[data-map-display-row="countries"]');
  const lower = page.locator('[data-map-display-row="subunits"]');
  await expect(general).toBeVisible();
  await expect(page.locator('.view-menu-root [data-map-display-row="countries"], .view-menu-root [data-map-display-row="subunits"]')).toHaveCount(0);
  await general.focus();
  await page.keyboard.press('ArrowRight');
  await expect(upper).toBeFocused();
  await expect(upper).toContainText('상위 객체');
  await expect(lower).toContainText('하위 객체');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#countriesVisible')).toBeFocused();
  await expect(page.locator('#generalDisplayOptions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(upper).toBeFocused();
  await expect(page.locator('#generalDisplayOptions')).toBeVisible();
  await expect(page.locator('#layerStylePanel-countries')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(general).toBeFocused();
  await expect(page.locator('#generalDisplayOptions')).toBeHidden();
  await general.click();
  await upper.hover();
  await expect(page.locator('#countriesVisible')).toBeVisible();
  await general.hover();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await upper.hover();
  await page.locator('label').filter({ has: page.locator('#countriesVisible') }).click();
  await expect(page.locator('#countriesVisible')).not.toBeChecked();
  await expect(page.locator('g.territorial-label-item[data-label-id="DEU"]')).toHaveCount(0);
  await lower.hover();
  await expect(page.locator('#subunitsVisible')).toBeChecked();
  await page.locator('label').filter({ has: page.locator('#subunitFlagsVisible') }).click();
  await expect(page.locator('#subunitFlagsVisible')).not.toBeChecked();
  await expect.poll(async () => {
    const saved = await savedPresentation(page);
    return saved && [saved.layerVisibility.countries, saved.layerVisibility.subunits,
      saved.layerVisibility.countryFlags, saved.layerVisibility.subunitFlags];
  }).toEqual([false, true, true, false]);
  await page.screenshot({ path: testInfo.outputPath('general-hierarchy-menu.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect(general.locator('.view-menu-leading > span')).toBeVisible();
  await general.click();
  await lower.click();
  await expect(page.locator('#subunitFlagsVisible')).toBeVisible();
  await expect(page.locator('#subunitFlagsVisible')).not.toBeChecked();
  await expect(page.locator('#subunitsVisible')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('general-hierarchy-mobile.png') });
  await page.setViewportSize({ width: 1366, height: 900 });
  await general.click();
  await upper.hover();
  await expect(page.locator('#countriesVisible')).not.toBeChecked();
  await page.locator('label').filter({ has: page.locator('#countriesVisible') }).click();
  await expect(page.locator('#countriesVisible')).toBeChecked();
  await expect(page.locator('g.territorial-label-item[data-label-id="DEU"]')).toHaveCount(1);
  await expect.poll(async () => (await savedPresentation(page))?.layerVisibility.countries).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#mapDisplayBtn').click();
  await general.click();
  await lower.hover();
  await expect(page.locator('#subunitFlagsVisible')).not.toBeChecked();
  expect(errors).toEqual([]);
});
