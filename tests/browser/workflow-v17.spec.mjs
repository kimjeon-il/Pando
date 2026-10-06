import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function boot(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function pickCountry(page, id) {
  const map = await page.locator('#map').boundingBox();
  const point = await page.evaluate(id => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor(id)), id);
  await page.locator('#map .map-svg').dispatchEvent('click', { clientX: map.x + point[0], clientY: map.y + point[1], button: 0 });
}

async function captureLayouts(page, name) {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.locator('#modeEditingHud')).toBeVisible();
      const overflow = await page.locator('.mode-task-window-body').evaluate(node => node.scrollWidth > node.clientWidth);
      expect(overflow).toBe(false);
      const spacing = await page.locator('.mode-task-window-body').evaluate(node => {
        const first = [...node.children].find(child => child.getBoundingClientRect().height > 0);
        return { actual: first.getBoundingClientRect().top - node.getBoundingClientRect().top, expected: parseFloat(getComputedStyle(node).paddingTop) };
      });
      expect(spacing.actual).toBeCloseTo(spacing.expected, 0);
      await page.locator('#modeEditingHud').screenshot({ path: `node_modules/.cache/workflow-v17/captures/${name}-${width}-${theme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
}

async function draw(page, offset = 0, polygon = false) {
  const map = await page.locator('#map').boundingBox();
  const points = [[0.38 + offset, 0.38], [0.46 + offset, 0.39], [0.45 + offset, 0.48], ...(polygon ? [[0.38 + offset, 0.38]] : [])]
    .map(([x, y]) => [map.x + map.width * x, map.y + map.height * y]);
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#modeDraftDoneBtn')).toBeVisible();
}

async function drawCoordinates(page, coordinates) {
  const box = await page.locator('#map').boundingBox();
  const points = await page.evaluate(coordinates => coordinates.map(point => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(point)), coordinates);
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(box.x + point[0], box.y + point[1], { steps: 5 });
  await page.mouse.up();
}

test('annex setup hides selection-stage visuals and restores the exact draft on return', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexEntityBtn').click();
  await pickCountry(page, 'POL');
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStep')).toHaveText('2 / 3');
  await page.locator('#modeDirectLineMethodInput').check();
  await expect(page.locator('#modeDraftActions')).toBeVisible({ timeout: 60_000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  await page.evaluate(() => {
    const host = window.__PANDOLAB_MAP_HOST__;
    host.setViewState({ projection: 'flat', view: { ...host.getViewState(), flatCenter: [19, 52], flatZoom: 10 } });
    host.requestRepaint('workflow-draft-back-test');
  });
  await drawCoordinates(page, [[17, 51], [21, 53], [17, 53], [21, 51]]);
  const vertices = page.locator('g.draft-vertex');
  await expect(vertices).not.toHaveCount(0);
  await expect(page.locator('g.draft-issue-marker')).not.toHaveCount(0);
  const coordinates = await vertices.evaluateAll(nodes => nodes.map(node => node.__data__.coordinate));
  const issueText = await page.locator('g.draft-issue-marker title').first().textContent();
  expect(issueText).toBeTruthy();
  await expect(page.locator('#modeTaskDisabledReason')).toContainText(issueText);

  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#modeTaskStep')).toHaveText('1 / 3');
  for (const selector of [
    'g.draft-vertex', 'path.draft-packet-shape', 'path.draft-segment-hit',
    'g.draft-issue-marker', 'circle.draft-snap-point', 'g.draft-insert-handle',
    'path.draft-split-preview', 'path.territory-component', 'path.territory-candidate',
    'path.river-partition-emphasis', '.geometry-preview-fill',
  ]) await expect(page.locator(selector)).toHaveCount(0);
  await expect(page.locator('#modeTaskDisabledReason')).toBeHidden();
  await expect(page.locator('#modeTaskInstruction')).not.toContainText(issueText);
  await expect(page.locator('#modeTaskObjects')).toContainText('독일');

  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStep')).toHaveText('2 / 3');
  await expect(vertices).toHaveCount(coordinates.length);
  expect(await vertices.evaluateAll(nodes => nodes.map(node => node.__data__.coordinate))).toEqual(coordinates);
  await expect(page.locator('g.draft-issue-marker')).not.toHaveCount(0);
  await expect(page.locator('#modeTaskDisabledReason')).toContainText(issueText);
  expect(errors).toEqual([]);
});

test('task windows omit target focus while the object editor retains its focus action', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('GRC'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#editorObjectHeader #focusSelectedObjectBtn')).toBeVisible();
  for (const [command, name] of [['#annexEntityBtn', '영토 편입'], ['#editEntityBorderBtn', '국경 조정']]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#actionsTabBtn').click();
    await page.locator(command).click();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'task');
      await expect(page.locator('#modeTaskName')).toHaveText(name);
      await expect(page.locator('#modeTaskTargetsFocusBtn')).toHaveCount(0);
      await expect(page.locator('#modeEditingHud button[aria-label*="대상으로 이동"]')).toHaveCount(0);
      await expect(page.locator('#modeCancelBtn')).toBeVisible();
      await page.locator('#modeEditingHud').screenshot({ path: testInfo.outputPath(`no-target-focus-${command.slice(1)}-${width}.png`) });
    }
    await page.locator('#modeCancelBtn').click();
    await expect(page.locator('#editorSurface')).toHaveAttribute('data-editor-content', 'properties');
    await expect(page.locator('#editorObjectHeader #focusSelectedObjectBtn')).toBeVisible();
    await expect(page.locator('#propertyTitle')).toHaveText('그리스');
  }
  expect(errors).toEqual([]);
});

test('editor identity returns to header flag and focus controls without changing task headers', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect(page.locator('#selectionCardName')).toHaveText('독일');
  await expect(page.locator('#selectionCardFlagPreview img')).toBeVisible();
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  const flag = page.locator('#editorObjectHeader #flagMenuBtn');
  const focus = page.locator('#editorObjectHeader #focusSelectedObjectBtn');
  await expect(page.locator('#editorScrollBody #flagMenuBtn, #editorScrollBody #focusSelectedObjectBtn')).toHaveCount(0);
  await expect(focus.locator('use')).toHaveAttribute('href', '#icon-focus-target');
  await expect(focus).toHaveText('');
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(flag).toBeVisible();
      await expect(focus).toBeVisible();
      const flagBox = await flag.boundingBox();
      const headingBox = await page.locator('#editorObjectHeading').boundingBox();
      const focusBox = await focus.boundingBox();
      expect(flagBox.width).toBeCloseTo(56, 0);
      expect(flagBox.height).toBeCloseTo(48, 0);
      expect(focusBox.width).toBeCloseTo(width === 390 ? 40 : 36, 0);
      expect(focusBox.height).toBeCloseTo(focusBox.width, 0);
      expect(flagBox.x + flagBox.width).toBeLessThanOrEqual(headingBox.x);
      expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(focusBox.x);
      expect(Math.abs(flagBox.y + flagBox.height / 2 - focusBox.y - focusBox.height / 2)).toBeLessThan(1);
      await flag.hover();
      expect(await flag.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await flag.click();
      await expect(page.locator('#flagMenu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#flagMenu')).toBeHidden();
      await expect(flag).toBeFocused();
      await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath(`restored-editor-${width}-${theme}.png`) });
    }
    for (const tab of ['#actionsTabBtn', '#relationTabBtn', '#editorTabBtn']) {
      await page.locator(tab).click();
      await expect(flag).toBeVisible();
      await expect(focus).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const before = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState());
  await focus.click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState())).not.toEqual(before);
  await expect(page.locator('#propertyTitle')).toHaveText('독일');

  await page.locator('#createMenuBtn').click();
  await page.locator('#addEntityBtn').click();
  await selectUiOption(page, '#territorialCreateParentInput', 'DEU');
  const task = await page.locator('#modeEditingHud').evaluateHandle(node => node);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#modeTaskName')).toHaveText('객체 추가');
    await expect(page.locator('#modeTaskStage')).toHaveText('객체 정보');
    await expect(page.locator('#modeTaskStep')).toHaveText('1 / 3');
    await expect(page.locator('.mode-task-window-header #modeTaskTargetsFocusBtn')).toHaveCount(0);
    await expect(page.locator('.mode-task-window-header .ui-icon:visible')).toHaveCount(0);
    await expect(page.locator('#modeTaskTargetsFocusBtn')).toHaveCount(0);
    expect(await page.locator('#modeEditingHud').evaluate((node, original) => node === original, task)).toBe(true);
    await page.locator('#modeEditingHud').screenshot({ path: testInfo.outputPath(`text-header-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

for (const kind of ['general', 'regional']) test(`${kind} creation retains candidate validation, review back, real geometry and undo`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
    await page.locator('#createMenuBtn').click();
    await page.locator('#addEntityBtn').click();
    if (kind === 'general') await selectUiOption(page, '#territorialCreateParentInput', 'DEU');
    else await page.locator('#territorialCreateRegionalInput').check();
    const name = `v17 ${kind}`;
    await page.locator('#territorialCreateNameInput').fill(name);
    await page.locator('#modePrimaryBtn').click();
    await expect(page.locator('#modeTaskStep')).toHaveText('2 / 3');
    await page.locator('#modePolygonMethodInput').check();
    await expect(page.locator('#modePolygonMethodInput')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#modeDraftActions')).toBeVisible({ timeout: 60_000 });
    await page.locator('#flatBtn').evaluate(button => button.click());
    await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'flat', view: { ...host.getViewState(), flatCenter: [10, 50.5], flatZoom: 16 } });
      host.requestRepaint('workflow-create-test');
    });
    await drawCoordinates(page, [[9.6, 50.2], [10.4, 50.2], [10.4, 50.8], [9.6, 50.8], [9.6, 50.2]]);
    await expect(page.locator('g.draft-vertex')).not.toHaveCount(0);
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30_000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modeDraftDoneBtn')).toHaveAttribute('aria-label', '현재 영역 확정', { timeout: 60_000 });
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#territorySelectionStackList li')).toHaveCount(1);
    await page.locator('#modePrimaryBtn').click();
    await expect(page.locator('#modeTaskStage')).toHaveText('생성 확인');
    await expect(page.locator('#geometryPreviewSummary')).toContainText(name);
    await page.locator('#modeCancelBtn').click();
    await expect(page.locator('#territorySelectionStackList li')).toHaveCount(1);
    await page.locator('#modePrimaryBtn').click();
    await page.locator('#modePrimaryBtn').click();
    const created = await page.evaluate(({ kind, name }) => window.PANDOLAB_TERRITORIAL.list({ kind }).find(unit => unit.properties.name === name), { kind, name });
    expect(created.properties.entityKind).toBe(kind);
    expect(created.properties.parentId).toBe(kind === 'general' ? 'DEU' : '');
    expect(created?.geometry?.type).toMatch(/Polygon/);
    expect(created.geometry.coordinates.length).toBeGreaterThan(0);
    await page.locator('#undoBtn').click();
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), created.id)).toBeNull();
  expect(errors).toEqual([]);
});

