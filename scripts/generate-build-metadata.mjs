import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { decodeArchiveEntry, libraryCheckout, libraryConfig } from '../tools/library-data.mjs';
import { collectViewerAssets } from './lib/product-assets.mjs';
import { renderProductHtml } from './lib/product-html.mjs';
import { buildWorkerAsset } from './lib/worker-assets.mjs';
import { transform } from 'esbuild';

const scriptsDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(scriptsDirectory, '..');
const packageJsonPath = resolve(projectRoot, 'package.json');
const buildMetaPath = resolve(projectRoot, 'assets/js/build-meta.js');
const indexPath = resolve(projectRoot, 'index.html');
const editorPath = resolve(projectRoot, 'apps/web-shell/editor.html');
const readmePath = resolve(projectRoot, 'README.md');
const checkOnly = process.argv.includes('--check');
const pendingText = new Map();
// A mounted runtime cache may contain another task's unarchived data edits.
// Release identity belongs to the immutable data pin, without rewriting that cache.
const library = libraryConfig(projectRoot), checkout = libraryCheckout(projectRoot);
const libraryIndex = JSON.parse(execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
  'show', `${library.revision}:archive/index.json`], { cwd: checkout, maxBuffer: 16 * 1024 * 1024 }));
function readPinnedData(path) {
  const entry = libraryIndex.files[path];
  assert.ok(entry, `Missing pinned metadata input: ${path}`);
  return decodeArchiveEntry(checkout, entry, library.revision);
}
// Metadata consumes the published land derivative; GIS generation has its own owner.
const landManifest = JSON.parse(readPinnedData('assets/data/physical-land/v1/manifest.json'));
const physicalLandOutput = { manifest: landManifest };
const terrainSource = JSON.parse(readPinnedData('assets/data/terrain-preview/v0.13.3-p1/manifest.json'));
assert.equal(landManifest.sourceSha256, terrainSource.sourceDem.landMaskSha256, 'Physical land must use the pinned terrain mask source.');
function publishText(path, source) {
  if (checkOnly) assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), source.replaceAll('\r\n', '\n'), `Stale build metadata output: ${path}`);
  else pendingText.set(path, source);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const appVersion = String(packageJson.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error(`package.json version이 유효한 semver가 아닙니다: ${appVersion}`);
const DATA_MANIFEST_PATHS = Object.freeze([
  'assets/data/world/current.json',
  'assets/data/terrain-preview/v0.13.3-p1/manifest.json',
  'assets/data/physical-land/v1/manifest.json',
  'assets/data/hydro/v0.13.2/manifest.json',
  'assets/data/places/manifest.json',
  'assets/data/territorial-entities/generated/v2/index.json',
  'assets/data/builtin-world/generated/v1/index.json',
  'assets/data/prepared-polygons/generated/v2/manifest.json',
]);

function gitRevision() {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

const suppliedBuildId = String(process.env.PANDOLAB_BUILD_ID || '').trim();
const rawBuildId = suppliedBuildId || gitRevision();
const safeBuildId = rawBuildId.replace(/[^A-Za-z0-9._-]/g, '-');
// Verification preserves the published identifier: its commit necessarily
// precedes the bot commit that records the generated output.
const recordedMeta = checkOnly ? JSON.parse(readFileSync(buildMetaPath, 'utf8').match(/Object\.freeze\(([\s\S]*)\);\s*$/)?.[1] || 'null') : null;
if (checkOnly) assert.ok(recordedMeta?.buildId?.startsWith(`${appVersion}-build-`), 'Invalid published build identity');
const buildId = checkOnly ? recordedMeta.buildId : `${appVersion}-build-${safeBuildId || 'local'}`;
const assetRevision = buildId;
const workerAssets = {};
// Classic Workers consume the same pure module as ESM owners. The adapter is
// generated, never a second hand-maintained invalidation implementation.
const policyCorePath = resolve(projectRoot, 'assets/js/workers/resource-update-policy-core.js');
const policyCore = await transform(readFileSync(resolve(projectRoot, 'assets/js/modules/resource-update-policy.js'), 'utf8'),
  { format: 'iife', globalName: 'PandoLabResourceUpdatePolicy', target: 'es2022', legalComments: 'none' });
publishText(policyCorePath, '// Generated from modules/resource-update-policy.js. Do not edit.\n'
  + policyCore.code + '\nself.PandoLabResourceUpdatePolicy = PandoLabResourceUpdatePolicy;\n');
for (const name of readdirSync(resolve(projectRoot, 'assets/js/workers')).filter(name => name.endsWith('-worker.js')).sort()) {
  const entry = `assets/js/workers/${name}`;
  const generated = await buildWorkerAsset({ root: projectRoot, entry,
    readSource: path => pendingText.get(resolve(projectRoot, path)) ?? readFileSync(resolve(projectRoot, path), 'utf8') });
  workerAssets[entry] = { url: generated.url, files: [...generated.files.keys()].sort(),
    sha256: Object.fromEntries([...generated.files].sort(([a], [b]) => a.localeCompare(b))
      .map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])) };
  for (const [path, source] of generated.files) {
    publishText(resolve(projectRoot, path), source);
  }
}

