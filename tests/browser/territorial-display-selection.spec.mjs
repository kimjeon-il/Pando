import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

test.use({ channel: 'chromium', trace: 'off', actionTimeout: 15000, viewport: { width: 1440, height: 900 } });

async function mapPixel(page, coordinate) {
  const point = await page.evaluate(value => window.__PANDOLAB_MAP_HOST__.project(value), coordinate);
  const box = await page.locator('#map').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  let data;
  try {
    ({ data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: {
      x: Math.round(box.x + point[0]), y: Math.round(box.y + point[1]), width: 1, height: 1, scale: 1,
    } }));
  } finally { await cdp.detach(); }
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, data);
}

for (const renderer of ['webgl2', 'canvas']) {
  test(`common entity display, independent regional fill, picking and undo in ${renderer}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
        appearance: { theme: 'light' }, selection: { outlineVisible: true, fillStrength: 0 } }));
      window.__workerErrors = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('error', event => window.__workerErrors.push(event.message));
        }
      };
    });
    await page.goto(`/?debug=1&renderer=${renderer}&demTerrain=raster`);
    await expect.poll(async () => {
      expect(errors).toEqual([]);
      const phase = await page.locator('#app').getAttribute('data-readiness');
      expect(phase).not.toBe('error');
      return phase;
    }, { timeout: 45000 }).toBe('enhanced');
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer))
      .toBe(renderer === 'canvas' ? 'canvas-worker' : renderer);
    await page.locator('#terrainNoneRadio').evaluate(input => input.click());
    await page.locator('#flatBtn').evaluate(input => input.click());
    await page.addStyleTag({ content: '#map text { visibility: hidden !important; } #map .territorial-label-item { pointer-events: none !important; }' });
    const before = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL'));
    await page.evaluate(() => {
      window.PANDOLAB_TERRITORIAL.setColor('IRL', '#ff0000');
      window.PANDOLAB_TERRITORIAL.select('IRL');
    });
    if (renderer === 'canvas') {
      await expect(page.locator('.map-selection-outline.is-primary')).toHaveAttribute('data-selection-fallback-key', 'territorial:entity:IRL');
    }
    const interior = [-8, 53];
    await expect.poll(() => mapPixel(page, interior), { timeout: renderer === 'canvas' ? 20000 : 8000 }).toEqual([255, 0, 0]);
    await page.locator('#relationTabBtn').click();
    await page.locator('#entityChangeParentBtn').click();
    await selectUiOption(page, '#entityParentInput', 'GBR');
    await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('GBR');
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
    await expect.poll(() => page.locator('path.territorial-unit-shape').evaluateAll(nodes =>
      nodes.filter(node => node.__data__.id === 'IRL').map(node => node.dataset.gpuSceneKey)))
      .toContain('territorial:entity:IRL:fill');
    if (renderer === 'webgl2') {
      await expect.poll(() => page.evaluate(() =>
        window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []))
        .toContain('territorial:entity:IRL');
    }
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('');
    await page.locator('#redoBtn').click();
    await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').properties.parentId)).toBe('GBR');
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.setColor('IRL', ''));
    await expect.poll(() => mapPixel(page, interior), { timeout: renderer === 'canvas' ? 20000 : 8000 }).toEqual([204, 204, 204]);
    await page.evaluate(() => { window.PANDOLAB_TERRITORIAL.setColor('IRL', '#ff0000'); window.PANDOLAB_TERRITORIAL.select('IRL'); });
    await expect.poll(() => mapPixel(page, interior), { timeout: renderer === 'canvas' ? 20000 : 8000 }).toEqual([255, 0, 0]);
    await page.locator('#actionsTabBtn').click();
    await page.locator('#copyEntityRegionBtn').click();
    let regionId;
    await expect.poll(async () => {
      regionId = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'regional' })
        .find(entity => entity.properties.name.includes('아일랜드'))?.id);
      return !!regionId;
    }).toBe(true);
    const region = await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), regionId);
    expect(region.id).not.toBe('IRL');
    expect(region.properties.parentId).toBe('');
    expect(region.geometry).toEqual(before.geometry);
    await page.evaluate(id => window.PANDOLAB_TERRITORIAL.setColor(id, '#0000ff'), regionId);
    await page.locator('[data-layer-style-opacity="regions"]').evaluate(input => {
      input.value = '50'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await expect.poll(async () => {
      const pixel = await mapPixel(page, interior);
      return pixel.every((channel, index) => Math.abs(channel - [128, 0, 128][index]) <= 1);
    }).toBe(true);
    const clickInterior = async () => {
      const point = await page.evaluate(value => window.__PANDOLAB_MAP_HOST__.project(value), interior);
      const box = await page.locator('#map').boundingBox();
      await page.mouse.move(box.x + point[0], box.y + point[1]);
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().adaptiveRenderQuality.phase)).toBe('settle');
      await page.mouse.click(box.x + point[0], box.y + point[1]);
    };
    await clickInterior();
    await expect(page.locator('#objectChooser')).toBeVisible();
    await expect.poll(() => page.locator('#objectChooserList [role="option"]').first().getAttribute('aria-selected')).toBe('true');
    await page.keyboard.press('Escape');
    await page.locator('#regionsVisible').evaluate(input => input.click());
    await expect.poll(() => mapPixel(page, interior), { timeout: renderer === 'canvas' ? 20000 : 8000 }).toEqual([255, 0, 0]);
    await clickInterior();
    await expect(page.locator('#objectChooser')).toBeHidden();
    await expect(page.locator('#statusSelection')).toContainText('아일랜드');
    await page.locator('#subunitsVisible').evaluate(input => input.click());
    await clickInterior();
    await expect(page.locator('#statusSelection')).toHaveText('');
    await page.locator('#subunitsVisible').evaluate(input => input.click());
    await page.locator('#regionsVisible').evaluate(input => input.click());
    await page.locator('#undoBtn').click(); // Region color.
    await page.locator('#undoBtn').click(); // Copy, leaving the general object unchanged.
    expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id), regionId)).toBeNull();
    expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
    await expect.poll(() => mapPixel(page, interior), { timeout: renderer === 'canvas' ? 20000 : 8000 }).toEqual([255, 0, 0]);
    expect(await page.evaluate(() => window.__workerErrors)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
