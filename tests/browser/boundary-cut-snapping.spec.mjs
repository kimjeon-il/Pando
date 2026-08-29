import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function importDrawing(page) {
  await page.locator('#gisFileInput').setInputFiles({
    name: 'boundary-snap-area.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'boundary-snap-area-corrected',
        properties: { name: '경계 스냅 실제 시험 영역' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[5, 5], [5, 25], [25, 25], [25, 5], [5, 5]]],
        },
      }],
    })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('2/5');
  await selectUiOption(page, '#gisTargetType', 'drawing');
  for (const step of ['3/5', '4/5', '5/5']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('path.drawing-shape')).toHaveCount(1);
}

test('a cut line with endpoints just inside the polygon snaps to both boundaries and splits', async ({ page }) => {
  test.setTimeout(360_000);
  const errors = await openApp(page);

  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  for (const [x, y] of [[0.42, 0.38], [0.48, 0.46], [0.55, 0.4]]) {
    await page.mouse.click(mapBox.x + mapBox.width * x, mapBox.y + mapBox.height * y);
  }
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

  await importDrawing(page);

  await page.getByRole('button', { name: '경계 스냅 실제 시험 영역', exact: true }).click();
  await expect(page.locator('#drawingProperties')).toBeVisible();
  const shape = page.locator('path.drawing-shape.selected');
  await page.locator('#actionsTabBtn').click();
  await page.locator('#splitDrawingBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();

  const box = await shape.boundingBox();
  expect(box).not.toBeNull();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, y + 8, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1);
  await expect(page.locator('.draft-snap-point')).toHaveCount(2);
  await expect(page.locator('.draft-split-preview')).toHaveCount(2);
  await expect(page.locator('g.draft-vertex')).toHaveCount(2);
  await expect(page.locator('#modeEditingHud')).toBeVisible();
  await expect(page.locator('#modeDraftRedrawBtn')).toBeVisible();
  await expect(page.locator('#modeDraftRemoveLastBtn')).toBeVisible();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeHidden();
  await expect(page.locator('#modeTaskInstruction')).toHaveClass(/cut-valid/);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();

  await page.locator('.draft-segment-hit').first().hover();
  await expect(page.locator('.draft-insert-handle')).toBeVisible();
  await page.locator('.draft-insert-handle').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(3);
  await expect(page.locator('#modeDraftRedrawBtn')).toBeHidden();
  await expect(page.locator('#modeDraftRemoveLastBtn')).toBeHidden();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeVisible();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeEnabled();
  const middleVertexBox = await page.locator('g.draft-vertex').nth(1).boundingBox();
  expect(middleVertexBox).not.toBeNull();
  await page.mouse.move(middleVertexBox.x + middleVertexBox.width / 2, middleVertexBox.y + middleVertexBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 24, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.draft-shape.cut-invalid')).toBeVisible();
  await expect(page.locator('.draft-issue-marker')).not.toHaveCount(0);
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await page.locator('#undoBtn').click();
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1);
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
  const afterNudge = await page.locator('g.draft-vertex').nth(1).getAttribute('transform');
  expect(afterNudge).not.toBe(beforeNudge);
  await expect(page.locator('.draft-shape.cut-valid')).toHaveCount(1);
  await expect(page.locator('.draft-split-preview')).toHaveCount(2);
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toContainText('변경 적용');
  await page.locator('#modePrimaryBtn').click();

  await expect(page.locator('path.drawing-shape')).toHaveCount(2);
  await expect(page.locator('#propertyTitle')).toHaveText('경계 스냅 실제 시험 영역 1');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await page.locator('#mobileCreateBtn').click();
  await page.locator('#addRiverBtn').click();
  const mobileMapBox = await page.locator('#map').boundingBox();
  expect(mobileMapBox).not.toBeNull();
  await page.mouse.click(mobileMapBox.x + mobileMapBox.width * 0.42, mobileMapBox.y + mobileMapBox.height * 0.42);
  await page.mouse.click(mobileMapBox.x + mobileMapBox.width * 0.62, mobileMapBox.y + mobileMapBox.height * 0.58);
  await expect(page.locator('g.draft-vertex')).toHaveCount(2);
  const touchHitBox = await page.locator('.draft-vertex-hit').first().boundingBox();
  expect(touchHitBox.width).toBeGreaterThanOrEqual(30);
  const modeBarBox = await page.locator('#modeActionBar').boundingBox();
  expect(modeBarBox.x).toBeGreaterThanOrEqual(0);
  expect(modeBarBox.x + modeBarBox.width).toBeLessThanOrEqual(390);
  const mobileButtons = await page.locator('#modeActionBar .mode-action-buttons > button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
  expect(Math.abs(mobileButtons[0] - mobileButtons[1])).toBeLessThanOrEqual(1);
  const mobileVertexBefore = await page.locator('g.draft-vertex').first().getAttribute('transform');
  await page.mouse.move(touchHitBox.x + touchHitBox.width / 2, touchHitBox.y + touchHitBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(touchHitBox.x + touchHitBox.width / 2 + 18, touchHitBox.y + touchHitBox.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  const mobileVertexAfter = await page.locator('g.draft-vertex').first().getAttribute('transform');
  expect(mobileVertexAfter).not.toBe(mobileVertexBefore);
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);
  expect(errors).toEqual([]);
});
