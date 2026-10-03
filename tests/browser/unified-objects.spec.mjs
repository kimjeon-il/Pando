import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off' });

async function select(page, id) {
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#entityProperties')).toBeVisible();
}

async function clickCoordinate(page, coordinate) {
  const box = await page.locator('#map').boundingBox();
  const point = await page.evaluate(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate), coordinate);
  await page.locator('#map .map-svg').dispatchEvent('click', { clientX: box.x + point[0], clientY: box.y + point[1], button: 0 });
}

async function polygon(page, coordinates) {
  await page.locator('#modePolygonMethodInput').check();
  await expect(page.locator('#modeDraftActions')).toBeVisible({ timeout: 30000 });
  const box = await page.locator('#map').boundingBox();
  const points = await page.evaluate(coordinates => coordinates.map(c => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(c)), coordinates);
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(box.x + point[0], box.y + point[1], { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled();
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('#modeDraftDoneBtn')).toHaveAttribute('aria-label', '현재 영역 확정', { timeout: 30000 });
  await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30000 });
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 30000 });
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('생성 확인');
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  if (await page.locator('#confirmModal').isVisible()) await page.locator('#confirmModalOkBtn').click();
}

async function entityNamed(page, name) {
  await expect.poll(() => page.evaluate(name => window.PANDOLAB_TERRITORIAL.list().find(f => f.properties.name === name)?.id, name), { timeout: 30000 }).toBeTruthy();
  return page.evaluate(name => window.PANDOLAB_TERRITORIAL.list().find(f => f.properties.name === name), name);
}

async function savedProject(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('pandolab-editor', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('projects', 'readonly'), get = tx.objectStore('projects').get('active-project');
      tx.oncomplete = () => { db.close(); resolve(get.result); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

async function generalGeometries(page) {
  return page.evaluate(async () => {
    const result = [];
    for (const feature of window.PANDOLAB_TERRITORIAL.list({ kind: 'general' })) {
      const bytes = new TextEncoder().encode(JSON.stringify(feature.geometry));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      result.push({ id: feature.id, parentId: feature.properties.parentId, hash: Array.from(new Uint8Array(digest)).join(',') });
    }
    return result;
  });
}

test('one object flow creates a root, child and independent region; common editing and copy survive undo and restore', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error(m.text()); } });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  await select(page, 'DEU');
  await page.locator('#focusSelectedObjectBtn').click();
  const original = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').geometry);

  await page.locator('#createMenuBtn').click();
  await expect(page.locator('#addEntityBtn')).toHaveText('객체');
  await expect(page.locator('#addCountryBtn, #addSubunitBtn, #addRegionBtn')).toHaveCount(0);
  await page.locator('#addEntityBtn').click();
  await page.locator('#territorialCreateParentInput').selectOption('DEU');
  await page.locator('#territorialCreateRegionalInput').check();
  await expect(page.locator('#territorialCreateParentInput')).toHaveValue('');
  await expect(page.locator('#territorialCreateParentInput')).toBeDisabled();
  await page.locator('#territorialCreateRegionalInput').uncheck();
  await expect(page.locator('#territorialCreateParentInput')).toHaveValue('');
  await expect(page.locator('#territorialCreateParentInput')).toBeEnabled();
  await page.locator('#modeCancelBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').geometry)).toEqual(original);

  await page.locator('#createMenuBtn').click();
  await page.locator('#addEntityBtn').click();
  await page.locator('#territorialCreateNameInput').fill('일반 객체');
  await page.locator('#territorialCreateNameInput').dispatchEvent('input');
  await clickCoordinate(page, [11, 51]);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await polygon(page, [[10, 50], [12, 50], [12, 52], [10, 52], [10, 50]]);
  const root = await entityNamed(page, '일반 객체');
  console.log('Root creation verified');
  expect(root.properties.entityKind).toBe('general');
  expect(root.properties.parentId).toBe('');
  expect(root.geometry.coordinates.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').geometry)).not.toEqual(original);

  await select(page, root.id);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#addEntityChildBtn').click();
  await expect(page.locator('#territorialCreateParentInput')).toHaveValue(root.id);
  await page.locator('#territorialCreateNameInput').fill('하위 객체');
  await page.locator('#territorialCreateNameInput').dispatchEvent('input');
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 30000 });
  await page.locator('#modePrimaryBtn').click();
  await polygon(page, [[10.3, 50.3], [11, 50.3], [11, 51], [10.3, 51], [10.3, 50.3]]);
  const child = await entityNamed(page, '하위 객체');
  console.log('Child creation verified');
  expect(child.properties.entityKind).toBe('general');
  expect(child.properties.parentId).toBe(root.id);

  const beforeRegion = await generalGeometries(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addEntityBtn').click();
  await page.locator('#territorialCreateRegionalInput').check();
  await page.locator('#territorialCreateNameInput').fill('독립 권역');
  await page.locator('#territorialCreateNameInput').dispatchEvent('input');
  await page.locator('#modePrimaryBtn').click();
  await polygon(page, [[9.8, 49.8], [12.2, 49.8], [12.2, 52.2], [9.8, 52.2], [9.8, 49.8]]);
  const region = await entityNamed(page, '독립 권역');
  console.log('Independent region creation verified');
  expect(region.properties.entityKind).toBe('regional');
  expect(region.properties.parentId).toBe('');
  expect(await generalGeometries(page)).toEqual(beforeRegion);
  await select(page, region.id);
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#entityRegionalStatus')).toBeVisible();
  await expect(page.locator('#entityParentRow')).toBeHidden();

  await select(page, root.id);
  await page.locator('#editorTabBtn').click();
  await page.locator('#entityNotesInput').fill('공통 폼 저장');
  await page.locator('#entityNotesInput').dispatchEvent('change');
  await page.locator('#entityValidFromInput').fill('1900-01-01');
  await page.locator('#entityValidFromInput').dispatchEvent('change');
  const beforeCopy = await page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id)), [root.id, child.id]);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setLocked(id, true), root.id);
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#copyEntityRegionBtn')).toBeEnabled();
  await page.locator('#copyEntityRegionBtn').click();
  const copy = await page.evaluate(rootId => window.PANDOLAB_TERRITORIAL.list({ kind: 'regional' }).find(f => f.properties.name === '일반 객체' && f.id !== rootId), root.id);
  expect(copy.id).not.toBe(root.id);
  expect(copy.properties.parentId).toBe('');
  expect(copy.geometry).toEqual(beforeCopy[0].geometry);
  expect(await page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id).geometry), [root.id, child.id])).toEqual(beforeCopy.map(f => f.geometry));
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), copy.id)).toBeNull();
  await page.locator('#redoBtn').click();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), copy.id)).toEqual(copy);
  await expect.poll(async () => JSON.stringify(await savedProject(page)), { timeout: 15000 }).toContain('공통 폼 저장');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60000 });
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.notes, root.id)).toBe('공통 폼 저장');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.validFrom, root.id)).toBe('1900-01-01');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.parentId, child.id)).toBe(root.id);
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).geometry, copy.id)).toEqual(copy.geometry);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobileCreateBtn').click();
  await page.locator('#addEntityBtn').click();
  await expect(page.locator('#territorialCreateRegionalInput')).toBeVisible();
  await page.locator('#territorialCreateRegionalInput').check();
  await expect(page.locator('#territorialCreateParentInput')).toBeDisabled();
  await page.locator('#modeCancelBtn').click();
  await select(page, child.id);
  await expect(page.locator('#entityNameInput')).toBeVisible();
  expect(errors).toEqual([]);
});
