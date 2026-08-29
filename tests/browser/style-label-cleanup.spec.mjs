import { expect, test } from '@playwright/test';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function renderedCountryLabelCount(page, countryId) {
  return page.evaluate(id => [...document.querySelectorAll('text.country-label')]
    .filter(node => String(node.__data__?.properties?.editor_id || '') === id).length, countryId);
}

test('a selected small-country label stays visible and screen-space zoom controls its automatic return', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const countryId = await page.evaluate(() => ['AND', 'LUX', 'LIE', 'SMR']
    .find(id => window.PANDOLAB_TERRITORIAL.get(id)?.geometry) || 'IRL');

  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select('country', id), countryId);
  await expect.poll(() => renderedCountryLabelCount(page, countryId)).toBe(1);
  await page.locator('#focusSelectedObjectBtn').click();
  await page.locator('#clearMultiSelectionBtn').evaluate(button => button.click());
  await expect(page.locator('#countryProperties')).toHaveClass(/\bhidden\b/);
  await expect.poll(() => renderedCountryLabelCount(page, countryId)).toBe(1);

  for (let step = 0; step < 12; step += 1) await page.locator('#zoomOutBtn').click();
  await expect.poll(() => renderedCountryLabelCount(page, countryId)).toBe(0);
  for (let step = 0; step < 12; step += 1) await page.locator('#zoomInBtn').click();
  await expect.poll(() => renderedCountryLabelCount(page, countryId)).toBe(1);
  expect(errors).toEqual([]);
});
