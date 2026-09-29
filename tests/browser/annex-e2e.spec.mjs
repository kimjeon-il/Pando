import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

async function openAnnex(page, center) {
  await page.addInitScript(() => {
    window.__annexE2e = { workerErrors: [], workerTransfers: [], rebases: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('error', event => window.__annexE2e.workerErrors.push(event.message));
        this.addEventListener('message', event => {
          if (event.data?.type === 'result' && event.data.ok === false && !event.data.cancelled) window.__annexE2e.workerErrors.push(event.data.message);
          if (event.data?.result?.transferredGeometry) window.__annexE2e.workerTransfers.push(event.data.result.transferredGeometry);
        });
      }
      postMessage(message, ...rest) {
        if (message?.type === 'rebase') window.__annexE2e.rebases.push({
          turkeyBytes: JSON.stringify(message.features?.find(feature => feature.id === 'TUR')?.geometry || null).length,
        });
        return super.postMessage(message, ...rest);
      }
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto('/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'TUR'));
  await page.locator('#selectionToolbarEditBtn').click({ timeout: 10_000 });
  await page.locator('#focusSelectedObjectBtn').click({ timeout: 10_000 });
  const map = await page.locator('#map').boundingBox();
  const centerPoint = await page.evaluate(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate), center);
  expect(centerPoint).toBeTruthy();
  await page.mouse.move(map.x + centerPoint[0], map.y + centerPoint[1]);
  await page.mouse.wheel(0, -400);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'GRC'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click({ timeout: 10_000 });
  await expect(page.locator('#editorSurface')).toBeVisible();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexTerritoryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('대상 선택');
  const donorPoint = await page.evaluate(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate), center);
  await page.locator('#map .map-svg').dispatchEvent('click', {
    clientX: map.x + donorPoint[0], clientY: map.y + donorPoint[1], button: 0,
  });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('영역 선택');
  const before = await page.evaluate(() => ({
    a: JSON.stringify(window.PANDOLAB_TERRITORIAL.get('GRC').geometry),
    b: JSON.stringify(window.PANDOLAB_TERRITORIAL.get('TUR').geometry),
  }));
  return { errors, before };
}

async function drawStroke(page, coordinates, { closed = true } = {}) {
  const map = await page.locator('#map').boundingBox();
  const points = await page.evaluate(rows => rows.map(row => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(row)), coordinates);
  await page.mouse.move(map.x + points[0][0], map.y + points[0][1]);
  await page.mouse.down();
  for (const point of [...points.slice(1), ...(closed ? [points[0]] : [])]) {
    await page.mouse.move(map.x + point[0], map.y + point[1], { steps: 5 });
  }
  await page.mouse.up();
}

async function completeAndCheck(page, context, expectedGeometry = null) {
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('path.editing-preview-path.geometry-preview-add.geometry-preview-fill').length > 0
    || window.__annexE2e.workerErrors.length > 0 || document.querySelector('#modePrimaryBtn')?.textContent?.includes('다시 계산')),
  { timeout: 90_000 }).toBe(true);
  const workerErrors = await page.evaluate(() => window.__annexE2e.workerErrors);
  expect(workerErrors).toEqual([]);
  await expect(page.locator('path.editing-preview-path.geometry-preview-add.geometry-preview-fill')).toHaveCount(1);
  await expect.poll(() => page.locator('#modePrimaryBtn').evaluate(button => !button.disabled && button.getAttribute('aria-busy') === 'false'),
    { timeout: 90_000 }).toBe(true);
  await page.locator('#modePrimaryBtn').click();
  try {
    await expect(page.locator('#modeTaskStage')).toHaveText('결과 확인', { timeout: 5_000 });
  } catch (error) {
    console.log('review transition state', await page.evaluate(() => ({
      stage: document.querySelector('#modeTaskStage')?.textContent,
      disabled: document.querySelector('#modePrimaryBtn')?.disabled,
      busy: document.querySelector('#modePrimaryBtn')?.getAttribute('aria-busy'),
      reason: document.querySelector('#modeTaskDisabledReason')?.textContent,
      instruction: document.querySelector('#modeTaskInstruction')?.textContent,
      workerErrors: window.__annexE2e.workerErrors,
    })));
    throw error;
  }
  const previewFill = page.locator('path.editing-preview-path.geometry-preview-add.geometry-preview-fill');
  await expect(previewFill).toHaveCount(1, { timeout: 15_000 });
  const preview = await previewFill
    .evaluate(element => element.__data__.geometry);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 90_000 });
  await page.locator('#modePrimaryBtn').click();
  await expect.poll(() => page.evaluate(before => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('GRC').geometry) !== before, context.before.a),
    { timeout: 90_000 }).toBe(true);
  const result = await page.evaluate(({ before, expectedGeometry, preview }) => {
    const clipper = window.polygonClipping;
    const multi = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const planarArea = polygons => (polygons || []).reduce((sum, polygon) => sum + Math.abs(polygon.reduce((area, ring, index) => {
      let ringArea = 0;
      for (let i = 0; i < ring.length - 1; i++) ringArea += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      return area + (index ? -1 : 1) * Math.abs(ringArea / 2);
    }, 0)), 0);
    const oldA = multi(JSON.parse(before.a)), oldB = multi(JSON.parse(before.b));
    const newA = multi(window.PANDOLAB_TERRITORIAL.get('GRC').geometry);
    const newB = multi(window.PANDOLAB_TERRITORIAL.get('TUR').geometry);
    const added = clipper.difference(newA, oldA);
    const removed = clipper.difference(oldB, newB);
    const transfer = window.__annexE2e.workerTransfers.at(-1);
    return {
      beforeBChanged: JSON.stringify(window.PANDOLAB_TERRITORIAL.get('TUR').geometry) !== before.b,
      addedArea: planarArea(added), removedArea: planarArea(removed),
      mismatchArea: planarArea(clipper.xor(added, removed)),
      previewMissingArea: transfer ? planarArea(clipper.difference(multi(transfer), multi(preview))) : Infinity,
      selectionMissingArea: expectedGeometry ? planarArea(clipper.difference(multi(expectedGeometry), added)) : null,
      workerErrors: window.__annexE2e.workerErrors,
      rebases: window.__annexE2e.rebases,
    };
  }, { before: context.before, expectedGeometry, preview });
  expect(result.beforeBChanged).toBe(true);
  expect(result.addedArea).toBeGreaterThan(0);
  expect(result.removedArea).toBeGreaterThan(0);
  expect(result.mismatchArea).toBeLessThan(1e-5);
  expect(result.previewMissingArea).toBeLessThan(1e-5);
  if (expectedGeometry) expect(result.selectionMissingArea).toBeLessThan(1e-5);
  expect(result.workerErrors).toEqual([]);
  expect(context.errors).toEqual([]);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(before => ({
    a: JSON.stringify(window.PANDOLAB_TERRITORIAL.get('GRC').geometry) === before.a,
    b: JSON.stringify(window.PANDOLAB_TERRITORIAL.get('TUR').geometry) === before.b,
  }), context.before), { timeout: 30_000 }).toEqual({ a: true, b: true });
}

