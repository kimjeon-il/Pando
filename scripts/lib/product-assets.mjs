import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import {collectRuntimeDataAssets} from "../../src/data/runtime-manifest-assets.js";
import {validateMapProjectManifest} from "../../src/data/map-project-manifest.js";

// Dependencies selected through URLs or classic Worker APIs are reviewed here;
// static ESM edges are discovered by the same parser used by the build tooling.
export const runtimeDependencies = Object.freeze({
  'assets/js/modules/map-display-client.js':['assets/js/workers/map-display-worker.js'],
  'assets/js/modules/gpu-scene.js':['assets/js/workers/gpu-mesh-worker.js'],
  'assets/js/modules/territorial-labels.js':['assets/js/workers/place-worker.js'],
  'assets/js/modules/country-index.js':['assets/js/workers/label-anchor-worker.js'],
  'assets/js/modules/core-document-client.js': ['assets/js/workers/core-viewer-session-worker.js'],
  'assets/js/modules/core-wasm-loader.js': ['assets/wasm/pandoeditor-core.js', 'assets/wasm/pandoeditor-core.wasm', 'assets/wasm/pandoeditor-core.manifest.json'],
  'assets/js/modules/gpu-map-renderer.js': ['assets/js/workers/hydro-tile-worker.js', 'assets/js/workers/gpu-mesh-worker.js',
    'assets/js/workers/country-shared-boundary-worker.js', 'assets/js/workers/canvas-render-worker.js'],
  'assets/js/modules/builtin-mesh-resource.js': ['assets/js/workers/data-loader-worker.js'],
  'assets/js/workers/canvas-render-worker.js': ['assets/js/vendor/d3.min.js', 'assets/js/workers/geographic-boundary-core.js',
    'assets/js/workers/canvas-scene-composition-core.js', 'assets/js/workers/canvas-terrain-dem-core.js', 'assets/js/modules/terrain-manifest.js'],
  'assets/js/workers/project-read-worker.js': ['assets/js/vendor/sql/sql-wasm.js', 'assets/js/vendor/sql/sql-wasm.wasm'],
});
export const viewerDataEntryPaths = Object.freeze([...new Set(Object.values(runtimeDependencies).flat()
  .filter(path => path.startsWith('assets/data/')))]);
export const dynamicExpressions = Object.freeze({
  'assets/js/modules/core-wasm-loader.js': ['url'],
  'assets/js/workers/canvas-render-worker.js': ['validationUrl.href'],
  'assets/js/workers/place-worker.js': ['storeModuleUrl.href'],
});
const editorOnly = /^(?:assets\/js\/(?:app|bootstrap|gis-io|gis-adapters)\.js|assets\/js\/modules\/(?:app-(?:composition|runtime-dependencies|domain-assembly|lifecycle-assembly|project-restore|project-snapshots|country-commits|generic-commands|object-commands|global-input-bindings|file-bindings|tool-bindings|editor-bindings|territorial-drafts|territory-selection-workflow|geometry-preview|history-assembly|gis-assembly|library-assembly)|editing-|editor-map-click|spatial-edit-registration|project-setup-dialog|project-file-service|import-service|export-service)|assets\/js\/workers\/(?:core-session-worker|map-edit-worker|gis-gpkg-worker|gis-geometry-worker|geometry-validation-worker|river-territory-partition-worker)\.js)/;
const slash = path => path.replaceAll('\\', '/');

