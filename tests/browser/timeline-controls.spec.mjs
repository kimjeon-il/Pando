import { expect, test } from '@playwright/test';
import { shiftTimelineMonth, timelineMonthLabel } from '../../assets/js/modules/timeline-controls.js';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

test.use({ trace: 'off', hasTouch: true, actionTimeout: 15000 });

test('floating date controls preserve navigation and document state across desktop and narrow mobile', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2, appearance: { statusBarVisible: false } })));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90000 });
  const fixture = await createViewerProjectPackage('날짜 도구 검증');
  await page.locator('#projectFileInput').setInputFiles({ name: 'date-controls.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset)).toBe(fixture.project.baseDataset);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#mapBottomStatus')).toHaveCount(0);
  await expect(page.locator('#viewerStatus')).toBeHidden();
  const button = page.locator('#timelineMonthButton'), year = page.locator('#timelineYearInput');
  const month = page.locator('#timelineMonthInput'), popup = page.locator('#timelinePopover');
  const before = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
  let current = '1914-06';
  await expect(button).toContainText(timelineMonthLabel(current));
  for (const [id, delta] of [['timelinePreviousMonth', -1], ['timelineNextMonth', 1], ['timelinePreviousYear', -12], ['timelineNextYear', 12]]) {
    await expect(page.locator(`#${id} svg use`)).toHaveCount(1);
    expect(await page.locator(`#${id}`).innerText()).not.toMatch(/[«‹›»]/);
    await page.locator(`#${id}`).click();
    current = shiftTimelineMonth(current, delta);
    await expect(button).toContainText(timelineMonthLabel(current));
  }
  await page.locator('#preferencesBtn').click();
  await expect(page.locator('#preferencesStatusBarVisibleInput')).toHaveCount(0);
  await page.locator('#preferencesCancelBtn').click();
  for (const [width, value, selectedMonth, label] of [[1440, '1914', '7', '1914년 7월'], [1024, '1914', '7', '1914년 7월'], [800, '1914', '7', '1914년 7월'], [390, '-1', '12', '기원전 1년 12월'], [320, '10000', '3', '10000년 3월']]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(button).toBeVisible();
    if (width < 800) await button.tap(); else await button.click();
    await expect(popup).toBeVisible();
    await expect(year).toBeFocused();
    await year.fill(value); await month.selectOption(selectedMonth);
    await year.press('Enter');
    await expect(popup).toBeHidden(); await expect(button).toBeFocused();
    await expect(button).toContainText(label);
    const layout = await page.evaluate(() => {
      const bounds = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const root = document.getElementById('timelineControls');
      const controls = [...root.querySelectorAll(':scope > button')].map(el => {
        const r = bounds(el), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return { ...r, hit: el.contains(hit) };
      });
      return { tool: bounds(root), search: bounds(document.querySelector('.map-command-toolbar')), controls };
    });
    expect(layout.tool.left).toBeGreaterThanOrEqual(0); expect(layout.tool.right).toBeLessThanOrEqual(width);
    for (const control of layout.controls) {
      const minimum = width < 800 ? 40 : 36;
      expect(control.width).toBeGreaterThanOrEqual(minimum); expect(control.height).toBeGreaterThanOrEqual(minimum); expect(control.hit).toBe(true);
    }
    if (width < 900) expect(layout.search.bottom).toBeLessThanOrEqual(layout.tool.top - 8);
    else expect(layout.search.right).toBeLessThanOrEqual(layout.tool.left);
    if (width === 1024) {
      await page.locator('#objectSearchBtn').click();
      await expect(page.getByLabel('지도에서 찾기', { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const tool = document.getElementById('timelineControls').getBoundingClientRect();
        const search = document.querySelector('.map-command-toolbar').getBoundingClientRect();
        return search.bottom <= tool.top - 8;
      })).toBe(true);
      await page.getByLabel('지도에서 찾기', { exact: true }).press('Escape');
    }
    await button.click();
    const popupBounds = await popup.boundingBox();
    expect(popupBounds.x).toBeGreaterThanOrEqual(0); expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`date-popover-${width}.png`) });
    const moveVisible = await page.locator('#timelineGoBtn').evaluate(el => {
      const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(moveVisible, `date popover action at ${width}px`).toBe(true);
    await year.fill('0'); await page.locator('#timelineGoBtn').click();
    await expect(page.locator('#timelineMonthError')).toBeVisible(); await expect(button).toContainText(label);
    await year.press('Escape'); await expect(popup).toBeHidden(); await expect(button).toBeFocused();
    await button.click(); await year.fill('1900');
    const map = await page.locator('#map').boundingBox();
    await page.locator('#map').click({ position: { x: map.width / 2, y: map.height / 3 } });
    await expect(popup).toBeHidden(); await expect(button).toContainText(label);
  }
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
  expect(errors).toEqual([]);
});