test('subunit merge removes the exact middle target and preserves preview, apply and undo', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').evaluate(button => button.click());
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'v17-merge.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [[9, 50, 9.9, 50.15], [9, 50.15, 9.3, 50.45], [9.3, 50.15, 9.6, 50.45], [9.6, 50.15, 9.9, 50.45]]
      .map(([left, bottom, right, top], index) => ({ type: 'Feature', properties: { name: `병합 ${index}` },
        geometry: { type: 'Polygon', coordinates: [[[left, bottom], [left, top], [right, top], [right, bottom], [left, bottom]]] } })),
  })) });
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await selectUiOption(page, '#gisTargetType', 'general');
  await selectUiOption(page, '#gisParentUnit', 'DEU');
  for (const step of ['2/3', '3/3']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step);
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId).filter(unit => unit.properties.name.startsWith('병합 ')).length), { timeout: 60_000 }).toBe(4);
  const units = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId).filter(unit => unit.properties.name.startsWith('병합 ')).sort((a, b) => a.properties.name.localeCompare(b.properties.name)));
  if (await page.locator('#mobileFileBtn').getAttribute('aria-expanded') === 'true') await page.locator('#mobileFileBtn').click();
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), units[0].id);
  // GIS units can have no visible map label/card. Use the existing editor entry.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#entityProperties')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#actionsTabBtn')).toBeVisible();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#mergeEntityBtn').click();
  for (const target of units.slice(1)) {
    await page.locator('path.territorial-unit-shape').evaluateAll((nodes, id) => {
      const node = nodes.find(node => node.__data__.id === id);
      if (!node) throw new Error(`missing merge target ${id}`);
      node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
    }, target.id);
  }
  await expect(page.locator('#modeTaskResultsList li')).toHaveCount(3);
  await page.getByRole('button', { name: '병합 2 합병 대상에서 제외' }).click();
  await expect(page.locator('#modeTaskResultsList li')).toHaveCount(2);
  await expect(page.locator('#modeTaskResultsList')).not.toContainText('병합 2');
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('합병 확인', { timeout: 60_000 });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await page.locator('#confirmModalOkBtn').click();
  const after = await page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id)), units.map(unit => unit.id));
  expect(after[0].geometry).not.toEqual(units[0].geometry);
  expect(after[1]).toBeNull();
  expect(after[2].geometry).toEqual(units[2].geometry);
  expect(after[3]).toBeNull();
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(ids => ids.map(id => window.PANDOLAB_TERRITORIAL.get(id).geometry), units.map(unit => unit.id))).toEqual(units.map(unit => unit.geometry));
  expect(errors).toEqual([]);
});

