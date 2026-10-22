import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

async function openActionsTab(page) {
  await page.mouse.move(0, 0);
  await page.locator('#actionsTabBtn').click();
}

test('mobile task remains open after its asynchronous property action starts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Expose the existing presentation owner to exercise the late-completion
  // order observed in WebView2, without changing the edit operation itself.
  await page.route('**/modules/workspace-surfaces.js*', async route => {
    const source = await (await route.fetch()).text();
    const anchor = 'function initializeWorkspaceSurfaces() {';
    expect(source).toContain(anchor);
    await route.fulfill({ contentType: 'text/javascript', body: source.replace(anchor,
      anchor + 'window.__testCompleteToolStart = completeToolStart;') });
  });
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await openActionsTab(page);
  await page.locator('#annexEntityBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입');
  // The start command may still be settling after the task first appears.
  await expect(page.locator('#modeCancelBtn')).toBeEnabled();
  await page.evaluate(() => window.__testCompleteToolStart(true));
  await expect(page.locator('#editorSurface')).toHaveClass(/mobile-open/);
  await expect(page.locator('#modeTaskMinimizeBtn')).toBeInViewport();
  await page.locator('#modeTaskMinimizeBtn').click();
  await expect(page.locator('#modeTaskMinimizeBtn')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#modeTaskMinimizeBtn').click();
  await expect(page.locator('#modeTaskMinimizeBtn')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'properties');
});

test('the current editor surface owns tasks at every responsive width', async ({ page }) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect.poll(async () => {
    const panel = await page.locator('#editorSurface').boundingBox();
    return Math.round(panel.x);
  }).toBe(0);
  const panel = await page.locator('#editorSurface').boundingBox();
  const map = await page.locator('#map').boundingBox();
  const topbar = await page.locator('.topbar').boundingBox();
  expect(Math.round(panel.y)).toBe(Math.round(topbar.y + topbar.height));
  // The wide editor overlays the map edge without resizing the map viewport,
  // so opening the editor must not shift the geographic projection.
  expect(Math.round(map.x + map.width)).toBe(1440);
  expect(Math.round(map.x + map.width)).toBeGreaterThan(Math.round(panel.x));
  await expect(page.locator('#mapDisplaySurface')).toBeHidden();
  const task = page.locator('#modeEditingContext');
  await expect(page.locator('#editorTaskSlot > #modeEditingContext')).toHaveCount(1);
  await expect(page.locator('#mapTopContextSlot #modeEditingContext')).toHaveCount(0);
  const originalTask = await task.elementHandle();
  await openActionsTab(page);
  await page.locator('#annexEntityBtn').click();
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입');
  await expect(page.locator('#editorScrollBody')).not.toBeVisible();
  await expect(page.locator('#modeTaskMinimizeBtn')).toBeVisible();
  await page.locator('#modeTaskMinimizeBtn').click();
  await expect(page.locator('#modeTaskMinimizeBtn')).toHaveAttribute('aria-expanded','false');
  await page.locator('#modeTaskMinimizeBtn').click();
  await expect(page.locator('#modeTaskMinimizeBtn')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'compact');
  const compactPosition = await page.evaluate(() => {
    const panel = document.querySelector('#editorSurface').getBoundingClientRect();
    const probe=document.createElement('div');probe.style.cssText='position:absolute;width:var(--ui-shell-compact-inset);height:0;padding:0;border:0';document.body.append(probe);const inset=probe.getBoundingClientRect().width;probe.remove();
    return { x: panel.x, inset };
  });
  expect(compactPosition.x).toBeCloseTo(compactPosition.inset, 0);
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'task');
  await expect(page.locator('#mapTopContextSlot #modeEditingContext')).toHaveCount(0);
  await expect(page.locator('#modeTaskMinimizeBtn')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입');
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'properties');
  await expect(page.locator('#editorTaskSlot > #modeEditingContext')).toHaveCount(1);
  expect(await task.evaluate((node, initial) => node === initial, originalTask)).toBe(true);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await openActionsTab(page);
  await page.locator('#mergeEntityBtn').click();
  await expect(page.locator('#editorTaskSlot #modeTaskName')).toHaveText('객체 합병');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect(page.locator('#editorSurface')).toHaveClass(/mobile-open/);
  await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'task');
  await expect(page.locator('#editorTaskSlot #modeEditingContext')).toBeVisible();
  await expect(page.locator('#mapTopContextSlot #modeEditingContext')).toHaveCount(0);
  await expect(page.locator('#modeTaskMinimizeBtn')).toBeVisible();
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#editorTaskSlot > #modeEditingContext')).toHaveCount(1);
  expect(await task.evaluate((node, initial) => node === initial, originalTask)).toBe(true);
  expect(errors).toEqual([]);
});

test('expanded role-card task keeps a single visible target and restores context on collapse', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await openActionsTab(page);
  await page.locator('#mergeEntityBtn').click();
  await expect(page.locator('#modeTaskObjects')).toBeVisible();
  await expect(page.locator('#modeTaskObjects')).toContainText('독일');
  await expect(page.locator('.mode-task-context-summary')).toBeHidden();
  await expect(page.locator('#modeTaskEditingStage')).toBeHidden();
  await expect(page.locator('#modeTaskStatus')).toBeHidden();
  await expect(page.locator('#modeMapSummary')).toBeHidden();
  await page.locator('#modeTaskMinimizeBtn').click();
  await expect(page.locator('.mode-task-context-summary')).toBeVisible();
  await expect(page.locator('#modeTaskTargetSummary')).toContainText('독일');
  await expect(page.locator('#modeTaskEditingStage')).toBeVisible();
  await expect(page.locator('#modeTaskWindowContent')).toBeHidden();
  await page.locator('#modeTaskMinimizeBtn').click();
  await expect(page.locator('.mode-task-context-summary')).toBeHidden();
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'properties');
  expect(errors).toEqual([]);
});

test('annex setup hides duplicate context but restores it after donor selection', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, '/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await openActionsTab(page);
  await page.locator('#annexEntityBtn').click();

  await expect(page.locator('#modeTaskStage')).toHaveText('가져올 국가');
  await expect(page.locator('#modeTaskStep')).toHaveText('1 / 3');
  await expect(page.locator('#modeTaskObjects [aria-label="넘겨받는 객체"]')).toContainText('독일');
  await expect(page.locator('#modeTaskObjects [aria-label="넘겨주는 객체"]')).toContainText('객체 선택');
  await expect(page.locator('.mode-edit-context')).toBeHidden();
  await expect(page.locator('#modeTaskDisabledReason')).toBeHidden();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.locator('#modeTaskObjects')).toBeVisible();
      await expect(page.locator('.mode-edit-context')).toBeHidden();
      const overflow = await page.locator('.mode-task-window-body').evaluate(node => node.scrollWidth > node.clientWidth);
      expect(overflow).toBe(false);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const map = await page.locator('#map').boundingBox();
  const point = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([19, 52]));
  await page.locator('#map .map-svg').dispatchEvent('click', {
    clientX: map.x + point[0], clientY: map.y + point[1], button: 0,
  });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('영토 선택');
  await expect(page.locator('.mode-edit-context')).toBeHidden();
  await expect(page.locator('#territorySelectionStack')).toBeHidden();
  await expect(page.locator('#modeTaskViewTime')).toContainText('보기:');
  expect(errors).toEqual([]);
});
