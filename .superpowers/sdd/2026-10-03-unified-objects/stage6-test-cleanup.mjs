import { readFileSync, writeFileSync } from 'node:fs';
const update = (file, edit) => {
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, edit(source), 'utf8');
};
update('tests/browser/runtime.spec.mjs', source => source
  .replace("{ name: '권역', exact: true }", "{ name: '독립 권역 자료', exact: true }")
  .replace("toHaveValue('territory')", "toHaveValue('regional')")
  .replace("await expect(page.locator('#gisTargetCountryRow')).toBeVisible();", "await expect(page.locator('#gisParentUnitRow')).toBeHidden();")
  .replaceAll("select.value = 'country';", "select.value = 'general';")
  .replace("await railMatches(['#gisImportImpact', '#gisOpenModeRow']);", "await railMatches(['#gisParentUnitRow', '#gisCoastReferenceRow']);")
  .replace(/    const identitySelect = page\.locator\('#gisCountryIdentityRows[\s\S]*?    await page\.locator\('#gisImportNextBtn'\)\.click\(\);\n/, ''));
update('tests/browser/russia-edit-preparation.spec.mjs', source => source
  .replace('const add = async (type, parentId, name, coords)', 'const add = async (parentId, name, coords)')
  .replace("await page.evaluate(({ type, parentId }) => window.PANDOLAB_TERRITORIAL.select(type, parentId), { type, parentId });", "await page.evaluate(parentId => window.PANDOLAB_TERRITORIAL.select(parentId), parentId);")
  .replace("page.locator(type === 'country' ? '#addEntityChildBtn' : '#addEntityChildBtn')", "page.locator('#addEntityChildBtn')")
  .replace("await add('country', 'RUS',", "await add('RUS',")
  .replace("await add('subunit', parent,", "await add(parent,")
  .replace('value?.territorialUnits?.some', '(value?.entityDelta?.changed || value?.territorialEntities || []).some')
  .replace("{ parentId: parent, sovereignId: 'RUS', locked: true }", "{ entityKind: 'general', parentId: parent, locked: true }"));
for (const file of ['generic-feature-independent-geometry', 'hydro-metadata-edit', 'storage-protection']) {
  update(`tests/browser/${file}.spec.mjs`, source => source
    .replace('PROJECT_SCHEMA_VERSION, DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION', 'PROJECT_SCHEMA_VERSION, DISTRIBUTION_MODEL_SCHEMA_VERSION, LAYER_PRESENTATION_SCHEMA_VERSION, TERRITORIAL_MODEL_SCHEMA_VERSION')
    .replace("coastlineAuthority: 'countries'", "coastlineAuthority: 'territorialEntities'")
    .replace('territorialModel: { schemaVersion: 2 }', 'territorialModel: { schemaVersion: TERRITORIAL_MODEL_SCHEMA_VERSION }'));
}
update('tests/browser/gis-interchange.spec.mjs', source => {
  source = source
    .replace("'countries', 'territories', 'administrative', 'regions',", "'entities', 'regions',")
    .replaceAll('countryColumns', 'entityColumns')
    .replace('PRAGMA table_info(countries)', 'PRAGMA table_info(entities)')
    .replace("['pandolab_id', 'pandolab_name']", "['id', 'name', 'entity_kind', 'parent_id', 'properties_json']")
    .replace("['id', 'name', 'type', 'parent_id', 'sovereign_id', 'color']", "['pandolab_id', 'pandolab_name', 'type', 'sovereign_id']")
    .replace('savedState.countryOverrides.POL.flagDataUrl', "savedState.territorialEntities.find(entity => entity.id === 'POL').properties.metadata.flagDataUrl")
    .replace("expect(Object.hasOwn(savedState.countryOverrides.DEU, 'flagDataUrl')).toBe(false);", "expect(savedState.territorialEntities.find(entity => entity.id === 'DEU').properties.metadata.flagDataUrl).toMatch(/^data:image/);")
    .replace("expect(tables.has('countries')).toBe(true);", "expect(tables.has('entities')).toBe(true);\n    expect(tables.has('countries')).toBe(false);")
    .replaceAll("'1/2 · 파일 확인'", "'1/1 · 프로젝트 복원 확인'")
    .replace("  await page.locator('#gisImportNextBtn').click();\r\n  await expect(page.locator('#gisStepIndicator')).toHaveText('2/2 · 열기 확인');\r\n", '')
    .replace("  await page.locator('#gisImportNextBtn').click();\n  await expect(page.locator('#gisStepIndicator')).toHaveText('2/2 · 열기 확인');\n", '')
    .replaceAll("'#gisTargetType', 'subunit'", "'#gisTargetType', 'general'")
    .replaceAll("toHaveValue('subunit')", "toHaveValue('general')")
    .replaceAll('#gisTargetCountryRow', '#gisParentUnitRow')
    .replaceAll('#gisTargetCountry', '#gisParentUnit')
    .replace("await expect(page.locator('#gisParentUnitRow')).toBeVisible();", "await expect(page.locator('#gisParentUnitRow')).toBeVisible();\n  await selectUiOption(page, '#gisParentUnit', 'DEU');")
    .replace("toContainText('독일');\n  await expect(page.locator('#gisFinalSummary')).toContainText('영토 이전');", "toContainText('객체 자료');\n  await expect(page.locator('#gisFinalSummary')).toContainText('현재 지도에 추가');");
  const start = source.indexOf("test('East Prussia imports");
  if (start < 0) throw new Error('Missing retired GIS test');
  return source.slice(0, start) + `test('general GIS import preserves source geometry and existing roots through undo and redo', async ({ page }) => {
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
  await (await choosing).setFiles(eastPrussiaFixture);
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\\bis-busy\\b/, { timeout: 90_000 });
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
`;
});
