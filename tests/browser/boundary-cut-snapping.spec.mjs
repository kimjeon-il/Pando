import { expect, test as base } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { boundaryRevisionTimingFixture, isBoundaryRevisionComparison } from './helpers/boundary-revision-timings.mjs';

const comparison = isBoundaryRevisionComparison();
const loaf = comparison ? null : await import('./helpers/long-animation-frame-diagnostics.mjs');
const diagnostics = comparison ? null : await import('./helpers/native-action-diagnostics.mjs');
const timeline = comparison ? null : await import('./helpers/native-action-timeline.mjs');
const installLongAnimationFrameProbe = comparison ? null : loaf.installLongAnimationFrameProbe;
const withNativeActionDiagnostics = comparison ? null : diagnostics.withNativeActionDiagnostics;
const test = base.extend({
  boundaryTimings: boundaryRevisionTimingFixture,
  // The comparator uses a null slot, never the native controller fixture.
  // Its host fixture validates the isolated config before any test action.
  nativeTimeline: comparison ? async ({ boundaryTimings }, use) => { await use(null); }
    : [timeline.boundaryNativeTimelineFixture, { timeout: 22_000 }],
});

const parentId = '00000000-0000-4000-8000-000000000021';
const parent = createTerritorialFeature({ id: parentId, entityKind: 'general', name: '경계 스냅 실제 시험 영역',
  geometry: { type: 'Polygon', coordinates: [[[5, 5], [5, 25], [25, 25], [25, 5], [5, 5]]] } });

