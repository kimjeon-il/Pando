import { expect, test } from '@playwright/test';

test('global file menus stay above the object editor and keep their existing focus flow', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('BIH'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#editorObjectHeader')).toBeVisible();
  const menu = page.locator('#fileMenu');
  await expect(page.locator('.overlay-root > #fileMenu')).toHaveCount(1);
  await expect(page.locator('.overlay-root > #mobileGlobalMenu')).toHaveCount(1);
  const selection = await page.locator('#propertyTitle').textContent();
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const mobile = width === 390;
    if (mobile) {
      await page.locator('[data-sheet-handle="editorSurface"]').press('End');
      await page.locator('#mobileMenuBtn').click();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
      await page.locator('#mobileMenuFileBtn').click();
    } else await page.locator('#mobileFileBtn').click();
    await expect(menu).toBeVisible();
    await expect(page.locator('#newProjectBtn')).toBeFocused();
    const hitTesting = await page.locator('#newProjectBtn').evaluate(button => {
      const rect = button.getBoundingClientRect();
      const editor = document.getElementById('editorSurface').getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        menuHit: !!hit?.closest('#fileMenu'),
        editorOverlap: rect.right > editor.left && rect.left < editor.right && rect.bottom > editor.top && rect.top < editor.bottom,
      };
    });
    expect(hitTesting.menuHit).toBe(true);
    expect(hitTesting.editorOverlap).toBe(true);
    await page.locator('#saveProjectBtn').click({ trial: true });
    await page.screenshot({ path: testInfo.outputPath(`file-above-editor-${width}.png`) });
    await page.locator('#newProjectBtn').press('End');
    await expect(page.locator('#dataExportBtn')).toBeFocused();
    if (mobile) {
      await page.locator('#mobileFileBackBtn').click();
      await expect(menu).toBeHidden();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
      await page.locator('#mobileMenuFileBtn').press('Escape');
      await expect(page.locator('#mobileGlobalMenu')).toBeHidden();
    } else {
      await page.locator('#newProjectBtn').press('Escape');
      await expect(menu).toBeHidden();
    }
    await expect(page.locator(mobile ? '#mobileMenuBtn' : '#mobileFileBtn')).toBeFocused();
    await expect(page.locator('#editorObjectHeader')).toBeVisible();
    await expect(page.locator('#propertyTitle')).toHaveText(selection);
  }
  expect(errors).toEqual([]);
});
