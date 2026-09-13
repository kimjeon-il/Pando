import { expect, test } from '@playwright/test';

async function openApp(page, viewport) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function searchFor(page, query) {
  await page.locator('#layerSearchInput').fill(query);
  const result = page.locator('#layerSearchResults .layer-search-result').first();
  await expect(result).toBeVisible();
  await expect(result).toContainText(query);
  return result;
}

test('compact map commands stay clickable and search closes only after a single normal selection', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 1024, height: 800 });

  await expect(page.locator('#mobileSearchBtn')).toBeHidden();
  await expect(page.locator('#objectSearchBtn')).toBeVisible();
  await expect(page.locator('#mapDisplayBtn')).toBeVisible();

  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  const countryRow = page.locator('[data-map-display-row="countries"]');
  await countryRow.click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(countryRow).toHaveAttribute('aria-expanded', 'true');
  const displayMenuGeometry = await page.evaluate(() => {
    const rect = selector => {
      const { left, right, top, width, height } = document.querySelector(selector)?.getBoundingClientRect() || {};
      return { left, right, top, width, height };
    };
    const countryRow = rect('[data-map-display-row="countries"]');
    const panel = rect('#layerStylePanel-countries');
    const visibilityLabel = rect('#countriesVisible + span');
    return { countryRow, panel, visibilityLabel };
  });
  expect(displayMenuGeometry.panel.left).toBeGreaterThanOrEqual(displayMenuGeometry.countryRow.right);
  expect(Math.abs(displayMenuGeometry.panel.top - displayMenuGeometry.countryRow.top)).toBeLessThanOrEqual(2);
  expect(displayMenuGeometry.visibilityLabel.height).toBeLessThanOrEqual(24);
  await page.locator('#countriesVisible').locator('..').click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(page.locator('#layerStylePanel-countries .view-menu-panel-content')).toHaveJSProperty('inert', true);
  await page.locator('#countriesVisible').locator('..').click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(page.locator('#layerStylePanel-countries .view-menu-panel-content')).toHaveJSProperty('inert', false);

  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeHidden();
  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  await (await searchFor(page, '폴란드')).click();
  await expect(page.locator('#objectSearchSurface')).toBeHidden();

  await page.locator('#objectSearchBtn').click();
  const germany = await searchFor(page, '독일');
  await germany.click({ modifiers: ['Control'] });
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile bottom navigation opens the display sheet without restoring desktop navigation', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });

  await expect(page.locator('#mobileDisplayBtn')).toBeVisible();
  await expect(page.locator('#mapDisplayBtn')).toBeHidden();
  await expect(page.locator('#objectSearchBtn')).toBeHidden();
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('[data-map-display-row="terrain"] .view-menu-leading')).toBeHidden();
  await expect(page.locator('#terrainVisible + span')).toHaveText('지형');
  await page.locator('[data-map-display-row="terrain"]').click();
  await expect(page.locator('#terrainDisplayOptions')).toBeVisible();
  await expect(page.locator('.sheet-drag-handle[data-sheet-handle="mapDisplaySurface"]')).toBeVisible();
  expect(errors).toEqual([]);
});
