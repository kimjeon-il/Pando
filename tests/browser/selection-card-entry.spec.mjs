import { expect, test } from '@playwright/test';

async function openMap(page) {
  page.setDefaultTimeout(10_000);
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

const label = page => page.locator('g.territorial-label-item[data-label-id="DEU"]');

test('desktop hover previews a label without selecting it, and one click enters the editor', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openMap(page);
  await expect(page.locator('#selectionToolbar')).toBeHidden();
  const selectedBefore = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision);
  await label(page).hover();
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await expect(page.locator('#selectionCardName')).toHaveText('독일');
  await expect.poll(() => label(page).locator('text').evaluate(node => getComputedStyle(node).opacity)).toBe('0');
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision)).toEqual(selectedBefore);
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await page.screenshot({ path: testInfo.outputPath('desktop-hover-card.png') });
  await page.locator('g.territorial-label-item[data-label-id="BGR"]').hover();
  const bulgariaPosition = await page.locator('#selectionToolbar').boundingBox();
  await page.locator('g.territorial-label-item[data-label-id="RUS"]').hover();
  await expect(page.locator('#selectionCardName')).toHaveText('러시아');
  const russiaPosition = await page.locator('#selectionToolbar').boundingBox();
  expect(Math.hypot(russiaPosition.x - bulgariaPosition.x, russiaPosition.y - bulgariaPosition.y)).toBeGreaterThan(20);
  await label(page).hover();
  await label(page).click();
  await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
  await expect(page.locator('#propertyTitle')).toHaveText('독일');
  await expect(page.locator('#selectionToolbar')).toBeHidden();
  await expect.poll(() => label(page).locator('text').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
});

test('hover card keeps quick actions usable and applies them to the hovered country', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openMap(page);
  await label(page).hover();
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await page.locator('#objectLockBtn').hover();
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await page.locator('#objectLockBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.locked)).toBe(true);
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await page.locator('#objectLockBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.locked)).toBe(false);
  await page.locator('#countryColorTrigger').click();
  await expect(page.locator('#countryColorPopover')).toBeVisible();
  await page.locator('#countryColorPopover [data-color-value]').first().click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.style.color)).not.toBeUndefined();
  // The palette is outside the card; closing it can end that hover preview.
  await label(page).hover();
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await page.locator('#objectVisibilityBtn').click();
  await expect(label(page)).toHaveCount(0);
  await expect(page.locator('#objectVisibilityIcon')).toHaveAttribute('href', '#icon-eye-off');
  await page.locator('#objectVisibilityBtn').click();
  await expect(label(page)).toHaveCount(1);
  await expect(page.locator('#objectVisibilityIcon')).toHaveAttribute('href', '#icon-eye');
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await page.mouse.move(0, 0);
  await expect(page.locator('#selectionToolbar')).toBeHidden();
});

test('mobile tap enters the editor directly without displaying a selection card', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await openMap(page);
    await label(page).tap();
    await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
    await expect(page.locator('#propertyTitle')).toHaveText('독일');
    await expect(page.locator('#selectionToolbar')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('mobile-direct-editor.png') });
  } finally { await context.close(); }
});

test('compact label hover uses the card, and a layout change to mobile clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openMap(page);
  await label(page).hover();
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect(page.locator('#selectionToolbar')).toBeHidden();
});
