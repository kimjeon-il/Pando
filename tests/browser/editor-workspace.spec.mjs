import { expect, test } from '@playwright/test';

async function openActionsTab(page) {
  await page.mouse.move(0, 0);
  await page.locator('#actionsTabBtn').click();
}

test('the current editor surface owns tasks at every responsive width', async ({ page }) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect(page.locator('#countryProperties')).toBeVisible();
  await expect.poll(async () => {
    const panel = await page.locator('#rightPanel').boundingBox();
    return Math.round(panel.x + panel.width);
  }).toBe(1440);
  const panel = await page.locator('#rightPanel').boundingBox();
  const map = await page.locator('#map').boundingBox();
  const topbar = await page.locator('.topbar').boundingBox();
  expect(Math.round(panel.y)).toBe(Math.round(topbar.y + topbar.height));
  // The wide editor overlays the map edge without resizing the map viewport,
  // so opening the editor must not shift the geographic projection.
  expect(Math.round(map.x + map.width)).toBe(1440);
  expect(Math.round(map.x + map.width)).toBeGreaterThan(Math.round(panel.x));
  await expect(page.locator('#leftPanel')).toBeVisible();
  await page.locator('#focusSelectedObjectBtn').click();
  await openActionsTab(page);
  await page.locator('#annexTerritoryBtn').click();
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 1단계');
  await expect(page.locator('#editorScrollBody')).not.toBeVisible();
  await expect(page.locator('#modeTaskMinimizeBtn')).not.toBeVisible();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'compact');
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#rightPanel')).toHaveAttribute('data-editor-content', 'task');
  await expect(page.locator('#mapTopContextSlot #modeEditingContext')).toHaveCount(0);
  await expect(page.locator('#modeTaskMinimizeBtn')).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 1단계');
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#rightPanel')).toHaveAttribute('data-editor-content', 'properties');
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await openActionsTab(page);
  await page.locator('#mergeCountryBtn').click();
  await expect(page.locator('#editorTaskSlot #modeTaskName')).toHaveText('국가 합병');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect(page.locator('#rightPanel')).toHaveClass(/mobile-open/);
  await expect(page.locator('#rightPanel')).toHaveAttribute('data-editor-content', 'task');
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#mapTopContextSlot #modeEditingContext')).toHaveCount(0);
  await expect(page.locator('#modeTaskMinimizeBtn')).not.toBeVisible();
  await page.locator('#modeCancelBtn').click();
  expect(errors).toEqual([]);
});
