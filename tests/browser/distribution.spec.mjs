import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  return errors;
}

async function createDistribution(page, name) {
  await page.locator('#createMenuBtn').click();
  page.once('dialog', dialog => dialog.accept(name));
  await page.locator('#addDistributionBtn').click();
  await expect(page.locator('#distributionProperties')).toBeVisible();
}

async function autosavedDistributions(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve({
          layers: request.result?.distributionLayers || [],
          entries: request.result?.distributionEntries || [],
        });
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test('distribution controls stay inside the single view submenu on desktop and mobile', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);
  const group = page.locator('#distributionMenuGroup');
  const settings = page.locator('#distributionViewSettings');
  const style = page.locator('#layerStylePanel-distributions');
  await expect(group).toBeHidden();
  await expect(style).toBeHidden();
  await expect(settings.locator('#layerStylePanel-distributions')).toHaveCount(1);
  await page.locator('#mapDisplayBtn').click();
  await expect(group).toBeHidden();
  await expect(style).toBeHidden();
  await expect(page.locator('.view-menu-popups > #layerStylePanel-distributions')).toHaveCount(0);
  await page.locator('#mapDisplayBtn').click();

  await createDistribution(page, '보기 메뉴 검사');
  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  await expect(group).toBeVisible();
  await expect(page.locator('#distributionMenuTrigger')).toHaveCount(1);
  await expect(style).toBeHidden();
  await expect(page.locator('.view-menu-popups > #layerStylePanel-distributions')).toHaveCount(0);
  await page.locator('#distributionMenuTrigger').click();
  await expect(settings).toBeVisible();
  await expect(style).toBeVisible();
  await expect(style.locator('[data-layer-style-opacity="distributions"]')).toBeVisible();
  await expect(style.locator('[data-layer-style-blend-mode="distributions"]')).toBeVisible();
  await expect(page.locator('#distributionOverlapRadio')).toBeVisible();
  await page.locator('#distributionSingleRadio').locator('..').click({ timeout: 5_000 });
  await expect(page.locator('#distributionSingleRadio')).toBeChecked();
  await expect(page.locator('#distributionActiveLayerInput').locator('..')).toBeVisible();
  await expect(page.locator('#distributionLegend')).toBeVisible();
  await expect(page.locator('#distributionBoundaryVisibleInput')).toBeVisible();
  await page.locator('[data-map-display-row="countries"]').click();
  await expect(page.locator('#layerStylePanel-countries')).toBeVisible();
  await expect(style).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mapDisplaySurface')).not.toHaveClass(/view-menu-desktop/);
  await expect(settings.locator('#layerStylePanel-distributions')).toHaveCount(1);
  await expect(style).toBeVisible();
  expect(errors).toEqual([]);
});

test('single display follows distribution selection without another view menu change', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);

  for (const [name, countryName] of [['분포 A', '독일'], ['분포 B', '프랑스']]) {
    await createDistribution(page, name);
    await page.locator('#actionsTabBtn').click();
    const unitId = await page.locator('#distributionTerritorialUnitInput option')
      .evaluateAll((options, label) => options.find(option => option.textContent.trim() === `${label} · 국가`)?.value, countryName);
    expect(unitId).toBeTruthy();
    await page.locator('#distributionTerritorialUnitInput').selectOption(unitId, { force: true });
    await page.locator('#distributionValueInput').fill('10');
    await page.locator('#addTerritorialDistributionBtn').click();
    await expect(page.locator('#distributionEntryList .distribution-entry-row')).toHaveCount(1);
  }
  const ids = await page.evaluate(() => window.PANDOLAB_DISTRIBUTIONS.listLayers().map(layer => layer.id));
  expect(ids).toHaveLength(2);
  await page.locator('#mapDisplayBtn').click();
  await page.locator('#distributionMenuTrigger').click();
  await page.locator('#distributionSingleRadio').locator('..').click();
  await expect(page.locator('#distributionSingleRadio')).toBeChecked();
  await page.locator('#mapDisplayBtn').click();

  const renderedLayerIds = () => page.locator('#map path.distribution-shape')
    .evaluateAll(nodes => nodes.map(node => node.__data__.layer.id));
  for (const id of ids) {
    expect(await page.evaluate(layerId => window.PANDOLAB_DISTRIBUTIONS.select(layerId), id)).toBe(true);
    await expect.poll(renderedLayerIds).toEqual([id]);
  }
  expect(errors).toEqual([]);
});

