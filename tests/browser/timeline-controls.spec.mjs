import { expect, test } from '@playwright/test';
import { shiftTimelineMonth, timelineMonthLabel } from '../../assets/js/modules/timeline-controls.js';

async function openApp(page) {
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
}

test('month and year buttons navigate without creating Undo or dirty state', async ({ page }) => {
  await openApp(page);
  const input = page.locator('#timelineMonthInput');
  const button = page.locator('#timelineMonthButton');
  const before = await input.inputValue();
  expect(before).toMatch(/^[+-]?\d{4,6}-\d{2}$/);
  await expect(button).toContainText(timelineMonthLabel(before));
  await expect(input).toBeHidden();
  await expect(page.locator('.timeline-status')).not.toContainText('월말 기준');
  const dirty = await page.locator('#projectSaveStatus').getAttribute('data-tooltip');
  const undo = await page.locator('#undoBtn').isDisabled();
  for (const [id, delta] of [
    ['#timelinePreviousMonth', -1],
    ['#timelineNextMonth', 1],
    ['#timelinePreviousYear', -12],
    ['#timelineNextYear', 12],
  ]) {
    const current = await input.inputValue();
    await page.locator(id).click();
    await expect(input).toHaveValue(shiftTimelineMonth(current, delta));
    await expect(button).toContainText(timelineMonthLabel(shiftTimelineMonth(current, delta)));
  }
  await expect(input).toHaveValue(before);
  expect(await page.locator('#projectSaveStatus').getAttribute('data-tooltip')).toBe(dirty);
  expect(await page.locator('#undoBtn').isDisabled()).toBe(undo);
});

test('desktop and narrow mobile use the same inline date editor and Enter/Done action', async ({ page }) => {
  await openApp(page);
  const button = page.locator('#timelineMonthButton');
  const input = page.locator('#timelineMonthInput');
  const initial = await input.inputValue();
  const dirty = await page.locator('#projectSaveStatus').getAttribute('data-tooltip');
  for (const [width, date] of [[1280, '1914-07'], [390, '1918-11'], [320, '1945-08']]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(button).toBeVisible();
    await button.click();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    expect(await input.getAttribute('enterkeyhint')).toBe('done');
    await input.fill(date);
    // Keyboard Return and a mobile virtual keyboard's Done share the Enter route.
    await input.press('Enter');
    await expect(input).toBeHidden();
    await expect(button).toBeVisible();
    await expect(button).toContainText(timelineMonthLabel(date));
    await expect(input).toHaveValue(date);
    const bounds = await page.locator('.timeline-status').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
  }
  await button.click();
  await input.fill('1915-13');
  await input.press('Enter');
  await expect(page.locator('#timelineMonthError')).toBeVisible();
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.press('Escape');
  await expect(button).toBeVisible();
  await expect(input).toHaveValue('1945-08');
  await page.setViewportSize({ width: 1280, height: 800 });
  await button.click();
  await input.fill('1916-06');
  await page.locator('#timelineNextMonth').click();
  await expect(button).toBeVisible();
  await expect(input).toHaveValue('1945-09');
  expect(await page.locator('#projectSaveStatus').getAttribute('data-tooltip')).toBe(dirty);
  expect(initial).not.toBe('');
});
