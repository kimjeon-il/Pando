import { expect, test } from '@playwright/test';
import { shiftTimelineMonth, timelineMonthLabel } from '../../assets/js/modules/timeline-controls.js';

async function openApp(page) {
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
}

test('web month and year buttons navigate without changing the document', async ({ page }) => {
  await openApp(page);
  const input = page.locator('#timelineMonthInput');
  const button = page.locator('#timelineMonthButton');
  const before = await input.inputValue();
  expect(before).toMatch(/^[+-]?\d{4,6}-\d{2}$/);
  await expect(button).toContainText(timelineMonthLabel(before));
  await expect(input).toBeHidden();
  await expect(page.locator('.timeline-status')).not.toContainText('월말 기준');
  const documentBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
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
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(documentBefore);
});

test('desktop and narrow mobile use the same inline date editor and Enter/Done action', async ({ page }) => {
  await openApp(page);
  const button = page.locator('#timelineMonthButton');
  const input = page.locator('#timelineMonthInput');
  const initial = await input.inputValue();
  const documentBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
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
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(documentBefore);
  expect(initial).not.toBe('');
});

test('mobile timeline and map command toolbar occupy separate rows without covering date buttons', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  for (const width of [320, 360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'mobile');
    const positions = await page.evaluate(() => {
      const rect = selector => {
        const el = document.querySelector(selector);
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
      };
      const controls = {};
      for (const id of ['timelinePreviousYear', 'timelinePreviousMonth', 'timelineMonthButton',
        'timelineNextMonth', 'timelineNextYear', 'objectSearchBtn', 'resetViewBtn']) {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        controls[id] = { visible: r.width > 0 && r.height > 0,
          unobstructed: el.contains(target), top: r.top, bottom: r.bottom };
      }
      return { timeline: rect('.timeline-status'), toolbar: rect('.map-command-toolbar'), controls };
    });
    expect(positions.toolbar.bottom, `map toolbar vs timeline at ${width}px`)
      .toBeLessThanOrEqual(positions.timeline.top - 4);
    expect(positions.timeline.left, `timeline left at ${width}px`).toBeGreaterThanOrEqual(-1);
    expect(positions.timeline.right, `timeline right at ${width}px`).toBeLessThanOrEqual(width + 1);
    for (const [id, control] of Object.entries(positions.controls)) {
      expect(control.visible, `${id} visible at ${width}px`).toBe(true);
      expect(control.unobstructed, `${id} hit target at ${width}px`).toBe(true);
    }
    await page.locator('#timelineMonthButton').click();
    await expect(page.locator('#timelineMonthInput')).toBeVisible();
    await page.locator('#timelineMonthInput').press('Escape');
    await expect(page.locator('#timelineMonthButton')).toBeVisible();
  }
});
