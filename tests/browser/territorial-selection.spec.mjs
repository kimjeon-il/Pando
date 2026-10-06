import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { selectUiOption } from './helpers/ui-select.mjs';

async function openApp(page, viewport = { width: 1440, height: 900 }) {
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#basemapLabelsVisible').evaluate(input => {
    if (!input.checked) return;
    input.checked = false;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  return errors;
}

async function importTerritorialPolygon(page, { name, target, coordinates }) {
  if (await page.locator('#mobileMenuBtn').isVisible()) {
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileMenuFileBtn').click();
  } else await page.locator('#mobileFileBtn').click();
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#openGisBtn').click()]);
  await picker.setFiles({
    name: `${name}.geojson`,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: `${target}-map-selection`,
        properties: { name },
        geometry: { type: 'Polygon', coordinates: [coordinates] },
      }],
    })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#gisStepIndicator')).toContainText('1/3');
  await selectUiOption(page, '#gisTargetType', target);
  if (target === 'general') await selectUiOption(page, '#gisParentUnit', 'DEU');
  for (const step of ['2/3', '3/3']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 60_000 });
  const shape = page.locator('path.territorial-unit-shape');
  await expect.poll(
    async () => shape.evaluateAll((nodes, expectedName) => nodes.some(node => node.__data__?.properties?.name === expectedName), name),
    { timeout: 60_000 },
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fileMenu')).toBeHidden();
}

async function territorialShapeCenter(page, name) {
  return page.locator('path.territorial-unit-shape').evaluateAll((nodes, expectedName) => {
    const shape = nodes.find(node => node.__data__?.properties?.name === expectedName);
    if (!shape) return null;
    const box = shape.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, name);
}

async function selectTerritorialObjectOnMap(page, point, name, { touch = false } = {}) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(page.locator('#objectChooser')).toBeVisible();
  expect(await page.locator('#objectChooserList [role="option"]').count()).toBeGreaterThan(1);
  const option = page.locator('#objectChooserList [role="option"]').filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await expect(option.locator(':scope > span')).toHaveText(name);
  await option.click();
  await expect(page.locator('#selectionStatus')).toContainText(name);
  await expect(page.locator('#objectChooser')).toBeHidden();
}

test('an overlapping child can be chosen explicitly and does not block map dragging', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '지도 선택 시험 권역';
  await importTerritorialPolygon(page, {
    name,
    target: 'general',
    coordinates: [[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]],
  });

  const beforeDrag = await territorialShapeCenter(page, name);
  expect(beforeDrag).not.toBeNull();
  await page.mouse.move(beforeDrag.x, beforeDrag.y);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 48, beforeDrag.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await territorialShapeCenter(page, name))?.x).toBeGreaterThan(beforeDrag.x + 20);

  const afterDrag = await territorialShapeCenter(page, name);
  await selectTerritorialObjectOnMap(page, afterDrag, name);
  await expect(page.locator('#selectionStatus')).toContainText(name);
  await expect(page.locator('#entityProperties')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an imported child above its visible parent is chosen explicitly', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '지도 선택 시험 행정구역';
  await importTerritorialPolygon(page, {
    name,
    target: 'general',
    coordinates: [[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]],
  });

  const point = await territorialShapeCenter(page, name);
  expect(point).not.toBeNull();
  await selectTerritorialObjectOnMap(page, point, name);
  await expect(page.locator('#selectionStatus')).toContainText(name);
  await expect(page.locator('#entityProperties')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a region import stays explicit, opens the region editor, and survives undo and redo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '명시 지방 시험';
  await importTerritorialPolygon(page, {
    name,
    target: 'regional',
    coordinates: [[12, 47], [12, 48], [13, 48], [13, 47], [12, 47]],
  });

  const snapshot = await page.evaluate(expectedName => {
    const feature = window.PANDOLAB_TERRITORIAL.list({ kind: 'regional' })
      .find(candidate => candidate.properties?.name === expectedName);
    if (feature) window.PANDOLAB_TERRITORIAL.select(feature.id);
    return feature ? {
      id: String(feature.id),
      entityKind: feature.properties.entityKind,
      coverageMode: feature.properties.coverageMode,
    } : null;
  }, name);
  expect(snapshot).toMatchObject({ entityKind: 'regional', coverageMode: 'explicit' });
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#selectionStatus')).toContainText(name);

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(expectedName => window.PANDOLAB_TERRITORIAL.list({ kind: 'regional' })
    .some(feature => feature.properties?.name === expectedName), name)).toBe(false);
  await page.locator('#redoBtn').click();
  await expect.poll(() => page.evaluate(expectedName => window.PANDOLAB_TERRITORIAL.list({ kind: 'regional' })
    .some(feature => feature.properties?.name === expectedName), name)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('mobile selection', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a mobile touch tap offers overlapping objects and selects the chosen child', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const viewport = { width: 390, height: 844 };
    const errors = await openApp(page, viewport);
    const name = '모바일 선택 시험 권역';
    await importTerritorialPolygon(page, {
      name,
      target: 'general',
      coordinates: [[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]],
    });
    if (await page.locator('#mobileEditBtn').getAttribute('aria-expanded') === 'true') {
      const camera = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
      await expect(page.locator('#mobileEditBtn')).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#mobileEditBtn').click();
      await expect(page.locator('#editorSurface')).toBeHidden();
      const after = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
      expect({ zoom: after.zoom, rotation: after.globeRotation, center: after.flatCenter })
        .toEqual({ zoom: camera.zoom, rotation: camera.globeRotation, center: camera.flatCenter });
    }
    await expect(page.locator('#mobileEditBtn')).toHaveAttribute('aria-expanded', 'false');

    const point = await territorialShapeCenter(page, name);
    expect(point).not.toBeNull();
    const inputProofPath = testInfo.outputPath('mobile-territorial-input.json');
    await writeFile(inputProofPath, JSON.stringify(await page.evaluate(({ point, name }) => {
      const node = [...document.querySelectorAll('path.territorial-unit-shape')]
        .find(node => node.__data__?.properties.name === name);
      return { point, shapeBounds: node.getBoundingClientRect().toJSON(), d: node.getAttribute('d'),
        target: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 400),
        selection: document.querySelector('#selectionStatus').textContent,
        view: window.__PANDOLAB_VIEW_DEBUG__.snapshot(), frame: window.__PANDOLAB_RENDER_DEBUG__.snapshot() };
    }, { point, name })));
    await testInfo.attach('mobile-territorial-input', { path: inputProofPath, contentType: 'application/json' });
    await selectTerritorialObjectOnMap(page, point, name, { touch: true });
    await expect(page.locator('#selectionStatus')).toContainText(name);
    await expect(page.locator('#objectChooser')).toBeHidden();
    await expect(page.locator('#selectionStatus')).toContainText(name);
    await expect(page.locator('#entityProperties')).not.toHaveClass(/hidden/);
    await expect(page.locator('#entityNameInput')).toHaveValue(name);
    const proofPath = testInfo.outputPath('mobile-territorial-selection.json');
    await writeFile(proofPath, JSON.stringify({ point, model: await page.evaluate(name =>
      window.PANDOLAB_TERRITORIAL.list().find(entity => entity.properties.name === name), name),
    selectionStatus: await page.locator('#selectionStatus').innerText(),
    frame: await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot()) }));
    await testInfo.attach('mobile-territorial-selection', { path: proofPath, contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
});
