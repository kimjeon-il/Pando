import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', trace: 'off', viewport: { width: 1440, height: 900 } });

test('parent changes replace type conversion while preserving entity ID, kind, geometry and undo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60000 });
  const before = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'));
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('IRL'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#entityParentInput')).toHaveValue('');
  await expect(page.locator('#territorialTypeModal, #changeCountryTypeBtn, #promoteSubunitBtn')).toHaveCount(0);
  await page.locator('#entityParentInput').selectOption('GBR');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('GBR');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.entityKind)).toBe('general');
  await page.locator('#entityParentInput').selectOption('');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('');
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('GBR');
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'))).toEqual(before);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('IRL'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexEntityBtn').click();
  await expect(page.locator('#modeTaskObjects [aria-label="넘겨받는 객체"]')).toContainText('아일랜드');
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#modeActionBar')).toBeHidden();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'))).toEqual(before);
  expect(errors).toEqual([]);
});
