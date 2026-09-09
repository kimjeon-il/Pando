import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('projection buttons retain all four borders in either selection state', async ({ page }) => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const section = html.match(/<section class="layer-style-editor map-projection-settings"[\s\S]*?<\/section>/)[0];
  await page.route('**/projection-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <link rel="stylesheet" href="/assets/css/app.css">
    <link rel="stylesheet" href="/assets/css/ui-v2.bundle.css">${section}` }));
  await page.goto('/projection-fixture');
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((el, value) => { el.dataset.theme = value; }, theme);
      for (const active of ['globeBtn', 'flatBtn']) {
        await page.locator('.projection-btn').evaluateAll((buttons, id) => {
          buttons.forEach(button => {
            button.classList.toggle('active', button.id === id);
            button.setAttribute('aria-pressed', String(button.id === id));
          });
        }, active);
        for (const id of ['globeBtn', 'flatBtn']) {
          const button = page.locator(`#${id}`);
          await button.hover();
          expect(await button.evaluate(el => {
            const style = getComputedStyle(el);
            return ['Top', 'Right', 'Bottom', 'Left'].map(side => style[`border${side}Width`]);
          })).toEqual(['1px', '1px', '1px', '1px']);
        }
      }
    }
  }
  expect(html).toContain('id="mapNameSettingsTitle">지도 표기');
  expect(html).toContain('aria-label="국기 표시"');
  expect(html).not.toContain('국기 함께 표시');
});
