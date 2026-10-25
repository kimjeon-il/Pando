/**
 * Verify a running Android debug WebView over the emulator's CDP endpoint.
 * This must not be confused with a browser-only or an APK-only check.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Persist a machine-readable error even when inspection fails before CDP attaches.
process.on('uncaughtExceptionMonitor', error => {
  mkdirSync('build-native/web-shell', { recursive: true });
  writeFileSync('build-native/web-shell/android-native-webview.json', JSON.stringify({
    schema: 'pandolab-android-native-webview-p6',
    capturedAt: new Date().toISOString(), ok: false,
    error: String(error?.stack || error),
  }, null, 2) + '\n');
});

const PACKAGE_ID = 'com.pandolab.webshell.prototype';
const DEBUG_PORT = 9222;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function adb(...args) {
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 20000 }).trim();
}
async function repeat(label, action, { attempts = 75, delayMs = 1500 } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) { last = error; }
    await delay(delayMs);
  }
  throw new Error(label + ': ' + (last?.message || 'timed out'));
}

const pid = await repeat('The Android application process did not start', () =>
  adb('shell', 'pidof', PACKAGE_ID).split(/\s+/)[0] || null, { attempts: 30 });
const socket = await repeat('Android debug WebView CDP socket was not exposed', () => {
  const entries = adb('shell', 'cat', '/proc/net/unix');
  const exact = new RegExp('webview_devtools_remote_' + pid + '\\b');
  return entries.split('\n').find(line => exact.test(line))?.match(/webview_devtools_remote_\d+/)?.[0] || null;
}, { attempts: 40 });
console.log('ANDROID_WEBVIEW_CDP_SOCKET', JSON.stringify({ pid, socket }));
adb('forward', 'tcp:' + DEBUG_PORT, 'localabstract:' + socket);

const endpoint = 'http://127.0.0.1:' + DEBUG_PORT + '/json';
const target = await repeat('Native WebView debugging endpoint was not available', async () => {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) return null;
  const targets = await response.json();
  return targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl) || null;
}, { attempts: 30 });
const channel = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  channel.addEventListener('open', resolve, { once: true });
  channel.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const awaiting = new Map();
channel.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!awaiting.has(message.id)) return;
  const { resolve, reject, timeout } = awaiting.get(message.id);
  awaiting.delete(message.id);
  clearTimeout(timeout);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
async function evaluate(expression) {
  const id = ++nextId;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { awaiting.delete(id); reject(new Error('CDP evaluation timed out')); }, 10000);
    awaiting.set(id, { resolve, reject, timeout });
    channel.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
      expression, awaitPromise: true, returnByValue: true,
    } }));
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'WebView JavaScript evaluation failed');
  return result.result?.value;
}

try {
  const startupExpression = "(async () => { const profile = await fetch(new URL('shell/stage-profile.json', location.href)).then(response => response.json()); return ({ verification: globalThis.PANDOLAB_SHELL_VERIFICATION, stagedVerification: profile.verification, ready: document.querySelector('#app')?.getAttribute('data-readiness'), nativeBridge: typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function', fileCommands: !!document.getElementById('openGisBtn'), map: !!document.getElementById('map'), title: document.title, url: location.href }); })()";
  const startup = await repeat('Native Android WebView failed to become interactive', async () => {
    const state = await evaluate(startupExpression);
    return state?.ready === 'enhanced' && state.nativeBridge && state.fileCommands && state.map ? state : null;
  }, { attempts: 60 });

  assert.equal(startup.verification, true, 'Android native runtime must be an explicit verification build');
  assert.equal(startup.stagedVerification, true, 'Android staged assets must be an explicit verification build');

  // Exercise the current file-menu interaction; full import/edit/persistence is
  // covered separately by native-map-plugin.mjs with an actual plugin export.
  const direct = await evaluate("(() => { const button = document.getElementById('mobileFileBtn'); const direct = !!button?.getClientRects().length; (direct ? button : document.getElementById('mobileMenuBtn')).click(); return direct; })()");
  if (!direct) await repeat('Native Android global menu did not open', () => evaluate("(() => { const button = document.getElementById('mobileMenuFileBtn'); if (!button?.getClientRects().length) return false; button.click(); return true; })()"));
  await repeat('Native Android file menu did not open', () => evaluate("(() => { const button = document.getElementById('fileAdvancedBtn'); if (!button?.getClientRects().length) return false; button.click(); return true; })()"));
  const fileMenu = await repeat('Native Android ordinary GIS import command unavailable', () => evaluate("(() => { const button = document.getElementById('openGisBtn'), input = document.getElementById('gisFileInput'); return button?.getClientRects().length && !button.disabled && input?.accept.includes('.geojson') ? { ordinaryGisImport: true, acceptedFormats: input.accept } : null; })()"));

  const proof = {
    schema: 'pandolab-android-native-webview-p6',
    capturedAt: new Date().toISOString(),
    package: PACKAGE_ID,
    pid: Number(pid),
    webviewSocket: socket,
    browserTarget: target.url,
    startup,
    fileMenu,
    ok: true,
  };
  mkdirSync('build-native/web-shell', { recursive: true });
  writeFileSync('build-native/web-shell/android-native-webview.json', JSON.stringify(proof, null, 2) + '\n');
  console.log('ANDROID_NATIVE_WEBVIEW_PASS ' + JSON.stringify(proof));
} finally {
  channel.close();
  adb('forward', '--remove', 'tcp:' + DEBUG_PORT);
}
