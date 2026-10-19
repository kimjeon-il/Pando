import { test, expect } from '@playwright/test';
import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';

test.use({ hasTouch: true });

test('editor status bar omits date navigation while editing context remains usable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  const original = await page.evaluate(() => ({
    month: window.__testEditorTimeline.month(),
    selected: window.__testEditorTimeline.state().selected,
  }));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 640, height: 360 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.timeline-status, #timelinePreviousYear, #timelinePreviousMonth, #timelineMonthButton, #timelineMonthInput, #timelineNextMonth, #timelineNextYear')).toHaveCount(0);
    await expect(page.locator('#projectSaveStatus')).toBeVisible();
    await expect(page.locator('#timelineComparePin, #timelineComparisonPanel')).toHaveCount(0);
    expect(await page.evaluate(() => ({ month: window.__testEditorTimeline.month(), selected: window.__testEditorTimeline.state().selected }))).toEqual(original);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await setEditorMonth(page, '1914-06');
  await expect(page.locator('#editorTimelineContext')).toHaveText('1914년 6월 기준 편집');
  expect(errors).toEqual([]);
});
