import { expect, test } from '@playwright/test';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createStaticTerritorialSnapshot } from '../../assets/js/modules/territorial-entity-store.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';

async function openMap(page) {
  page.setDefaultTimeout(12_000);
  await page.addInitScript(() => document.addEventListener('pointermove', event => {
    window.__countryHoverPointer = { x: event.clientX, y: event.clientY, pointerType: event.pointerType,
      target: event.target.closest('svg')?.getAttribute('class') || event.target.tagName,
      label: event.target.closest('[data-label-id]')?.dataset.labelId || null };
  }, true));
  await page.goto('/?debug=1&renderer=canvas&demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}
const label = page => page.locator('g.territorial-label-item[data-label-id="DEU"]');
const view = page => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState());
const revision = page => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision);
async function assertTooltip(page, name) {
  const tooltip = page.locator('#uiTooltip[data-kind="country"]');
  try { await expect(tooltip).toBeVisible(); }
  catch (error) {
    await test.info().attach('hover-integration-diagnostics', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => ({
      pointer: window.__countryHoverPointer,
      media: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
      svgRoots: [...document.querySelectorAll('#map > svg')].map(node => node.getAttribute('class')),
      tooltip: document.querySelector('#uiTooltip').outerHTML,
      selectionInput: window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput,
    })), null, 2) });
    throw error;
  }
  await expect(tooltip.locator('span')).toHaveText(name);
  await expect(tooltip.locator('img')).toHaveCount(1);
  expect(await tooltip.evaluate(node => ({ pointerEvents: getComputedStyle(node).pointerEvents,
    whitespace: getComputedStyle(node).whiteSpace, controls: node.querySelectorAll('button,input,a').length })))
    .toEqual({ pointerEvents: 'none', whitespace: 'nowrap', controls: 0 });
  const box = await tooltip.boundingBox(), size = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(7); expect(box.y).toBeGreaterThanOrEqual(7);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width - 7);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height - 7);
}

