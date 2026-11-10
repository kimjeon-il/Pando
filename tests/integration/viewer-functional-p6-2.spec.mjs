import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const fixedTime = '2026-10-31T00:00:00+09:00';
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light' });

test('P6-2 narrow layout, touch camera, year input and mobile preferences', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date(fixedTime));
  const observations = [], layouts = [], screenshots = [], errors = [], consoleErrors = [];
  let preservedCamera, failure = null, checksCompleted = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const camera = () => page.evaluate(() => {
    const state = window.__PANDOLAB_MAP_HOST__.getViewState();
    return { projection: state.projection, globeRotation: state.globeRotation,
      globeZoom: state.globeZoom, flatCenter: state.flatCenter, flatZoom: state.flatZoom };
  });
  const ready = (month, timeout = 45_000) => expect.poll(() => page.evaluate(() => ({
    month: window.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
    cursor: window.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
    ready: document.querySelector('#viewerStatus')?.dataset.ready,
  })), { timeout }).toEqual({ month, cursor: month, ready: 'true' });
  const observe = async (step, month, year, basis) => {
    await ready(month);
    await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'mobile');
    await expect(page.locator('#timelineDateButtonText')).toHaveText(`${year}년`);
    await expect(page.locator('#timelineDateBasis')).toHaveText(basis);
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'false');
    await expect(page.locator('#timelineDateError')).toHaveJSProperty('hidden', true);
    await expect(page.locator('#viewerCanvas')).toBeVisible();
    const state = await page.evaluate(() => {
      const viewer = window.__PANDOLAB_VIEWER__, documentState = viewer.documentState();
      const canvas = document.querySelector('#viewerCanvas');
      return { presented: viewer.initialMapPresented(), visible: viewer.visibleTerritorialCount(),
        history: Object.fromEntries(['dirty', 'documentDirty', 'presentationDirty', 'canUndo', 'canRedo']
          .map(key => [key, documentState[key]])),
        canvas: { width: canvas.width, height: canvas.height },
        theme: document.documentElement.dataset.theme, pageScale: visualViewport.scale };
    });
    expect(state.presented).toBe(true); expect(state.visible).toBeGreaterThan(0);
    expect(state.canvas.width).toBeGreaterThan(0); expect(state.canvas.height).toBeGreaterThan(0);
    expect(state.history).toEqual({ dirty: false, documentDirty: false, presentationDirty: false,
      canUndo: false, canRedo: false });
    const currentCamera = await camera();
    expect(currentCamera.projection).toBe('globe');
    if (preservedCamera) expect(currentCamera, `${step} preserves touch-adjusted camera`).toEqual(preservedCamera);
    observations.push({ step, month, year, basis, ...state, camera: currentCamera });
  };
  const bounds = async (selector, { hit = false, contents = false, minimum = 0 } = {}) => {
    const state = await page.locator(selector).evaluate(element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        hit: element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(state.width).toBeGreaterThan(0); expect(state.height).toBeGreaterThan(0);
    expect(state.left, selector).toBeGreaterThanOrEqual(-1);
    expect(state.top, selector).toBeGreaterThanOrEqual(-1);
    expect(state.right, selector).toBeLessThanOrEqual(state.viewportWidth + 1);
    expect(state.bottom, selector).toBeLessThanOrEqual(state.viewportHeight + 1);
    if (hit) expect(state.hit, `${selector} receives a center tap`).toBe(true);
    if (contents) expect(state.scrollWidth, `${selector} horizontal contents`).toBeLessThanOrEqual(state.clientWidth + 1);
    if (minimum) { expect(state.width).toBeGreaterThanOrEqual(minimum); expect(state.height).toBeGreaterThanOrEqual(minimum); }
    layouts.push({ selector, ...state });
    return state;
  };
  const screenshot = async name => {
    const path = info.outputPath(name);
    await page.screenshot({ path, type: 'jpeg', quality: 75 });
    await info.attach(name, { path, contentType: 'image/jpeg' }); screenshots.push(name);
  };

  try {
    await test.step('Narrow first presentation and unobstructed controls', async () => {
      await page.goto('/?debug=1'); await ready('2026-10', 75_000);
      await observe('initial', '2026-10', 2026, '현재 월 기준');
      await bounds('html', { contents: true });
      await bounds('#map'); await bounds('.viewer-map-tools');
      await bounds('#mobileMenuBtn', { hit: true });
      const toolbar = await bounds('.map-command-toolbar'), timeline = await bounds('#timelineControls');
      expect(toolbar.bottom).toBeLessThanOrEqual(timeline.top - 8);
      const controls = page.locator('#timelineControls > button'); await expect(controls).toHaveCount(5);
      for (const id of await controls.evaluateAll(elements => elements.map(element => element.id))) {
        await bounds('#' + id, { hit: true, minimum: 40 });
      }
    });

    await test.step('One-finger pan and two-finger pinch', async () => {
      const before = await camera(), pageScale = await page.evaluate(() => visualViewport.scale);
      const box = await page.locator('#map').boundingBox(); expect(box).not.toBeNull();
      const x = Math.round(box.x + box.width * .5), y = Math.round(box.y + box.height * .4);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
        await touch('touchStart', [{ x, y, id: 1 }]);
        for (const dx of [15, 30, 45, 60]) await touch('touchMove', [{ x: x + dx, y, id: 1 }]);
        await touch('touchEnd', []);
        await expect.poll(async () => (await camera()).globeRotation).not.toEqual(before.globeRotation);
        await expect(page.locator('#map')).not.toHaveClass(/dragging/);
        const panned = await camera();
        await touch('touchStart', [{ x: x - 24, y, id: 1 }, { x: x + 24, y, id: 2 }]);
        for (const half of [28, 32, 36]) await touch('touchMove', [{ x: x - half, y, id: 1 }, { x: x + half, y, id: 2 }]);
        await touch('touchEnd', []);
        await expect.poll(async () => (await camera()).globeZoom).toBeGreaterThan(panned.globeZoom);
        await expect(page.locator('#map')).not.toHaveClass(/dragging/);
        expect(await page.evaluate(() => visualViewport.scale), 'Pinch zooms the map, not the document').toBe(pageScale);
      } finally { await cdp.detach(); }
      preservedCamera = await camera();
      await observe('touch-pan-pinch', '2026-10', 2026, '현재 월 기준');
    });

    await test.step('Narrow year input and tap submission', async () => {
      await page.locator('#timelineDateButton').tap();
      await expect(page.locator('#timelinePopover')).toBeVisible();
      await expect(page.locator('#timelineViewUnit')).toHaveValue('year');
      await bounds('#timelinePopover', { contents: true });
      await bounds('#timelineYearInput', { hit: true }); await bounds('#timelineGoBtn', { hit: true });
      await page.locator('#timelineYearInput').fill('2024');
      await screenshot('year-input.jpg');
      await page.locator('#timelineGoBtn').tap();
      await observe('direct-year', '2024-12', 2024, '연말 기준');
      await expect(page.locator('#timelinePopover')).toBeHidden();
    });

    await test.step('Mobile menu and persisted theme', async () => {
      await page.locator('#mobileMenuBtn').tap();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
      await bounds('#mobileGlobalMenu', { contents: true }); await bounds('#mobilePreferencesBtn', { hit: true });
      await page.locator('#mobilePreferencesBtn').tap();
      await expect(page.locator('#mobileGlobalMenu')).toBeHidden();
      await expect(page.locator('#preferencesModal')).toBeVisible();
      await bounds('.preferences-card', { contents: true }); await bounds('.preferences-fields', { contents: true });
      const swatch = '#preferencesModal [data-preference-theme="dark"]';
      await bounds(swatch, { hit: true }); await bounds('#preferencesApplyBtn', { hit: true });
      await page.locator(swatch).tap();
      await expect(page.locator(swatch)).toHaveAttribute('aria-pressed', 'true');
      await screenshot('preferences.jpg');
      await page.locator('#preferencesApplyBtn').tap();
      await expect(page.locator('#preferencesModal')).toBeHidden();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('#map')).toHaveCSS('background-color', 'rgb(12, 17, 23)');
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences')).appearance.theme)).toBe('dark');
      await observe('mobile-preferences', '2024-12', 2024, '연말 기준');
      await screenshot('narrow-dark.jpg');
    });
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]); checksCompleted = true;
  } catch (error) { failure = String(error?.stack || error); throw error; }
  finally {
    const report = { scope: 'P6-2', checksCompleted, revision: process.env.GITHUB_SHA || null,
      browser: browser.version(), node: process.version,
      environment: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
        locale: 'ko-KR', timezone: 'Asia/Seoul', fixedTime },
      observations, layouts, screenshots, errors, consoleErrors, failure,
      boundaries: ['Chromium touch emulation; not physical-device, Safari, WebView, software-keyboard or IME certification.',
        'No deferred timeout rerun, performance benchmark, or repeated desktop scenario.'] };
    const path = info.outputPath('p6-2-functional.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('p6-2-functional', { path, contentType: 'application/json' });
    console.log('P6_2_SUMMARY ' + JSON.stringify(report));
  }
});
