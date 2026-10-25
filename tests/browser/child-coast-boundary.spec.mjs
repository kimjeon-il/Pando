import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { coreFileProjection, productionGeoPackage } from '../helpers/production-geopackage.mjs';
import { startupDocument } from '../helpers/core-startup.mjs';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off' });

for (const mode of ['viewer', 'editor']) for (const renderer of ['webgl2', 'canvas']) {
  test(`${mode} ${renderer} keeps Hong Kong land contact in the shared boundary owner`, async ({ playwright }, testInfo) => {
    test.setTimeout(180_000);
    const browser = await playwright.chromium.launch({ ...testInfo.project.use.launchOptions, channel: testInfo.project.use.channel,
      args: renderer === 'webgl2' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] : [] });
    const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    try {
    page.setDefaultTimeout(20_000);
    const entities = ['CHN', 'HKG', 'MAC'].map(id => {
      const source = JSON.parse(readFileSync(new URL(`../../assets/data/territorial-entities/source/countries/state-${id}.json`, import.meta.url), 'utf8'));
      return createTerritorialFeature({ id, name: id, entityKind: 'general', parentId: source.parentEntityId.replace('state:', ''), geometry: source.geometryVersions[0].geometry });
    });
    const receipt = await coreFileProjection(startupDocument(entities));
    const file = await productionGeoPackage('write', new ArrayBuffer(0), receipt.project, receipt.spatialState);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(forceCanvas => {
      window.__coastScene = {};
      window.__coastPackets = [];
      window.__coastWorkers = [];
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options); window.__coastWorkers.push(String(url));
          if (String(url).includes('country-shared-boundary-worker')) this.addEventListener('message', event => {
            if (event.data.type === 'prepared') window.__coastPackets.push(event.data.packet);
          });
        }
      };
      if (forceCanvas) {
        const getContext = window.HTMLCanvasElement.prototype.getContext;
        window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
        };
      }
    }, renderer === 'canvas');
    await page.route('**/modules/gpu-scene.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor,
        anchor + '\nif(domain === "territorial-boundaries") window.__coastScene = structuredClone({polygons,strokes});') });
    });
    await page.route('**/modules/rendering-domain.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'export function createRenderingDomain(';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor, 'function createObservedDomain(') + `
export function createRenderingDomain(options) {
  return createObservedDomain({...options, prepareView: value => {
    const frame = options.prepareView(value); window.__coastFrame = frame; return frame;
  }});
}` });
    });
    await page.goto(mode === 'viewer' ? `/?renderer=${renderer}&debug=1` : `/__editor/index.html?renderer=${renderer}&debug=1`);
    await expect(page.locator(mode === 'viewer' ? '#viewerStatus' : '#app'))
      .toHaveAttribute(mode === 'viewer' ? 'data-ready' : 'data-readiness', mode === 'viewer' ? 'true' : /editable|enhanced/, { timeout: 120_000 });
    await page.evaluate(() => {
      window.__coastOpened = false;
      window.addEventListener('pandolab:project-changed', event => {
        if (!event.detail || event.detail.reason === 'project-load') window.__coastOpened = true;
      });
    });
    await page.locator('#mobileFileBtn').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#openProjectBtn').click()]);
    await chooser.setFiles({ name: 'china-hongkong-macao.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: Buffer.from(file.buffer) });
    await expect.poll(() => page.evaluate(() => window.__coastOpened), { timeout: 90_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__coastPackets.at(-1)?.segments.filter(row => row.ownerIds.some(id => id.includes('HKG'))).length || 0), { timeout: 60_000 }).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__coastScene.strokes?.length || 0)).toBe(0);
    const coordinates = await page.evaluate(() => window.__coastPackets.at(-1).segments
      .filter(row => row.ownerIds.some(id => id.includes('HKG'))).map(row => [row.start, row.end]));
    expect(coordinates.flat().every(point => point[1] > 22.5)).toBe(true);
    expect(await page.evaluate(() => window.__coastWorkers.every(url => /assets\/worker-runtime\/[a-f0-9]{32}\//.test(url)))).toBe(true);
    const length = coordinates.reduce((total, line) => total + line.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0), 0);
    expect(length).toBeGreaterThan(0.1);
    expect(length).toBeLessThan(0.3);
    expect(await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection)).toBe(mode==='viewer'?'globe':'flat');
    await page.locator('#objectSearchBtn').click();
    await page.locator('#objectSearchInput').fill('HKG');
    await page.locator('#objectSearchResults button').filter({ hasText: 'HKG' }).first().click();
    await page.keyboard.press('Escape');
    const bounds = await page.locator('#map').boundingBox();
    const point = await page.evaluate(() => window.__coastFrame.projectVisibleCoordinate([114.15, 22.35]));
    expect(point).not.toBeNull();
    await page.mouse.move(bounds.x + point[0], bounds.y + point[1]);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
    await page.mouse.up();
    const scale = await page.evaluate(() => window.__coastFrame.cssScale);
    await page.mouse.wheel(0, -3000);
    await expect.poll(() => page.evaluate(() => window.__coastFrame.cssScale)).toBeGreaterThan(scale * 10);
    await page.mouse.move(bounds.x + 10, bounds.y + 10);
    await expect(page.locator('#map')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-${renderer}-hongkong.png`) });
    expect(errors).toEqual([]);
    } finally { await browser.close(); }
  });
}
