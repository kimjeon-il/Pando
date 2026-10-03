import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('Ctrl deselection restores the remaining country presenter and toolbar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#entityProperties')).toBeVisible();
  const map = await page.locator('#map').boundingBox();
  const points = await page.evaluate(() => [[2, 47], [13, 51]].map(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate)));
  const viewBefore = await page.evaluate(() => {
    const view = window.__PANDOLAB_VIEW_STATE__;
    return { scale: view.scale, rotation: view.rotation, translate: view.translate, center: view.projectionCenter };
  });
  await page.keyboard.down('Control');
  try {
    await page.mouse.click(map.x + points[0][0], map.y + points[0][1]);
    await expect(page.locator('#multiProperties')).toBeVisible();
    await expect(page.locator('#selectionToolbar')).toBeHidden();
    await page.mouse.click(map.x + points[0][0], map.y + points[0][1]);
    await expect(page.locator('#entityProperties')).toBeVisible();
    await expect(page.locator('#propertyTitle')).toContainText('독일');
    // The card stays hidden while the editor is open, but must track its single object.
    await expect(page.locator('#selectionToolbar')).toHaveAttribute('data-object-key', 'territorial:country:DEU');
    const viewAfter = await page.evaluate(() => {
      const view = window.__PANDOLAB_VIEW_STATE__;
      return { scale: view.scale, rotation: view.rotation, translate: view.translate, center: view.projectionCenter };
    });
    expect(viewAfter).toEqual(viewBefore);
    await page.mouse.click(map.x + points[1][0], map.y + points[1][1]);
    await expect(page.locator('#entityProperties')).toBeHidden();
    await expect(page.locator('#multiProperties')).toBeHidden();
    await expect(page.locator('#selectionToolbar')).toBeHidden();
  } finally {
    await page.keyboard.up('Control');
  }
  expect(errors).toEqual([]);
});

test('search Shift click selects the displayed range and its final primary', async ({ page }) => {
  test.setTimeout(45_000);
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('국가');
  const rows = page.locator('#layerSearchResults .layer-search-result');
  await expect.poll(() => rows.count()).toBeGreaterThan(3);
  const displayedKeys = await rows.evaluateAll(nodes => nodes.slice(0, 4).map(node => node.dataset.objectKey));
  await rows.nth(0).locator('[data-object-search-select]').click();
  await page.locator('#selectionToolbarEditBtn').click();
  await page.locator('#objectSearchBtn').click();
  await expect(rows.nth(0)).toHaveAttribute('data-object-key', displayedKeys[0]);
  await rows.nth(2).locator('[data-object-search-select]').click({ modifiers: ['Shift'] });
  await expect.poll(() => rows.evaluateAll(nodes => nodes.filter(node => node.getAttribute('aria-selected') === 'true').map(node => node.dataset.objectKey)))
    .toEqual(displayedKeys.slice(0, 3));
  await expect(rows.nth(2)).toHaveClass(/is-primary-selected/);
  await expect(rows.nth(3)).toHaveAttribute('aria-selected', 'false');
  expect(errors).toEqual([]);
});

test('reselecting a country before idle area calculation finishes still displays its area', async ({ page }) => {
  test.setTimeout(45_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await page.evaluate(() => {
    const requestIdle = window.requestIdleCallback.bind(window);
    window.__countryAreaCallbacks = [];
    window.requestIdleCallback = (callback, options) => {
      if (options?.timeout !== 800) return requestIdle(callback, options);
      window.__countryAreaCallbacks.push(callback);
      return 1;
    };
    window.PANDOLAB_TERRITORIAL.select('DEU');
    window.PANDOLAB_TERRITORIAL.select('DEU');
  });
  await page.locator('#selectionToolbarEditBtn').click({ timeout: 8_000 });
  await expect(page.locator('#entityAreaValue')).toHaveText('면적 계산 중…');
  expect(await page.evaluate(() => window.__countryAreaCallbacks.length)).toBe(1);
  await page.evaluate(() => window.__countryAreaCallbacks.shift()());
  await expect(page.locator('#entityAreaValue')).not.toHaveText('면적 계산 중…');
  await expect(page.locator('#entityAreaValue')).toContainText('km²');
  expect(errors).toEqual([]);
});
