import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { setViewingProjection, closeViewingDisplay } from './helpers/viewing-display.mjs';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

for (const renderer of ['webgl2', 'canvas']) for (const mode of ['political', 'physical']) {
  test(`child land enters the viewport and survives paint toggles (${renderer}, ${mode})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ renderer, mode }) => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
        backgrounds: { viewer: { terrainVisible: true, terrainStyle: mode } } }));
      if (renderer === 'canvas') {
        const original = window.HTMLCanvasElement.prototype.getContext;
        window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return String(type).includes('webgl') ? null : original.call(this, type, ...args);
        };
      }
    }, { renderer, mode });
    await page.route('**/modules/map-renderer-composition.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'export function createMapRenderer(dependencies) {';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor, anchor + '\nwindow.__terrainPorts = dependencies;') });
    });
    await page.route('**/modules/gpu-scene.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor,
        anchor + '\nif(domain === "territorial-units") window.__terrainPackets = polygons;') });
    });
    await page.goto(`/?debug=1&renderer=${renderer}`);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().renderer))
      .toBe(renderer === 'canvas' ? 'canvas-worker' : 'webgl2');
    const documentBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
    await setViewingProjection(page, 'flat');
    await closeViewingDisplay(page);
    const childId = await page.evaluate(() => window.__terrainPorts.territorialModel.entityRepository.list()
      .find(entity => entity.properties.metadata?.builtinSubunit?.sourceCountryId === 'HKG').id);
    const childKey = `territorial:entity:${childId}:fill`;
    const hasChild = () => page.evaluate(key => window.__terrainPackets.some(packet => packet.key === key), childKey);
    // Prepare a known offscreen set, then use real pointer navigation to enter it.
    await page.evaluate(async () => {
      const ports = window.__terrainPorts, state = ports.projectState.state;
      window.__PANDOLAB_MAP_HOST__.setViewState({ projection: 'flat',
        view: { ...state.view, flatCenter: [101, 22.27], flatZoom: 32 } });
      ports.domains.renderingDomain.invalidateOverlayStyle('offscreen-test-fixture');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(await hasChild()).toBe(false);
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width * .92, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .08, box.y + box.height * .5, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#map')).not.toHaveClass(/dragging/);
    await expect.poll(hasChild, { timeout: 5000 }).toBe(true);
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="objects"]').click();
    const color = page.locator('[data-layer-style-color="objects"]');
    await expect(color).toBeChecked();
    const replacements = () => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().canvasWorkerMessagesByType['replace-data'] || 0);
    const replacementsBefore = await replacements();
    const receipts = [];
    for (const visible of [false, true]) {
      await color.locator('..').click();
      await expect(color).toBeChecked({ checked: visible });
      await expect.poll(() => page.evaluate(key => window.__terrainPackets.find(packet => packet.key === key)?.style.fillAlpha,
        childKey)).toBeCloseTo(visible ? mode === 'physical' ? .22 : .68 : 0);
      const packet = await page.evaluate(key => {
        const item = window.__terrainPackets.find(packet => packet.key === key);
        return { key: item.key, role: item.role, style: item.style };
      }, childKey);
      expect(packet.role).toBe('territorial-fill');
      expect(packet.style.color).toBe(visible ? '#cc3333' : '');
      if (renderer === 'canvas') expect(await replacements(), 'paint toggles must not resend the world geometry').toBe(replacementsBefore);
      receipts.push({ visible, packet, replacements: await replacements() });
    }
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState())).toEqual(documentBefore);
    expect(errors).toEqual([]);
    await writeFile(testInfo.outputPath('child-land-and-transport.json'), JSON.stringify({ renderer, mode, receipts }, null, 2));
  });
}
