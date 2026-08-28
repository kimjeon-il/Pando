import { test, expect } from '@playwright/test';

test.describe('phase 1 residual UI cleanup', () => {
  test('removes obsolete map/editor surfaces after startup', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done');

    await expect(page.locator('.map-bottom-status')).toHaveCount(0);
    await expect(page.locator('.editor-edge-slot')).toHaveCount(0);
    await expect(page.locator('#togglePanelBtn')).toHaveCount(0);
    await expect(page.locator('.ui-dialog-kicker')).toHaveCount(0);
    await expect(page.locator('.create-toolbar-divider')).toHaveCount(0);

    await expect(page.locator('#selectionStatus')).toHaveCount(1);
    await expect(page.locator('#engineStatus')).toHaveCount(1);
    await expect(page.locator('.map-status-state')).toHaveCount(1);
  });

  test('historical library uses wide two-pane desktop and fullscreen mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done');
    await page.locator('#addFromLibraryBtn').click();

    const card = page.locator('.historical-library-card');
    await expect(card).toBeVisible();
    const desktop = await card.evaluate(el => ({
      width: el.getBoundingClientRect().width,
      radius: getComputedStyle(el).borderRadius,
    }));
    expect(desktop.width).toBeLessThanOrEqual(1041);
    expect(desktop.width).toBeGreaterThan(700);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await card.evaluate(el => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      radius: getComputedStyle(el).borderRadius,
    }));
    expect(mobile.width).toBeGreaterThanOrEqual(389);
    expect(mobile.height).toBeGreaterThanOrEqual(843);
    expect(mobile.radius).toBe('0px');
  });

  test('GIS importer stays compact on desktop and fullscreen on mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done');
    await page.locator('#openGisBtn').click();

    const card = page.locator('#gisImportModal .ui-dialog-card');
    await expect(card).toBeVisible();
    const desktopWidth = await card.evaluate(el => el.getBoundingClientRect().width);
    expect(desktopWidth).toBeLessThanOrEqual(641);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await card.evaluate(el => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));
    expect(mobile.width).toBeGreaterThanOrEqual(389);
    expect(mobile.height).toBeGreaterThanOrEqual(843);
  });

  test('file menu does not use the page-wide modal backdrop', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done');
    await page.locator('#mobileFileBtn').click();
    const backdrop = page.locator('.mobile-backdrop');
    if (await backdrop.count()) {
      await expect(backdrop).toHaveCSS('display', 'none');
    }
  });
});
