import { expect, test } from '@playwright/test';

const visualSelectors = [
  '.map-base-svg',
  '.gpu-map-canvas',
  '.map-overlay-svg',
  '.map-interaction-svg',
  '.map-graticule',
  '.country-label-layer',
  '.labels-layer',
];

async function visualFrameIds(page) {
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const node = document.querySelector(selector);
    return [selector, node?.getAttribute('data-visual-frame-id') || ''];
  })), visualSelectors);
}

test('flat and globe view-attached layers commit the same visual frame', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });

  for (const selector of ['#globeBtn', '#flatBtn']) {
    await page.locator(selector).evaluate(button => button.click());
    const map = page.locator('#map');
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.61, box.y + box.height * 0.55, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => {
      const ids = Object.values(await visualFrameIds(page));
      return ids.length > 0 && ids.every(id => id && id === ids[0]);
    }, { timeout: 20_000 }).toBe(true);
  }

  const stats = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot?.().rendering || null);
  expect(stats?.visualFrameCommittedCount).toBeGreaterThan(0);
  expect(stats?.visualFramePartialCommitCount).toBe(0);
  expect(errors).toEqual([]);
});