// A query on the entry module is not inherited by relative ESM imports.
// Pin the complete browser module graph before bootstrap starts resolving it.
const moduleImports = {}, assetPaths = [];
function collectModuleImports(directory, prefix) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory() || entry.isSymbolicLink() && statSync(resolve(directory, entry.name)).isDirectory()) collectModuleImports(resolve(directory, entry.name), path);
    else if (entry.isFile()) {
      assetPaths.push(path.replace(/^\.\//, ''));
      if (path.startsWith('./assets/js/') && entry.name.endsWith('.js')) moduleImports[path] = `${path}?v=${encodeURIComponent(assetRevision)}`;
    }
  }
}
collectModuleImports(resolve(projectRoot, 'assets'), './assets');
// The current Worker closure is generated in-memory and committed only after the
// full plan passes. Dependency discovery must see those pending immutable files.
const pendingAssetPaths = [...pendingText.keys()].map(p => p.slice(projectRoot.length + 1).replaceAll('\\', '/'));
const viewerAssets = await collectViewerAssets({
  root: projectRoot,
  availablePaths: [...new Set([...assetPaths, ...pendingAssetPaths, 'index.html', '.nojekyll'])],
  workerAssets,
  readSource: path => pendingText.get(resolve(projectRoot, path)) ?? readFileSync(resolve(projectRoot, path), 'utf8'),
});
const viewerModuleImports = Object.fromEntries(Object.entries(moduleImports).filter(([path]) => viewerAssets.has(path.slice(2))));

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildDataRevision() {
  const digest = createHash('sha256');
  for (const relativePath of DATA_MANIFEST_PATHS) {
    const source = readPinnedData(relativePath).toString('utf8');
    let value;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(`데이터 manifest JSON을 읽을 수 없습니다: ${relativePath}`, { cause: error });
    }
    digest.update(relativePath);
    digest.update('\0');
    digest.update(stableJson(value));
    digest.update('\0');
  }
  return `data-${digest.digest('hex').slice(0, 32)}`;
}

const dataRevision = buildDataRevision();
const indexBytes = readPinnedData('assets/data/territorial-entities/generated/v2/index.json');
const territorialIndex = { encoding: 'identity', compressedBytes: indexBytes.length, decodedBytes: indexBytes.length,
  sha256: createHash('sha256').update(indexBytes).digest('hex') };
const historicalBytes = readPinnedData('assets/data/builtin-world/generated/v1/index.json');
const builtinWorld = { url: 'assets/data/builtin-world/generated/v1/index.json', encoding: 'identity',
  compressedBytes: historicalBytes.length, decodedBytes: historicalBytes.length,
  sha256: createHash('sha256').update(historicalBytes).digest('hex') };
const preparedPolygonBytes = readPinnedData('assets/data/prepared-polygons/generated/v2/manifest.json');
const preparedPolygonMeshes = { url: 'assets/data/prepared-polygons/generated/v2/manifest.json', encoding: 'identity',
  compressedBytes: preparedPolygonBytes.length, decodedBytes: preparedPolygonBytes.length,
  sha256: createHash('sha256').update(preparedPolygonBytes).digest('hex'),
  algorithmSourceSha256: JSON.parse(preparedPolygonBytes).algorithmSourceSha256 };

