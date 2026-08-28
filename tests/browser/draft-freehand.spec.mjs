import { expect, test } from '@playwright/test';

async function openApp(page, viewport = { width: 1440, height: 900 }) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function drawMouseStroke(page, points) {
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 4 });
  await page.mouse.up();
}

test('freehand river becomes one editable draft history step', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();

  await drawMouseStroke(page, [
    [box.x + box.width * 0.38, box.y + box.height * 0.42],
    [box.x + box.width * 0.45, box.y + box.height * 0.48],
    [box.x + box.width * 0.53, box.y + box.height * 0.43],
    [box.x + box.width * 0.62, box.y + box.height * 0.52],
  ]);

  const vertices = page.locator('g.draft-vertex');
  expect(await vertices.count()).toBeGreaterThan(2);
  await expect(page.locator('.draft-raw-stroke')).toHaveCount(0);
  await expect(page.locator('#modeEditingHud')).toBeVisible();
  await expect(page.locator('#modeTaskInstruction')).toContainText('미세조정');
  await expect(page.locator('#undoBtn')).toBeEnabled();
  await expect(page.locator('#modeDraftRedrawBtn')).toBeEnabled();
  await expect(page.locator('#modeDraftRemoveLastBtn')).toBeVisible();
  await expect(page.locator('#modeDraftDeleteBtn')).toBeHidden();

  const countBeforeRedraw = await vertices.count();
  await page.locator('#modeDraftRedrawBtn').click();
  await expect(vertices).toHaveCount(0);
  await page.locator('#undoBtn').click();
  await expect(vertices).toHaveCount(countBeforeRedraw);
  await expect(page.locator('#modeDraftRedrawBtn')).toBeVisible();

  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('path.drawing-shape.selected')).toBeVisible();
  expect(errors).toEqual([]);
});

test('double click never completes a draft implicitly', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.44);
  await page.mouse.dblclick(box.x + box.width * 0.58, box.y + box.height * 0.52);

  await expect(page.locator('#modeEditingHud')).toBeVisible();
  await expect(page.locator('#modeTaskName')).toHaveText('강 추가');
  await expect(page.locator('path.drawing-shape.selected')).toHaveCount(0);
  expect(await page.locator('g.draft-vertex').count()).toBeGreaterThanOrEqual(2);
  await page.locator('#modeCancelBtn').click();
  expect(errors).toEqual([]);
});

test('mobile touch stroke draws, while a second touch cancels raw input for map gestures', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 390, height: 844 });
  await page.locator('#mobileCreateBtn').click();
  await page.locator('#addLakeBtn').click();
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  const points = [
    [box.x + box.width * 0.28, box.y + box.height * 0.32],
    [box.x + box.width * 0.68, box.y + box.height * 0.32],
    [box.x + box.width * 0.68, box.y + box.height * 0.62],
    [box.x + box.width * 0.28, box.y + box.height * 0.62],
    [box.x + box.width * 0.3, box.y + box.height * 0.34],
  ];

  await page.locator('#map svg.map-overlay-svg').evaluate((element, inputPoints) => {
    const BrowserPointerEvent = element.ownerDocument.defaultView.PointerEvent;
    const emit = (type, point, pointerId = 41) => element.dispatchEvent(new BrowserPointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: pointerId === 41,
      button: 0,
      clientX: point[0],
      clientY: point[1],
    }));
    emit('pointerdown', inputPoints[0]);
    for (const point of inputPoints.slice(1)) emit('pointermove', point);
    emit('pointerup', inputPoints.at(-1));
  }, points);

  expect(await page.locator('g.draft-vertex').count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#modeEditingHud')).toBeVisible();
  await page.locator('#modeDraftRedrawBtn').click();
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);

  await page.locator('#map svg.map-overlay-svg').evaluate((element, inputBox) => {
    const BrowserPointerEvent = element.ownerDocument.defaultView.PointerEvent;
    const event = (type, pointerId, x, y) => element.dispatchEvent(new BrowserPointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: pointerId === 51,
      button: 0,
      clientX: x,
      clientY: y,
    }));
    const x = inputBox.x + inputBox.width * 0.35;
    const y = inputBox.y + inputBox.height * 0.4;
    event('pointerdown', 51, x, y);
    event('pointermove', 51, x + 30, y + 20);
    event('pointerdown', 52, x + 80, y);
    event('pointermove', 52, x + 95, y + 18);
    event('pointerup', 52, x + 95, y + 18);
    event('pointerup', 51, x + 30, y + 20);
  }, box);

  await expect(page.locator('.draft-raw-stroke')).toHaveCount(0);
  await expect(page.locator('g.draft-vertex')).toHaveCount(0);
  expect(errors).toEqual([]);
});