const stripQuery = path => path.split(/[?#]/, 1)[0];

// Processing remnants must never become public viewer assets.
export const isEditorOnlyAsset = path => editorOnly.test(path) || path.startsWith('assets/vendor/reference-analysis/');

export async function collectViewerAssets({ root, availablePaths, readSource = path => readFileSync(resolve(root, path), 'utf8'), workerAssets = null }) {
  const {build}=await import('esbuild');
  root = resolve(root);
  const available = new Set(availablePaths), selected = new Set(), entries = new Set();
  function include(path) {
    if (path.split('/').some(part=>part==='..'||part==='.') || !/^(?:assets\/|index\.html$|\.nojekyll$)/.test(path)) throw Error(`Non-product dependency: ${path}`);
    if (isEditorOnlyAsset(path)) throw Error(`Viewer reaches editor-only dependency: ${path}`);
    if (!available.has(path)) throw Error(`Missing viewer dependency: ${path}`);
    selected.add(path);
    return path;
  }
  function local(specifier, importer) {
    const path = stripQuery(specifier);
    if (/^(?:https?:|data:|blob:|#)/.test(path)) throw Error(`External viewer dependency: ${specifier}`);
    return slash(relative(root, resolve(dirname(resolve(root, importer)), path)));
  }
  include('index.html'); include('.nojekyll'); include('assets/js/viewer.js'); entries.add('assets/js/viewer.js');
  for (const path of available) {
    if (/^assets\/(?:fonts|vendor|wasm)\//.test(path) && !path.endsWith('.map') && !isEditorOnlyAsset(path)) include(path);
  }
  const previewMetadataSource=readSource('assets/js/build-meta.js');
  const previewMetadata=/Object\.freeze\(([\s\S]*)\);\s*$/.exec(previewMetadataSource);
  if(!previewMetadata)throw Error('Viewer build metadata must be immutable.');
  const meta=JSON.parse(previewMetadata[1]);
  const project=meta.mapProject?validateMapProjectManifest(meta.mapProject):null;
  if(project){
    const spec=meta.mapProjectManifest;
    if(!spec?.url||!/^assets\/data\/projects\/[a-z0-9-]+\/manifest\.json$/.test(spec.url))
      throw Error('Missing map project manifest publication');
    include(spec.url);
    const bytes=Buffer.from(readSource(spec.url),'utf8');
    if(bytes.length!==spec.compressedBytes||createHash('sha256').update(bytes).digest('hex')!==spec.sha256)
      throw Error('Map project manifest bytes differ from the build identity');
    if(JSON.stringify(validateMapProjectManifest(JSON.parse(bytes)))!==JSON.stringify(project))
      throw Error('Map project manifest disagrees with runtime selection');
  }
  for(const path of collectRuntimeDataAssets({availablePaths:available,
    entryPaths:viewerDataEntryPaths,projectManifest:project,
    readManifest:path=>JSON.parse(readSource(path))}))include(path);
  const dataAsset=(url,base)=>include(url.startsWith('assets/')?url:base+url);
  const previewSpec=meta.initialLandPreview;
  if(!previewSpec?.url)throw Error('Missing immutable first-map land preview.');
  dataAsset(previewSpec.url,'assets/data/');
  const html = readSource('index.html');
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const path = stripQuery(match[1]).replace(/^\.\//, '');
    if (!path.startsWith('assets/')) continue;
    include(path); if (path.endsWith('.js')) entries.add(path);
  }
  const cssQueue = [...selected].filter(path => path.endsWith('.css'));
  for (let at = 0; at < cssQueue.length; at++) {
    const path = cssQueue[at], text = readSource(path);
    for (const match of text.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^\s"')]+)["']?\s*\)?/g)) {
      if (/^(?:data:|#)/.test(match[1])) continue;
      const dependency = local(match[1], path), seen = selected.has(dependency);
      include(dependency); if (!seen && dependency.endsWith('.css')) cssQueue.push(dependency);
    }
  }
  await build({ absWorkingDir: root, entryPoints: [...entries], bundle: true, write: false,
    outdir: resolve(root, '.product-graph-unused'), format: 'esm', platform: 'browser', logLevel: 'silent',
    plugins: [{ name: 'viewer-product-closure', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const importer = slash(relative(root, args.importer));
        if (importer === 'assets/js/modules/temporal.js' && args.path === '../../../tools/build/load-node-core.mjs')
          return { path: args.path, external: true }; // Explicit Node-only calculation test adapter.
        const path = args.kind === 'entry-point' ? slash(relative(root, resolve(root, args.path))) : local(args.path, importer);
        include(path); return { path: resolve(root, path) };
      });
      builder.onLoad({ filter: /\.js$/ }, args => {
        const path = slash(relative(root, args.path));
        if (/^assets\/(?:js\/vendor|vendor|wasm)\//.test(path)) return { contents: '', loader: 'js' };
        let source = readSource(path);
        // Only the query may vary: the module identity before '?' is fixed.
        source = source.replace(/\bimport\s*\(\s*`([^`$?]+)\?[^`]*`\s*\)/g, (_, specifier) => `import(${JSON.stringify(specifier)})`);
        if (/\bimport\s*\(\s*`/.test(source)) throw Error(`Uncatalogued dynamic module identity in ${path}`);
        for (const match of source.matchAll(/\bimport\s*\(\s*(?!['"\s])([^)]*)\)/g)) {
          if (!(dynamicExpressions[path] || []).includes(match[1].trim()))
            throw Error(`Uncatalogued dynamic import in ${path}: ${match[1]}`);
        }
        const dependencies = new Set(runtimeDependencies[path] || []);
        for (const match of source.matchAll(/new URL\(\s*['"]([^'"]+\.(?:js|wasm)(?:\?[^'"]*)?)['"]/g)) dependencies.add(local(match[1], path));
        for (const call of source.matchAll(/\bimportScripts\(([^)]*)\)/g)) {
          for (const match of call[1].matchAll(/['"]([^'"]+\.js(?:\?[^'"]*)?)['"]/g)) dependencies.add(local(match[1], path));
        }
        for (const match of source.matchAll(/runtimeAssetUrl\(\s*['"]([^'"]+)['"]/g)) {
          const dependency = slash(relative(root,resolve(root,'assets/js',stripQuery(match[1]))));
          if (!dependencies.has(dependency)) throw Error(`Uncatalogued runtime asset in ${path}: ${dependency}`);
        }
        for (const dependency of dependencies) {
          include(dependency);
          if (dependency.endsWith('.js')) source += `\nimport ${JSON.stringify(`./${slash(relative(dirname(args.path), resolve(root, dependency)))}`)};`;
        }
        return { contents: source, loader: 'js' };
      });
    } }],
  });
  if (workerAssets === null) {
    const source = readSource('assets/js/build-meta.js');
    workerAssets = JSON.parse(source.match(/Object\.freeze\(([\s\S]*)\);\s*$/)?.[1] || '{}').workerAssets || {};
  }
  if (Object.keys(workerAssets).length) for (const path of selected) {
    if (/^assets\/js\/workers\/[\w-]+-worker\.js$/.test(path) && !workerAssets[path]) throw Error('Missing immutable Worker manifest: ' + path);
  }
  for (const [entry, asset] of Object.entries(workerAssets)) if (selected.has(entry)) {
    const prefix = asset.url.slice(0, asset.url.indexOf('/assets/js/workers/') + 1);
    if (!asset.files.includes(asset.url)) throw Error(`Incomplete immutable Worker entry: ${entry}`);
    for (const path of asset.files) {
      if (!path.startsWith(prefix) || !/^assets\/worker-runtime\/[a-f0-9]{32}\/assets\//.test(path) || isEditorOnlyAsset(path.replace(/^assets\/worker-runtime\/[a-f0-9]{32}\//, ''))) throw Error(`Invalid viewer Worker dependency: ${path}`);
      include(path);
      if (asset.sha256?.[path] !== createHash('sha256').update(readSource(path).replaceAll('\r\n', '\n')).digest('hex')) throw Error(`Immutable Worker asset mismatch: ${path}`);
    }
    selected.delete(entry); // Only the immutable entry is executable in the published viewer.
  }
  return selected;
}
