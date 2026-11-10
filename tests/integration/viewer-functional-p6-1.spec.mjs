import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const fixedTime = '2026-10-31T00:00:00+09:00';
const cleanHistory = {
  dirty: false, documentDirty: false, presentationDirty: false,
  canUndo: false, canRedo: false,
};

test.use({
  viewport: { width: 1280, height: 800 },
  locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light',
});

test('P6-1 desktop startup, camera, year navigation, direct input and themes', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date(fixedTime));
  const errors = [], consoleErrors = [], observations = [], screenshots = [];
  let preservedCamera, failure = null, checksCompleted = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const camera = () => page.evaluate(() => {
    const state = window.__PANDOLAB_MAP_HOST__.getViewState();
    return {
      projection: state.projection, globeRotation: state.globeRotation,
      globeZoom: state.globeZoom, flatCenter: state.flatCenter, flatZoom: state.flatZoom,
    };
  });
  const ready = (month, timeout = 45_000) => expect.poll(() => page.evaluate(() => ({
    month: window.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
    cursor: window.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
    ready: document.querySelector('#viewerStatus')?.dataset.ready,
  })), { timeout, message: `Presented and committed month ${month}` }).toEqual({
    month, cursor: month, ready: 'true',
  });
  const observe = async (step, month, year, basis) => {
    await ready(month);
    await expect(page.locator('#timelineDateButtonText')).toHaveText(`${year}년`);
    await expect(page.locator('#timelineDateBasis')).toHaveText(basis);
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'false');
    await expect(page.locator('#timelineDateError')).toHaveJSProperty('hidden', true);
    await expect(page.locator('#viewerCanvas')).toBeVisible();
    const state = await page.evaluate(() => {
      const viewer = window.__PANDOLAB_VIEWER__, documentState = viewer.documentState();
      const canvas = document.querySelector('#viewerCanvas');
      return {
        presented: viewer.initialMapPresented(), visible: viewer.visibleTerritorialCount(),
        history: Object.fromEntries(['dirty', 'documentDirty', 'presentationDirty', 'canUndo', 'canRedo']
          .map(key => [key, documentState[key]])),
        canvas: { width: canvas.width, height: canvas.height },
        theme: document.documentElement.dataset.theme,
        mapBackground: getComputedStyle(document.querySelector('#map')).backgroundColor,
      };
    });
    expect(state.presented).toBe(true);
    expect(state.visible).toBeGreaterThan(0);
    expect(state.canvas.width).toBeGreaterThan(0);
    expect(state.canvas.height).toBeGreaterThan(0);
    expect(state.history).toEqual(cleanHistory);
    const currentCamera = await camera();
    expect(currentCamera.projection).toBe('globe');
    if (preservedCamera) expect(currentCamera, `${step} preserves adjusted camera`).toEqual(preservedCamera);
    observations.push({ step, month, year, basis, ...state, camera: currentCamera });
  };
  const screenshot = async name => {
    const path = info.outputPath(name);
    await page.screenshot({ path, type: 'jpeg', quality: 70 });
    await info.attach(name, { path, contentType: 'image/jpeg' });
    screenshots.push(name);
  };

  try {
    await test.step('Initial desktop presentation', async () => {
      await page.goto('/?debug=1');
      await ready('2026-10', 75_000);
      await expect(page.locator('#viewer')).toHaveAttribute('data-layout', 'compact');
      await observe('initial', '2026-10', 2026, '현재 월 기준');
      await screenshot('initial.jpg');
    });

    await test.step('Real mouse pan and wheel zoom', async () => {
      const before = await camera(), map = page.locator('#map'), box = await map.boundingBox();
      expect(box).not.toBeNull();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 100, y, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await camera()).globeRotation).not.toEqual(before.globeRotation);
      await expect(map).not.toHaveClass(/dragging/);
      const panned = await camera();
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -200);
      await expect.poll(async () => (await camera()).globeZoom).toBeGreaterThan(panned.globeZoom);
      await expect(map).not.toHaveClass(/dragging/);
      preservedCamera = await camera();
      await observe('pan-and-zoom', '2026-10', 2026, '현재 월 기준');
    });

    await test.step('Previous year', async () => {
      await page.locator('#timelinePreviousYear').click();
      await observe('previous-year', '2025-12', 2025, '연말 기준');
    });
    await test.step('Next year returns to current month', async () => {
      await page.locator('#timelineNextYear').click();
      await observe('next-year', '2026-10', 2026, '현재 월 기준');
    });
    await test.step('Direct year input', async () => {
      await page.locator('#timelineDateButton').click();
      await expect(page.locator('#timelinePopover')).toBeVisible();
      await page.locator('#timelineViewUnit').selectOption('year');
      await page.locator('#timelineYearInput').fill('2024');
      await page.locator('#timelineGoBtn').click();
      await observe('direct-year', '2024-12', 2024, '연말 기준');
      await expect(page.locator('#timelinePopover')).toBeHidden();
    });

    for (const [theme, background] of [['dark', 'rgb(12, 17, 23)'], ['light', 'rgb(255, 255, 255)']]) {
      await test.step(`Apply ${theme} theme through preferences`, async () => {
        await page.locator('#preferencesBtn').click();
        await expect(page.locator('#preferencesModal')).toBeVisible();
        const swatch = page.locator(`#preferencesModal [data-preference-theme="${theme}"]`);
        await swatch.click();
        await expect(swatch).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#preferencesApplyBtn').click();
        await expect(page.locator('#preferencesModal')).toBeHidden();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('#map')).toHaveCSS('background-color', background);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences')).appearance.theme))
          .toBe(theme);
        await observe(`theme-${theme}`, '2024-12', 2024, '연말 기준');
        await screenshot(`${theme}.jpg`);
      });
    }
    expect(errors, 'No unhandled browser exceptions').toEqual([]);
    expect(consoleErrors, 'No browser console errors').toEqual([]);
    checksCompleted = true;
  } catch (error) {
    failure = String(error?.stack || error);
    throw error;
  } finally {
    const report = {
      scope: 'P6-1', checksCompleted, revision: process.env.GITHUB_SHA || null,
      browser: browser.version(), node: process.version,
      environment: { viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezone: 'Asia/Seoul', fixedTime },
      observations, screenshots, errors, consoleErrors, failure,
      boundaries: [
        'One desktop Chromium session; no mobile, other browser or native desktop package coverage.',
        'No forced failure, historical timeout rerun, performance benchmark or reload persistence check.',
        'Screenshots require visual review; checksCompleted is confirmed by the final Playwright/CI outcome.',
      ],
    };
    const path = info.outputPath('p6-1-functional.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('p6-1-functional', { path, contentType: 'application/json' });
    console.log('P6_1_SUMMARY ' + JSON.stringify(report));
  }
});
