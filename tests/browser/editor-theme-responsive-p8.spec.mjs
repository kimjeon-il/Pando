import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

const sizes = [
  { width: 1440, height: 900, layout: 'wide' },
  { width: 1024, height: 768, layout: 'compact' },
  { width: 768, height: 1024, layout: 'mobile' },
  { width: 390, height: 844, layout: 'mobile' },
  { width: 320, height: 700, layout: 'mobile' },
];

async function ensureEditor(page) {
  const panel = page.locator('#editorSurface');
  if (!await panel.isVisible()) {
    await expect(page.locator('#mobileEditBtn')).toBeVisible();
    await page.locator('#mobileEditBtn').click();
  }
  await expect(panel).toBeVisible();
}

async function setTheme(page, theme) {
  // The saved theme must remain effective even with the opposite OS preference.
  await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
  await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function readLayout(page, phase) {
  return page.evaluate(view => {
    const root = document.documentElement;
    const panel = document.querySelector('#editorSurface');
    const panelRect = panel.getBoundingClientRect();
    const body = document.querySelector(view === 'task' ? '.mode-task-window-body' : '#editorScrollBody');
    const selectors = view === 'info'
      ? ['#editorObjectHeader', '.editor-view-tabs', '#entityNameInput',
        '#entityColorTrigger', '#entityPeriodInput']
      : view === 'actions'
        ? ['#editorObjectHeader', '.editor-view-tabs', '#objectDeleteBtn',
          '#annexEntityBtn', '#mergeEntityBtn', '#copyEntityRegionBtn']
        : ['#modeTaskName', '#modeTaskObjects', '#modeTaskMinimizeBtn',
          '#modeActionBar', '#modeCancelBtn', '#modePrimaryBtn'];
    const outside = selectors.map(selector => [selector, document.querySelector(selector)])
      .filter(([, el]) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .filter(([, el]) => {
        const rect = el.getBoundingClientRect();
        return rect.left < panelRect.left - 2 || rect.right > panelRect.right + 2;
      }).map(([selector]) => selector);
    return {
      viewport: window.innerWidth,
      documentOverflow: Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      panelFits: panelRect.left >= -2 && panelRect.right <= window.innerWidth + 2,
      contentOverflow: body.scrollWidth - body.clientWidth,
      outside,
      textColor: getComputedStyle(document.querySelector(view === 'task' ? '#modeTaskName' : '#propertyTitle')).color,
    };
  }, phase);
}

function expectLayout(measure, title) {
  expect(measure.panelFits, title + ' panel bounds').toBe(true);
  expect(measure.documentOverflow, title + ' document overflow').toBeLessThanOrEqual(2);
  expect(measure.contentOverflow, title + ' editor content overflow').toBeLessThanOrEqual(2);
  expect(measure.outside, title + ' controls outside editor').toEqual([]);
}

async function attachScreen(page, info, title, testInfo) {
  if (![320, 768, 1440].includes(info.width)) return;
  await testInfo.attach(title + '-' + info.width + '.png', {
    body: await page.locator(title.startsWith('task') ? '#modeEditingHud' : '#editorSurface')
      .screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
}

test('P8-1 explicitly checks editor information, actions, and task at five widths in both themes', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, '/?renderer=canvas&demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect(page.locator('#entityProperties')).toBeVisible();

  for (const viewport of sizes) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator('#app')).toHaveAttribute('data-layout', viewport.layout);
    await ensureEditor(page);
    const colors = {};
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      await page.locator('#editorTabBtn').click();
      await expect(page.locator('#entityNameInput')).toBeVisible();
      const info = await readLayout(page, 'info');
      expectLayout(info, viewport.width + 'px ' + theme + ' information');
      await page.locator('#actionsTabBtn').click();
      await expect(page.locator('#objectDeleteBtn')).toBeVisible();
      expectLayout(await readLayout(page, 'actions'), viewport.width + 'px ' + theme + ' actions');
      colors[theme] = info.textColor;
      await attachScreen(page, viewport, 'editor-' + theme, testInfo);
    }
    expect(colors.light, viewport.width + 'px explicit theme must alter text palette').not.toBe(colors.dark);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await ensureEditor(page);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#mergeEntityBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('객체 합병');
  await expect(page.locator('#modeTaskObjects')).toBeVisible();

  for (const viewport of sizes) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator('#app')).toHaveAttribute('data-layout', viewport.layout);
    await ensureEditor(page);
    const colors = {};
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      await expect(page.locator('#modeTaskObjects')).toBeVisible();
      const task = await readLayout(page, 'task');
      expectLayout(task, viewport.width + 'px ' + theme + ' task');
      colors[theme] = task.textColor;
      await attachScreen(page, viewport, 'task-' + theme, testInfo);
    }
    expect(colors.light, viewport.width + 'px task theme must alter text palette').not.toBe(colors.dark);
  }
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'properties');
  expect(errors).toEqual([]);
});
