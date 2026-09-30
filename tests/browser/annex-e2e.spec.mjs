import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

async function openAnnex(page, center, { renderer = 'webgl2' } = {}) {
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
  await page.goto(`/?debug=1&renderer=${renderer}`);
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

async function inspectLineCandidate(page) {
  return page.evaluate(async () => {
    const { buildPolygonGeometryPacket } = await import('/assets/js/modules/render-scene.js');
    const selected = document.querySelector('path.territory-candidate.selected-candidate');
    const candidates = [...document.querySelectorAll('path.territory-candidate')];
    const source = window.PANDOLAB_TERRITORIAL.get('TUR').geometry;
    const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const points = geometry => polygons(geometry).flat(2);
    const bounds = geometry => {
      const coords = points(geometry);
      return [Math.min(...coords.map(point => point[0])), Math.min(...coords.map(point => point[1])),
        Math.max(...coords.map(point => point[0])), Math.max(...coords.map(point => point[1]))];
    };
    const signedArea = ring => ring.slice(1).reduce((sum, point, index) =>
      sum + (ring[index][0] * point[1] - point[0] * ring[index][1]), 0) / 2;
    const area = geometry => polygons(geometry).reduce((sum, polygon) =>
      sum + Math.abs(polygon.reduce((part, ring, index) => part + (index ? -1 : 1) * Math.abs(signedArea(ring)), 0)), 0);
    const geometry = selected.__data__.geometry;
    const packet = buildPolygonGeometryPacket(geometry, { triangulate: window.earcut });
    const packetArea = Array.from({ length: packet.indices.length / 3 }, (_, index) => {
      const triangle = Array.from(packet.indices.slice(index * 3, index * 3 + 3), vertex =>
        [packet.positions[vertex * 2], packet.positions[vertex * 2 + 1]]);
      return Math.abs((triangle[0][0] * (triangle[1][1] - triangle[2][1])
        + triangle[1][0] * (triangle[2][1] - triangle[0][1])
        + triangle[2][0] * (triangle[0][1] - triangle[1][1])) / 2);
    }).reduce((sum, value) => sum + value, 0);
    const path = new Path2D(selected.getAttribute('d'));
    const svg = selected.ownerSVGElement;
    const mask = document.createElement('canvas');
    mask.width = 240; mask.height = 144;
    const context = mask.getContext('2d', { willReadFrequently: true });
    context.scale(mask.width / svg.clientWidth, mask.height / svg.clientHeight);
    context.fill(path);
    const pixels = context.getImageData(0, 0, mask.width, mask.height).data;
    let filled = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) filled += 1;
    const variables = ['--map-selection-halo', '--map-primary-fill-alpha', '--map-primary-stroke-alpha', '--map-primary-stroke-width'];
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const mapStyle = getComputedStyle(document.querySelector('#map'));
    const css = Object.fromEntries(variables.map(name => [name, {
      root: rootStyle.getPropertyValue(name).trim(), map: mapStyle.getPropertyValue(name).trim(),
      owner: root.style.getPropertyValue(name).trim(),
    }]));
    const originalInlineOpacity = selected.style.getPropertyValue('fill-opacity');
    const saved = variables.map(name => [name, root.style.getPropertyValue(name)]);
    for (const [name] of saved) root.style.removeProperty(name);
    selected.style.removeProperty('fill-opacity');
    const fallbackOpacity = Number(getComputedStyle(selected).fillOpacity);
    for (const [name, value] of saved) root.style.setProperty(name, value);
    if (originalInlineOpacity) selected.style.setProperty('fill-opacity', originalInlineOpacity);
    const selectedBounds = bounds(geometry);
    const packetBounds = [Math.min(...packet.positions.filter((_, index) => index % 2 === 0)),
      Math.min(...packet.positions.filter((_, index) => index % 2 === 1)),
      Math.max(...packet.positions.filter((_, index) => index % 2 === 0)),
      Math.max(...packet.positions.filter((_, index) => index % 2 === 1))];
    const rect = selected.getBoundingClientRect();
    const mapRect = document.querySelector('#map').getBoundingClientRect();
    return {
      css, fallbackOpacity, opacity: Number(getComputedStyle(selected).fillOpacity),
      sourceBounds: bounds(source), selectedBounds, packetBounds, packetArea,
      areas: candidates.map(node => area(node.__data__.geometry)), selectedArea: area(geometry),
      canonical: window.PandoLabCountryGeometry.hasCanonicalCountryWinding(geometry),
      sourceCanonical: window.PandoLabCountryGeometry.hasCanonicalCountryWinding(source),
      pathLength: selected.getAttribute('d').length,
      pathCoverage: filled / (mask.width * mask.height),
      pathRectRatio: rect.width * rect.height / (mapRect.width * mapRect.height),
      gpuPacketKey: selected.getAttribute('data-gpu-interaction-fill-keys'),
      graticuleFrame: window.__PANDOLAB_RENDER_DEBUG__.snapshot().rendering.graticuleCommittedFrameId,
    };
  });
}