test('territory setup uses actual role cards and the shared spacing', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  for (const placement of ['root', 'nested', 'regional']) {
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
    await page.locator('#createMenuBtn').click();
    await page.locator('#addEntityBtn').click();
    if (placement === 'nested') await selectUiOption(page, '#territorialCreateParentInput', 'DEU');
    else if (placement === 'regional') await page.locator('#territorialCreateRegionalInput').check();
    await expect(page.locator('#modeTaskName')).toHaveText('객체 추가');
    await expect(page.locator('#modeTaskStage')).toHaveText('객체 정보');
    await expect(page.locator('#modeTaskStep')).toHaveText('1 / 3');
    await expect(page.locator('#territorialCreateNameLabel')).toHaveText('이름');
    await expect(page.locator('#modeTaskStatus')).toBeHidden();
    if (placement === 'root') {
      await pickCountry(page, 'POL');
      await pickCountry(page, 'CZE');
      await expect(page.locator('#territorialCreateReferenceList')).toContainText('폴란드');
      await expect(page.locator('#territorialCreateReferenceList')).toContainText('체코');
    }
    if (placement === 'nested') {
      await expect(page.locator('#territorialCreateParentInput')).toHaveValue('DEU');
      await expect(page.locator('#territorialCreateParentInput')).toBeEnabled();
    }
    if (placement === 'regional') {
      await expect(page.locator('#territorialCreateParentInput')).toHaveValue('');
      await expect(page.locator('#territorialCreateParentInput')).toBeDisabled();
    }
    await captureLayouts(page, placement);
    await page.locator('#modeCancelBtn').click();
  }
  expect(errors).toEqual([]);
});

