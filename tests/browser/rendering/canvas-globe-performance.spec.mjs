import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'off', ignoreHTTPSErrors: true });

for (const mode of ['physical', 'political']) {
  test(`Canvas globe reuses the accepted scene during map-theme transitions (${mode})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
        appearance: { mapStyle: mode === 'physical' ? 'standard' : 'classic' } }));
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
      const anchor = 'export function createMapRenderer(dependencies, { presentMapPreparation, onMapPreparationStatus = null } = {}) {';
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
      replace('function* renderSteps(message, renderRequestId = null) {\n      lastRenderMessage = message;', `function* renderSteps(message, renderRequestId = null) {\n      lastRenderMessage = message;
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
      // Only actual transferred bitmap frames carry profile receipts;
      // cancellation acknowledgements remain uninstrumented.
      replace("self.postMessage({\n        type: 'frame',\n        physicalLandCount:",
        "self.postMessage({\n        type: 'frame', profile,\n        physicalLandCount:");
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
    const originalTheme = mode === 'physical' ? 'standard' : 'classic';
    const alternativeTheme = mode === 'physical' ? 'classic' : 'standard';
    const receipts = [];
    for (const theme of [alternativeTheme,originalTheme,alternativeTheme,originalTheme]) {
      const started = Date.now();
      await page.locator('#preferencesBtn').click();
      await page.locator(`input[name="preferencesMapStyle"][value="${theme}"]`).locator('..').click();
      await page.locator('#preferencesCloseBtn').click();
      await expect(page.locator('html')).toHaveAttribute('data-map-style',theme);
      const expectedAlpha = theme === 'standard' ? .22 : 0;
      const expectedTerrain = theme === 'standard' ? 'physical' : 'political';
      await expect.poll(() => page.evaluate(({key,alpha,terrain}) => {
        const frame=window.__canvasProfiles.at(-1),stats=window.__PANDOLAB_VIEWER__.rendererStats();
        return frame?.zoom===16 && frame.complete && frame.style===terrain && frame.paints[key]?.alpha===alpha
          && frame.styleRevision===stats.canvasStyleRevision && frame.styleRevision===stats.canvasDisplayedStyleRevision;
      },{key:childKey,alpha:expectedAlpha,terrain:expectedTerrain}),{timeout:45000}).toBe(true);
      const frame=await page.evaluate(()=>window.__canvasProfiles.at(-1));
      expect(frame.total).toBeGreaterThan(0);
      expect(frame.pixel[3]).toBe(255);
      receipts.push({theme,latencyMs:Date.now()-started,frame});
    }
    expect(receipts[0].frame.pixel).not.toEqual(receipts[1].frame.pixel);
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState())).toEqual(documentBefore);
    expect(errors).toEqual([]);
    const profiles=await page.evaluate(()=>window.__canvasProfiles);
    await writeFile(info.outputPath('phases.json'),JSON.stringify({mode,profiles,receipts},null,2));
    await page.screenshot({path:info.outputPath('canvas-globe.png')});
    console.log(mode,JSON.stringify(receipts.map(({theme,latencyMs,frame})=>({theme,latencyMs,ms:frame.total,pixel:frame.pixel}))));
  });
}
