// Run against one attached physical Android phone; preserve Chrome data/tabs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createP3PreviewServer } from '../scripts/p3-preview-server.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const adb = arg('--adb') || 'adb';
const serial = arg('--serial');
const browserPackage = arg('--browser-package');
const devtoolsSocket = arg('--devtools-socket') || 'chrome_devtools_remote';
const output = resolve(arg('--output') || 'build-native/p9/android-touch');
const port = 4175, debugPort = 9227;
const run = args => execFileSync(adb, args, { encoding: 'utf8', timeout: 30_000 }).trim();
const phone = (...args) => run(['-s', serial, ...args]);
assert.ok(serial, '--serial must select an explicitly attached physical phone');
assert.ok(browserPackage, '--browser-package must select the installed Chromium browser');
assert.equal(phone('get-state'), 'device', 'Authorize USB debugging on the phone');
assert.notEqual(phone('shell', 'getprop', 'ro.kernel.qemu'), '1', 'An emulator cannot satisfy the physical-device check');
await mkdir(output, { recursive: false });
const report = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Physical Android Chromium browser with CDP-injected touch gestures; no desktop emulation, human-finger, or Qt APK claim',
  browserPackage, devtoolsSocket,
  device: { model: phone('shell', 'getprop', 'ro.product.model'), android: phone('shell', 'getprop', 'ro.build.version.release'),
    screen: phone('shell', 'wm', 'size'), density: phone('shell', 'wm', 'density') },
  status: 'unverified', errors: [], steps: [],
};
const server = createP3PreviewServer();
let browser, page, cdp, reverseInstalled = false, forwardInstalled = false;
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  phone('reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`); reverseInstalled = true;
  const url = `http://127.0.0.1:${port}/?debug=1`;
  phone('shell', 'am', 'start', '--user', 'current', '-a', 'android.intent.action.VIEW', '-d', url, browserPackage);
  phone('forward', '--no-rebind', `tcp:${debugPort}`, `localabstract:${devtoolsSocket}`); forwardInstalled = true;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 30_000 });
  await expect.poll(() => browser.contexts().flatMap(context => context.pages()).filter(tab => tab.url().startsWith(`http://127.0.0.1:${port}/`)).length,
    { timeout: 30_000 }).toBeGreaterThan(0);
  page = browser.contexts().flatMap(context => context.pages()).find(tab => tab.url().startsWith(`http://127.0.0.1:${port}/`));
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /PL-|Worker|WASM/.test(message.text())) report.errors.push(message.text()); });
  await page.bringToFront();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', /^(editable|enhanced)$/, { timeout: 120_000 });
  const dataRoot = new URL('../assets/data/', import.meta.url);
  const input = JSON.parse(await readFile(new URL('world/build-input.json', dataRoot), 'utf8'));
  const world = JSON.parse(await readFile(new URL(input.canonicalSource, dataRoot), 'utf8'));
  const russia = world.features.find(feature => feature.id === 'RUS').geometry;
  const pairCount = geometry => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flat().reduce((sum, ring) => sum + ring.length, 0);
  const model = await page.evaluate(() => {
    const geometry = window.PANDOLAB_TERRITORIAL.get('RUS').geometry;
    return { countries: window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).length,
      russiaCoordinatePairs: (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flat().reduce((sum, ring) => sum + ring.length, 0),
      readiness: document.querySelector('#app').dataset.readiness };
  });
  assert.ok(model.countries >= world.features.length);
  assert.equal(model.russiaCoordinatePairs, pairCount(russia), 'The editable model must contain full canonical geometry');
  report.initialModel = model;
  cdp = await page.context().newCDPSession(page);
  report.browser = browser.version();
  report.environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints,
    viewport: [innerWidth, innerHeight, devicePixelRatio], coarsePointer: matchMedia('(pointer:coarse)').matches }));
  assert.match(report.environment.userAgent, /Android/);
  assert.ok(report.environment.maxTouchPoints > 0 && report.environment.coarsePointer);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })) });
  const pause = () => new Promise(done => setTimeout(done, 20));
  const tap = async point => { await send('touchStart', [point]); await pause(); await send('touchEnd', []); };
  const view = () => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  const closeEditor = async () => {
    const box = await page.getByRole('button', { name: '편집창 닫기', exact: true }).boundingBox();
    assert.ok(box, 'Actual mobile editor close control must be visible');
    await tap([box.x + box.width / 2, box.y + box.height / 2]);
  };
  await page.locator('#flatBtn').evaluate(button => button.click());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('TUR'));
  await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
  await closeEditor();
  const original = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('TUR').geometry));
  const map = await page.locator('#map').boundingBox();
  const center = [map.x + map.width * .5, map.y + map.height * .4];
  const beforePan = await view();
  await send('touchStart', [center]);
  for (let i = 1; i <= 15; i++) { await send('touchMove', [[center[0] + i * 4, center[1] + i]]); await pause(); }
  await send('touchEnd', []);
  await expect.poll(async () => Math.hypot(...(await view()).geographicCenter.map((value, i) => value - beforePan.geographicCenter[i])), { timeout: 30_000 }).toBeGreaterThan(.001);
  report.steps.push({ action: 'one-finger-pan', before: beforePan, after: await view() });
  const beforePinch = await view();
  await send('touchStart', [[center[0] - 35, center[1]], [center[0] + 35, center[1]]]);
  for (let i = 1; i <= 15; i++) { const distance = 35 + i * 2; await send('touchMove', [[center[0] - distance, center[1]], [center[0] + distance, center[1]]]); await pause(); }
  await send('touchEnd', []);
  await expect.poll(async () => (await view()).zoom / beforePinch.zoom, { timeout: 30_000 }).toBeGreaterThan(1.01);
  report.steps.push({ action: 'two-finger-pinch', before: beforePinch, after: await view() });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('TUR'));
  await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('ARM'));
  await expect(page.locator('#propertyTitle')).toHaveText('아르메니아');
  await closeEditor();
  const point = await page.evaluate(() => {
    const [x, y] = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([35, 39]);
    const box = document.querySelector('#map').getBoundingClientRect(); return [box.x + x, box.y + y];
  });
  await tap(point);
  await expect(page.locator('#propertyTitle')).toHaveText('튀르키예', { timeout: 30_000 });
  assert.equal(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('TUR').geometry)), original);
  report.steps.push({ action: 'touch-select-country', from: 'ARM', to: 'TUR', geometryUnchanged: true });
  report.gpu = await page.evaluate(() => { const gl = document.querySelector('#map canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  assert.doesNotMatch(report.gpu, /SwiftShader|llvmpipe|software/i);
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: resolve(output, 'physical-android-window.png') });
  report.status = 'passed';
} catch (error) {
  if (page && !page.isClosed()) {
    try {
      report.failureState = await page.evaluate(() => ({ readiness: document.querySelector('#app')?.dataset.readiness,
        startup: globalThis.__PANDOLAB_STARTUP_METRICS__, title: document.querySelector('#propertyTitle')?.textContent }));
      await page.screenshot({ path: resolve(output, 'physical-android-failure.png'), timeout: 5000 });
    } catch (diagnosticError) { report.diagnosticError = diagnosticError.message; }
  }
  report.error = { name: error.name, message: error.message }; throw error;
} finally {
  await writeFile(resolve(output, 'physical-android-touch.json'), JSON.stringify(report, null, 2) + '\n');
  if (cdp) await cdp.detach();
  if (page && !page.isClosed()) await page.close();
  if (browser) await browser.close();
  if (forwardInstalled) phone('forward', '--remove', `tcp:${debugPort}`);
  if (reverseInstalled) phone('reverse', '--remove', `tcp:${port}`);
  await new Promise(done => { server.close(done); server.closeIdleConnections(); });
}
