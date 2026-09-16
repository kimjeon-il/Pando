import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { selectUiOption } from './helpers/ui-select.mjs';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('Russia nested edits retain parent candidates, locks and history after autosave reload', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  const add = async (type, parentId, name, coords) => {
    await page.evaluate(({ type, parentId }) => window.PANDOLAB_TERRITORIAL.select(type, parentId), { type, parentId });
    await page.locator(type === 'country' ? '#addCountrySubunitBtn' : '#addSubunitChildBtn').evaluate(button => button.click());
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#territorialCreateNameInput').fill(name);
    await page.locator('#modePrimaryBtn').click();
    await page.locator('#modePolygonMethodInput').check();
    const map = await page.locator('#map').boundingBox();
    const points = await page.evaluate(coords => coords.map(coord => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coord)), coords);
    await page.mouse.move(map.x + points[0][0], map.y + points[0][1]);
    await page.mouse.down();
    for (const point of [...points.slice(1), points[0]]) await page.mouse.move(map.x + point[0], map.y + point[1], { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    await expect.poll(() => page.evaluate(name => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' }).some(item => item.properties.name === name), name)).toBe(true);
    return page.evaluate(name => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' }).find(item => item.properties.name === name).id, name);
  };
  const parent = await add('country', 'RUS', '러시아 부모 저장 시험', [[45, 56], [57, 56], [51, 63]]);
  const child = await add('subunit', parent, '러시아 자식 저장 시험', [[49, 58], [53, 58], [51, 60]]);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => !!window.PANDOLAB_TERRITORIAL.get(id), child)).toBe(false);
  await page.locator('#redoBtn').click();
  await expect.poll(() => page.evaluate(id => !!window.PANDOLAB_TERRITORIAL.get(id), child)).toBe(true);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select('subunit', id), child);
  await expect(page.locator('#subunitParentInput')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 });
  expect(await page.locator('#subunitParentInput').inputValue()).toBe(parent);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setLocked('subunit', id, true), child);
  await expect(page.locator('#subunitParentInput')).toBeDisabled();
  await expect.poll(() => page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('pandolab-editor', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const value = await new Promise((resolve, reject) => { const request = db.transaction('projects', 'readonly').objectStore('projects').get('active-project'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return value?.territorialUnits?.some(unit => unit.id === id && unit.properties.locked === true) === true;
    } finally { db.close(); }
  }, child), { timeout: 30000 }).toBe(true);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id)?.properties, child)).toMatchObject({ parentId: parent, sovereignId: 'RUS', locked: true });
});

test('Russia library replacement reuses the confirmed batch and undoes atomically', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__libraryBatchRequests = 0;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        if (message.type === 'execute' && message.operation === 'territorial-library-batch') window.__libraryBatchRequests++;
        return super.postMessage(message, ...rest);
      }
    };
  });
  await page.goto('/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  const original = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry));
  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await page.locator('#historicalLibrarySearchInput').fill('USSR');
  await selectUiOption(page, '#historicalLibraryStatusInput', 'past');
  await page.locator('#historicalLibraryYearInput').fill('1991');
  await page.locator('[data-library-entity-id="historical-country:soviet-union"]').click();
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('[data-library-impact]')).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry))).toBe(original);
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden({ timeout: 60000 });
  expect(await page.evaluate(() => window.__libraryBatchRequests)).toBe(1);
  expect(await page.evaluate(() => !!window.PANDOLAB_TERRITORIAL.get('historical-country:soviet-union'))).toBe(true);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => !!window.PANDOLAB_TERRITORIAL.get('historical-country:soviet-union'))).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry))).toBe(original);
});

