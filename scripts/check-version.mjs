import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {buildFrontendSnapshot} from './lib/frontend-build.mjs';
import { isEditorOnlyAsset } from './lib/product-assets.mjs';

const scriptsDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(scriptsDirectory, '..');
const snapshot=await buildFrontendSnapshot({root:projectRoot});
const read=path=>path==='apps/editor/editor.html'?snapshot.html.editor:snapshot.assets.has(path)?snapshot.assets.get(path).bytes.toString('utf8'):readFileSync(resolve(projectRoot,path),'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const packageJson = JSON.parse(read('package.json'));
const appVersion = String(packageJson.version || '').trim();
const productEntries = [
  { path: 'index.html', mode: 'viewer', entry: 'assets/js/viewer.js' },
  { path: 'apps/editor/editor.html', mode: 'editor', entry: 'assets/js/bootstrap.js' },
];
const buildMetaSource = read('assets/js/build-meta.js');
const metaMatch = buildMetaSource.match(/PANDOLAB_BUILD_META\s*=\s*Object\.freeze\((\{[\s\S]*?\})\);/);
let buildMeta = null;
try { buildMeta = JSON.parse(metaMatch?.[1] || 'null'); } catch { /* report below */ }

expect(/^\d+\.\d+\.\d+$/.test(appVersion), `package.json version이 유효하지 않습니다: ${appVersion}`);
expect(buildMeta && buildMeta.appVersion === appVersion, 'build-meta.js의 appVersion이 package.json과 다릅니다.');
expect(buildMeta && buildMeta.buildId === buildMeta.assetRevision, 'buildId와 assetRevision은 동일한 build ID여야 합니다.');
expect(buildMeta && /^[0-9]+\.[0-9]+\.[0-9]+-build-[A-Za-z0-9._-]+$/.test(buildMeta.assetRevision), 'assetRevision 형식이 올바르지 않습니다.');
expect(buildMeta && /^data-[a-f0-9]{32}$/.test(buildMeta.dataRevision || ''), 'dataRevision 형식이 올바르지 않습니다.');
for (const product of productEntries) {
const index = read(product.path);
if (product.mode === 'editor') expect(index.includes(`data-app-version="${appVersion}"`), `${product.path}의 data-app-version이 package.json과 다릅니다.`);
expect(index.includes(`${product.entry}?v=${buildMeta?.assetRevision || ''}`), `${product.path}이 현재 제품 진입점을 사용하지 않습니다.`);
expect(index.includes(`assets/js/build-meta.js?v=${buildMeta?.assetRevision || ''}`), `${product.path}이 현재 build-meta revision을 사용하지 않습니다.`);

const indexRevisions = [...index.matchAll(/\?v=([^"&]+)/g)].map(match => match[1]);
for (const revision of indexRevisions) expect(revision === buildMeta?.assetRevision, `${product.path}에 다른 asset revision이 있습니다: ${revision}`);

// Transitive browser imports must use the same deployment as the entry module.
const moduleImportMap = index.match(/<script\b[^>]*id="pandolab-module-import-map"[^>]*>([\s\S]*?)<\/script>/);
try {
  const imports = JSON.parse(moduleImportMap?.[1] || 'null')?.imports;
  expect(imports && Object.keys(imports).length > 0, '브라우저 모듈 import map이 없습니다.');
  for (const [specifier, target] of Object.entries(imports || {})) {
    if (product.mode === 'viewer') expect(!isEditorOnlyAsset(specifier.slice(2)),
      `뷰어 import map에 편집기 모듈이 있습니다: ${specifier}`);
    const source = new URL(specifier, 'https://build.invalid/');
    const destination = new URL(target, 'https://build.invalid/');
    expect(specifier.startsWith('./assets/js/') && specifier.endsWith('.js')
      && snapshot.assets.has(specifier.slice(2)), `현재 모듈 파일이 없습니다: ${specifier}`);
    expect(source.origin === destination.origin && source.pathname === destination.pathname
      && destination.searchParams.get('v') === buildMeta?.assetRevision,
      `브라우저 모듈 버전이 일치하지 않습니다: ${specifier}`);
  }
} catch (error) {
  failures.push(`브라우저 모듈 import map 검증에 실패했습니다: ${error.message}`);
}
}

// Dataset identity is content-addressed and independent from package.json.version.
const bundlePath = 'assets/data/world/current.json';
expect(existsSync(resolve(projectRoot, bundlePath)), `${bundlePath} 데이터 매니페스트가 없습니다.`);
if (existsSync(resolve(projectRoot, bundlePath))) {
  try {
    const { validateWorldBundle } = await import("../shared/frontend/js/modules/world-bundle-manifest.js");
    const bundle = validateWorldBundle(JSON.parse(read(bundlePath)));
    for (const [role, asset] of Object.entries(bundle.assets)) {
      expect(existsSync(resolve(projectRoot, 'assets/data', asset.url)),
        `세계지도 ${role} 불변 파일이 없습니다: ${asset.url}`);
    }
  } catch (error) {
    failures.push(`세계지도 데이터 매니페스트 검증에 실패했습니다: ${error.message}`);
  }
}

// Generated preparation metadata is an integrity contract, not merely a version label.
// A stale size or checksum disables fixed-mesh loading and large polygon editing.
const preparedPath = 'assets/data/prepared-polygons/generated/v2/manifest.json';
expect(existsSync(resolve(projectRoot, preparedPath)), `Prepared polygon manifest is missing: ${preparedPath}`);
if (existsSync(resolve(projectRoot, preparedPath))) {
  try {
    const bytes = readFileSync(resolve(projectRoot, preparedPath));
    const manifest = JSON.parse(bytes.toString('utf8'));
    const expected = {
      url: preparedPath,
      encoding: 'identity',
      compressedBytes: bytes.length,
      decodedBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      algorithmSourceSha256: manifest.algorithmSourceSha256,
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(buildMeta?.preparedPolygonMeshes?.[key] === value,
        `build-meta.js의 preparedPolygonMeshes.${key}가 현재 매니페스트와 다릅니다.`);
    }
  } catch (error) {
    failures.push(`Prepared polygon metadata validation failed: ${error.message}`);
  }
}

const productionFiles = [
  'assets/js/viewer.js',
  'assets/js/workers/core-viewer-session-worker.js',
  'assets/js/bootstrap.js',
  'assets/js/app.js',
  'assets/js/gis-io.js',
  'assets/js/workers/data-loader-worker.js',
  'assets/js/workers/gis-gpkg-worker.js',
  'assets/js/workers/gpu-mesh-worker.js',
];
for (const relativePath of productionFiles) {
  const source = read(relativePath);
  expect(!/0\.\d+\.\d+-r\d+/.test(source), `${relativePath}에 수동 rN asset revision이 남아 있습니다.`);
}

const readmeHeading = read('README.md').match(/^# .*?v(\d+\.\d+\.\d+)/m)?.[1];
expect(readmeHeading === appVersion, `README 최신 버전(${readmeHeading || '없음'})이 package.json(${appVersion})과 다릅니다.`);

if (failures.length) {
  console.error('Version check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Version metadata is consistent for ${appVersion} (${buildMeta.assetRevision}).`);
