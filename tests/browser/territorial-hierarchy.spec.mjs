import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

test('nested general objects use the common desktop/mobile creation and editor surface', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  expect(errors).toEqual([]);
  await expect(page.locator('#addEntityBtn')).toHaveCount(1);
  await expect(page.locator('#addTerritoryBtn, #addAdministrativeBtn, #territoryProperties, #administrativeProperties')).toHaveCount(0);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#addEntityChildBtn').evaluate(button => button.click());
  await expect(page.locator('#editorTaskSlot #territorialCreateSetup')).toBeVisible();
  await expect(page.locator('#modeTaskName')).toContainText('객체 추가');
  await expect(page.locator('#territorialCreateNameLabel')).toHaveText('이름');
  await expect(page.locator('#territorialCreateNameInput')).toHaveValue('새 객체');
  await expect(page.locator('#territorialCreateParentInput')).toHaveValue('DEU');
  await page.locator('#modeCancelBtn').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').evaluate(button => button.click());
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'subunit-smoke.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: { name: '하위단위 검증' }, geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] } }] })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await selectUiOption(page, '#gisTargetType', 'general');
  await selectUiOption(page, '#gisParentUnit', 'DEU');
  for (const step of ['2/3', '3/3']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId).some(unit => unit.properties.name === '하위단위 검증')), { timeout: 60_000 }).toBe(true);
  const id = await page.evaluate(() => {
    const unit = window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId).find(item => item.properties.name === '하위단위 검증');
    window.PANDOLAB_TERRITORIAL.select(unit.id);
    return unit.id;
  });
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#entityNameInput')).toHaveValue('하위단위 검증');
  await expect(page.locator('#subunitLevelInput')).toHaveCount(0);
  expect(await page.evaluate(key => Object.hasOwn(window.PANDOLAB_TERRITORIAL.get(key).properties, 'adminLevel'), id)).toBe(false);
  const originalColor = await page.locator('#entityColorInput').inputValue();
  await page.evaluate(key => window.PANDOLAB_TERRITORIAL.setColor(key, '#ff9900'), id);
  await expect(page.locator('#entityColorInput')).toHaveValue('#ff9900');
  await page.locator('#undoBtn').click();
  // Existing history restore clears selection; inspect the restored object,
  // not the hidden editor's retained input value.
  await page.evaluate(key => window.PANDOLAB_TERRITORIAL.select(key), id);
  await expect(page.locator('#entityColorInput')).toHaveValue(originalColor);
  await page.locator('#redoBtn').click();
  await page.evaluate(key => window.PANDOLAB_TERRITORIAL.select(key), id);
  await expect(page.locator('#entityColorInput')).toHaveValue('#ff9900');
  expect(await page.evaluate(key => {
    window.PANDOLAB_TERRITORIAL.setLocked(key, true);
    return window.PANDOLAB_TERRITORIAL.isLocked(key);
  }, id)).toBe(true);
  expect(await page.evaluate(key => {
    window.PANDOLAB_TERRITORIAL.setLocked(key, false);
    return window.PANDOLAB_TERRITORIAL.isLocked(key);
  }, id)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#addEntityBtn')).toHaveCount(1);
  await page.locator('#addEntityBtn').evaluate(button => button.click());
  await expect(page.locator('#editorTaskSlot #territorialCreateSetup')).toBeVisible();
  await expect(page.locator('#territorialCreateParentInput')).toHaveValue('');
  await selectUiOption(page, '#territorialCreateParentInput', 'DEU');
  expect(errors).toEqual([]);
});
