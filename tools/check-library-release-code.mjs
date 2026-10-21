import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX64 = /^[0-9a-f]{64}$/;
export function assertLibraryCodeCompatibility(code, release) {
  const expected = code?.preparedPolygonMeshes?.algorithmSourceSha256;
  const actual = release?.assets?.preparedPolygonMeshes?.algorithmSourceSha256;
  if (!HEX64.test(expected) || !HEX64.test(actual) || expected !== actual) {
    throw new Error('Library release prepared mesh algorithm does not match the staged viewer code');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--site');
  if (at < 0 || !process.argv[at + 1]) throw new Error('Usage: check-library-release-code.mjs --site STAGED_SITE');
  const site = resolve(process.argv[at + 1]);
  const source = readFileSync(join(site, 'assets/js/build-meta.js'), 'utf8');
  const code = JSON.parse(source.match(/Object\.freeze\(([\s\S]*)\);\s*$/)?.[1] || 'null');
  const pointer = JSON.parse(readFileSync(join(site, 'assets/data/library-channel/current.json')));
  if (!HEX64.test(pointer.revision)) throw new Error('Invalid active library revision');
  const release = JSON.parse(readFileSync(join(site, 'assets/data/library-releases', pointer.revision, 'manifest.json')));
  assertLibraryCodeCompatibility(code, release);
  console.log(`Library release ${pointer.revision} matches the staged viewer mesh algorithm`);
}
