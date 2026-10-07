import { startChildCreation } from './helpers/ui-select.mjs';
import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off' });

async function select(page, id) {
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  await expect(page.locator('#entityProperties')).toBeVisible();
}

async function clickCoordinate(page, coordinate) {
  const box = await page.locator('#map').boundingBox();
  const point = await page.evaluate(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate), coordinate);
  await page.locator('#map .map-svg').dispatchEvent('click', { clientX: box.x + point[0], clientY: box.y + point[1], button: 0 });
}

async function polygon(page, coordinates, reviewStage = '생성 확인') {
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
  await expect(page.locator('#modeTaskStage')).toHaveText(reviewStage);
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

test('one object flow creates a root, child and independent region; annex across the independent region and common editing survive undo and restore', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); } });
  await page.addInitScript(() => {
    window.__workerErrors = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.addEventListener('error', event => window.__workerErrors.push(event.message)); }
    };
  });
  await page.goto('/?debug=1&renderer=webgl2&demTerrain=raster');
  await expect.poll(async () => { expect(errors).toEqual([]); return page.locator('#app').getAttribute('data-readiness'); }, { timeout: 60000 }).toBe('enhanced');
  await page.locator('#flatBtn').evaluate(button => button.click());
  await select(page, 'DEU');
  await page.locator('#focusSelectedObjectBtn').click();
  const original = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').geometry);

  await page.locator('#createMenuBtn').click();
  await expect(page.locator('#addEntityBtn')).toHaveText('객체');
  await expect(page.locator('#addCountryBtn, #addSubunitBtn, #addRegionBtn')).toHaveCount(0);
  await page.locator('#addEntityBtn').click();
  await selectUiOption(page, '#territorialCreateParentInput', 'DEU');
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
  await startChildCreation(page, root.id);
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
  const beforeAnnex = await page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id)), [root.id, 'DEU', region.id, child.id]);
  await select(page, root.id);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexEntityBtn').click();
  await clickCoordinate(page, [12.3, 51]);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await polygon(page, [[12.04, 50.8], [12.4, 50.8], [12.4, 51.2], [12.04, 51.2], [12.04, 50.8]], '편입 확인');
  const annex = await page.evaluate(before => {
    const [target, donor, region, child] = before.map(f => window.PANDOLAB_TERRITORIAL.get(f.id));
    const coords = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const area = polygons => polygons.reduce((sum, polygon) => sum + polygon.reduce((sum, ring, index) => {
      let area = 0; for (let i = 1; i < ring.length; i++) area += ring[i-1][0]*ring[i][1] - ring[i][0]*ring[i-1][1];
      return sum + (index ? -1 : 1) * Math.abs(area / 2);
    }, 0), 0);
    const pc = window.polygonClipping;
    const added = pc.difference(coords(target.geometry), coords(before[0].geometry));
    const lost = pc.difference(coords(before[1].geometry), coords(donor.geometry));
    return { added: area(added), lost: area(lost), mismatch: area(pc.xor(added, lost)),
      crossesRegion: area(pc.intersection(added, coords(region.geometry))) > 0 && area(pc.difference(added, coords(region.geometry))) > 0,
      regionUnchanged: JSON.stringify(region.geometry) === JSON.stringify(before[2].geometry),
      childUnchanged: JSON.stringify(child.geometry) === JSON.stringify(before[3].geometry) };
  }, beforeAnnex);
  expect(annex.added).toBeGreaterThan(0); expect(annex.lost).toBeCloseTo(annex.added, 7);
  expect(annex.mismatch).toBeLessThan(1e-7); expect(annex.crossesRegion).toBe(true);
  expect(annex.regionUnchanged).toBe(true); expect(annex.childUnchanged).toBe(true);
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id).geometry), beforeAnnex.map(f => f.id)))
    .toEqual(beforeAnnex.map(f => f.geometry));
  console.log('Cross-region annex geometry and Undo verified');
  await select(page, region.id);
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#entityRegionalStatus')).toBeVisible();
  await expect(page.locator('#entityParentRow')).toBeHidden();

  await select(page, root.id);
  await page.locator('#editorTabBtn').click();
  await page.locator('#entityNotesInput').fill('공통 폼 저장');
  await page.locator('#entityNotesInput').dispatchEvent('change');
  await page.locator('#entityPeriodInput').fill('1900-01-01 ~');
  await page.locator('#entityPeriodInput').dispatchEvent('change');
  await expect(page.locator('#entityPeriodInput')).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.validFrom, root.id)).toBeNull();
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
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id).properties.validFrom, root.id)).toBeNull();
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
  expect(await page.evaluate(() => window.__workerErrors)).toEqual([]);
  expect(errors).toEqual([]);
});