test('merge removal, boundary and coast use actual role cards and the shared spacing', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#mergeEntityBtn').click();
  await expect(page.locator('#modeTaskObjects [aria-label="남길 객체"]')).toContainText('독일');
  for (const id of ['POL', 'CZE', 'AUT']) await pickCountry(page, id);
  await expect(page.locator('#modeTaskResultsList li')).toHaveCount(3);
  await page.getByRole('button', { name: '체코 합병 대상에서 제외' }).click();
  await expect(page.locator('#modeTaskResultsList li')).toHaveCount(2);
  await expect(page.locator('#modeTaskResultsList')).toContainText('폴란드');
  await expect(page.locator('#modeTaskResultsList')).toContainText('오스트리아');
  await expect(page.locator('#modeTaskResultsList')).not.toContainText('체코');
  await captureLayouts(page, 'country-merge');
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('합병 확인', { timeout: 60_000 });
  await expect(page.locator('#geometryPreviewSummary')).toContainText('독일');
  await expect(page.locator('#modeTaskObjects')).toBeHidden();
  await expect(page.locator('#modeTaskResults')).toBeHidden();
  await captureLayouts(page, 'merge-review');
  await page.locator('#modeCancelBtn').click();
  await page.locator('#modeCancelBtn').click();
  for (const [button, role] of [['editEntityBorderBtn', '기준 객체'], ['editEntityCoastBtn', '대상 객체']]) {
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
    if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
    await page.locator('#actionsTabBtn').click();
    await page.locator('#' + button).click();
    await expect(page.locator(`#modeTaskObjects [aria-label="${role}"]`)).toContainText('독일');
    await expect(page.locator('#modeDraftActions')).toBeHidden();
    await captureLayouts(page, button);
    await page.locator('#modeCancelBtn').click();
  }
  expect(errors).toEqual([]);
});

