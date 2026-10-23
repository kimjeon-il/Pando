import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, readFile, statfs, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createP3PreviewServer } from '../../scripts/p3-preview-server.mjs';
import { createDevelopmentAssets } from './stage.mjs';
import { libraryMaterializedRoot } from '../../tools/library-data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const developmentOrigin = 'http://127.0.0.1:4175';

export async function requireBuildSpace(path = root, expectedGiB = 4) {
  const disk = await statfs(path);
  const freeGiB = disk.bavail * disk.bsize / 2 ** 30;
  if (freeGiB < Math.max(15, expectedGiB + 2)) throw Error(`Native build requires at least ${Math.max(15, expectedGiB + 2)} GiB free; available ${freeGiB.toFixed(2)} GiB. Reuse the frontend server without building.`);
  return freeGiB;
}

export async function startDevelopmentServer({ repository = root, port = 4175, profile = 'full-world', observe = true } = {}) {
  repository = resolve(repository);
  let current = await createDevelopmentAssets({ root: repository, profile });
  let revision = 0, error = null, pending = null, dirty = false, timer;
  const watchers = [];
  // Android's Tauri asset proxy buffers streaming responses. A short request
  // works through that same origin on both native platforms.
  const reloadSource = Buffer.from(`let revision; async function check() { try { const state = await fetch('/__shell/health', { cache: 'no-store' }).then(response => response.json()); if (revision !== undefined && revision !== state.revision) { location.reload(); return; } revision = state.revision; } catch {} setTimeout(check, 1000); } check();`);
  const decorate = () => {
    const html = current.assets.get('index.html').bytes;
    current.assets.set('index.html', { bytes: Buffer.concat([html, Buffer.from('<script type="module" src="shell/dev-reload.js"></script>')]) });
    current.assets.set('shell/dev-reload.js', { bytes: reloadSource });
  };
  decorate();
  const lease = resolve(repository, '.library-data/dev-server.json');
  const updateLease = async () => {
    await mkdir(resolve(repository, '.library-data'), { recursive: true });
    await writeFile(lease, JSON.stringify({ pid: process.pid, materialized: [libraryMaterializedRoot(repository)] }));
  };
  async function refresh() {
    dirty = true;
    if (pending) return pending;
    pending = (async () => {
      do {
        dirty = false;
        try {
          const next = await createDevelopmentAssets({ root: repository, profile });
          current = next; decorate(); if (observe) await updateLease(); error = null; revision++;
        } catch (failure) { error = failure.message; console.error('Development assets rejected:', error); }
      } while (dirty);
    })().finally(() => { pending = null; });
    return pending;
  }
  const configuration = JSON.parse(await readFile(resolve(repository, 'apps/web-shell/src-tauri/tauri.conf.json'), 'utf8').catch(() => '{}'));
  const server = createP3PreviewServer(repository, {
    assets: () => current.assets,
    handleRequest(request, response, pathname) {
      if (pathname === '/__shell/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ root: repository, profile, revision, error, executionMode: 'development' })); return true;
      }
      if (pathname === '/' || pathname === '/index.html') {
        const hashes = [...current.assets.get('index.html').bytes.toString().matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
          .map(match => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`).join(' ');
        if (configuration.app?.security.csp) response.setHeader('Content-Security-Policy', configuration.app.security.csp.replace("script-src 'self'", `script-src 'self' ${hashes}`));
      }
      return false;
    },
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  if (observe) await updateLease();
  if (observe) {
    const changed = (_event, name) => {
      if (name && /(?:^|[/\\])(?:dist|target|node_modules|gen|\.dist-pending|\.dist-previous)(?:[/\\]|$)/.test(name)) return;
      clearTimeout(timer); timer = setTimeout(() => { refresh().catch(failure => console.error(failure)); }, 250);
    };
    for (const path of ['assets/js', 'assets/css', 'assets/wasm', 'config', 'apps/web-shell']) watchers.push(watch(resolve(repository, path), { recursive: path !== 'apps/web-shell' }, changed));
  }
  return { server, refresh, get evidence() { return current.evidence; }, async close() {
    clearTimeout(timer); for (const watcher of watchers) watcher.close();
    if (pending) await pending;
    await new Promise(resolve => server.close(resolve));
    if (observe) await unlink(lease);
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check-space')) await requireBuildSpace();
  else {
    let existing;
    try { existing = await globalThis.fetch(developmentOrigin + '/__shell/health', { signal: globalThis.AbortSignal.timeout(1000) }).then(response => response.json()); } catch { /* Bind below reports an occupied non-shell port. */ }
    if (existing) {
      if (existing.root !== resolve(root) || existing.profile !== 'full-world') throw Error('Port 4175 belongs to another worktree or profile.');
      console.log('Reusing existing development server:', developmentOrigin);
    } else {
      const app = await startDevelopmentServer();
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().then(() => process.exit(0), failure => { console.error(failure); process.exit(1); }); });
      console.log('Validated full-world development assets:', developmentOrigin);
    }
  }
}
