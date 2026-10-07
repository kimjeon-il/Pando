import { expect, test } from '@playwright/test';
import { installCanvasTransportDiagnostics, instrumentCanvasTransportSource, logMapDiagnostic, withMapDiagnostics } from './helpers/map-diagnostics.mjs';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 8_000, launchOptions: {
  args: ['--disable-gpu', '--enable-unsafe-swiftshader'],
} });

const pixelSamples = new WeakMap();
const diagnosticStages = new WeakMap();
const diagnosticErrors = new WeakMap();
const cachedColorFacts = page => ({ stage: diagnosticStages.get(page) || 'before-startup',
  lastPixelSample: pixelSamples.get(page) || null, errors: (diagnosticErrors.get(page) || []).slice(-8) });

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  // Emit cached evidence first: even a stalled/closed page cannot lose the last
  // failed sample or stage, and failure collection must never resample pixels.
  await logMapDiagnostic(testInfo.title, 'failed-case-cached', () => cachedColorFacts(page));
  await logMapDiagnostic(testInfo.title, 'failed-case', () => colorDiagnostics(page));
});

async function colorDiagnostics(page) {
  const data = await page.evaluate(() => {
    const snapshot = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
    const country = window.PANDOLAB_TERRITORIAL.get('TUR');
    const trigger = document.querySelector('#entityColorTrigger');
    const picker = document.querySelector('[data-color-picker="entity"]');
    const canvas = document.querySelector('.gpu-map-canvas');
    return {
      at: performance.now(),
      model: { id: country?.id, properties: pick(country?.properties, ['style', 'locked', 'entityKind', 'parentId']) },
      control: { value: document.querySelector('#entityColorInput')?.value,
        label: document.querySelector('#entityColorValue')?.textContent, disabled: trigger?.disabled,
        expanded: trigger?.getAttribute('aria-expanded'), colorValue: picker?.dataset.colorValue,
        colorIsDefault: picker?.dataset.colorIsDefault,
        redPressed: document.querySelector('#entityColorPopover [data-color-value="#ef4444"]')?.getAttribute('aria-pressed') },
      status: { action: document.querySelector('#statusAction')?.textContent,
        selection: document.querySelector('#statusSelection')?.textContent },
      gpu: pick(snapshot.gpu, ['renderer', 'projectGeneration', 'projectRenderBlocked', 'canvasStyleRevision',
        'canvasDisplayedStyleRevision', 'canvasWorkerBusy', 'canvasWorkerHasPendingFrame', 'canvasWorkerStaleFrameCount',
        'canvasWorkerMessagesByType', 'canvasWorkerViewMessageCount', 'canvasWorkerStateMessageCount', 'requestedRevision',
        'displayedRevision', 'committedGeometryRevision', 'displayedGeometryRevision', 'renderSceneRevision', 'paletteDirty', 'countryEmphasis']),
      rendering: pick(snapshot.rendering, ['invalidations', 'lastReason', 'lastReasons', 'pendingMask', 'frameQueued',
        'lastPreparedVisualFrameId', 'lastCommittedVisualFrameId', 'visualFrameRejectedCount']),
      recentFrames: snapshot.rendering.recentFrames?.slice(-4), mapHost: snapshot.mapHost,
      canvas: canvas && { width: canvas.width, height: canvas.height, rect: canvas.getBoundingClientRect().toJSON(),
        frameId: canvas.getAttribute('data-visual-frame-id'), viewRevision: canvas.getAttribute('data-view-revision'),
        projectionRevision: canvas.getAttribute('data-projection-revision') },
      transport: window.__canvasTransportProbe || null,
      unavailable: ['renderer acceptFrame internal reason when the observed transport decision is false'],
    };
  });
  return { ...data, ...cachedColorFacts(page) };
}

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
  const mask = await page.addStyleTag({ content: '#mapDisplaySurface { visibility: hidden !important; }' });
  let png;
  try {
    png = await capture(page, { x: Math.round(box.x + point[0]),
      y: Math.round(box.y + point[1]), width: 1, height: 1 });
  } finally { await mask.evaluate(node => node.remove()); }
  const value = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, png.toString('base64'));
  pixelSamples.set(page, { stage: diagnosticStages.get(page), sampledAt: Date.now(), coordinate: [32, 39], point, mapRect: box, value });
  return value;
}

