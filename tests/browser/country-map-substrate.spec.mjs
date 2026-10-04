import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 8_000, launchOptions: {
  args: ['--disable-gpu', '--enable-unsafe-swiftshader'],
} });

async function capture(page, clip = null) {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', { format: 'png',
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    return Buffer.from(data, 'base64');
  } finally { await session.detach(); }
}

async function pixel(page) {
  const point = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.project([32, 39]));
  const box = await page.locator('#map').boundingBox();
  // Measure map color even when the nested display menu covers the sample point.
  const mask = await page.addStyleTag({ content: '#selectionToolbar, #mapDisplaySurface { visibility: hidden !important; }' });
  let png;
  try {
    png = await capture(page, { x: Math.round(box.x + point[0]),
      y: Math.round(box.y + point[1]), width: 1, height: 1 });
  } finally { await mask.evaluate(node => node.remove()); }
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, png.toString('base64'));
}

async function openMap(page, renderer) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({
      version: 2, appearance: { theme: 'light' }, selection: { outlineVisible: false, fillStrength: 0 },
    })));
    await page.goto(`/?debug=1&renderer=${renderer}`);
    try {
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', /editable|enhanced/, { timeout: 45_000 });
    } catch (error) {
      // Do not evaluate the page again when its main thread may be unresponsive.
      await test.info().attach('startup-diagnostics', { body: JSON.stringify({ errors }, null, 2), contentType: 'application/json' });
      throw error;
    }
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer))
      .toBe(renderer === 'canvas' ? 'canvas-worker' : renderer);
    if (renderer === 'canvas') await page.locator('#flatBtn').evaluate(button => button.click());
    await page.addStyleTag({ content: '#map text, #map .map-label, #map .country-label { visibility: hidden !important; }' });
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('TUR'));
    return errors;
}

async function changeMode(page, mode) {
  await page.locator(`#terrain${mode}Radio`).evaluate(input => input.click());
  await page.mouse.move(20, 20);
}

for (const renderer of ['webgl2', 'canvas', 'webgl1']) {
  test.describe(renderer, () => {
  test(`intrinsic country colors override map substrate and reset restores them in ${renderer}`, async ({ page }) => {
    const errors = await openMap(page, renderer);
    await changeMode(page, 'None');
    await expect(page.locator('#entityColorInput')).toHaveValue('#c7e9b4');
    await expect.poll(() => pixel(page), { timeout: renderer === 'canvas' ? 30_000 : 8_000 }).toEqual([199, 233, 180]);
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('TUR').properties.style)).toEqual({});
    await page.locator('#entityColorTrigger').evaluate(input => input.click());
    await page.locator('#entityColorPopover [data-color-value="#ef4444"]').evaluate(input => input.click());
    const mapPixel = () => pixel(page);
    await expect.poll(mapPixel).toEqual([239, 68, 68]);
    if (renderer === 'webgl2') {
      await page.locator('#mapDisplayBtn').click();
      await page.locator('[data-map-display-row="general"]').click();
      await page.locator('[data-map-display-row="countries"]').click();
      const toggle = page.locator('[data-layer-style-color="countries"]');
      await toggle.locator('..').click();
      await expect(toggle).not.toBeChecked();
      await expect.poll(mapPixel).toEqual([204, 204, 204]);
      await toggle.locator('..').click();
      await expect(toggle).toBeChecked();
      await expect.poll(mapPixel).toEqual([239, 68, 68]);
      await page.locator('[data-map-display-row="countries"]').focus();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    await page.locator('#entityColorTrigger').evaluate(input => input.click());
    await page.locator('#entityColorPopover [data-color-default]').evaluate(input => input.click());
    await expect(page.locator('#entityColorValue')).toHaveText('기본 색상');
    await expect(page.locator('#entityColorInput')).toHaveValue('#c7e9b4');
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('TUR').properties.style)).toEqual({});
    await expect.poll(mapPixel).toEqual([199, 233, 180]);
    if (renderer === 'webgl2') {
      await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('FRA'));
      const point = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.project([32, 39]));
      const box = await page.locator('#map').boundingBox();
      const mask = await page.addStyleTag({ content: '#selectionToolbar { visibility: hidden !important; }' });
      try { await page.mouse.click(box.x + point[0], box.y + point[1]); } finally { await mask.evaluate(node => node.remove()); }
      await expect(page.locator('#statusSelection')).toContainText('튀르키예');
    }
    await page.locator('#undoBtn').click();
    await expect.poll(mapPixel).toEqual([239, 68, 68]);
    await page.locator('#redoBtn').click();
    await expect.poll(mapPixel).toEqual([199, 233, 180]);
    expect(errors).toEqual([]);
  });

  // Terrain loading is a separate responsibility; retain its own regression.
  if (renderer !== 'webgl1') test(`unpainted terrain retains color and monochrome modes in ${renderer}`, async ({ page }) => {
      const errors = await openMap(page, renderer);
      // Without country paint, terrain retains its own color/monochrome base.
      await page.locator('#mapDisplayBtn').click();
      await page.locator('[data-map-display-row="general"]').click();
      await page.locator('[data-map-display-row="countries"]').click();
      const toggle = page.locator('[data-layer-style-color="countries"]');
      await toggle.locator('..').click();
      await expect(toggle).not.toBeChecked();
      await page.locator('[data-map-display-row="countries"]').focus();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await changeMode(page, 'None');
      await expect.poll(() => pixel(page)).toEqual([204, 204, 204]);
      await changeMode(page, 'Physical');
      await expect.poll(async () => {
        const [r, g, b] = await pixel(page); return Math.max(r, g, b) - Math.min(r, g, b);
      }, { timeout: 60_000 }).toBeGreaterThan(15);
      await changeMode(page, 'Political');
      await expect.poll(async () => {
        const [r, g, b] = await pixel(page); return Math.max(r, g, b) - Math.min(r, g, b);
      }, { timeout: 30_000 }).toBeLessThan(4);
      expect(errors).toEqual([]);
  });
  });
}
