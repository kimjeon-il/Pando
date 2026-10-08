import { test, expect } from '@playwright/test';
import { PROJECT_SCHEMA_VERSION, TERRITORIAL_MODEL_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';
test.use({ channel: 'chromium' });

test('common entities feed editing, undo, autosave and restoration', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?debug=1');
  await expect.poll(async () => {
    if (errors.length) throw new Error(errors.join('\n'));
    return page.locator('#app').getAttribute('data-readiness');
  }, { timeout: 45000 }).toBe('enhanced');
  const before = await page.evaluate(() => {
    const api = window.PANDOLAB_TERRITORIAL;
    const unit = api.list({ kind: 'general' }).filter(f => f.properties.parentId).find(entity => entity.properties.metadata?.builtinSubunit?.sourceCountryId === 'ALD');
    return { country: api.get('DEU'), unit };
  });
  for (const [type, entity] of [['country', before.country], ['subunit', before.unit]]) {
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), entity.id)).toBe(true);
    await expect(page.locator('#entityProperties')).toBeVisible();
    const input = page.locator('#entityNameInput');
    await input.fill(`공통 경로 ${type}`);
    await input.dispatchEvent('change');
    await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, entity.id)).toBe(`공통 경로 ${type}`);
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, entity.id)).toEqual(entity.geometry);
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.name, entity.id)).toBe(entity.properties.name);
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, entity.id)).toEqual(entity.geometry);
  }
  const id = before.unit.id;
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setColor(id, '#123456').changed, id)).toBe(true);
  await expect.poll(() => page.locator('path.territorial-unit-shape').evaluateAll((nodes, id) =>
    nodes.find(node => node.__data__?.id === id)?.__data__?.properties.style.color, id)).toBe('#123456');
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.style, id)).toEqual(before.unit.properties.style);
  const colorCommits = await page.evaluate(id => {
    return {
      country: window.PANDOLAB_TERRITORIAL.setColor('DEU', '#476fae'),
      unit: window.PANDOLAB_TERRITORIAL.setColor(id, '#123456'),
    };
  }, id);
  expect(colorCommits.country.changed).toBe(true);
  expect(colorCommits.unit.changed).toBe(true);
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.style.color, id)).toBe('#123456');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').properties.style.color)).toBe('#476fae');
  const saved = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve, reject) => {
      const request = db.transaction('projects','readonly').objectStore('projects').get('active-project');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  });
  try {
    await expect.poll(async () => (await saved())?.entityDelta?.changed.find(entity => entity.id === id)?.properties.style.color,
      { timeout:30000 }).toBe('#123456');
  } catch (error) {
    const diagnostic = await page.evaluate(id => ({
      diagnostics: window.__PANDOLAB_RELIABILITY_LOG__.snapshot(),
      currentColor: window.PANDOLAB_TERRITORIAL.get(id).properties.style.color,
      countryColor: window.PANDOLAB_TERRITORIAL.get('DEU').properties.style.color,
    }), id);
    const savedProject = await saved();
    console.log('territorial autosave diagnostics', JSON.stringify({ format: savedProject?.format,
      savedColor: savedProject?.entityDelta?.changed.find(entity => entity.id === id)?.properties.style.color,
      savedCountryColor: savedProject?.entityDelta?.changed.find(entity => entity.id === 'DEU')?.properties.style.color,
      colorCommits,
      diagnostic }));
    throw error;
  }
  const project = await saved();
  expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(project.territorialModel.schemaVersion).toBe(TERRITORIAL_MODEL_SCHEMA_VERSION);
  expect(project.timelineRecords.schemaVersion).toBe(1);
  expect(project.geometries.length).toBeGreaterThan(0);
  expect(project.entityDelta.changed.every(entity => entity.geometry === null)).toBe(true);
  expect(project.entityDelta.changed.find(entity => entity.id === 'DEU').properties.style.color).toBe('#476fae');
  for (const key of ['countriesData','countryOverrides','countryDelta','territorialUnits']) expect(key in project).toBe(false);
  await page.reload();
  await expect.poll(async () => {
    if (errors.length) throw new Error(errors.join('\n'));
    return page.locator('#app').getAttribute('data-readiness');
  }, { timeout:45000 }).toMatch(/^(editable|enhanced)$/);
  const restored = await page.evaluate(id => ({country:window.PANDOLAB_TERRITORIAL.get('DEU'),unit:window.PANDOLAB_TERRITORIAL.get(id)}),id);
  expect(restored.country.properties.style.color).toBe('#476fae');
  expect(restored.unit.properties.style.color).toBe('#123456');
  expect(restored.country.geometry).toEqual(before.country.geometry);
  expect(restored.unit.geometry).toEqual(before.unit.geometry);
  expect(restored.unit.properties.parentId).toBe(before.unit.properties.parentId);
  expect('sovereignId' in restored.unit.properties).toBe(false);
  expect(errors).toEqual([]);
});
