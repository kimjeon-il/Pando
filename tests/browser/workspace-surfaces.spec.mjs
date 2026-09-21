import { expect, test } from '@playwright/test';

async function openApp(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

test('mobile create, display and editor share the current sheet contract', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { width: 390, height: 844 });

  const surfaces = [
    ['#mobileCreateBtn', '#createMenu'],
    ['#mobileDisplayBtn', '#mapDisplaySurface'],
    ['#mobileEditBtn', '#rightPanel'],
  ];

  for (const [triggerSelector, panelSelector] of surfaces) {
    if (triggerSelector === '#mobileDisplayBtn') {
      await page.locator('#mobileMenuBtn').click();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
    }
    const trigger = page.locator(triggerSelector);
    const panel = page.locator(panelSelector);
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const handle = panel.locator('[data-sheet-handle]');
    await expect(handle).toHaveAttribute('role', 'slider');
    await handle.press('End');
    await expect(panel).toHaveAttribute('data-sheet-snap', '2');
    await handle.press('Home');
    await expect(panel).toHaveAttribute('data-sheet-snap', '0');
    for (const [otherTrigger, otherPanel] of surfaces) {
      if (otherPanel === panelSelector) continue;
      await expect(page.locator(otherPanel)).toBeHidden();
      await expect(page.locator(otherTrigger)).toHaveAttribute('aria-expanded', 'false');
    }
  }
});

test('display and create reuse their DOM when switching between menu and sheet layouts', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { width: 1024, height: 800 });

  await page.evaluate(() => {
    document.querySelector('#createMenu').dataset.testIdentity = 'create';
    document.querySelector('#mapDisplaySurface').dataset.testIdentity = 'display';
  });

  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('#mapDisplaySurface')).not.toHaveClass(/view-menu-desktop/);
  await expect(page.locator('#mapDisplaySurface')).toHaveCount(1);
  await expect(page.locator('#createMenu')).toHaveCount(1);
  await expect(page.locator('#mapDisplaySurface')).toHaveAttribute('data-test-identity', 'display');
  await expect(page.locator('#createMenu')).toHaveAttribute('data-test-identity', 'create');
});

test('hamburger is mobile-only and mobile workspace fills the viewport', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { width: 1366, height: 800 });
  await expect(page.locator('#mobileMenuBtn')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobileMenuBtn')).toBeVisible();
  const metrics = await page.evaluate(() => {
    const app = document.querySelector('#app').getBoundingClientRect();
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    return { appTop: app.top, appHeight: app.height, workspaceTop: workspace.top, workspaceHeight: workspace.height };
  });
  expect(metrics.workspaceTop).toBe(0);
  expect(metrics.workspaceHeight).toBeGreaterThanOrEqual(metrics.appHeight - 1);
});