async function savedProject(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('pandolab-editor', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('projects', 'readonly');
      const project = transaction.objectStore('projects').get('active-project');
      transaction.oncomplete = () => { db.close(); resolve(project.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}

async function openApp(page, viewport = { width: 1440, height: 900 }) {
  await page.route('**/assets/js/modules/editing-domain.js*', async route => {
    const response = await route.fetch();
    const original = (await response.text()).replace(/\r\n/g, '\n');
    const marker = '  return Object.freeze({\n    setTool, handleInteraction, createRenderPacket,';
    expect(original).toContain(marker);
    await route.fulfill({ response, body: original.replace(marker, '  return window.__cutEditing = Object.freeze({\n    setTool, handleInteraction, createRenderPacket,') });
  });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.addInitScript(project => localStorage.setItem('pandolab-editor-project', JSON.stringify(project)),
    staticAutosaveProject({ physicalSettings: { terrainVisible: false } }, [parent]));
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

test('a child cut snaps to both parent boundaries, preserves coverage and undoes in one step', async ({ page, nativeTimeline, boundaryTimings }, testInfo) => {
  test.setTimeout(360_000);
  if (!comparison) await page.addInitScript(installLongAnimationFrameProbe);
  const errors = await openApp(page);

  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.move(mapBox.x + mapBox.width * 0.42, mapBox.y + mapBox.height * 0.38);
  await page.mouse.down();
  for (const [x, y] of [[0.48, 0.46], [0.55, 0.4]]) await page.mouse.move(mapBox.x + mapBox.width * x, mapBox.y + mapBox.height * y);
  await page.mouse.up();
  await expect(page.locator('g.draft-vertex')).toHaveCount(3);
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmModalMessage')).toContainText('점 3개');
  await expect(page.locator('#confirmModalCancelBtn')).toHaveText('계속 그리기');
  await page.locator('#confirmModalCancelBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(3);
  await page.locator('#modeCancelBtn').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);

  await page.locator('#mapDisplayBtn').click();
  await page.locator('#mapProjectionMenuTrigger').click();
  await page.locator('#flatBtn').click();
  for (let index = 0; index < 2 && await page.locator('#mapDisplaySurface').isVisible(); index++) await page.keyboard.press('Escape');
  await expect(page.locator('#mapDisplaySurface')).toBeHidden();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), parentId)).toBe(true);
  await expect(page.locator('#entityProperties')).toBeVisible();
  await page.locator('#focusSelectedObjectBtn').click();
  const before = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), parentId);
  const beforeStorage = await savedProject(page);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#addEntityChildBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#territorialCreateNameInput').fill('스냅 자식');
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#modeDirectLineMethodInput').check();
  await expect(page.locator('#modeDraftDoneBtn')).toBeDisabled();
  const box = await page.evaluate(() => {
    const points = [[5, 25], [25, 5]].map(coordinate => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate));
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.x + Math.min(...points.map(point => point[0])), y: rect.y + Math.min(...points.map(point => point[1])),
      width: Math.abs(points[1][0] - points[0][0]), height: Math.abs(points[1][1] - points[0][1]) };
  });
  expect(box).not.toBeNull();
  const pointTargets = await page.evaluate(box => [
    document.elementFromPoint(box.x + 6, box.y + box.height / 2)?.closest('#map')?.id,
    document.elementFromPoint(box.x + box.width - 6, box.y + box.height / 2 + 8)?.closest('#map')?.id,
  ], box);
  const proofPath = testInfo.outputPath('cut-projected-input.json');
  const beforeInput = await page.evaluate(() => window.__cutEditing.snapshot());
  await writeFile(proofPath, JSON.stringify({ box, pointTargets, beforeInput }));
  await testInfo.attach('cut-projected-input', { path: proofPath, contentType: 'application/json' });
  expect(pointTargets).toEqual(['map', 'map']);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, y + 8, { steps: 12 });
  await page.mouse.up();
  const afterInput = await page.evaluate(() => window.__cutEditing.snapshot());
  await writeFile(proofPath, JSON.stringify({ box, pointTargets, beforeInput, afterInput }));

  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1);
  await expect(page.locator('.draft-snap-point')).toHaveCount(2);
  const snapped = await page.locator('.draft-snap-point').evaluateAll(nodes => nodes.map(node => node.__data__.coordinate));
  for (const [x, y] of snapped) {
    expect(x === 5 || x === 25 || y === 5 || y === 25).toBe(true);
  }
  await expect(page.locator('.draft-split-preview')).toHaveCount(2);
  await expect(page.locator('g.draft-vertex')).toHaveCount(2);
  await expect(page.locator('#modeEditingHud')).toBeVisible();
  await expect(page.locator('#modeDraftRedrawBtn')).toBeVisible();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeHidden();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeDisabled();
  await expect(page.locator('#modeTaskInstruction')).toHaveClass(/cut-valid/);
  await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled();

  const insertPoint = await page.locator('.draft-segment-hit').first().evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() / 4);
    const screenPoint = new path.ownerDocument.defaultView.DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: screenPoint.x, y: screenPoint.y,
      hitsSegment: document.elementFromPoint(screenPoint.x, screenPoint.y) === path };
  });
  expect(insertPoint.hitsSegment).toBe(true);
  await page.mouse.move(insertPoint.x, insertPoint.y);
  await expect(page.locator('.draft-insert-handle')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cutEditing.snapshot().draft.insertTarget?.segmentIndex)).toBe(0);
  expect(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)
    ?.closest('.draft-insert-handle'), insertPoint)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('draft-insert-handle.png') });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('g.draft-vertex')).toHaveCount(3);
  await expect(page.locator('#modeDraftRedrawBtn')).toBeVisible();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeVisible();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeEnabled();
  const middleVertexPoint = await page.locator('g.draft-vertex').nth(1).evaluate(vertex => {
    const point = new vertex.ownerDocument.defaultView.DOMPoint(0, 0).matrixTransform(vertex.getScreenCTM());
    const hit = document.elementFromPoint(point.x, point.y);
    const projected = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(vertex.__data__.coordinate);
    const map = document.querySelector('#map').getBoundingClientRect();
    return { x: point.x, y: point.y, index: vertex.__data__.index,
      hitsVertex: hit?.closest('g.draft-vertex') === vertex,
      transform: vertex.getAttribute('transform'), datum: vertex.__data__,
      rect: vertex.getBoundingClientRect().toJSON(), hit: hit?.outerHTML.slice(0, 2000),
      projected: { x: map.x + projected[0], y: map.y + projected[1] },
      frame: window.__PANDOLAB_VIEW_DEBUG__.snapshot() };
  });
  const vertexHitProofPath = testInfo.outputPath('cut-middle-vertex-hit.json');
  await writeFile(vertexHitProofPath, JSON.stringify(middleVertexPoint));
  await testInfo.attach('cut-middle-vertex-hit', { path: vertexHitProofPath, contentType: 'application/json' });
  expect(middleVertexPoint.index).toBe(1);
  expect(middleVertexPoint.hitsVertex).toBe(true);
  const secondInsertPoint = await page.locator('.draft-segment-hit').nth(1).evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() * 3 / 4);
    const screenPoint = new path.ownerDocument.defaultView.DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: screenPoint.x, y: screenPoint.y,
      hitsSegment: document.elementFromPoint(screenPoint.x, screenPoint.y) === path };
  });
  expect(secondInsertPoint.hitsSegment).toBe(true);
  await page.mouse.move(secondInsertPoint.x, secondInsertPoint.y);
  await expect(page.locator('.draft-insert-handle')).toBeVisible();
  expect(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)
    ?.closest('.draft-insert-handle'), secondInsertPoint)).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('g.draft-vertex')).toHaveCount(4);
  const beforeVertexDrag = await page.evaluate(() => window.__cutEditing.snapshot());
  const nativeDrags = [];
  for (const [index, coordinate] of [[1, [23, 20]], [2, [7, 20]]]) {
    const input = await page.locator('g.draft-vertex').nth(index).evaluate((vertex, coordinate) => {
      const center = new vertex.ownerDocument.defaultView.DOMPoint(0, 0).matrixTransform(vertex.getScreenCTM());
      const point = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coordinate);
      const map = document.querySelector('#map').getBoundingClientRect();
      const target = { x: map.x + point[0], y: map.y + point[1] };
      const hit = document.elementFromPoint(target.x, target.y);
      return { center: { x: center.x, y: center.y }, target, coordinate,
        hitsVertex: document.elementFromPoint(center.x, center.y)?.closest('g.draft-vertex') === vertex,
        hitsMap: !!hit?.closest('#map'), hit: hit?.outerHTML.slice(0, 1000) };
    }, coordinate);
    expect(input.hitsVertex).toBe(true);
    expect(input.hitsMap).toBe(true);
    await page.mouse.move(input.center.x, input.center.y);
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() => window.__cutEditing.snapshot().draft.dragging)).toBe(true);
    const dragging = await page.evaluate(() => window.__cutEditing.snapshot());
    await page.mouse.move(input.target.x, input.target.y, { steps: 6 });
    await page.mouse.up();
    nativeDrags.push({ index, input, dragging });
  }
  const nativeDragProofPath = testInfo.outputPath('cut-native-invalid-drag.json');
  const afterVertexDrag = await page.evaluate(() => window.__cutEditing.snapshot());
  await writeFile(nativeDragProofPath, JSON.stringify({ middleVertexPoint, secondInsertPoint,
    beforeVertexDrag, nativeDrags, afterVertexDrag }));
  await expect.poll(() => page.evaluate(() => window.__cutEditing.snapshot().draft.cutAssessment?.status), { timeout: 60_000 }).toBe('invalid');
  const invalidDraft = await page.evaluate(() => window.__cutEditing.snapshot());
  await writeFile(nativeDragProofPath, JSON.stringify({ middleVertexPoint, secondInsertPoint,
    beforeVertexDrag, nativeDrags, afterVertexDrag, invalidDraft }));
  await testInfo.attach('cut-native-invalid-drag', { path: nativeDragProofPath, contentType: 'application/json' });
  expect(invalidDraft.draft.dragging).toBe(false);
  const [a, b, c, d] = invalidDraft.draft.coords;
  const orientation = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  expect(orientation(a, b, c) * orientation(a, b, d)).toBeLessThan(0);
  expect(orientation(c, d, a) * orientation(c, d, b)).toBeLessThan(0);
  expect(invalidDraft.draft.cutAssessment.issues).toContainEqual(expect.objectContaining({ kind: 'self-intersection' }));
  for (const { index, input } of nativeDrags) {
    expect(Math.abs(invalidDraft.draft.coords[index][0] - input.coordinate[0])).toBeLessThan(0.1);
    expect(Math.abs(invalidDraft.draft.coords[index][1] - input.coordinate[1])).toBeLessThan(0.1);
  }
  await expect(page.locator('.draft-shape.cut-invalid')).toBeVisible();
  await expect(page.locator('.draft-issue-marker')).not.toHaveCount(0);
  await expect(page.locator('#modeDraftDoneBtn')).toBeDisabled();
  await page.locator('#undoBtn').click();
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.__cutEditing.snapshot().draft.coords)).toEqual(beforeVertexDrag.draft.coords);
  await page.locator('#undoBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(3);
  await page.locator('#modeDraftDeleteBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(2);
  await page.locator('#undoBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(3);
  await page.locator('#redoBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(2);
  await page.locator('#undoBtn').click();
  await page.locator('g.draft-vertex').nth(1).click();
  const beforeNudge = await page.locator('g.draft-vertex').nth(1).getAttribute('transform');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.locator('g.draft-vertex').nth(1).getAttribute('transform')).not.toBe(beforeNudge);
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1);
  await expect(page.locator('.draft-split-preview')).toHaveCount(2);
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('path.territory-candidate')).toHaveCount(2, { timeout: 60_000 });
  const candidates = await page.locator('path.territory-candidate').evaluateAll(nodes => nodes.map(node => node.__data__.geometry));
  const partition = await page.evaluate(({ candidates, original }) => {
    const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const union = window.polygonClipping.union(...candidates.map(polygons));
    const outside = window.polygonClipping.xor(union, polygons(original));
    const shared = window.polygonClipping.intersection(...candidates.map(polygons));
    return { outside, shared };
  }, { candidates, original: before.geometry });
  expect(partition.outside).toEqual([]);
  expect(partition.shared).toEqual([]);
  for (const coordinate of snapped) {
    for (const candidate of candidates) expect(candidate.coordinates.flat(candidate.type === 'Polygon' ? 1 : 2)).toContainEqual(coordinate);
  }
  await expect(page.locator('#modeDraftDoneBtn')).toHaveAttribute('aria-label', '현재 영역 확정');
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('생성 확인');
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label', '생성');
  const beforeCreate = await page.evaluate(id => ({ stage: document.querySelector('#modeTaskStage').textContent,
    button: document.querySelector('#modePrimaryBtn').outerHTML,
    children: window.PANDOLAB_TERRITORIAL.list().filter(entity => entity.properties.parentId === id).map(entity => entity.id),
    editing: window.__cutEditing.snapshot() }), parentId);
  await writeFile(testInfo.outputPath('cut-create-ready.json'), JSON.stringify({ beforeCreate, errors }));
  await page.locator('#modePrimaryBtn').click({ noWaitAfter: true });
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.list().filter(entity => entity.properties.parentId === id).length, parentId)).toBe(1);
  const child = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.list().find(entity => entity.properties.parentId === id), parentId);
  expect(candidates).toContainEqual(child.geometry);
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), parentId)).toEqual(before);
  await expect.poll(async () => (await savedProject(page)).territorialEntities.some(entity => entity.id === child.id), { timeout: 30_000 }).toBe(true);
  const timed = (name, operation) => boundaryTimings ? boundaryTimings.measure(name, operation) : operation();
  const undo = async () => {
    await page.locator('#undoBtn').click();
  };
  if (comparison) await timed('undo-click', undo);
  else await withNativeActionDiagnostics(page, testInfo, { label: 'boundary-project-undo', selector: '#undoBtn', cpuProfile: true, longAnimationFrames: true, nativeTimeline }, undo);
  await timed('child-observation', async () => {
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), child.id)).toBeNull();
  });
  await timed('parent-observation', async () => {
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), parentId)).toEqual(before);
  });
  await timed('storage-observation', async () => {
    await expect.poll(async () => {
      const restored = await savedProject(page);
      return { identities: restored.territorialEntities, timelineRecords: restored.timelineRecords, geometries: restored.geometries };
    }, { timeout: 30_000 }).toEqual({ identities: beforeStorage.territorialEntities,
      timelineRecords: beforeStorage.timelineRecords, geometries: beforeStorage.geometries });
  });
  // Trace snapshots and complete archive restoration share this native action's budget.
  await timed('redo-click', async () => {
    await page.locator('#redoBtn').click({ timeout: 30_000, noWaitAfter: true });
  });
  await timed('redo-observation', async () => {
    await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), child.id),
      { timeout: 30_000 }).toEqual(child);
  });
  const committedProofPath = testInfo.outputPath('cut-geometry-history.json');
  await writeFile(committedProofPath, JSON.stringify({ parent: before, child, candidates,
    restored: { identities: beforeStorage.territorialEntities, timelineRecords: beforeStorage.timelineRecords,
      geometries: beforeStorage.geometries } }));
  await testInfo.attach('cut-geometry-history', { path: committedProofPath, contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('a mobile native touch stroke keeps editable hit targets and cancels without residue', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openApp(page, { width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect.poll(() => savedProject(page)).toBeTruthy();
  const beforeModel = await savedProject(page);
  await expect(page.locator('path.hydro-edit-shape')).toHaveCount(0);
  const drawTouchStroke = async () => {
    const mobileMapBox = await page.locator('#map').boundingBox();
    expect(mobileMapBox).not.toBeNull();
    const start = { x: mobileMapBox.x + mobileMapBox.width * 0.42, y: mobileMapBox.y + mobileMapBox.height * 0.42 };
    const middle = { x: mobileMapBox.x + mobileMapBox.width * 0.52, y: mobileMapBox.y + mobileMapBox.height * 0.48 };
    const end = { x: mobileMapBox.x + mobileMapBox.width * 0.62, y: mobileMapBox.y + mobileMapBox.height * 0.58 };
    expect(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)?.closest('#map'), start)).toBe(true);
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      const touchPoint = point => [{ x: point.x, y: point.y, id: 71, radiusX: 3, radiusY: 3, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(start) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(middle) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(end) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
    await expect(page.locator('g.draft-vertex')).toHaveCount(3);
    const draft = await page.evaluate(() => window.__cutEditing.snapshot());
    expect(draft.draft.coords).toHaveLength(3);
    expect(draft.draft.strokeActive).toBe(false);
    return draft;
  };
  await page.locator('#mobileCreateBtn').click();
  await page.locator('#addRiverBtn').click();
  await drawTouchStroke();
  const touchHitBox = await page.locator('.draft-vertex-hit').first().boundingBox();
  expect(touchHitBox.width).toBeGreaterThanOrEqual(32);
  const modeBarBox = await page.locator('#modeActionBar').boundingBox();
  expect(modeBarBox.x).toBeGreaterThanOrEqual(0);
  expect(modeBarBox.x + modeBarBox.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#modePrimaryBtn')).toBeHidden();
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmModalMessage')).toContainText('점 3개');
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);
  expect((await page.evaluate(() => window.__cutEditing.snapshot())).draft.coords).toEqual([]);
  await page.locator('#mobileCreateBtn').click();
  await page.locator('#addRiverBtn').click();
  await drawTouchStroke();
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('생성 확인');
  await expect(page.locator('#modePrimaryBtn')).toBeVisible();
  await expect(page.locator('#modeCancelBtn')).toBeVisible();
  const mobileButtons = await page.locator('#modeActionBar .mode-action-buttons > button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
  expect(mobileButtons).toHaveLength(2);
  expect(Math.min(...mobileButtons)).toBeGreaterThan(0);
  expect(Math.abs(mobileButtons[0] - mobileButtons[1])).toBeLessThanOrEqual(1);
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#confirmModal')).toBeHidden();
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);
  await expect(page.locator('.editing-preview-path')).toHaveCount(0);
  await expect(page.locator('path.hydro-edit-shape')).toHaveCount(0);
  expect((await page.evaluate(() => window.__cutEditing.snapshot())).draft.coords).toEqual([]);
  expect(await savedProject(page)).toEqual(beforeModel);
  expect(errors).toEqual([]);
});