test('a numeric distribution stores signed values and survives undo and redo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);

  await createDistribution(page, '인구 변화');
  await page.locator('#distributionUnitInput').fill('명');
  await page.locator('#distributionUnitInput').blur();
  await page.locator('#distributionColorTrigger').click();
  await page.locator('#distributionColorPopover [data-color-value="#3b82f6"]').click();
  await expect(page.locator('#distributionColorInput')).toHaveValue('#3b82f6');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_DISTRIBUTIONS.listLayers()[0]?.color)).toBe('#3b82f6');
  await page.locator('#actionsTabBtn').click();

  const territorialUnitId = await page.locator('#distributionTerritorialUnitInput option').nth(1).getAttribute('value');
  expect(territorialUnitId).toBeTruthy();
  await selectUiOption(page, '#distributionTerritorialUnitInput', territorialUnitId);
  await page.locator('#distributionValueInput').fill('-2.5');
  await page.locator('#addTerritorialDistributionBtn').click();

  await expect(page.locator('#distributionEntryList .distribution-entry-row')).toHaveCount(1);
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  const stored = await page.evaluate(() => {
    const layer = window.PANDOLAB_DISTRIBUTIONS.listLayers()[0];
    return { layer, entries: window.PANDOLAB_DISTRIBUTIONS.listEntries(layer.id) };
  });
  expect(stored.layer.name).toBe('인구 변화');
  expect(stored.layer.unit).toBe('명');
  expect(stored.entries).toHaveLength(1);
  expect(stored.entries[0]).toMatchObject({ mode: 'territorial', territorialUnitId, value: -2.5 });

  await page.locator('#undoBtn').click();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(0);
  await page.locator('#redoBtn').click();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('overlap and single display preserve independent values and free geometry on reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);

  await createDistribution(page, '밀도');
  await page.locator('#distributionNameInput').fill('인구 밀도');
  await page.locator('#distributionNameInput').blur();
  await page.locator('#actionsTabBtn').click();
  const firstUnit = await page.locator('#distributionTerritorialUnitInput option').nth(1).getAttribute('value');
  await selectUiOption(page, '#distributionTerritorialUnitInput', firstUnit);
  await page.locator('#distributionValueInput').fill('100');
  await page.locator('#addTerritorialDistributionBtn').click();

  await createDistribution(page, '기온');
  await page.locator('#distributionUnitInput').fill('°C');
  await page.locator('#distributionUnitInput').blur();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#distributionValueInput').fill('-4.25');
  await page.locator('#addGeometryDistributionBtn').click();
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.click(mapBox.x + mapBox.width * 0.47, mapBox.y + mapBox.height * 0.43);
  await page.mouse.click(mapBox.x + mapBox.width * 0.55, mapBox.y + mapBox.height * 0.48);
  await page.mouse.click(mapBox.x + mapBox.width * 0.49, mapBox.y + mapBox.height * 0.56);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#distributionEntryList .distribution-entry-row')).toHaveCount(1);

  await createDistribution(page, '삭제할 분포');
  await page.locator('#actionsTabBtn').click();
  await page.locator('#objectDeleteBtn').click();
  await page.locator('#confirmModalOkBtn').click();

  const current = await page.evaluate(() => ({
    layers: window.PANDOLAB_DISTRIBUTIONS.listLayers(),
  }));
  expect(current.layers.map(layer => layer.name)).toEqual(['인구 밀도', '기온']);
  await page.locator('#mapDisplayBtn').click();
  await page.locator('#distributionMenuTrigger').click();
  await page.locator('#distributionSingleRadio').check();
  await selectUiOption(page, '#distributionActiveLayerInput', current.layers[1].id);
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  await page.locator('#distributionOverlapRadio').check();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(2);

  await expect.poll(async () => {
    const saved = await autosavedDistributions(page);
    return {
      names: saved.layers.map(layer => layer.name).sort(),
      modes: saved.entries.map(entry => entry.mode).sort(),
    };
  }, { timeout: 10_000 }).toEqual({ names: ['기온', '인구 밀도'], modes: ['geometry', 'territorial'] });

  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const restored = await page.evaluate(() => {
    const temperature = window.PANDOLAB_DISTRIBUTIONS.listLayers().find(layer => layer.name === '기온');
    return {
      names: window.PANDOLAB_DISTRIBUTIONS.listLayers().map(layer => layer.name),
      unit: temperature?.unit,
      entries: temperature ? window.PANDOLAB_DISTRIBUTIONS.listEntries(temperature.id) : [],
    };
  });
  expect(restored.names).toContain('인구 밀도');
  expect(restored.names).toContain('기온');
  expect(restored.unit).toBe('°C');
  expect(restored.entries[0]).toMatchObject({ mode: 'geometry', territorialUnitId: '', value: -4.25 });
  expect(restored.entries[0].geometry?.type).toBe('Polygon');
  expect(errors).toEqual([]);
});