async function openMap(page, renderer) {
    const errors = [];
    diagnosticErrors.set(page, errors);
    diagnosticStages.set(page, 'startup');
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (renderer === 'canvas') {
      await page.addInitScript(installCanvasTransportDiagnostics);
      await page.route('**/modules/gpu-canvas-worker.js*', async route => {
        const response = await route.fetch();
        const original = (await response.text()).replace(/\r\n/g, '\n');
        await route.fulfill({ response, body: instrumentCanvasTransportSource(original) });
      });
    }
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
    diagnosticStages.set(page, 'renderer-readiness');
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer))
      .toBe(renderer === 'canvas' ? 'canvas-worker' : renderer);
    if (renderer === 'canvas') await page.locator('#flatBtn').evaluate(button => button.click());
    await page.addStyleTag({ content: '#map text, #map .map-label, #map .country-label { visibility: hidden !important; }' });
    diagnosticStages.set(page, 'initial-selection');
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('TUR'));
    return errors;
}

async function changeMode(page, mode) {
  diagnosticStages.set(page, `terrain-${mode.toLowerCase()}`);
  await page.locator(`#terrain${mode}Radio`).evaluate(input => input.click());
  await page.mouse.move(20, 20);
}

for (const renderer of ['webgl2', 'canvas', 'webgl1']) {
  test.describe(renderer, () => {
  test(`intrinsic country colors override map substrate and reset restores them in ${renderer}`, async ({ page }) => {
    const errors = await openMap(page, renderer);
    await changeMode(page, 'None');
    diagnosticStages.set(page, 'initial-default');
    await expect(page.locator('#entityColorInput')).toHaveValue('#c7e9b4');
    await expect.poll(() => pixel(page), { timeout: renderer === 'canvas' ? 30_000 : 8_000 }).toEqual([199, 233, 180]);
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('TUR').properties.style)).toEqual({});
    const mapPixel = () => pixel(page);
    diagnosticStages.set(page, 'red-color');
    await withMapDiagnostics(`country-red-color:${renderer}`, () => colorDiagnostics(page), async () => {
      await page.locator('#entityColorTrigger').evaluate(input => input.click());
      await page.locator('#entityColorPopover [data-color-value="#ef4444"]').evaluate(input => input.click());
      await logMapDiagnostic(`country-red-color:${renderer}`, 'after-color-click', () => colorDiagnostics(page));
      await expect.poll(mapPixel).toEqual([239, 68, 68]);
    });
    if (renderer === 'webgl2') {
      diagnosticStages.set(page, 'layer-color-off');
      await page.locator('#mapDisplayBtn').click();
      await page.locator('[data-map-display-row="general"]').click();
      await page.locator('[data-map-display-row="countries"]').click();
      const toggle = page.locator('[data-layer-style-color="countries"]');
      await toggle.locator('..').click();
      await expect(toggle).not.toBeChecked();
      await expect.poll(mapPixel).toEqual([204, 204, 204]);
      diagnosticStages.set(page, 'layer-color-on');
      await toggle.locator('..').click();
      await expect(toggle).toBeChecked();
      await expect.poll(mapPixel).toEqual([239, 68, 68]);
      await page.locator('[data-map-display-row="countries"]').focus();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    diagnosticStages.set(page, 'reset-to-default');
    await page.locator('#entityColorTrigger').evaluate(input => input.click());
    await page.locator('#entityColorPopover [data-color-default]').evaluate(input => input.click());
    await expect(page.locator('#entityColorValue')).toHaveText('기본 색상');
    await expect(page.locator('#entityColorInput')).toHaveValue('#c7e9b4');
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('TUR').properties.style)).toEqual({});
    await expect.poll(mapPixel).toEqual([199, 233, 180]);
    if (renderer === 'webgl2') {
      diagnosticStages.set(page, 'map-selection');
      await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('FRA'));
      const point = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.project([32, 39]));
      const box = await page.locator('#map').boundingBox();
      await page.mouse.click(box.x + point[0], box.y + point[1]);
      await expect(page.locator('#statusSelection')).toContainText('튀르키예');
    }
    diagnosticStages.set(page, 'undo-color-reset');
    await page.locator('#undoBtn').click();
    await expect.poll(mapPixel).toEqual([239, 68, 68]);
    diagnosticStages.set(page, 'redo-color-reset');
    await page.locator('#redoBtn').click();
    await expect.poll(mapPixel).toEqual([199, 233, 180]);
    expect(errors).toEqual([]);
  });

  // Terrain loading is a separate responsibility; retain its own regression.
  if (renderer !== 'webgl1') test(`unpainted terrain retains color and monochrome modes in ${renderer}`, async ({ page }) => {
      const errors = await openMap(page, renderer);
      // Without country paint, terrain retains its own color/monochrome base.
      diagnosticStages.set(page, 'terrain-country-fill-off');
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
