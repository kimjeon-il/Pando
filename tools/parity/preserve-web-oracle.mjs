import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test-only source admission. This never reads the current working implementation
// and never creates or changes a behavioral expected-result fixture.
const baseline = '930060923889d17134e36e152c29f4adbb2e60a9';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const target = join(root, 'tests/fixtures/portability/web-9300609-oracle');
const entries = [
  'tools/parity/command-history.mjs', 'tests/helpers/timeline-project.mjs',
  'tests/fixtures/timeline-storage.json',
  'assets/js/modules/project-transaction.js', 'assets/js/modules/project-state.js',
  'assets/js/modules/country-flags.js', 'assets/js/modules/selection-domain.js',
  'assets/js/modules/editing-domain.js', 'assets/js/modules/app-project-snapshots.js',
  'assets/js/modules/app-generic-commands.js', 'assets/js/modules/app-object-deletion.js',
  'assets/js/modules/label-layout.js',
  'assets/js/modules/generic-feature-service.js', 'assets/js/modules/distribution-service.js',
  'assets/js/modules/app-object-metadata.js', 'assets/js/modules/app-hydro-settings.js',
  'assets/js/modules/app-map-settings.js', 'assets/js/modules/app-layer-list.js',
];
const files = new Map();
const dependencies = source => [...source.matchAll(/^\s*(?:import|export)\s+(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gm),
  ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
function capture(path) {
  if (files.has(path)) return;
  const bytes = execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, maxBuffer: 4*1024*1024 });
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  files.set(path, { bytes, blob, sha256 });
  for (const specifier of dependencies(bytes.toString('utf8'))) {
    if (specifier.startsWith('node:')) continue;
    if (!specifier.startsWith('.')) throw new Error(`Unadmitted oracle dependency: ${path} -> ${specifier}`);
    const dependency = posix.normalize(posix.join(posix.dirname(path), specifier));
    if (dependency.startsWith('../') || dependency.startsWith('/')) throw new Error(`Oracle dependency escapes repository: ${dependency}`);
    capture(dependency);
  }
}
for (const path of entries) capture(path);
function preserve(path, bytes) {
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) throw new Error(`Refusing to overwrite changed frozen oracle: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
}
for (const [path, { bytes }] of files) preserve(join(target, path), bytes);
const manifest = { schema: 'pandoeditor-web-test-oracle', baseline, entries: entries.toSorted(),
  files: [...files].map(([path, { blob, sha256 }]) => ({ path, blob, sha256 })).sort((a,b) => a.path.localeCompare(b.path, 'en')) };
const manifestPath = join(target, 'manifest.json');
if (existsSync(manifestPath)) {
  const previous = JSON.parse(readFileSync(manifestPath,'utf8'));
  if (previous.baseline !== baseline || previous.files.some(row => !files.has(row.path)
    || files.get(row.path).blob !== row.blob || files.get(row.path).sha256 !== row.sha256))
    throw new Error('Refusing to change existing frozen source provenance.');
}
writeFileSync(manifestPath, JSON.stringify(manifest,null,2)+'\n');
console.log(`Preserved ${files.size} exact Git blobs from ${baseline} for independent test oracles.`);
