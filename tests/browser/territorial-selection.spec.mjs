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
  await expect(page.locator('#map .map-svg')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'canonical', { timeout: 90_000 });
  await page.locator('#basemapLabelsVisible').evaluate(input => {
    if (!input.checked) return;
    input.checked = false;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  return errors;
}

async function importTerritorialPolygon(page, { name, target, coordinates }) {
  await page.locator('#geoJsonFileInput').setInputFiles({
    name: `${name}.geojson`,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: `${target}-map-selection`,
        properties: { name },
        geometry: { type: 'Polygon', coordinates: [coordinates] },
      }],
    })),
  });
  await page.locator('#geoJsonTargetType').selectOption(target);
  await page.locator('#geoJsonTargetConfirmBtn').click();
  const shape = page.locator('path.country-region-shape');
  await expect.poll(async () => shape.evaluateAll((nodes, expectedName) => nodes.some(node => node.__data__?.properties?.name === expectedName), name)).toBe(true);
}

async function territorialShapeCenter(page, name) {
  return page.locator('path.country-region-shape').evaluateAll((nodes, expectedName) => {
    const shape = nodes.find(node => node.__data__?.properties?.name === expectedName);
    if (!shape) return null;
    const box = shape.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, name);
}

test('a region above a visible country remains clickable and does not block map dragging', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '지도 선택 시험 지역';
  await importTerritorialPolygon(page, {
    name,
    target: 'region',
    coordinates: [[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]],
  });

  const beforeDrag = await territorialShapeCenter(page, name);
  expect(beforeDrag).not.toBeNull();
  await page.mouse.move(beforeDrag.x, beforeDrag.y);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 48, beforeDrag.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await territorialShapeCenter(page, name))?.x).toBeGreaterThan(beforeDrag.x + 20);

  const afterDrag = await territorialShapeCenter(page, name);
  await page.mouse.click(afterDrag.x, afterDrag.y);
  await expect(page.locator('#selectionStatus')).toHaveText(`지역 · 독일 · ${name}`);
  await expect(page.locator('#regionProperties')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an administrative area above a visible country wins the physical map click', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '지도 선택 시험 행정구역';
  await importTerritorialPolygon(page, {
    name,
    target: 'administrative',
    coordinates: [[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]],
  });

  const point = await territorialShapeCenter(page, name);
  expect(point).not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#selectionStatus')).toHaveText(`행정구역 · 독일 · 1급 · ${name}`);
  await expect(page.locator('#administrativeProperties')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a mobile touch tap selects the territorial overlay above its country', async ({ browser }) => {
  test.setTimeout(180_000);
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const errors = await openApp(page, viewport);
    const name = '모바일 선택 시험 지역';
    await importTerritorialPolygon(page, {
      name,
      target: 'region',
      coordinates: [[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]],
    });

    const point = await territorialShapeCenter(page, name);
    expect(point).not.toBeNull();
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('#selectionStatus')).toHaveText(`지역 · 독일 · ${name}`);
    await expect(page.locator('#regionProperties')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
