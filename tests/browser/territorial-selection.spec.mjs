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
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#basemapLabelsVisible').evaluate(input => {
    if (!input.checked) return;
    input.checked = false;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  return errors;
}

async function importTerritorialPolygon(page, { name, target, coordinates }) {
  await page.locator('#gisFileInput').setInputFiles({
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
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('2/5');
  await page.locator('#gisTargetType').evaluate((select, value) => {
    select.value = value;
    select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
  }, target);
  await page.locator('#gisTargetCountry').evaluate(select => {
    const germany = [...select.options].find(option => option.textContent?.includes('독일'));
    if (!germany) throw new Error('독일 소속 국가 옵션을 찾지 못했습니다.');
    select.value = germany.value;
    select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  for (const step of ['3/5', '4/5', '5/5']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  const shape = page.locator('path.country-region-shape');
  await expect.poll(
    async () => shape.evaluateAll((nodes, expectedName) => nodes.some(node => node.__data__?.properties?.name === expectedName), name),
    { timeout: 60_000 },
  ).toBe(true);
}

async function territorialShapeCenter(page, name) {
  return page.locator('path.country-region-shape').evaluateAll((nodes, expectedName) => {
    const shape = nodes.find(node => node.__data__?.properties?.name === expectedName);
    if (!shape) return null;
    const box = shape.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, name);
}

async function chooseTerritorialObject(page, point, name, { touch = false } = {}) {
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  const chooser = page.locator('#objectChooser');
  await expect(chooser).toBeVisible();
  const option = chooser.getByRole('option').filter({ hasText: name });
  await expect(option).toHaveCount(1);
  if (touch) await option.tap();
  else await option.click();
  await expect(chooser).toBeHidden();
}

test('a region above a visible country opens the chooser and does not block map dragging', async ({ page }) => {
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
  await chooseTerritorialObject(page, afterDrag, name);
  await expect(page.locator('#selectionStatus')).toContainText(`권역 · 독일 · ${name}`);
  await expect(page.locator('#regionProperties')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an administrative area above a visible country is chosen explicitly', async ({ page }) => {
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
  await chooseTerritorialObject(page, point, name);
  await expect(page.locator('#selectionStatus')).toContainText(`행정구역 · 독일 · 1급 · ${name}`);
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
    await chooseTerritorialObject(page, point, name, { touch: true });
    await expect(page.locator('#selectionStatus')).toContainText(`권역 · 독일 · ${name}`);
    await expect(page.locator('#regionProperties')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
