import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { build } from 'esbuild';

// Dependencies selected through URLs or classic Worker APIs are reviewed here;
// static ESM edges are discovered by the same parser used by the build tooling.
const runtimeDependencies = Object.freeze({
  'assets/js/modules/core-document-client.js': ['assets/js/workers/core-viewer-session-worker.js'],
  'assets/js/modules/core-wasm-loader.js': ['assets/wasm/pandoeditor-core.js', 'assets/wasm/pandoeditor-core.wasm', 'assets/wasm/pandoeditor-core.manifest.json'],
  'assets/js/modules/gpu-map-renderer.js': ['assets/js/workers/hydro-tile-worker.js', 'assets/js/workers/gpu-mesh-worker.js',
    'assets/js/workers/country-shared-boundary-worker.js', 'assets/js/workers/canvas-render-worker.js'],
  'assets/js/modules/builtin-mesh-resource.js': ['assets/js/workers/data-loader-worker.js'],
  'assets/js/workers/canvas-render-worker.js': ['assets/js/vendor/d3.min.js', 'assets/js/workers/geographic-boundary-core.js',
    'assets/js/workers/canvas-scene-composition-core.js', 'assets/js/workers/canvas-terrain-dem-core.js', 'assets/js/modules/terrain-manifest.js'],
  'assets/js/workers/project-read-worker.js': ['assets/js/vendor/sql/sql-wasm.js', 'assets/js/vendor/sql/sql-wasm.wasm'],
});
const dynamicExpressions = Object.freeze({
  'assets/js/modules/core-wasm-loader.js': ['url'],
  'assets/js/workers/canvas-render-worker.js': ['validationUrl.href'],
  'assets/js/workers/place-worker.js': ['storeModuleUrl.href'],
});
const editorOnly = /^(?:assets\/js\/(?:app|bootstrap|gis-io|gis-adapters)\.js|assets\/js\/modules\/(?:app-|editing-|project-domain|project-setup-dialog|project-file-service|import-service|export-service)|assets\/js\/workers\/(?:core-session-worker|map-edit-worker|gis-gpkg-worker|gis-geometry-worker|geometry-validation-worker|river-territory-partition-worker)\.js)/;
const slash = path => path.replaceAll('\\', '/');
const stripQuery = path => path.split(/[?#]/, 1)[0];

export async function collectViewerAssets({ root, availablePaths, readSource = path => readFileSync(resolve(root, path), 'utf8') }) {
  root = resolve(root);
  const available = new Set(availablePaths), selected = new Set(), entries = new Set();
  function include(path) {
    if (path.startsWith('../') || !/^(?:assets\/|index\.html$|\.nojekyll$)/.test(path)) throw Error(`Non-product dependency: ${path}`);
    if (editorOnly.test(path)) throw Error(`Viewer reaches editor-only dependency: ${path}`);
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
    if (/^assets\/(?:data|fonts|vendor|wasm)\//.test(path) && !path.endsWith('.map')) include(path);
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
          const dependency = `assets/js/${stripQuery(match[1])}`;
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
  return selected;
}
