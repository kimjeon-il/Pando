// Node entrypoint for classic geometry modules that use the shared C++ core.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sharedSourceManifest } from './package-shared-core-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const explicitBuild = Boolean(process.env.PANDOEDITOR_WASM_MODULE);
const modulePath = resolve(process.env.PANDOEDITOR_WASM_MODULE
  || fileURLToPath(new URL('../assets/wasm/pandoeditor-core.js', import.meta.url)));
if (!modulePath.endsWith('.js')) throw Error('PANDOEDITOR_WASM_MODULE must point to the compiled core JS');
const js = await readFile(modulePath);
const wasm = await readFile(modulePath.slice(0, -3) + '.wasm');
const sourceSha256 = sharedSourceManifest(root).sourceSha256;
if (!explicitBuild) {
  const manifest = JSON.parse(await readFile(new URL('../assets/wasm/pandoeditor-core.manifest.json', import.meta.url), 'utf8'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  if (manifest.schema !== 'pandoeditor-core-wasm' || manifest.abiVersion !== 1
    || manifest.sourceSha256 !== sourceSha256
    || manifest.assets?.js?.sha256 !== sha256(js)
    || manifest.assets?.wasm?.sha256 !== sha256(wasm)) {
    throw Error('Packaged C++ core manifest or artifact hash is stale');
  }
}
const { default: createCore } = await import(pathToFileURL(modulePath).href);
const core = await createCore({ wasmBinary: wasm });
if (core.coreAbiVersion !== 1 || core.coreCompilerVersion !== '4.0.20'
  || core.coreSourceSha256 !== sourceSha256) {
  throw Error('C++ core ABI, compiler, or source identity does not match this checkout');
}
if (typeof core.normalizePolygonGeometry !== 'function'
  || typeof core.normalizePolygonRing !== 'function'
  || typeof core.hasCanonicalPolygonWinding !== 'function') {
  throw Error('The required C++ spherical polygon normalizer is unavailable.');
}
globalThis.PandoLabSphericalCore = core;
export { core as sphericalCore };
