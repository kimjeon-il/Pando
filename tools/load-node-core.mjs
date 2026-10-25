import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadVerifiedCore } from "../shared/frontend/js/modules/core-wasm-loader.js";
import { sharedSourceManifest } from './package-shared-core-assets.mjs';
import {frontendWasmRoot} from '../scripts/lib/frontend-layout.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadNodeCore({ root = fileURLToPath(new URL('../', import.meta.url)),
  modulePath = process.env.PANDOEDITOR_WASM_MODULE } = {}) {
  try {
    const assets = resolve(root, frontendWasmRoot);
    const manifest = JSON.parse(await readFile(resolve(assets, 'pandoeditor-core.manifest.json'), 'utf8'));
    const sourceSha256 = sharedSourceManifest(root).sourceSha256;
    const compiledPath = resolve(modulePath || resolve(assets, manifest.assets?.js?.file || 'pandoeditor-core.js'));
    if (!compiledPath.endsWith('.js')) throw Object.assign(new Error('Core module must be a compiled .js file'), { code: 'PL-CORE-WASM-MANIFEST' });
    const [js, wasm] = await Promise.all([readFile(compiledPath), readFile(compiledPath.slice(0, -3) + '.wasm')]);
    if (modulePath) {
      // Explicit builds use the current compiler/ABI contract and must still
      // identify this checkout's source when instantiated below.
      manifest.sourceSha256 = sourceSha256;
      manifest.assets = { js: { file: 'pandoeditor-core.js', sha256: sha256(js) },
        wasm: { file: 'pandoeditor-core.wasm', sha256: sha256(wasm) } };
    } else if (manifest.sourceSha256 !== sourceSha256) {
      throw Object.assign(new Error('Compiled core source identity is stale for this checkout'), { code: 'PL-CORE-PREREQUISITE-STALE' });
    }
    const moduleUrl = pathToFileURL(compiledPath);
    moduleUrl.searchParams.set('sha256', sha256(js));
    const core = await loadVerifiedCore({ baseUrl: pathToFileURL(assets + '/'), subtle: webcrypto.subtle,
      fetchAsset: async url => {
        const name = new URL(url).pathname.split('/').pop();
        if (name === 'pandoeditor-core.manifest.json') return Response.json(manifest);
        if (name === manifest.assets.js.file) return new Response(js);
        if (name === manifest.assets.wasm.file) return new Response(wasm);
        throw new Error(`Unexpected core asset: ${name}`);
      },
      createModuleUrl: () => moduleUrl.href, revokeModuleUrl: () => {}, importModule: url => import(url),
    });
    for (const name of ['DocumentSession', 'normalizePolygonGeometry', 'normalizePolygonRing', 'hasCanonicalPolygonWinding']) {
      if (typeof core[name] !== 'function') throw Object.assign(new Error(`Required core capability is missing: ${name}`), { code: 'PL-CORE-WASM-CAPABILITY' });
    }
    return core;
  } catch (cause) {
    const code = cause.code === 'ENOENT' ? 'PL-CORE-PREREQUISITE-MISSING'
      : cause.code || 'PL-CORE-PREREQUISITE-LOAD';
    throw Object.assign(new Error(`Shared C++ core prerequisite failed: ${cause.message}`, { cause }), { code });
  }
}