function expectLineCandidate(result, { gpu }) {
  for (const name of ['--map-selection-halo', '--map-primary-fill-alpha', '--map-primary-stroke-alpha', '--map-primary-stroke-width']) {
    expect(result.css[name].root).toBeTruthy();
    expect(result.css[name].map).toBe(result.css[name].root);
    expect(result.css[name].owner).toBe(result.css[name].root);
  }
  expect(Number(result.css['--map-primary-fill-alpha'].root)).toBeCloseTo(0.084, 3);
  expect(result.css['--map-selection-halo'].root).toBe('#316fd3');
  expect(Number(result.css['--map-primary-stroke-alpha'].root)).toBe(1);
  expect(result.css['--map-primary-stroke-width'].root).toBe('2.5px');
  expect(result.opacity).toBeCloseTo(0.084, 3);
  expect(result.fallbackOpacity).toBeCloseTo(0.084, 3);
  expect(result.areas).toHaveLength(2);
  expect(result.selectedArea).toBeCloseTo(Math.min(...result.areas), 6);
  expect(result.canonical).toBe(true);
  expect(result.sourceCanonical).toBe(true);
  for (const index of [0, 1]) {
    expect(result.selectedBounds[index]).toBeGreaterThanOrEqual(result.sourceBounds[index] - 1e-5);
    expect(result.selectedBounds[index + 2]).toBeLessThanOrEqual(result.sourceBounds[index + 2] + 1e-5);
    expect(result.packetBounds[index]).toBeCloseTo(result.selectedBounds[index], 3);
    expect(result.packetBounds[index + 2]).toBeCloseTo(result.selectedBounds[index + 2], 3);
  }
  expect(result.packetArea).toBeCloseTo(result.selectedArea, 3);
  expect(result.pathLength).toBeGreaterThan(100);
  expect(result.pathCoverage).toBeGreaterThan(0);
  expect(result.pathCoverage).toBeLessThan(0.5);
  expect(result.pathRectRatio).toBeLessThan(0.5);
  expect(result.graticuleFrame).toBeGreaterThan(0);
  if (gpu) expect(result.gpuPacketKey).toContain(':candidate:');
}

async function accentViewportCoverage(page) {
  const screenshot = (await page.screenshot()).toString('base64');
  return page.evaluate(async encoded => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const map = document.querySelector('#map').getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const x = Math.floor(map.x), y = Math.floor(map.y);
    const width = Math.floor(map.width), height = Math.floor(map.height);
    const pixels = context.getImageData(x, y, width, height).data;
    let accentPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.abs(pixels[index] - 49) <= 5 && Math.abs(pixels[index + 1] - 111) <= 5
        && Math.abs(pixels[index + 2] - 211) <= 5) accentPixels += 1;
    }
    const land = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([35, 39]);
    const sample = context.getImageData(Math.floor(map.x + land[0]), Math.floor(map.y + land[1]), 1, 1).data;
    return { accentRatio: accentPixels / (width * height), landColor: Array.from(sample.slice(0, 3)) };
  }, screenshot);
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
  await expect(page.locator('path.territory-candidate')).toHaveCount(2);
  expectLineCandidate(await inspectLineCandidate(page), { gpu: true });
  const screen = await accentViewportCoverage(page);
  expect(screen.accentRatio).toBeLessThan(0.5);
  expect(screen.landColor).not.toEqual([49, 111, 211]);
  expect(screen.landColor).not.toEqual([255, 255, 255]);
  const selected = await page.locator('path.territory-candidate.selected-candidate').evaluate(element => element.__data__.geometry);
  await completeAndCheck(page, context, selected);
});

test('annex - line SVG fallback shows the same small candidate', async ({ page }) => {
  test.setTimeout(120_000);
  const context = await openAnnex(page, [27.5, 41.8], { renderer: 'canvas' });
  await page.locator('#modeDirectLineMethodInput').check();
  await expect(page.locator('#modeTaskInstruction')).toHaveText('가져올 영토를 가로질러 선을 그리세요.', { timeout: 60_000 });
  await drawStroke(page, [[26, 41.8], [29, 41.8]], { closed: false });
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1, { timeout: 45_000 });
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('path.territory-candidate')).toHaveCount(2);
  expectLineCandidate(await inspectLineCandidate(page), { gpu: false });
  const screen = await accentViewportCoverage(page);
  expect(screen.accentRatio).toBeLessThan(0.5);
  expect(screen.landColor).not.toEqual([49, 111, 211]);
  expect(screen.landColor).not.toEqual([255, 255, 255]);
  expect(context.errors).toEqual([]);
  expect(await page.evaluate(() => window.__annexE2e.workerErrors)).toEqual([]);
});

test('annex - line candidate stays local on the globe', async ({ page }) => {
  test.setTimeout(120_000);
  const context = await openAnnex(page, [27.5, 41.8]);
  await page.locator('#modeDirectLineMethodInput').check();
  await expect(page.locator('#modeTaskInstruction')).toHaveText('가져올 영토를 가로질러 선을 그리세요.', { timeout: 60_000 });
  await drawStroke(page, [[26, 41.8], [29, 41.8]], { closed: false });
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1, { timeout: 45_000 });
  await page.locator('#globeBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_STATE__?.projection)).toBe('globe');
  await page.locator('#modeDraftDoneBtn').click();
  expectLineCandidate(await inspectLineCandidate(page), { gpu: true });
  expect((await accentViewportCoverage(page)).accentRatio).toBeLessThan(0.5);
  expect(context.errors).toEqual([]);
  expect(await page.evaluate(() => window.__annexE2e.workerErrors)).toEqual([]);
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