test('annex - line', async ({ page }) => {
  test.setTimeout(180_000);
  const context = await openAnnex(page, [27.5, 41.8]);
  await page.locator('#modeDirectLineMethodInput').check();
  await expect(page.locator('#modeTaskInstruction')).toHaveText('가져올 영토를 가로질러 선을 그리세요.', { timeout: 60_000 });
  await drawStroke(page, [[26, 41.8], [29, 41.8]], { closed: false });
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1, { timeout: 45_000 });
  await expect(page.locator('.draft-split-preview')).toHaveCount(2);
  await page.locator('#modeDraftDoneBtn').click();
  const selected = await page.locator('path.territory-candidate.selected-candidate').evaluate(element => element.__data__.geometry);
  await completeAndCheck(page, context, selected);
});

test('annex - polygon', async ({ page }) => {
  test.setTimeout(180_000);
  const context = await openAnnex(page, [29.5, 39.5]);
  await page.locator('#modePolygonMethodInput').check();
  await expect(page.locator('#modeTaskInstruction')).toHaveText('가져올 영역을 지도에 그리세요.', { timeout: 60_000 });
  await drawStroke(page, [[29, 39], [30, 39], [30, 40], [29, 40]]);
  await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 45_000 });
  await page.locator('#modeDraftDoneBtn').click();
  const selected = await page.locator('path.territory-candidate.selected-candidate').evaluate(element => element.__data__.geometry);
  await completeAndCheck(page, context, selected);
});

test('annex - components', async ({ page }) => {
  test.setTimeout(180_000);
  const context = await openAnnex(page, [29.5, 39.5]);
  await page.locator('#modeComponentsMethodInput').check();
  const components = page.locator('.draft-layer path.territory-component');
  await expect.poll(() => components.count(), { timeout: 60_000 }).toBeGreaterThan(1);
  const selected = await components.evaluateAll(nodes => nodes.slice(0, 2).map(node => node.__data__.geometry));
  await components.evaluateAll(nodes => nodes.slice(0, 2).forEach(node => node.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, cancelable: true,
  }))));
  await expect(page.locator('#multiDrawnAddBtn')).toBeEnabled({ timeout: 90_000 });
  await page.locator('#multiDrawnAddBtn').click();
  await expect(page.locator('path.territory-candidate')).toHaveCount(2);
  const keys = await page.locator('path.territory-candidate').evaluateAll(nodes => nodes.map(node => node.__data__.key));
  expect(new Set(keys).size).toBe(2);
  await completeAndCheck(page, context, { type: 'MultiPolygon', coordinates: selected.flatMap(geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) });
});