test('Russia detailed line preparation remains cancellable and keeps the original', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  const original = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry));
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
  await page.locator('#addCountrySubunitBtn').evaluate(button => button.click());
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
  await page.locator('#territorialCreateNameInput').fill('러시아 경계선 시험');
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#modeDirectLineMethodInput').check();
  const map = await page.locator('#map').boundingBox();
  const points = await page.evaluate(() => [[45, 42], [45, 67.35]].map(coord => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coord)));
  await page.mouse.move(map.x + points[0][0], map.y + points[0][1]);
  await page.mouse.down();
  await page.mouse.move(map.x + points[1][0], map.y + points[1][1], { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('.draft-split-preview')).toHaveCount(2, { timeout: 30000 });
  await page.locator('#modeCancelBtn').click();
  if (await page.locator('#confirmModal').isVisible()) await page.locator('#confirmModalOkBtn').click();
  await page.locator('#modeCancelBtn').click();
  if (await page.locator('#confirmModal').isVisible()) await page.locator('#confirmModalOkBtn').click();
  expect(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry))).toBe(original);
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);
});

for (const renderer of ['webgl2', 'webgl1', 'canvas']) {
  test(`Russia detailed polygon creation, boundary refresh, undo and preparation cancellation (${renderer})`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__russiaEdit = { jobs: [], tasks: [], ticks: 0 };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...rest) {
          if (message.type === 'execute') window.__russiaEdit.jobs.push(message.operation);
          return super.postMessage(message, ...rest);
        }
      };
      new window.PerformanceObserver(list => window.__russiaEdit.tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true });
      setInterval(() => window.__russiaEdit.ticks++, 50);
    });
    await page.goto(`/?debug=1&renderer=${renderer}`);
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
    const baseline = await page.evaluate(() => {
      const country = window.PANDOLAB_TERRITORIAL.get('RUS');
      window.__russiaOriginal = JSON.stringify(country.geometry);
      const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
      return { polygons: polygons.length, pairs: polygons.flat().reduce((sum, ring) => sum + ring.length, 0), version: document.querySelector('#app').dataset.appVersion };
    });
    expect(baseline).toMatchObject({ polygons: 214, pairs: 36756 });
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
    await page.locator('#addCountrySubunitBtn').evaluate(button => button.click());
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#territorialCreateNameInput').fill('러시아 응답성 시험');
    await page.locator('#modePrimaryBtn').click();
    await page.locator('#modePolygonMethodInput').check();
    await page.evaluate(() => { window.__russiaEdit.start = performance.now(); });
    const map = await page.locator('#map').boundingBox();
    const points = await page.evaluate(() => [[45, 56], [57, 56], [51, 63]].map(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate)));
    await page.mouse.move(map.x + points[0][0], map.y + points[0][1]);
    await page.mouse.down();
    for (const point of [...points.slice(1), points[0]]) await page.mouse.move(map.x + point[0], map.y + point[1], { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    const children = () => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' }).filter(item => item.properties.name === '러시아 응답성 시험').length);
    await expect.poll(children, { timeout: 30000 }).toBe(1);
    await expect.poll(() => page.locator('path.territorial-internal-boundary').count(), { timeout: 30000 }).toBeGreaterThan(0);
    expect(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('RUS').geometry) === window.__russiaOriginal)).toBe(true);
    await page.locator('#undoBtn').click();
    await expect.poll(children).toBe(0);
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
    await page.locator('#editCoastBtn').evaluate(button => button.click());
    await page.locator('#modeCancelBtn').click();
    await expect(page.locator('g.boundary-vertex')).toHaveCount(0);
    const metrics = await page.evaluate(() => window.__russiaEdit);
    const tasks = metrics.tasks.filter(task => task.start >= metrics.start);
    const summary = { renderer, ...baseline, requests: metrics.jobs.length, longTasks: tasks.length, longestTaskMs: Math.round(Math.max(0, ...tasks.map(task => task.duration))), ticks: metrics.ticks };
    await writeFile(testInfo.outputPath('russia-edit-metrics.json'), JSON.stringify(summary, null, 2));
    console.log('Russia edit metrics', JSON.stringify(summary));
    expect(errors).toEqual([]);
  });
}
