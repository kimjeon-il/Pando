import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// An installed plugin binds to the existing permanent workspace, never a copy
// of its dependencies, data cache or Python environment.
export const workspace = resolve(process.env.PANDO_MAP_WORKSPACE || fileURLToPath(new URL('../../../', import.meta.url)));
if (!existsSync(resolve(workspace, 'tools/load-node-core.mjs'))) throw new Error('Set --workspace to the existing Pando work/ui checkout.');
export const workspaceModule = path => import(pathToFileURL(resolve(workspace, path)).href);
export const requireWorkspace = createRequire(resolve(workspace, 'package.json'));
export const { sharedCalculationCore: core } = await workspaceModule('assets/js/modules/temporal.js');

// Bind numerical work to the loaded producer, including its helper modules.
// These identities are path-independent so the installed code and source agree.
const hash = value => createHash('sha256').update(value).digest('hex');
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
function runtimeSnapshot() {
  const inputs = {};
  const add = (name, path) => { inputs[name] = hash(readFileSync(path)); };
  function pluginFiles(directory) {
    for (const entry of readdirSync(resolve(pluginRoot,directory),{withFileTypes:true})) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pluginFiles(path);
      else if (/\.(mjs|py)$/.test(path)) add('plugin/'+path,resolve(pluginRoot,path));
    }
  }
  pluginFiles('lib');pluginFiles('scripts');add('plugin/plugin.json',resolve(pluginRoot,'plugin.json'));
  for (const path of ['pnpm-lock.yaml','assets/js/modules/temporal.js','assets/js/modules/core-wasm-loader.js',
    'assets/js/modules/source-provenance.js','assets/js/modules/version-contract.js','assets/js/modules/place-worker-store.js',
    'assets/js/modules/worker-rpc.js','assets/js/workers/worker-rpc-host.js','tools/load-node-core.mjs']) add('workspace/'+path,resolve(workspace,path));
  const producerInputs=Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b)));
  return {producerSha256:hash(JSON.stringify(producerInputs)),producerInputs,
    coreManifestSha256:hash(readFileSync(resolve(workspace,'assets/wasm/pandoeditor-core.manifest.json')))};
}
const loadedRuntime=runtimeSnapshot();
export function runtimeResources() { return structuredClone(loadedRuntime); }
export function assertRuntimeResources(resources) {
  const current=runtimeSnapshot();
  for (const key of ['producerSha256','coreManifestSha256']) {
    if (current[key]!==loadedRuntime[key] || resources?.[key]!==loadedRuntime[key])
      throw Object.assign(new Error('Analysis runtime identity is missing or changed; analyze a new job with the current plugin and core.'),{code:'PL-MAP-RUNTIME-CHANGED'});
  }
}
