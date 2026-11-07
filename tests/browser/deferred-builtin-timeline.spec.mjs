import { expect, test } from '@playwright/test';

// These two unresolved scenarios are user-deferred and owned by the manual check group.
// Their original assertions and observation helpers are preserved below.
test.use({ trace: 'off', hasTouch: true, actionTimeout: 15000 });

async function observeBuiltinCamera(page) {
  await page.route('**/modules/viewer-composition.js*', async route => {
    const source = await (await route.fetch()).text();
    const debug = 'productMode,documentState:', reader = 'await owners.physicalResources.preparePhysicalContext(month,{isCurrent});';
    if (!source.includes(debug) || !source.includes(reader)) throw new Error('Viewer observation boundary is missing.');
    await route.fulfill({ contentType: 'text/javascript', body: source
      .replace(debug, 'cameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),cameraMoving:()=>map.viewState.mapMoving,' + debug)
      .replace(reader, 'if(window.__testBuiltinRead)await window.__testBuiltinRead(month);\n      ' + reader) });
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
    await page.locator('#timelineDateButton').click(); await page.locator('#timelineViewUnit').selectOption('year'); await page.locator('#timelineGoBtn').click(); await builtinMonthReady(page, '2026-10');
    for (const [id, month] of [['timelinePreviousYear', '2025-12'], ['timelinePreviousDecade', '2015-12'], ['timelineNextDecade', '2025-12'], ['timelineNextYear', '2026-10']]) {
      await page.locator('#' + id).click(); await builtinMonthReady(page, month);
      expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
      expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().projectSetup.initialMonth)).toBe('2026-10');
    }
    await page.locator('#timelineDateButton').click(); await page.locator('#timelineViewUnit').selectOption('month'); await page.locator('#timelineYearInput').fill('1953');
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
  await page.locator('#timelinePreviousYear').click();
  await expect(page.locator('#timelineDateError')).toHaveText('month source unavailable');
  await builtinMonthReady(page, '2026-10');
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__testBuiltinRead = month => month === '2025-12' ? new Promise(resolve => { window.__releaseMonthRead = resolve; }) : Promise.resolve(); });
  await page.locator('#timelinePreviousYear').click();
  await page.waitForFunction(() => typeof window.__releaseMonthRead === 'function');
  await page.locator('#timelinePreviousYear').click();
  await page.evaluate(() => window.__releaseMonthRead()); await builtinMonthReady(page, '2024-12');
  expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  expect(errors).toEqual([]);
});

