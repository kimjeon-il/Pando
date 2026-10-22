import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'off', ignoreHTTPSErrors: true });

for (const mode of ['physical', 'political']) {
  test(`Canvas globe keeps child terrain ready during paint toggles (${mode})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
        backgrounds: { viewer: { terrainVisible: true, terrainStyle: mode } } }));
      const original = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return String(type).includes('webgl') ? null : original.call(this, type, ...args);
      };
      window.__canvasProfiles = [];
      const OriginalWorker = Worker;
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => {
            if (event.data.profile) window.__canvasProfiles.push(event.data.profile);
          });
        }
      };
    }, mode);
    await page.route('**/modules/map-renderer-composition.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'export function createMapRenderer(dependencies, { productMode }) {';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor, anchor + '\nwindow.__canvasPorts = dependencies;') });
    });
    // Instrument only the owned test response; production carries no profiling API.
    await page.route('**/workers/canvas-render-worker.js*', async route => {
      const response = await route.fetch();
      let source = (await response.text()).replaceAll('\r\n', '\n');
      const replace = (anchor, body) => {
        expect(source.split(anchor).length, anchor).toBe(2);
        source = source.replace(anchor, body);
      };
      replace('lastRenderMessage = message;', `lastRenderMessage = message;
        const started = performance.now(), profile = { phases: {}, projection: message.projection,
          zoom: message.view?.globeZoom, style: message.physicalSettings?.terrainStyle, styleRevision };`);
      replace('for (const role of message.visualOrder.base) {',
        'for (const role of message.visualOrder.base) { const phaseStart = performance.now();');
      const hydro = 'else if (message.visualOrder.hydro.includes(role)) renderHydroPass(message, projection, dpr, role);';
      replace(hydro, hydro + '\nprofile.phases[role] = performance.now() - phaseStart;');
      replace('const bitmap = canvas.transferToImageBitmap();', `
        profile.total = performance.now() - started;
        profile.complete = terrainComplete; profile.terrain = terrainFrameStats;
        profile.pixel = Array.from(context.getImageData(...createProjection(message, width, height)([114.15, 22.35])
          .map(value => Math.round(value * dpr)), 1, 1).data);
        profile.paints = Object.fromEntries((message.scenePolygons || []).filter(packet => packet.role === 'territorial-fill')
          .map(packet => [packet.key, { alpha: packet.style.fillAlpha, color: packet.style.color }]));
        const bitmap = canvas.transferToImageBitmap();`);
      replace("self.postMessage({\n        type: 'frame',", "self.postMessage({\n        type: 'frame', profile,");
      await route.fulfill({ response, body: source });
    });
    await page.goto('/?debug=1');
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const documentBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
    const childKey = await page.evaluate(() => {
      const child = window.__canvasPorts.territorialModel.entityRepository.list()
        .find(entity => entity.properties.metadata?.builtinSubunit?.sourceCountryId === 'HKG');
      return `territorial:entity:${child.id}:fill`;
    });
    await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { flatCenter: [0, 0], flatZoom: 1,
        globeRotation: [-114.17, -22.27, 0], globeZoom: 16 } });
      host.requestRepaint('canvas-globe-regression');
    });
    await expect.poll(() => page.evaluate(key => {
      const frame = window.__canvasProfiles.at(-1);
      return frame?.zoom === 16 && frame.complete && !!frame.paints[key]
        && frame.terrain.terrainSource === 'dem-derived-canvas';
    }, childKey), { timeout: 90_000 }).toBe(true);
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="objects"]').click();
    const color = page.locator('[data-layer-style-color="objects"]');
    const replacements = () => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().canvasWorkerMessagesByType['replace-data'] || 0);
    const before = await replacements(), receipts = [];
    for (const visible of [false, true, false, true]) {
      const started = Date.now();
      await color.locator('..').click();
      await expect(color).toBeChecked({ checked: visible });
      await expect.poll(() => page.evaluate(({ key, alpha }) => {
        const frame = window.__canvasProfiles.at(-1), stats = window.__PANDOLAB_VIEWER__.rendererStats();
        return frame?.zoom === 16 && frame.complete && frame.paints[key]?.alpha === alpha
          && frame.styleRevision === stats.canvasStyleRevision && frame.styleRevision === stats.canvasDisplayedStyleRevision;
      }, { key: childKey, alpha: visible ? mode === 'physical' ? .22 : .68 : 0 }), { timeout: 30_000 }).toBe(true);
      const frame = await page.evaluate(() => window.__canvasProfiles.at(-1));
      expect(frame.phases.terrain, 'paint-only frames must reuse the ready terrain substrate').toBeUndefined();
      expect(frame.total, 'do not regress to multi-second paint frames').toBeLessThan(750);
      expect(frame.pixel[3]).toBe(255);
      expect(frame.pixel.slice(0, 3)).not.toEqual([255, 255, 255]);
      expect(await replacements()).toBe(before);
      receipts.push({ visible, latencyMs: Date.now() - started, frame });
    }
    const off = receipts[0].frame.pixel, on = receipts[1].frame.pixel;
    const alpha = mode === 'physical' ? .22 : .68;
    for (const [index, channel] of [204, 51, 51].entries()) {
      expect(Math.abs(on[index] - Math.round(off[index] * (1 - alpha) + channel * alpha))).toBeLessThanOrEqual(2);
    }
    if (mode === 'political') expect(Math.max(...off.slice(0, 3)) - Math.min(...off.slice(0, 3))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState())).toEqual(documentBefore);
    expect(errors).toEqual([]);
    const profiles = await page.evaluate(() => window.__canvasProfiles);
    await writeFile(info.outputPath('phases.json'), JSON.stringify({ mode, profiles, receipts }, null, 2));
    await page.locator('#mapDisplayBtn').click();
    await page.screenshot({ path: info.outputPath('canvas-globe.png') });
    console.log(mode, JSON.stringify(receipts.map(({ visible, latencyMs, frame }) => ({ visible, latencyMs, ms: frame.total, pixel: frame.pixel }))));
  });
}
