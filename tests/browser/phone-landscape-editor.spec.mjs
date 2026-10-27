import { test, expect } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

test('phone landscape switches one right panel, preserves camera and adapts to keyboard without changing mode', async ({ page }) => {
  await page.route('**/modules/app-domain-assembly.js*', async route => {
    const source = await (await route.fetch()).text();
    await route.fulfill({ contentType: 'text/javascript', body: source.replace('dependencies = ports;', 'dependencies = ports; window.__phoneEditing = () => editingDomain;') });
  });
  await page.goto('/__editor/index.html?debug=1&demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'phone-landscape');
  const view = () => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState());
  const before = await view();
  const rightInset = () => page.locator('.workspace').evaluate(node => getComputedStyle(node).getPropertyValue('--map-safe-right').trim());
  const dock = await page.locator('.mobile-workspace-controls').boundingBox();
  expect(dock.x + dock.width).toBe(844);
  await expect(page.locator('.mobile-workspace-controls #mobileMenuBtn')).toHaveCount(1);
  await expect(page.locator('#mobileMenuBtn strong')).toHaveText('메뉴');
  const menuLabel = await page.locator('#mobileMenuBtn strong').boundingBox();
  const menuIcon = await page.locator('#mobileMenuBtn svg').boundingBox();
  expect(menuLabel.y).toBeGreaterThanOrEqual(menuIcon.y + menuIcon.height);
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
  const menu = await page.locator('#mobileGlobalMenu').boundingBox();
  expect(menu.x + menu.width).toBeCloseTo(dock.x, 0);
  await page.locator('#mobileMenuFileBtn').click();
  await expect(page.locator('.top-actions')).toBeVisible();
  const fileMenu = await page.locator('.top-actions').boundingBox();
  expect(fileMenu.x + fileMenu.width).toBeCloseTo(dock.x, 0);
  await page.locator('#mobileFileBackBtn').click();
  await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileMenuBtn')).toBeFocused();
  await expect(page.locator('#mobileGlobalMenu')).toBeHidden();
  await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#editorSurface')).toBeVisible();
  const box = await page.locator('#editorSurface').boundingBox();
  expect(box.width).toBeLessThanOrEqual(320);
  expect(box.width).toBeLessThanOrEqual(844 * 0.45);
  const skin = await page.locator('#editorSurface').evaluate(node => {
    const style = getComputedStyle(node);
    return { position: style.position, leftBorder: style.borderLeftWidth,
      topBorder: style.borderTopWidth, radius: style.borderTopLeftRadius, shadow: style.boxShadow };
  });
  expect(skin.position).toBe('fixed');
  expect(skin.leftBorder).toBe('1px');
  expect(skin.topBorder).toBe('0px');
  expect(skin.radius).toBe('0px');
  expect(skin.shadow).not.toBe('none');
  await expect.poll(async () => {
    const bounds = await page.locator('#editorSurface').boundingBox();
    return Math.round(bounds.x + bounds.width);
  }).toBe(Math.round(dock.x));
  await page.locator('#mobileSearchBtn').click();
  await expect(page.locator('#editorSurface')).not.toBeVisible();
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  await page.locator('#objectSearchInput').fill('서울');
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 210 });
    window.visualViewport.dispatchEvent(new window.Event('resize'));
  });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'phone-landscape');
  await expect.poll(async () => (await page.locator('#objectSearchSurface').boundingBox()).height).toBeLessThanOrEqual(210);
  await expect.poll(async () => {
    const bounds = await page.locator('.adaptive-nav').boundingBox();
    return bounds.y + bounds.height;
  }).toBeLessThanOrEqual(210);
  await expect(page.locator('#objectSearchInput')).toHaveValue('서울');
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new window.Event('resize'));
  });
  await page.locator('#objectSearchCloseBtn').click();
  await expect.poll(rightInset).toBe(`${dock.width}px`);
  await expect.poll(view).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'phone-landscape');
  await page.locator('#mobileCreateBtn').click();
  await page.locator('#addRiverBtn').click();
  await expect.poll(() => page.evaluate(() => window.__phoneEditing().snapshot().draft.active)).toBe(true);
  await page.evaluate(() => window.__phoneEditing().replaceDraftCoordinates([[10, 48], [11, 49], [12, 48]], { selectedVertexIndex: 1, record: true }));
  const draft = () => page.evaluate(() => {
    const value = window.__phoneEditing().snapshot();
    return { activeTool: value.activeTool, draft: value.draft };
  });
  const started = await draft();
  expect(started.draft.coords).toHaveLength(3);
  expect(started.draft.historyCount).toBeGreaterThan(0);
  expect(started.draft.selectedVertexIndex).toBe(1);
  if (await page.locator('#mobileEditBtn').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#editorSurface')).toBeVisible();
  await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#editorSurface')).not.toBeVisible();
  await page.locator('#mobileSearchBtn').click();
  await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#editorSurface')).toBeVisible();
  expect(await draft()).toEqual(started);
  await page.locator('#mobileUndoBtn').click();
  await expect.poll(async () => (await draft()).draft.coords.length).toBe(0);
  await page.locator('#mobileRedoBtn').click();
  await expect.poll(async () => (await draft()).draft.coords).toEqual(started.draft.coords);
  await page.screenshot({ path: test.info().outputPath('phone-landscape-editor.png'), style: '#debugMapPanel { visibility: hidden; }' });
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'phone-landscape');
  await expect(page.locator('#mobileEditBtn')).toBeVisible();
  expect((await page.locator('#editorSurface').boundingBox()).width).toBeLessThanOrEqual(640 * 0.45 + 0.1);
  await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#editorSurface')).not.toBeVisible();
  await expect.poll(async () => (await draft()).draft.coords).toEqual(started.draft.coords);
});
