import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { prepareLibraryData } from '../tools/library-data.mjs';
import { collectViewerAssets } from './lib/product-assets.mjs';
import { renderProductHtml } from './lib/product-html.mjs';
import { buildWorkerAsset } from './lib/worker-assets.mjs';

const scriptsDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(scriptsDirectory, '..');
const packageJsonPath = resolve(projectRoot, 'package.json');
const buildMetaPath = resolve(projectRoot, 'assets/js/build-meta.js');
const indexPath = resolve(projectRoot, 'index.html');
const editorPath = resolve(projectRoot, 'apps/web-shell/editor.html');
const readmePath = resolve(projectRoot, 'README.md');
const checkOnly = process.argv.includes('--check');
prepareLibraryData({ root: projectRoot });
// Metadata consumes the published land derivative; GIS generation has its own owner.
const landManifest = JSON.parse(readFileSync(resolve(projectRoot, 'assets/data/physical-land/v1/manifest.json')));
const physicalLandOutput = { manifest: landManifest };
const terrainSource = JSON.parse(readFileSync(resolve(projectRoot, 'assets/data/terrain-preview/v0.13.3-p1/manifest.json')));
assert.equal(landManifest.sourceSha256, terrainSource.sourceDem.landMaskSha256, 'Physical land must use the pinned terrain mask source.');
function publishText(path, source) {
  if (checkOnly) assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), source.replaceAll('\r\n', '\n'), `Stale build metadata output: ${path}`);
  else writeFileSync(path, source, 'utf8');
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
for (const name of readdirSync(resolve(projectRoot, 'assets/js/workers')).filter(name => name.endsWith('-worker.js')).sort()) {
  const entry = `assets/js/workers/${name}`;
  const generated = await buildWorkerAsset({ root: projectRoot, entry });
  workerAssets[entry] = { url: generated.url, files: [...generated.files.keys()].sort(),
    sha256: Object.fromEntries([...generated.files].sort(([a], [b]) => a.localeCompare(b))
      .map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])) };
  for (const [path, source] of generated.files) {
    if (!checkOnly) mkdirSync(dirname(resolve(projectRoot, path)), { recursive: true });
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
const viewerAssets = await collectViewerAssets({ root: projectRoot, availablePaths: [...assetPaths, 'index.html', '.nojekyll'], workerAssets });
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
    const absolutePath = resolve(projectRoot, relativePath);
    const source = readFileSync(absolutePath, 'utf8');
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
const indexBytes = readFileSync(resolve(projectRoot, 'assets/data/territorial-entities/generated/v2/index.json'));
const territorialIndex = { encoding: 'identity', compressedBytes: indexBytes.length, decodedBytes: indexBytes.length,
  sha256: createHash('sha256').update(indexBytes).digest('hex') };
const historicalBytes = readFileSync(resolve(projectRoot, 'assets/data/builtin-world/generated/v1/index.json'));
const builtinWorld = { url: 'assets/data/builtin-world/generated/v1/index.json', encoding: 'identity',
  compressedBytes: historicalBytes.length, decodedBytes: historicalBytes.length,
  sha256: createHash('sha256').update(historicalBytes).digest('hex') };
const preparedPolygonBytes = readFileSync(resolve(projectRoot, 'assets/data/prepared-polygons/generated/v2/manifest.json'));
const preparedPolygonMeshes = { url: 'assets/data/prepared-polygons/generated/v2/manifest.json', encoding: 'identity',
  compressedBytes: preparedPolygonBytes.length, decodedBytes: preparedPolygonBytes.length,
  sha256: createHash('sha256').update(preparedPolygonBytes).digest('hex'),
  algorithmSourceSha256: JSON.parse(preparedPolygonBytes).algorithmSourceSha256 };

const metaSource = `// Generated by scripts/generate-build-metadata.mjs. Do not edit manually.\n` +
  `globalThis.PANDOLAB_BUILD_META = Object.freeze(${JSON.stringify({ appVersion, buildId, assetRevision, dataRevision, territorialIndex, builtinWorld, preparedPolygonMeshes, workerAssets, physicalLand: physicalLandOutput.manifest.asset }, null, 2)});\n`;
publishText(buildMetaPath, metaSource);

const productHtml=renderProductHtml(path=>readFileSync(resolve(projectRoot,path),'utf8'));
for (const [htmlPath, imports, mode] of [[indexPath, viewerModuleImports,'web'], [editorPath, moduleImports,'editor']]) {
let index = productHtml[mode].replaceAll('{{assetRevision}}',assetRevision);
index = index.replace(/(\bdata-app-version=")[^"]+(")/, `$1${appVersion}$2`);
index = index.replace(/(\b(?:href|src)="[^"]*assets\/[^"?]+)(?:\?v=[^"]*)?(")/g, `$1?v=${assetRevision}$2`);
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

console.log(`${checkOnly ? 'Verified' : 'Generated'} PandoLab build metadata: ${buildId} (${dataRevision})`);
