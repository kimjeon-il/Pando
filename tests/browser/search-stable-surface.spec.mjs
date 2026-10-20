import { expect, test } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';

async function openProduct(page, product) {
  await page.setViewportSize({ width: 1024, height: 800 });
  if (product === 'editor') {
    await gotoEditor(page, '/?renderer=canvas&demTerrain=raster');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  } else {
    await page.goto('/?debug=1&renderer=canvas');
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
  }
}

for (const product of ['editor', 'viewer']) {
  test(product + ' search keeps one DOM and focused input through desktop/mobile', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openProduct(page, product);
    const root = page.locator(product === 'editor' ? '#app' : '#viewer');
    const panel = page.locator('#objectSearchSurface');
    const input = page.locator('#objectSearchInput');
    await panel.evaluate(node => { node.parentElement.dataset.p2SearchParent = 'stable'; });
    const parent = () => panel.evaluate(node => node.parentElement?.dataset.p2SearchParent);
    await page.locator('#objectSearchBtn').click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/search-toolbar-desktop/);
    await expect.poll(() => panel.evaluate(node => {
      const actual = node.getBoundingClientRect();
      const slot = document.querySelector('.map-command-search').getBoundingClientRect();
      return Math.max(Math.abs(actual.left - slot.left), Math.abs(actual.top - slot.top), Math.abs(actual.width - slot.width));
    })).toBeLessThan(2);
    await input.fill('독일');
    await expect(input).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(root).toHaveAttribute('data-layout', 'mobile');
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveClass(/search-toolbar-desktop/);
    await expect(input).toHaveValue('독일');
    await expect(input).toBeFocused();
    expect(await parent()).toBe('stable');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(root).toHaveAttribute('data-layout', 'wide');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/search-toolbar-desktop/);
    await expect(input).toHaveValue('독일');
    await expect(input).toBeFocused();
    expect(await parent()).toBe('stable');
    await expect.poll(() => panel.evaluate(node => {
      const actual = node.getBoundingClientRect();
      const slot = document.querySelector('.map-command-search').getBoundingClientRect();
      return Math.max(Math.abs(actual.left - slot.left), Math.abs(actual.top - slot.top), Math.abs(actual.width - slot.width));
    })).toBeLessThan(2);
    const hittable = await input.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === node;
    });
    expect(hittable).toBe(true);
    expect(errors).toEqual([]);
  });
}

test.use({ hasTouch: true });
test('viewer landscape search stays in its authored location after portrait rotation', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return String(type).includes('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'phone-landscape');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
  const panel = page.locator('#objectSearchSurface');
  await panel.evaluate(node => { node.parentElement.dataset.p2SearchParent = 'stable'; });
  await page.locator('#objectSearchBtn').tap();
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveClass(/search-toolbar-desktop/);
  await page.locator('#objectSearchInput').fill('서울');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'mobile');
  await expect(panel).toBeVisible();
  await expect(page.locator('#objectSearchInput')).toHaveValue('서울');
  expect(await panel.evaluate(node => node.parentElement?.dataset.p2SearchParent)).toBe('stable');
});