test('hydro lists preserve add, undo and validation, and lake creation retains geometry and project undo', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  for (const [tool, title, label] of [['river', '강 그리기', '경로'], ['lake', '호수 그리기', '영역']]) {
    await page.locator('#createMenuBtn').click();
    await page.locator(tool === 'river' ? '#addRiverBtn' : '#addLakeBtn').click();
    await expect(page.locator('#modeTaskName')).toHaveText(title);
    await expect(page.locator('#modeTaskResultsSummary')).toContainText(label + ' 0개');
    await expect(page.locator('#modeDraftDeleteBtn')).toBeHidden();
    await draw(page, 0, tool === 'lake');
    const vertices = page.locator('g.draft-vertex');
    const vertexCount = await vertices.count();
    await vertices.nth(1).click();
    await expect(page.locator('#modeDraftDeleteBtn')).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(vertices).toHaveCount(vertexCount - 1);
    await page.locator('#undoBtn').click();
    await expect(vertices).toHaveCount(vertexCount);
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modeTaskResultsList li')).toHaveCount(1);
    await expect(page.locator('#multiDrawnAddBtn')).toBeEnabled();
    await page.locator('#multiDrawnAddBtn').click();
    await draw(page, 0.05, tool === 'lake');
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modeTaskResultsList li')).toHaveCount(2);
    await expect(page.locator('#multiDrawnUndoBtn')).toBeEnabled();
    await page.locator('#multiDrawnUndoBtn').click();
    await expect(page.locator('#modeTaskResultsList li')).toHaveCount(0);
    await draw(page, 0, tool === 'lake');
    await page.locator('#modeDraftDoneBtn').click();
    if (tool === 'river') {
      // Existing geometry validation rejects the line-only multi-draft preview.
      // UI-only work must expose that error and must not bypass it to create a river.
      await expect(page.locator('#modeTaskDisabledReason')).toBeVisible();
      await expect(page.locator('#modeTaskResultsSummary')).toContainText('검증 필요');
      await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
      await captureLayouts(page, tool);
      await page.locator('#modeCancelBtn').click();
      continue;
    }
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
    await expect(page.locator('#modeTaskResultsSummary')).not.toContainText('계산 중');
    await captureLayouts(page, tool);
    await page.locator('#modePrimaryBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#hydroProperties')).toBeVisible();
    const id = await page.locator('#hydroIdValue').textContent();
    expect(id?.trim()).toBeTruthy();
    const savedFeature = () => page.evaluate(async id => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('pandolab-editor', 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = database.transaction('projects', 'readonly').objectStore('projects').get('active-project');
          request.onsuccess = () => resolve(request.result?.hydroEdits?.find(feature => feature.id === id) || null);
          request.onerror = () => reject(request.error);
        });
      } finally { database.close(); }
    }, id.trim());
    await expect.poll(savedFeature, { timeout: 20_000 }).not.toBeNull();
    const created = await savedFeature();
    expect(created.geometry.type).toBe(tool === 'river' ? 'LineString' : 'Polygon');
    expect(created.geometry.coordinates.length).toBeGreaterThan(0);
    await page.locator('#undoBtn').click();
    await expect(page.locator('#hydroProperties')).toBeHidden();
    await expect.poll(savedFeature, { timeout: 20_000 }).toBeNull();
    await page.locator('#redoBtn').click();
    await expect.poll(savedFeature, { timeout: 20_000 }).toEqual(created);
  }
  expect(errors).toEqual([]);
});