const metaSource = `// Generated by scripts/generate-build-metadata.mjs. Do not edit manually.\n` +
  `globalThis.PANDOLAB_BUILD_META = Object.freeze(${JSON.stringify({ appVersion, buildId, assetRevision, dataRevision, territorialIndex, builtinWorld, preparedPolygonMeshes, workerAssets, physicalLand: physicalLandOutput.manifest.asset, physicalWaterHistory: landManifest.historicalWaterbodies || [] }, null, 2)});\n`;
publishText(buildMetaPath, metaSource);

const productHtml=renderProductHtml(path=>readFileSync(resolve(projectRoot,path),'utf8'));
for (const [htmlPath, imports, mode] of [[indexPath, viewerModuleImports,'web'], [editorPath, moduleImports,'editor']]) {
let index = productHtml[mode].replaceAll('{{assetRevision}}',assetRevision);
index = index.replace(/(\bdata-app-version=")[^"]+(")/, `$1${appVersion}$2`);
index = index.replace(/(\b(?:href|src)="[^"]*assets\/[^"?]+)(?:\?v=[^"]*)?(")/g,
  (_match, start, end) => /assets\/fonts\/pretendard-v\d+\.\d+\.\d+\/[^/]+\.woff2$/.test(start)
    ? `${start}${end}` : `${start}?v=${assetRevision}${end}`);
const moduleImportMap = `<script id="pandolab-module-import-map" type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n  </script>`;
const moduleImportMapPattern = /<script\b[^>]*id="pandolab-module-import-map"[^>]*>[\s\S]*?<\/script>/;
index = moduleImportMapPattern.test(index)
  ? index.replace(moduleImportMapPattern, () => moduleImportMap)
  : index.replace(/(?=<script\b)/, `${moduleImportMap}\n  `);
if (!index.includes(`assets/js/build-meta.js?v=${assetRevision}`)) {
  index = index.replace(/(\s*<script src="assets\/js\/vendor\/d3\.min\.js"[^>]*><\/script>)/, `\n  <script src="assets/js/build-meta.js?v=${assetRevision}" defer></script>$1`);
}
publishText(htmlPath, index);
}

let readme = readFileSync(readmePath, 'utf8');
if (!/^# .*?v\d+\.\d+\.\d+/m.test(readme)) throw new Error('README 최신 버전 제목을 찾을 수 없습니다.');
readme = readme.replace(/^(# .*?v)\d+\.\d+\.\d+/m, `$1${appVersion}`);
publishText(readmePath, readme);

if (!checkOnly) {
  // Validate the whole plan before publishing any Worker or metadata. Roll back
  // just this write set on failure; do not discard the last valid asset graph.
  const previous = new Map();
  try {
    for (const [path, source] of pendingText) {
      previous.set(path, existsSync(path) ? readFileSync(path) : null);
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source, 'utf8');
    }
  } catch (error) {
    for (const [path, bytes] of previous) {
      if (bytes) writeFileSync(path, bytes); else if (existsSync(path)) unlinkSync(path);
    }
    throw error;
  }
  const active = new Set(Object.values(workerAssets).flatMap(asset => asset.files.map(path => path.split('/')[2])));
  const runtime = resolve(projectRoot, 'assets/worker-runtime');
  for (const entry of readdirSync(runtime, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name) || active.has(entry.name)) continue;
    const path = resolve(runtime, entry.name), logical = `assets/worker-runtime/${entry.name}`;
    // A modified or untracked old closure could be unfinished work. Preserve it.
    if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--ignored', '--', logical], { cwd: projectRoot, encoding: 'utf8' }).trim()) continue;
    const noLinks = path => !lstatSync(path).isSymbolicLink() && readdirSync(path, { withFileTypes: true }).every(item => !item.isSymbolicLink() && (!item.isDirectory() || noLinks(resolve(path, item.name))));
    if (noLinks(path)) rmSync(path, { recursive: true });
  }
}

console.log(`${checkOnly ? 'Verified' : 'Generated'} PandoLab build metadata: ${buildId} (${dataRevision})`);
