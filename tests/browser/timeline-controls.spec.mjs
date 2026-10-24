import { expect, test } from '@playwright/test';
import { shiftTimelineMonth, timelineMonthLabel } from '../../assets/js/modules/timeline-controls.js';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

test.use({ trace: 'off', hasTouch: true, actionTimeout: 15000 });

async function observeBuiltinCamera(page) {
  await page.route('**/modules/viewer-composition.js*', async route => {
    const source = await (await route.fetch()).text();
    const debug = 'productMode,documentState:', reader = '()=>map.prepareBuiltinProject(month,{isCurrent})';
    if (!source.includes(debug) || !source.includes(reader)) throw new Error('Viewer observation boundary is missing.');
    await route.fulfill({ contentType: 'text/javascript', body: source
      .replace(debug, 'cameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),cameraMoving:()=>map.viewState.mapMoving,' + debug)
      .replace(reader, 'async()=>{if(window.__testBuiltinRead)await window.__testBuiltinRead(month);return map.prepareBuiltinProject(month,{isCurrent});}') });
  });
  await page.clock.setFixedTime(new Date(2026, 9, 24, 12));
  await page.goto('/?debug=1');
  await builtinMonthReady(page, '2026-10');
}
async function builtinMonthReady(page, month) {
  await expect.poll(() => page.evaluate(() => ({ month: window.__PANDOLAB_VIEWER__?.builtinMonth().month,
    cursor: window.__PANDOLAB_VIEWER__?.documentState().timelineCursor,
    ready: document.querySelector('#viewerStatus').dataset.ready })), { timeout: 90000 }).toEqual({ month, cursor: month, ready: 'true' });
}
async function moveCamera(page) {
  const box = await page.locator('#map').boundingBox();
  const before = await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot());
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .45); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
  await page.mouse.wheel(0, -250);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot().view.globeZoom)).toBeGreaterThan(before.view.globeZoom);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraMoving())).toBe(false);
  return page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot());
}

test('builtin date changes retain the camera across controls and automatic month rollover', async ({ page }) => {
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await observeBuiltinCamera(page);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 480 }]) {
    await page.setViewportSize(viewport);
    const camera = await moveCamera(page);
    for (const [id, month] of [['timelinePreviousMonth', '2026-09'], ['timelinePreviousYear', '2025-09'], ['timelineNextYear', '2026-09'], ['timelineNextMonth', '2026-10']]) {
      await page.locator('#' + id).click(); await builtinMonthReady(page, month);
      expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
      expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().projectSetup.initialMonth)).toBe(month);
    }
    await page.locator('#timelineMonthButton').click(); await page.locator('#timelineYearInput').fill('1953');
    await page.locator('#timelineMonthInput').selectOption('7'); await page.locator('#timelineYearInput').press('Enter');
    await builtinMonthReady(page, '1953-07');
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    if (await page.locator('#mobileFileBtn').isVisible()) await page.locator('#mobileFileBtn').click();
    else { await page.locator('#mobileMenuBtn').click(); await page.locator('#mobileMenuFileBtn').click(); }
    await page.locator('#builtinMapBtn').click(); await builtinMonthReady(page, '2026-10');
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  }
  const camera = await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot());
  await page.clock.setFixedTime(new Date(2026, 10, 1, 12));
  await page.evaluate(() => window.dispatchEvent(new window.Event('focus'))); await builtinMonthReady(page, '2026-11');
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  expect(errors).toEqual([]);
});

test('failed and superseded builtin month reads keep the camera and last accepted month', async ({ page }) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await observeBuiltinCamera(page); const camera = await moveCamera(page);
  await page.evaluate(() => { window.__testBuiltinRead = async () => { throw Error('month source unavailable'); }; });
  await page.locator('#timelinePreviousMonth').click();
  await expect(page.locator('#timelineMonthError')).toHaveText('month source unavailable');
  await builtinMonthReady(page, '2026-10');
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__testBuiltinRead = month => month === '2026-09' ? new Promise(resolve => { window.__releaseMonthRead = resolve; }) : Promise.resolve(); });
  await page.locator('#timelinePreviousMonth').click();
  await page.waitForFunction(() => typeof window.__releaseMonthRead === 'function');
  await page.locator('#timelinePreviousMonth').click();
  await page.evaluate(() => window.__releaseMonthRead()); await builtinMonthReady(page, '2026-08');
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  expect(errors).toEqual([]);
});

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
