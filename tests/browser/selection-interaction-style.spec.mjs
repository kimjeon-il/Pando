import { expect, test } from '@playwright/test';

const storedPreferences = (theme = 'dark', selection = {}) => ({
  version: 2,
  appearance: { theme },
  labels: {
    country: { font: 'default', color: null },
    place: { font: 'default', color: null, pointColor: null },
  },
  selection: { color: null, outlineVisible: true, fillStrength: 0.35, ...selection },
});

async function openApp(page, {
  theme = 'dark', selection = {}, query = '?debug=1', disableWebGl = false,
  preserveSelectionBuffer = false, selectionWebGl1 = false,
} = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(({ preferences, disableWebGl: blockWebGl, preserveSelectionBuffer: preserve, selectionWebGl1: forceWebGl1 }) => {
    localStorage.setItem('pandolab-user-preferences', JSON.stringify(preferences));
    const originalGetContext = globalThis.HTMLCanvasElement.prototype.getContext;
    globalThis.HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (blockWebGl && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) return null;
      const isMapCanvas = this.classList?.contains('gpu-map-canvas');
      if (isMapCanvas && forceWebGl1 && type === 'webgl2') return null;
      if (isMapCanvas && preserve && (type === 'webgl' || type === 'webgl2')) {
        return originalGetContext.call(this, type, { ...(args[0] || {}), preserveDrawingBuffer: true });
      }
      return originalGetContext.call(this, type, ...args);
    };
  }, {
    preferences: storedPreferences(theme, selection), disableWebGl,
    preserveSelectionBuffer, selectionWebGl1,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/${query}`);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function selectionColorPixelCount(page, expected = [205, 169, 93]) {
  return page.evaluate(([red, green, blue]) => {
    const canvas = document.querySelector('.gpu-map-canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!gl) return -1;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 0 && Math.abs(pixels[offset] - red) <= 8
        && Math.abs(pixels[offset + 1] - green) <= 8 && Math.abs(pixels[offset + 2] - blue) <= 8) count += 1;
    }
    return count;
  }, expected);
}

test('theme defaults, custom selection colors, and reset stay synchronized', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);

  const initialStyle = await page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__);
  expect(initialStyle).toMatchObject({
    theme: 'dark',
    hover: { color: '#d7ba7d', fillAlpha: 0.05775 },
    selection: { color: '#cda95d' },
  });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--map-selection-halo').trim())).toBe('#cda95d');

  await page.evaluate(() => document.querySelector('#preferencesBtn').click());
  await expect(page.locator('#preferencesModal')).toBeVisible();
  await expect(page.locator('#preferencesSelectionColorValue')).toHaveText('기본 색상');
  await expect(page.locator('#preferencesSelectionColorInput')).toHaveValue('#cda95d');

  await page.locator('#preferencesThemeInput').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__)).toMatchObject({
    theme: 'light',
    hover: { color: '#5a7eb1', fillAlpha: 0.05 },
    selection: { color: '#315e9d' },
  });
  await expect(page.locator('#preferencesSelectionColorInput')).toHaveValue('#315e9d');

  await page.locator('#preferencesSelectionColorTrigger').click();
  await page.locator('#preferencesSelectionColorPopover [data-color-value="#8b5cf6"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__)).toMatchObject({
    hover: { color: '#a27df8' },
    selection: { color: '#8b5cf6' },
  });
  await page.locator('#preferencesThemeInput').selectOption('dark');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__)).toMatchObject({
    theme: 'dark',
    hover: { color: '#a27df8' },
    selection: { color: '#8b5cf6' },
  });

  await page.locator('#preferencesSelectionColorTrigger').click();
  await page.locator('#preferencesSelectionColorPopover [data-color-default]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences')).selection.color)).toBeNull();
  await expect(page.locator('#preferencesSelectionColorValue')).toHaveText('기본 색상');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__)).toMatchObject({
    hover: { color: '#d7ba7d' },
    selection: { color: '#cda95d' },
  });
  expect(errors).toEqual([]);
});

test('WebGL1 keeps successful country outlines on the GPU coverage path', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, {
    query: '?debug=1&renderer=webgl1', preserveSelectionBuffer: true, selectionWebGl1: true,
  });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer), { timeout: 30_000 }).toBe('webgl1');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.canonicalMeshReady), { timeout: 60_000 }).toBe(true);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []), { timeout: 20_000 }).toContain('country:DEU');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.selfTestPassed)).toBe(true);
  await expect.poll(() => selectionColorPixelCount(page)).toBeGreaterThan(0);
  await expect(page.locator('.selection-overlay-layer .map-selection-casing')).toHaveCount(0);
  await expect(page.locator('.selection-overlay-layer .map-selection-outline')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('WebGL2 country selection produces real outline pixels before suppressing SVG fallback', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { preserveSelectionBuffer: true });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.gpuHealth), { timeout: 30_000 }).toBe('healthy');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []), { timeout: 20_000 }).toContain('country:DEU');
  await expect.poll(() => selectionColorPixelCount(page)).toBeGreaterThan(0);
  await expect(page.locator('.selection-overlay-layer .map-selection-casing')).toHaveCount(0);
  await expect(page.locator('.selection-overlay-layer .map-selection-outline')).toHaveCount(0);
  const selfTestCount = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.selfTestCount);
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.selfTestCount)).toBe(selfTestCount);
  expect(errors).toEqual([]);
});

test('renderer fallback draws selection casing and inner outline in SVG', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { query: '?debug=1&renderer=canvas', disableWebGl: true });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.svgFallbackKeys || [])).toContain('country:DEU');
  const casing = page.locator('.selection-overlay-layer .map-selection-casing.is-primary');
  const outline = page.locator('.selection-overlay-layer .map-selection-outline.is-primary');
  await expect(casing).toHaveCount(1);
  await expect(outline).toHaveCount(1);
  await expect(casing).toHaveAttribute('stroke', '#f2f4f6');
  await expect(casing).toHaveAttribute('stroke-width', '4');
  await expect(outline).toHaveAttribute('stroke', '#cda95d');
  await expect(outline).toHaveAttribute('stroke-width', '2.5');
  for (const [button, projection] of [['#flatBtn', 'flat'], ['#globeBtn', 'globe']]) {
    await page.evaluate(selector => document.querySelector(selector).click(), button);
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_STATE__?.projection)).toBe(projection);
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.svgFallbackKeys || [])).toContain('country:DEU');
    await expect(casing).toHaveCount(1);
    await expect(outline).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test('shared WebGL context loss keeps a sparse SVG fallback until the single GPU context recovers', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []), { timeout: 30_000 }).toContain('country:DEU');

  const extensionAvailable = await page.evaluate(() => {
    const canvas = document.querySelector('.gpu-map-canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    window.__PANDOLAB_SELECTION_CONTEXT_EXTENSION__ = gl?.getExtension('WEBGL_lose_context') || null;
    window.__PANDOLAB_SELECTION_CONTEXT_EXTENSION__?.loseContext();
    return !!window.__PANDOLAB_SELECTION_CONTEXT_EXTENSION__;
  });
  test.skip(!extensionAvailable, 'WEBGL_lose_context is unavailable');

  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.contextLost), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.svgFallbackKeys || [])).toContain('country:DEU');
  await page.evaluate(() => window.__PANDOLAB_SELECTION_CONTEXT_EXTENSION__?.restoreContext());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.contextLost), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []), { timeout: 30_000 }).toContain('country:DEU');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.svgFallbackKeys || [])).toEqual([]);
  expect(errors).toEqual([]);
});
