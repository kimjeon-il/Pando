import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import '../../assets/js/gis-adapters.js';

const eastPrussiaFixture = process.env.PANDOLAB_EAST_PRUSSIA_FILE || 'tests/fixtures/east-prussia-1900-import.geojson';
const eastPrussiaGeometry = JSON.parse(readFileSync(eastPrussiaFixture, 'utf8')).features[0].geometry;
const planarArea = geometry => (geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || []).reduce((total, polygon) => {
  const ringArea = ring => Math.abs((ring || []).reduce((sum, coordinate, index, source) => {
    if (!index) return sum;
    const previous = source[index - 1];
    return sum + previous[0] * coordinate[1] - coordinate[0] * previous[1];
  }, 0)) / 2;
  return total + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0));
}, 0);
const eastPrussiaExpected = {
  components: eastPrussiaGeometry.type === 'MultiPolygon' ? eastPrussiaGeometry.coordinates.length : 1,
  area: planarArea(eastPrussiaGeometry),
};

test('GeoPackage export contains QGIS-ready territorial and distribution tables', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demTerrain=raster');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });

  // The production GeoPackage writer omits empty spatial layers. Add an
  // actual regional object so the regional-table guarantee is exercised.
  const regionalSource = createTerritorialFeature({ id: 'qgis-regional-source', entityKind: 'regional',
    name: 'QGIS 독립 권역', geometry: { type: 'MultiPolygon', coordinates: [[[[5, 35], [5, 36], [6, 36], [6, 35], [5, 35]]]] } });
  const regionalRow = globalThis.PandoLabGisAdapters.territorialRows({ territorialEntities: [regionalSource] }).regions[0];
  await page.locator('#mobileFileBtn').click();
  const [regionalPicker] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#openGisBtn').click()]);
  await regionalPicker.setFiles({ name: 'regions.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: regionalSource.id,
      properties: Object.fromEntries(Object.entries(regionalRow).filter(([key]) => key !== 'geometry')), geometry: regionalRow.geometry }] })) });
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await selectUiOption(page, '#gisTargetType', 'regional');
  for (const step of ['2/3', '3/3']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step);
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 90_000 });
  const regional = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'regional' })
    .find(entity => entity.properties.name === 'QGIS 독립 권역'));
  expect(regional.properties).toMatchObject({ entityKind: 'regional', parentId: '', coverageMode: 'explicit' });
  const regionalCoverageDifference = await page.evaluate(({ source, imported }) => {
    const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return window.polygonClipping.xor(polygons(source), polygons(imported));
  }, { source: regionalSource.geometry, imported: regional.geometry });
  expect(regionalCoverageDifference).toEqual([]);
  expect(planarArea(regional.geometry)).toBe(1);
  const regionalCorners = regional.geometry.coordinates.flat(regional.geometry.type === 'Polygon' ? 1 : 2);
  expect([...new Set(regionalCorners.map(point => JSON.stringify(point)))].sort()).toEqual(['[5,35]', '[5,36]', '[6,35]', '[6,36]']);

  if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '폴란드' }).first().click();
  const assetRevision = await page.evaluate(() => window.PANDOLAB_BUILD_META.assetRevision);
  await expect.poll(() => page.locator('#flagPreview img').evaluate(img => {
    const url = new URL(img.src);
    return { pathname: url.pathname, revision: url.searchParams.get('v') };
  })).toEqual({ pathname: '/assets/vendor/country-flags/c09927e63705529bbf59ca6684cd9b23225dddad/svg/pl.svg', revision: assetRevision });
  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  await expect(page.locator('#flagPreview img')).toHaveCount(0);
  await expect(page.locator('#flagPreview svg')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('POL').properties.metadata.flagDataUrl)).toBeNull();

  if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('독일');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '독일' }).first().click();
  await page.locator('#flagMenuBtn').click();
  const [germanFlagChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#flagUploadBtn').click()]);
  await germanFlagChooser.setFiles({
    name: 'custom-german-flag.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><path fill="#111" d="M0 0h60v40H0z"/></svg>'),
  });
  await expect(page.locator('#flagPreview img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);

  await page.locator('#createMenuBtn').click();
  page.once('dialog', dialog => dialog.accept('스모크 값'));
  await page.locator('#addDistributionBtn').click();
  await page.locator('#actionsTabBtn').click();
  const territorialUnitId = 'DEU';
  await selectUiOption(page, '#distributionTerritorialUnitInput', territorialUnitId);
  await page.locator('#distributionValueInput').fill('73');
  await page.locator('#addTerritorialDistributionBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_DISTRIBUTIONS.listLayers()
    .flatMap(layer => window.PANDOLAB_DISTRIBUTIONS.listEntries(layer.id))))
    .toContainEqual(expect.objectContaining({ mode: 'territorial', territorialUnitId, value: 73 }));

  await page.locator('#mobileFileBtn').click();
  await expect(page.locator('#saveProjectBtn')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.locator('#saveProjectBtn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('판도연구소-프로젝트.gpkg');
  const filePath = await download.path();
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of [
      'entities', 'regions',
      'distributions',
    ]) expect(tables.has(table)).toBe(true);

    const entityColumns = new Set(db.prepare('PRAGMA table_info(entities)').all().map(row => row.name));
    for (const field of ['id', 'name', 'entity_kind', 'parent_id', 'properties_json']) {
      expect(entityColumns.has(field)).toBe(true);
    }
    for (const field of ['pandolab_id', 'pandolab_name', 'type', 'sovereign_id']) {
      expect(entityColumns.has(field)).toBe(false);
    }
    expect(db.prepare('SELECT id, name, entity_kind, parent_id, typeof(geom) AS geometry_type FROM regions').all())
      .toContainEqual({ id: regional.id, name: 'QGIS 독립 권역', entity_kind: 'regional', parent_id: '', geometry_type: 'blob' });
    const distributionColumns = new Set(db.prepare('PRAGMA table_info(distributions)').all().map(row => row.name));
    for (const field of ['entry_id', 'layer_id', 'unit', 'value_scale_mode', 'value', 'source_mode', 'territorial_unit_id', 'certainty']) {
      expect(distributionColumns.has(field)).toBe(true);
    }
    const row = db.prepare('SELECT source_mode, territorial_unit_id, value, typeof(geom) AS geometry_type FROM distributions').get();
    expect(row).toMatchObject({ source_mode: 'territorial', territorial_unit_id: territorialUnitId, value: 73, geometry_type: 'blob' });
    const crs = db.prepare("SELECT srs_id FROM gpkg_geometry_columns WHERE table_name='distributions'").get();
    expect(crs.srs_id).toBe(4326);
    const savedState = JSON.parse(db.prepare("SELECT json_value FROM pandolab_project_settings WHERE setting_key='project_state'").get().json_value);
    expect(savedState.territorialEntities.find(entity => entity.id === 'POL').properties.metadata.flagDataUrl).toBeNull();
    expect(savedState.territorialEntities.find(entity => entity.id === 'DEU').properties.metadata.flagDataUrl).toMatch(/^data:image/);
    const flagAssets = db.prepare('SELECT country_id, mime_type, length(image_data) AS byte_length FROM pandolab_country_assets').all();
    expect(flagAssets).toHaveLength(1);
    expect(flagAssets[0]).toMatchObject({ country_id: 'DEU', mime_type: 'image/svg+xml' });
    expect(flagAssets[0].byte_length).toBeGreaterThan(0);
  } finally {
    db.close();
  }

  if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('독일');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '독일' }).first().click();
  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '폴란드' }).first().click();
  await page.locator('#flagMenuBtn').click();
  const [polishFlagChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#flagUploadBtn').click()]);
  await polishFlagChooser.setFiles({
    name: 'temporary-polish-flag.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><path fill="#00f" d="M0 0h60v40H0z"/></svg>'),
  });
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('POL').properties.metadata.flagDataUrl)).toMatch(/^data:image\/svg\+xml;base64,/);

  await page.locator('#mobileFileBtn').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openProjectBtn').click();
  await (await chooserPromise).setFiles({
    name: 'flag-roundtrip.gpkg',
    mimeType: 'application/geopackage+sqlite3',
    buffer: readFileSync(filePath),
  });
  await expect(page.locator('#gisImportTitle')).toHaveText('프로젝트 불러오기', { timeout: 90_000 });
  await expect(page.locator('#gisStepIndicator')).toHaveText('1/1 · 프로젝트 복원 확인', { timeout: 90_000 });
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await expect(page.locator('#gisImportError')).toBeEmpty();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled();
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#actionStatus')).not.toHaveClass(/\bworking\b/, { timeout: 120_000 });
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), regional.id)).toEqual(regional);
  expect(await page.evaluate(() => window.PANDOLAB_DISTRIBUTIONS.listLayers()
    .flatMap(layer => window.PANDOLAB_DISTRIBUTIONS.listEntries(layer.id))))
    .toContainEqual(expect.objectContaining({ mode: 'territorial', territorialUnitId, value: 73 }));

  if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '폴란드' }).first().click();
  await expect(page.locator('#flagPreview img')).toHaveCount(0);
  await expect(page.locator('#flagPreview svg')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('POL').properties.metadata.flagDataUrl)).toBeNull();
  if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('독일');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '독일' }).first().click();
  await expect(page.locator('#flagPreview img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  expect(errors).toEqual([]);
});

