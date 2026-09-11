import { expect, test } from '@playwright/test';

test('draft vertex drag is routed through the editing packet boundary', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  const map = await page.locator('#map').boundingBox();
  expect(map).not.toBeNull();
  for (const [x, y] of [[0.38, 0.42], [0.48, 0.5], [0.6, 0.44]]) {
    await page.mouse.click(map.x + map.width * x, map.y + map.height * y);
  }
  const vertices = page.locator('g.draft-vertex');
  await expect(vertices).toHaveCount(3);
  const first = await vertices.first().boundingBox();
  expect(first).not.toBeNull();
  const target = [first.x + first.width / 2 + 34, first.y + first.height / 2 + 18];
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(target[0], target[1], { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#undoBtn')).toBeEnabled();
  await page.locator('#undoBtn').click();
  await expect(vertices).toHaveCount(3);
  expect(errors).toEqual([]);
});
