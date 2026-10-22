import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const expectedCore = JSON.parse(readFileSync(new URL('../../../assets/wasm/pandoeditor-core.manifest.json', import.meta.url)));
const expectedCountries = JSON.parse(readFileSync(new URL('../../../assets/data/builtin-world/generated/v1/index.json', import.meta.url)));
const output = process.env.PANDOLAB_WEBVIEW_EVIDENCE;
if (!output) throw new Error('PANDOLAB_WEBVIEW_EVIDENCE must name the validation JSON output.');
const endpoint = process.env.PANDOLAB_WEBVIEW_CDP || 'http://127.0.0.1:9236';
await expect.poll(() => fetch(`${endpoint}/json/version`).then(response => response.ok).catch(() => false),
  { timeout: 30000, message: 'The task WebView must expose its debug endpoint.' }).toBe(true);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
  assert.ok(page, 'Packaged WebView page must exist.');
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(page.url());
  url.search = '?debug=1';
  await page.goto(url.href);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120000 });
  if (await page.locator('#shellDiagnostics[open]').count()) await page.locator('#shellDiagnostics summary').click();
  const source = await page.evaluate(async () => ({
    core: await (await fetch('assets/wasm/pandoeditor-core.manifest.json')).json(),
    history: await (await fetch('assets/data/builtin-world/generated/v1/index.json')).json(),
    buildId: window.PANDOLAB_BUILD_META.buildId,
  }));
  assert.equal(source.core.sourceSha256, expectedCore.sourceSha256);
  assert.deepEqual(source.history.inputHashes, expectedCountries.inputHashes);
  const countries = [];
  for (const [id, period] of [['BEL', '1830-10-04 ~'], ['ZMB', '1964-10-24 ~'], ['KOR', '1948-08-15 ~'], ['USA', ''], ['BEL', '1830-10-04 ~']]) {
    await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
    await expect(page.locator('#entityPeriodInput')).toBeVisible();
    await expect(page.locator('#entityPeriodInput')).toHaveValue('');
    const lifetime=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id).properties.metadata.historicalTimeline.lifetime,id);
    const sourcePeriod=[lifetime.validFrom||'',lifetime.validTo||''].some(Boolean)?[lifetime.validFrom||'',lifetime.validTo||''].join(' ~').trim():'';
    assert.equal(sourcePeriod,period);countries.push({id,sourceLifetime:lifetime,instancePeriod:await page.locator('#entityPeriodInput').inputValue()});
  }
  await page.screenshot({ path: output.replace(/\.json$/, '.png') });
  assert.deepEqual(errors, []);
  const result = { url: page.url(), buildId: source.buildId, coreSourceSha256: source.core.sourceSha256,
    countryInputHashes: source.history.inputHashes, countries, pageErrors: errors, embeddedAssets: true, sourceOverrides: false };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
