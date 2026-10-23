import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('native reference probe runs actual local OCR, place Worker and shared-source package contracts', async ({ page }) => {
  test.setTimeout(90_000);
  const source = await readFile(new URL('../../tools/historical-library/sources/korea/ibs017-1962-map.jpg', import.meta.url));
  const probe = await readFile(new URL('../../apps/web-shell/reference-analysis-probe.js', import.meta.url), 'utf8');
  const external = [];
  page.on('request', request => { if (/^https?:/u.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url()); });
  await page.route('**/reference-native-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">' }));
  await page.route('**/shell/reference-analysis-probe.js', route => route.fulfill({ contentType: 'text/javascript', body: probe }));
  // This checks the native-probe operation in Chromium. World readiness and
  // native report writing are checked by the actual WebView2 run separately.
  await page.route('**/shell/full-world-probe.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const inspectFullWorldRuntime=()=>({ok:true});' }));
  await page.route('**/shell/native-storage.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const finishDiagnostics=report=>{window.referenceNativeResult=report;};' }));
  await page.route('**/shell/reference-probe.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: source }));
  await page.route('**/shell/reference-probe.json', route => route.fulfill({ json: { sha256: createHash('sha256').update(source).digest('hex'), bytes: source.length } }));
  await page.goto('/reference-native-harness');
  await page.evaluate(async () => {
    await import('/assets/js/build-meta.js');
    window.__PANDOLAB_SHELL_REFERENCE_ANALYSIS__ = true;
    window.__PANDOLAB_SHELL_NETWORK__ = { blocked: [] };
    (await import('/shell/reference-analysis-probe.js')).installReferenceRuntimeProbe();
    window.dispatchEvent(new globalThis.Event('pandolab:ready'));
  });
  await expect.poll(() => page.evaluate(() => window.referenceNativeResult), { timeout: 60_000 }).toBeTruthy();
  const result = await page.evaluate(() => window.referenceNativeResult);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.releaseReady).toBe(false);
  expect(result.ocrDetections).toBeGreaterThan(0);
  expect(result.offlinePlaceMatches).toBeGreaterThan(0);
  expect(result.sharedSourceCount).toBe(1);
  expect(result.modelStatus).toBe('PL-REF-MODEL-MISSING');
  expect(external).toEqual([]);
});
