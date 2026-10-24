import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { reportPath } from '../../../tools/report-paths.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const output = resolve(reportPath('reports/development/testing/web-shell/browser-preflight.json'), '..');
const evidence = JSON.parse(await readFile(resolve(root, 'shell/stage-evidence.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const configuration = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const inlineHashes = [...(await readFile(resolve(root, 'index.html'), 'utf8')).matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`).join(' ');
const csp = configuration.app.security.csp.replace("script-src 'self'", `script-src 'self' ${inlineHashes}`);
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(resolve(root) + '\\') && !file.startsWith(resolve(root) + '/')) throw new Error('outside root');
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
      'Content-Security-Policy': csp });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  const errors = [];
  const requests = [];
  page.on('request', request => { requests.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[PANDOEDITOR-SHELL-DIAGNOSTIC] Error: Native shell bridge is unavailable')) console.error(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.__PANDOLAB_SHELL_READY__ || window.__PANDOLAB_SHELL_REPORT__?.stage === 'startup', null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__PANDOLAB_SHELL_READY__), true, 'The shell startup must complete under its real CSP.');
  await page.waitForFunction(() => window.__PANDOLAB_GPU_METRICS__?.countryBaseIndexCount > 0, null, { timeout: 15000 });
  const result = await page.evaluate(() => ({ ready: window.__PANDOLAB_SHELL_READY__, startup: window.__PANDOLAB_SHELL_REPORT__,
    metrics: window.__PANDOLAB_GPU_METRICS__, network: window.__PANDOLAB_SHELL_NETWORK__, entities: window.PANDOLAB_TERRITORIAL?.list?.().map(row => row.id) }));
  console.log(JSON.stringify({ ready: result.ready, renderer: result.metrics?.renderer,
    indices: result.metrics?.countryBaseIndexCount, triangles: result.metrics?.triangleCount,
    entities: result.entities, blocked: result.network?.blocked, errors }, null, 2));
  assert.equal(result.ready, true, JSON.stringify(result.startup));
  assert.equal(result.entities.length, evidence.worldData?.modelEntityCount || evidence.fixture.entityCount);
  assert.match(result.metrics.renderer, /^webgl/);
  assert.deepEqual(result.network.blocked, []);
  assert.deepEqual(errors, []);
  let commands = null;
  if (evidence.verification) {
  commands = await page.evaluate(async () => {
    try { await window.__PANDOLAB_SHELL_DIAGNOSTICS__.run(); }
    catch { /* A browser has no native file bridge; it must not claim that check passed. */ }
    return window.__PANDOLAB_SHELL_DIAGNOSTICS__.snapshot();
  });
  console.log(JSON.stringify({ browserChecks: Object.fromEntries(Object.entries(commands.checks).map(([key, value]) => [key, value.status])),
    expectedNativeUnavailable: commands.report?.error?.message.includes('Native shell bridge is unavailable') }, null, 2));
  for (const key of ['webgl', 'worker', 'wasm', 'autosave']) assert.equal(commands.checks[key].status, 'PASS', JSON.stringify(commands.report));
  assert.equal(commands.checks.nativeFile.status, 'FAIL');
  assert.match(commands.report.error.message, /Native shell bridge is unavailable/);
  } else {
    assert.equal(await page.evaluate(() => typeof window.__PANDOLAB_SHELL_DIAGNOSTICS__), 'undefined');
    assert.ok(!requests.some(path => /\/shell\/(?:verification|probe-storage|diagnostics|full-world-probe|reference-analysis-probe)\./.test(path)), 'Ordinary startup must not load verification tools');
  }
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'browser-preflight.json'), JSON.stringify({ browserOnly: true, viewport: { width: 1024, height: 768 },
    source: 'actual frontend under shell CSP', verification: evidence.verification, bootstrap: result, commands, errors }, null, 2));
  await page.screenshot({ path: resolve(output, 'browser-preflight.png') });
  console.log('Browser-only real-frontend preflight passed; this does not certify native WebView or Android.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
