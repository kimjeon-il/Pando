import { test, expect } from '@playwright/test';

test.describe('phase 1 residual UI cleanup', () => {
  test('removes obsolete editor surfaces while keeping the map status overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done');

    await expect(page.locator('.map-bottom-status')).toHaveCount(1);
    await expect(page.locator('.editor-edge-slot')).toHaveCount(0);
    await expect(page.locator('#togglePanelBtn')).toHaveCount(0);
    await expect(page.locator('.ui-dialog-kicker')).toHaveCount(0);
    await expect(page.locator('.create-toolbar-divider')).toHaveCount(0);

    await expect(page.locator('#selectionStatus')).toHaveCount(1);
    await expect(page.locator('#engineStatus')).toHaveCount(1);
    await expect(page.locator('.map-status-state')).toHaveCount(0);
  });

  test('historical library uses wide two-pane desktop and near-fullscreen mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await page.locator('#createMenuBtn').click();
    await page.locator('#createLibraryTabBtn').click();
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
    expect(mobile.width).toBeGreaterThanOrEqual(358);
    expect(mobile.height).toBeGreaterThanOrEqual(843);
    expect(mobile.radius).toBe('0px');
  });

test('GIS importer layout is available without the Phase 1 stylesheet', async ({ page }) => {
    await page.route('**/phase1-ui-cleanup.css*', route => route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: '',
    }));
    await page.goto('/');
    await page.locator('#mobileFileBtn').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#openGisBtn').click();
    await (await chooser).setFiles('tests/fixtures/sample-countries.geojson');

    const card = page.locator('#gisImportModal .ui-dialog-card');
    const form = page.locator('#gisImportForm');
    const rail = page.locator('#gisImportForm > .gis-import-content-rail');
    const actions = page.locator('#gisImportModal .ui-dialog-actions');
    await expect(card).toBeVisible();
    const desktop = await card.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      display: getComputedStyle(element).display,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(desktop).toEqual({ width: 640, display: 'grid', overflowY: 'hidden' });
    await expect(form).toHaveCSS('display', 'flex');
    await expect(rail).toHaveCSS('overflow-y', 'auto');
    await expect(actions).toHaveCSS('margin-top', '0px');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
    const mobile = await card.evaluate(el => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));
    expect(mobile.width).toBeGreaterThanOrEqual(389);
    expect(mobile.height).toBeGreaterThanOrEqual(843);
    await expect(actions).toBeVisible();
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
