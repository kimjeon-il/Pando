import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('editing label metadata immediately refreshes its map text and preserves the edited kind', async ({ page }) => {
  test.setTimeout(45_000);
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await page.locator('#createMenuBtn').click();
  await page.locator('#addLabelBtn').click();
  const bounds = await page.locator('#map').boundingBox();
  page.once('dialog', dialog => dialog.accept('수정 전 지명'));
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator('#labelProperties')).toBeVisible();
  await expect(page.locator('.user-label-text')).toHaveText('수정 전 지명');

  await page.locator('#labelNameInput').fill('수정 후 지명');
  await page.locator('#labelNameInput').press('Tab');
  await expect(page.locator('.user-label-text')).toHaveText('수정 후 지명');
  await expect(page.locator('#propertyTitle')).toHaveText('수정 후 지명');
  await selectUiOption(page, '#labelKindInput', 'capital');
  await expect(page.locator('#labelKindInput')).toHaveValue('capital');
  expect(await page.locator('.user-label').evaluate(node => ({ name: node.__data__.name, kind: node.__data__.kind })))
    .toEqual({ name: '수정 후 지명', kind: 'capital' });
  expect(errors).toEqual([]);
});
