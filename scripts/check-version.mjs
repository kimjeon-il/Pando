import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(scriptsDirectory, '..');
const read = relativePath => readFileSync(resolve(projectRoot, relativePath), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const packageJson = JSON.parse(read('package.json'));
const appVersion = String(packageJson.version || '').trim();
const index = read('index.html');
const buildMetaSource = read('assets/js/build-meta.js');
const metaMatch = buildMetaSource.match(/PANDOLAB_BUILD_META\s*=\s*Object\.freeze\((\{[\s\S]*?\})\);/);
let buildMeta = null;
try { buildMeta = JSON.parse(metaMatch?.[1] || 'null'); } catch { /* report below */ }

expect(/^\d+\.\d+\.\d+$/.test(appVersion), `package.json version이 유효하지 않습니다: ${appVersion}`);
expect(buildMeta && buildMeta.appVersion === appVersion, 'build-meta.js의 appVersion이 package.json과 다릅니다.');
expect(buildMeta && buildMeta.buildId === buildMeta.assetRevision, 'buildId와 assetRevision은 동일한 build ID여야 합니다.');
expect(buildMeta && /^[0-9]+\.[0-9]+\.[0-9]+-build-[A-Za-z0-9._-]+$/.test(buildMeta.assetRevision), 'assetRevision 형식이 올바르지 않습니다.');
expect(index.includes(`data-app-version="${appVersion}"`), 'index.html의 data-app-version이 package.json과 다릅니다.');
expect(index.includes(`assets/js/build-meta.js?v=${buildMeta?.assetRevision || ''}`), 'index.html이 현재 build-meta revision을 사용하지 않습니다.');

const indexRevisions = [...index.matchAll(/\?v=([^"&]+)/g)].map(match => match[1]);
for (const revision of indexRevisions) expect(revision === buildMeta?.assetRevision, `index.html에 다른 asset revision이 있습니다: ${revision}`);

const productionFiles = [
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
