import { expect, test } from '@playwright/test';
import { shiftTimelineMonth } from '../../assets/js/modules/timeline-controls.js';

test('month navigation updates the visible cursor without creating Undo or dirty state', async ({ page }) => {
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  const before = await page.locator('#timelineMonthInput').inputValue();
  await expect(page.locator('.timeline-status')).toContainText('월말 기준');
  expect(before).toMatch(/^-?\d{4,}-\d{2}$/);
  const dirty = await page.locator('#projectSaveStatus').getAttribute('data-tooltip');
  const undo = await page.locator('#undoBtn').isDisabled();
  await page.locator('#timelinePreviousMonth').click();
  await expect(page.locator('#timelineMonthInput')).toHaveValue(shiftTimelineMonth(before, -1));
  expect(await page.locator('#projectSaveStatus').getAttribute('data-tooltip')).toBe(dirty);
  expect(await page.locator('#undoBtn').isDisabled()).toBe(undo);
});