test('free distribution shows real name and signed value and applies immediately without a review step', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await boot(page);
  await page.locator('#createMenuBtn').click();
  page.once('dialog', dialog => dialog.accept('분포 UI 검증'));
  await page.locator('#addDistributionBtn').click();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#distributionValueInput').fill('-4.25');
  await page.locator('#addGeometryDistributionBtn').click();
  await expect(page.locator('#modeTaskObjects')).toContainText('분포 UI 검증');
  await expect(page.locator('#modeTaskObjects')).toContainText('-4.25');
  await expect(page.locator('#modeTaskStep')).toHaveText('1 / 1');
  await expect(page.locator('#modeTaskResults')).toBeHidden();
  await captureLayouts(page, 'distribution');
  await draw(page, 0, true);
  await page.locator('#modeDraftDoneBtn').click();
  await expect(page.locator('#modeEditingHud')).toBeHidden();
  const result = await page.evaluate(() => {
    const layer = window.PANDOLAB_DISTRIBUTIONS.listLayers().find(layer => layer.name === '분포 UI 검증');
    return window.PANDOLAB_DISTRIBUTIONS.listEntries(layer.id);
  });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ mode: 'geometry', value: -4.25 });
  expect(result[0].geometry.type).toBe('Polygon');
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_DISTRIBUTIONS.listEntries(window.PANDOLAB_DISTRIBUTIONS.listLayers()[0].id).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('annex selection starts with the method segment without redundant normal-state text', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexEntityBtn').click();
  await expect(page.locator('#modeTaskStatus')).toBeHidden();
  const map = await page.locator('#map').boundingBox();
  const point = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor('POL')));
  await page.locator('#map .map-svg').dispatchEvent('click', { clientX: map.x + point[0], clientY: map.y + point[1], button: 0 });
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('영토 선택');
  await expect(page.locator('#modeMethodSwitch')).toBeVisible();
  await expect(page.locator('#modeTaskObjects')).toBeHidden();
  await expect(page.locator('[data-interaction-legend]')).toHaveCount(0);
  await expect(page.locator('#modeTaskDisabledReason')).toBeHidden();
  await expect(page.locator('#modeTaskInstruction')).toBeHidden();
  const bounds = await page.locator('#modeMethodSwitch').evaluate(element => ({
    top: element.getBoundingClientRect().top,
    bodyTop: element.closest('.mode-task-window-body').getBoundingClientRect().top,
    padding: parseFloat(getComputedStyle(element.closest('.mode-task-window-body')).paddingTop),
  }));
  expect(bounds.top - bounds.bodyTop).toBeCloseTo(bounds.padding, 0);
  await page.locator('#modeComponentsMethodInput').check();
  await expect(page.locator('#modeDraftActions')).toBeHidden();
  await expect(page.locator('#modeRiverBoundaryOption')).toBeVisible();
  await expect(page.locator('#territorySelectionStackSummary')).toHaveText('선택 영토 0개 · 0 km²');
  for (const layout of [{ width: 1440, height: 900 }, { width: 1024, height: 844 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(layout);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.locator('#modeTaskStep')).toHaveText('2 / 3');
      await expect(page.locator('#modeTaskStatus')).toBeHidden();
      await expect(page.locator('#editorSurface > .editor-view-tabs')).toBeHidden();
      const size = await page.locator('#modeMethodSwitch').evaluate(element => ({ width: element.clientWidth, contents: element.scrollWidth }));
      expect(size.contents).toBeLessThanOrEqual(size.width);
      await page.screenshot({ path: `node_modules/.cache/workflow-v17/captures/annex-${layout.width}-${theme}.png` });
    }
  }
  await page.locator('#mobileSearchBtn').click();
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  await expect(page.locator('#editorSurface')).toBeHidden();
  await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('영토 선택');
  expect(errors).toEqual([]);
});