for (const width of [1366, 1024]) test(`country hover only identifies; one label click opens the editor at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 }); await openMap(page);
  const before = { view: await view(page), revision: await revision(page), country: await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU')) };
  await expect(page.locator('#selectionToolbar')).toHaveCount(0);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  await label(page).hover(); await assertTooltip(page, '독일');
  expect(await label(page).locator('text').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  expect(await revision(page)).toBe(before.revision); expect(await view(page)).toEqual(before.view);
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath(`country-hover-${width}.png`) });
  await page.keyboard.press('Escape'); await expect(page.locator('#uiTooltip')).toBeHidden();
  const hoverBox = await label(page).boundingBox();
  await page.mouse.move(hoverBox.x + hoverBox.width / 2 + 1, hoverBox.y + hoverBox.height / 2);
  await assertTooltip(page, '독일');
  await label(page).click();
  await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
  await expect(page.locator('#propertyTitle')).toHaveText('독일');
  const clickedBox = await label(page).boundingBox();
  await page.mouse.move(clickedBox.x + clickedBox.width / 2 + 2, clickedBox.y + clickedBox.height / 2);
  await assertTooltip(page, '독일');
  expect(await view(page)).toEqual(before.view);
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU'))).toEqual(before.country);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  await expect(page.locator('#editorObjectHeader #objectVisibilityBtn, #editorObjectHeader #objectLockBtn, #editorObjectHeader #focusSelectedObjectBtn')).toHaveCount(3);
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath(`editor-header-${width}.png`) });
  expect(errors).toEqual([]);
});

test('area hover, long names, header commands and color use the current editor target', async ({ page }, testInfo) => {
  test.setTimeout(150_000); await page.setViewportSize({ width: 1366, height: 900 }); await openMap(page);
  const box = await page.locator('#map').boundingBox();
  const point = await page.evaluate(() => {
    const map = document.querySelector('#map').getBoundingClientRect();
    for (const coordinate of [[10, 49], [10, 50], [9, 51], [12, 51], [12, 52]]) {
      const projected = window.__PANDOLAB_MAP_HOST__.project(coordinate);
      const target = document.elementFromPoint(map.x + projected[0], map.y + projected[1]);
      if (target?.closest('#map') && !target.closest('.territorial-label-item')) return projected;
    }
    throw new Error('No unobscured German territory sample was found for the area-hover regression.');
  });
  const before = await view(page), initialRevision = await revision(page);
  await page.mouse.move(box.x + point[0], box.y + point[1]); await assertTooltip(page, '독일');
  expect(await page.evaluate(() => window.__countryHoverPointer.label)).toBeNull();
  await page.screenshot({ path: testInfo.outputPath('country-area-hover.png') });
  expect(await revision(page)).toBe(initialRevision);
  await page.mouse.click(box.x + point[0], box.y + point[1]);
  await expect(page.locator('#entityNameInput')).toHaveValue('독일');
  await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/); expect(await view(page)).toEqual(before);
  const selected = await revision(page);
  await page.locator('#objectLockBtn').click();
  await expect(page.locator('#objectLockBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#entityColorTrigger')).toBeDisabled();
  await page.locator('#objectLockBtn').click();
  await expect(page.locator('#entityColorTrigger')).toBeEnabled();
  await page.locator('#objectVisibilityBtn').click(); await expect(label(page)).toHaveCount(0);
  await expect(page.locator('#objectVisibilityBtn')).toHaveAttribute('aria-label', '객체 표시');
  await page.locator('#objectVisibilityBtn').click(); await expect(label(page)).toHaveCount(1);
  expect(await revision(page)).toBe(selected);
  const name = '아주 긴 국가 이름 '.repeat(14).trim();
  await page.locator('#entityNameInput').fill(name); await page.locator('#entityNameInput').press('Tab');
  await page.mouse.move(box.x + point[0], box.y + point[1]); await assertTooltip(page, name);
  await page.screenshot({ path: testInfo.outputPath('long-name-hover.png') });
  await page.locator('#entityColorTrigger').click();
  await page.locator('#entityColorPopover [data-color-value]').first().click();
  const color = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.style.color);
  expect(color).toBeTruthy();
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.style.color)).toBeUndefined();
  await page.locator('#redoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.style.color)).toBe(color);
});

test('390px mobile country tap opens the editor directly without hover controls', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await openMap(page); const before = await view(page);
    await label(page).tap();
    await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
    await expect(page.locator('#propertyTitle')).toHaveText('독일');
    await expect(page.locator('#uiTooltip')).toBeHidden();
    await expect(page.locator('#selectionToolbar')).toHaveCount(0);
    expect((await view(page)).geographicCenter).toEqual(before.geographicCenter);
    await expect(page.locator('#flagMenuBtn')).toBeVisible();
    await expect(page.locator('#objectLockBtn')).toBeVisible();
    expect(await page.locator('#editorObjectHeader').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mobile-tap-editor.png') });
  } finally { await context.close(); }
});

for (const width of [1366, 390]) test(`pinned country label over another territory selects the named country at ${width}px`, async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
  const page = await context.newPage();
  try {
    const saved = staticAutosaveProject();
    const square = (x, y, size) => ({ type: 'Polygon', coordinates: [[[x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]]] });
    Object.assign(saved, createStaticTerritorialSnapshot([
      createTerritorialFeature({ id: 'DEU', entityKind: 'general', name: 'A 국가의 긴 이름', geometry: square(10, 0, 15) }),
      createTerritorialFeature({ id: 'FRA', entityKind: 'general', name: 'B 국가', geometry: square(-10, 0, 15) }),
    ]));
    saved.labelSettings = { 'territorial:DEU': { pinned: true, manualPosition: [0, 8] }, 'territorial:FRA': { pinned: true, manualPosition: [-8, 1] } };
    assertCurrentProjectSchema(saved);
    await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), saved);
    await openMap(page);
    const namedLabel = label(page); await expect(namedLabel).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.querySelector('.territorial-label-layer').dataset.viewRevision === String(window.__PANDOLAB_VIEW_STATE__.revision))).toBe(true);
    const mapBox = await page.locator('#map').boundingBox(), labelBox = await namedLabel.boundingBox();
    const pinned = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.project([0, 8]));
    expect(Math.abs(labelBox.x + labelBox.width / 2 - mapBox.x - pinned[0])).toBeLessThan(12);
    expect(Math.abs(labelBox.y + labelBox.height / 2 - mapBox.y - pinned[1])).toBeLessThan(12);
    const before = await view(page);
    if (width === 390) await namedLabel.tap();
    else {
      await namedLabel.hover(); await expect(page.locator('#uiTooltip span')).toHaveText('A 국가의 긴 이름');
      await namedLabel.click();
    }
    await expect(page.locator('#objectChooser')).toBeHidden();
    await expect(page.locator('#entityNameInput')).toHaveValue('A 국가의 긴 이름');
    await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
    expect((await view(page)).geographicCenter).toEqual(before.geographicCenter);
    await page.screenshot({ path: testInfo.outputPath(`pinned-label-identity-${width}.png`) });
  } finally { await context.close(); }
});