test('GIS data export writes only selected layers and omits project-only metadata', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await page.locator('#mobileFileBtn').click();
  await page.locator('#dataExportBtn').click();
  await expect(page.locator('#gisExportModal')).toBeVisible();
  await page.locator('#gisExportForm .gis-export-layers input').evaluateAll(inputs => {
    for (const input of inputs) input.checked = input.value === 'countries';
  });
  await page.locator('.gis-export-layers').dispatchEvent('change');
  await expect(page.locator('.gis-export-layers input[value="countries"]')).toBeChecked();
  await expect(page.locator('#gisExportSummary')).toBeHidden();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.locator('#gisExportConfirmBtn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('판도연구소-GIS-데이터.gpkg');
  const db = new DatabaseSync(await download.path(), { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    expect(tables.has('entities')).toBe(true);
    expect(tables.has('countries')).toBe(false);
    expect(tables.has('territories')).toBe(false);
    expect(tables.has('administrative')).toBe(false);
    expect(tables.has('pandolab_project_settings')).toBe(false);
    expect(tables.has('pandolab_country_assets')).toBe(false);
  } finally {
    db.close();
  }
});

test('mobile vector import advances by stage and preserves detected choices when moving back', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await expect(page.locator('.topbar')).toBeHidden();
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
  await page.locator('#mobileMenuFileBtn').click();
  await expect(page.locator('#fileMenu')).toBeVisible();
  const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#openGisBtn').click()]);
  await fileChooser.setFiles({
    name: 'mobile-region.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'mobile-region',
        properties: { name: '모바일 시험 지역', parent_id: 'DEU' },
        geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] },
      }],
    })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportNextBtn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#gisStepIndicator')).toHaveText('1/3 · 데이터 선택');
  await expect(page.locator('#gisTargetTypeRow')).toBeVisible();
  await selectUiOption(page, '#gisTargetType', 'general');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('2/3 · 가져오기 설정');
  await expect(page.locator('#gisParentUnitRow')).toBeVisible();
  await selectUiOption(page, '#gisParentUnit', 'DEU');
  await expect(page.locator('#gisParentUnit')).toHaveValue('DEU');
  const detectedNameField = await page.locator('#gisNameField').inputValue();
  expect(detectedNameField).toBeTruthy();

  await page.locator('#gisImportNextBtn').click();
  await page.locator('#gisImportBackBtn').click();
  await expect(page.locator('#gisTargetType')).toHaveValue('general');
  await expect(page.locator('#gisParentUnit')).toHaveValue('DEU');
  await expect(page.locator('#gisNameField')).toHaveValue(detectedNameField);
  await page.locator('#gisImportBackBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('1/3 · 데이터 선택');
  await expect(page.locator('#gisTargetType')).toHaveValue('general');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('2/3 · 가져오기 설정');
  await expect(page.locator('#gisParentUnit')).toHaveValue('DEU');
  await expect(page.locator('#gisNameField')).toHaveValue(detectedNameField);
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('3/3 · 확인');
  await expect(page.locator('#gisFinalSummary')).toContainText('객체 자료');
  await expect(page.locator('#gisFinalSummary')).toContainText('현재 지도에 추가');
  await expect(page.locator('#gisImportConfirmBtn')).toBeVisible();

  await page.locator('#gisImportModal [data-gis-cancel="true"]').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
  await expect(page.locator('#fileMenu')).toBeVisible();
  await expect(page.locator('#openGisBtn')).toBeFocused();
  expect(errors).toEqual([]);
});

