import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { build } from 'esbuild';

// Dependencies selected through URLs or classic Worker APIs are reviewed here;
// static ESM edges are discovered by the same parser used by the build tooling.
export const runtimeDependencies = Object.freeze({
  'assets/js/modules/map-display-client.js':['assets/js/workers/map-display-worker.js'],
  'assets/js/modules/gpu-scene.js':['assets/js/workers/gpu-mesh-worker.js'],
  'assets/js/modules/territorial-labels.js':['assets/data/places/manifest.json','assets/js/workers/place-worker.js'],
  'assets/js/modules/country-index.js':['assets/js/workers/label-anchor-worker.js'],
  'assets/js/modules/core-document-client.js': ['assets/js/workers/core-viewer-session-worker.js'],
  'assets/js/modules/core-wasm-loader.js': ['assets/wasm/pandoeditor-core.js', 'assets/wasm/pandoeditor-core.wasm', 'assets/wasm/pandoeditor-core.manifest.json'],
  'assets/js/modules/gpu-map-renderer.js': ['assets/js/workers/hydro-tile-worker.js', 'assets/js/workers/gpu-mesh-worker.js',
    'assets/js/workers/country-shared-boundary-worker.js', 'assets/js/workers/canvas-render-worker.js'],
  'assets/js/modules/builtin-mesh-resource.js': ['assets/js/workers/data-loader-worker.js','assets/data/world/current.json'],
  'assets/js/modules/builtin-world-loader.js': ['assets/data/builtin-world/generated/v1/index.json'],
  'assets/js/modules/physical-source-configuration.js': ['assets/data/terrain-preview/v0.13.3-p2/manifest.json'],
  'assets/js/workers/canvas-render-worker.js': ['assets/js/vendor/d3.min.js', 'assets/js/workers/geographic-boundary-core.js',
    'assets/js/workers/canvas-scene-composition-core.js', 'assets/js/workers/canvas-terrain-dem-core.js', 'assets/js/modules/terrain-manifest.js'],
  'assets/js/workers/project-read-worker.js': ['assets/js/vendor/sql/sql-wasm.js', 'assets/js/vendor/sql/sql-wasm.wasm'],
});
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
  // Current runtime manifests own data dependencies. Source/provenance fields
  // describe how data was built and must not publish the original GIS inputs.
  const manifests=[
    'assets/data/world/current.json',
    'assets/data/builtin-world/generated/v1/index.json',
    'assets/data/territorial-entities/generated/v2/index.json',
    'assets/data/prepared-polygons/generated/v2/manifest.json',
    'assets/data/hydro/v0.13.2/manifest.json',
    'assets/data/places/manifest.json',
    'assets/data/terrain-preview/v0.13.3-p2/manifest.json',
    'assets/data/physical-land/v1/manifest.json',
  ];
  const dataAsset=(url,base)=>{
    if(typeof url!=='string'||!url||/[?#\\]/.test(url))throw Error(`Invalid manifest resource: ${url}`);
    return include(url.startsWith('assets/')?url:base+url);
  };
  for(const path of manifests){
    if(!available.has(path))continue;
    include(path);
    const manifest=JSON.parse(readSource(path)),base=path.slice(0,path.lastIndexOf('/')+1);
    if(path==='assets/data/world/current.json'){
      for(const item of Object.values(manifest.assets||{}))dataAsset(item.url,'assets/data/');
      for(const url of Object.values(manifest.compatibility?.sharedBoundaries||{}))dataAsset(url,'assets/data/');
    }else if(path.includes('/builtin-world/')){
      dataAsset(manifest.transport.url,base);
      for(const item of manifest.entities)dataAsset(item.file,base);
    }
    else if(path.includes('/territorial-entities/')){
      for(const item of manifest.entities)dataAsset(item.file,base);
    }else if(path.includes('/prepared-polygons/')){
      for(const item of Object.values(manifest.meshes))dataAsset(item.url,base);
    }else if(path.includes('/hydro/')){
      dataAsset(manifest.container.url,base);
      for(const item of [manifest.index,manifest.metadata?.core,manifest.metadata?.detail,...manifest.shards])if(item?.url)dataAsset(item.url,base);
      if(manifest.sources?.independentHydronymReplacements?.file)
        dataAsset(manifest.sources.independentHydronymReplacements.file,base);
    }else if(path.includes('/places/')){
      for(const item of Object.values(manifest.shards))dataAsset(item.url,base);
    }else if(path.includes('/physical-land/')){
      dataAsset(manifest.asset.url,base);
      for(const context of manifest.historicalWaterbodies||[])
        for(const item of [context.land,context.water])dataAsset(item.url,'assets/data/');
    }
    else if(path.includes('/terrain-preview/')){
      for(const key of Object.keys(manifest.tiles))dataAsset(key,base);
    }
  }
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
        if (importer === 'assets/js/modules/temporal.js' && args.path === '../../../tools/load-node-core.mjs')
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
