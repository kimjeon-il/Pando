import { test, expect } from '@playwright/test';

test('fresh default Subunits survive canonical promotion and edit Undo on desktop/mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  expect(errors).toEqual([]);
  const info = await page.evaluate(() => {
    const api = window.PANDOLAB_TERRITORIAL;
    const units = api.list({ kind: 'general' }).filter(f => f.properties.parentId);
    const greenland = units.find(f => f.properties.metadata?.builtinSubunit?.sourceCountryId === 'GRL');
    return { count: units.length, countries: api.list({ kind: 'general', parentId: '' }).length, id: greenland.id, parent: greenland.properties.parentId };
  });
  expect(info.count).toBe(47);
  expect(info.countries).toBe(207);
  expect(info.parent).toBe('DNK');
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), info.id);
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#entityNameInput')).toHaveValue('그린란드');
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setColor(id, '#ff9900'), info.id);
  await expect(page.locator('#entityColorInput')).toHaveValue('#ff9900');
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general', parentId: '' }).length)).toBe(207);
  await page.locator('#redoBtn').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), info.id);
  await expect(page.locator('#entityNameInput')).toHaveValue('그린란드');
  expect(errors).toEqual([]);
});