test('current general GIS import preserves explicit source geometry and existing roots through undo and redo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const roots = ['DEU', 'POL', 'RUS'];
  const readRoots = () => page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id).geometry), roots);
  const before = await readRoots();
  await page.locator('#mobileFileBtn').click();
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  const source = createTerritorialFeature({ id: 'current-east-prussia', entityKind: 'general',
    name: '동프로이센주', parentId: 'DEU', coverageMode: 'explicit', geometry: eastPrussiaGeometry });
  const row = globalThis.PandoLabGisAdapters.territorialRows({ territorialEntities: [source] }).entities[0];
  await (await choosing).setFiles({ name: 'entities.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: source.id,
      properties: Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'geometry')), geometry: row.geometry }] })) });
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await selectUiOption(page, '#gisTargetType', 'general');
  await selectUiOption(page, '#gisParentUnit', 'DEU');
  await expect(page.locator('#gisCoastReference')).toHaveValue('');
  for (const step of ['2/3', '3/3']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step);
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 90_000 });
  const readImported = () => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' })
    .find(entity => entity.properties.name === '동프로이센주') || null);
  await expect.poll(readImported).not.toBeNull();
  const imported = await readImported();
  expect(imported.properties).toMatchObject({ entityKind: 'general', parentId: 'DEU', coverageMode: 'explicit' });
  expect('sovereignId' in imported.properties).toBe(false);
  expect(imported.geometry.coordinates).toHaveLength(eastPrussiaExpected.components);
  expect(planarArea(imported.geometry)).toBeCloseTo(eastPrussiaExpected.area, 8);
  const difference = await page.evaluate(({ expected, actual }) => {
    const coordinates = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return window.polygonClipping.xor(coordinates(expected), coordinates(actual));
  }, { expected: eastPrussiaGeometry, actual: imported.geometry });
  expect(planarArea({ type: 'MultiPolygon', coordinates: difference })).toBeLessThan(1e-8);
  expect(await readRoots()).toEqual(before);
  await page.locator('#undoBtn').click();
  await expect.poll(readImported).toBeNull();
  expect(await readRoots()).toEqual(before);
  await page.locator('#redoBtn').click();
  await expect.poll(readImported).toEqual(imported);
  expect(await readRoots()).toEqual(before);
  expect(errors).toEqual([]);
});
