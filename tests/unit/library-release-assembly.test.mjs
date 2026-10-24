import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assembleLibraryRelease, verifyLibraryRelease,
  verifyLibraryReleaseArchive } from '../../tools/assemble-library-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = 'a'.repeat(64), sourceRevision = 'b'.repeat(40);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-assembly-test-'));
  const output = join(root, 'release');
  const write = (name, content) => {
    const file = join(root, 'assets/data', name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return { url: name, sha256: hash(content), encoding: 'identity', compressedBytes: Buffer.byteLength(content), decodedBytes: Buffer.byteLength(content) };
  };
  const chunk = write('territorial-entities/generated/v2/state-AAA.json.gz', 'chunk');
  write('territorial-entities/generated/v2/index.json', JSON.stringify({ schemaVersion: 2, entities: [{ file: 'state-AAA.json.gz', ...chunk }], lineages: [], snapshots: [] }));
  const country=write('builtin-world/generated/v1/countries/AAA.json.gz','country');
  const packed=write('builtin-world/generated/v1/transport/packed.bin','country');
  write('builtin-world/generated/v1/index.json',JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:2,entities:[{...country,file:'countries/AAA.json.gz'}],transport:{...packed,url:'transport/packed.bin'}}));
  const source = write('territorial-entities/generated/current-world.geojson', 'world');
  const worldAsset = write('world/objects/countries-preview-sha256-' + 'c'.repeat(64) + '.geojson.gz', 'preview');
  const shared = write('countries-preview-shared-v0.36.1.json.gz', 'shared');
  write('world/current.json', JSON.stringify({ schema: 'pandolab-world-bundle', schemaVersion: 1,
    source: { ...source, countryCount: 1 }, assets: { previewCountries: worldAsset }, compatibility: { sharedBoundaries: { preview: shared.url } } }));
  const mesh = write('prepared-polygons/generated/v2/mesh.bin.gz', 'mesh');
  write('prepared-polygons/generated/v2/manifest.json', JSON.stringify({ schemaVersion: 2,
    algorithmSourceSha256: 'f'.repeat(64), meshes: { one: { ...mesh, url: `assets/data/${mesh.url}` } } }));
  return { root, output };
}

test('assembles a content-checked immutable release and a last-written activation pointer', () => {
  const { root, output } = fixture();
  const result = assembleLibraryRelease({ root, output, revision, sourceRevision });
  assert.equal(result.manifest.revision, revision);
  assert.equal(result.manifest.assets.preparedPolygonMeshes.algorithmSourceSha256, 'f'.repeat(64));
  const pointer = JSON.parse(readFileSync(join(output, 'assets/data/library-channel/current.json')));
  assert.equal(pointer.manifestSha256, hash(readFileSync(join(output, `assets/data/library-releases/${revision}/manifest.json`))));
  const historical = JSON.parse(readFileSync(join(output, `assets/data/library-releases/${revision}/builtin-world/generated/v1/index.json`)));
  assert.equal(historical.entities[0].file,'countries/AAA.json.gz');
  assert.equal(readFileSync(join(output,`assets/data/library-releases/${revision}/builtin-world/generated/v1/${historical.transport.url}`),'utf8'),'country');
  assert.equal(verifyLibraryRelease({ output, revision }).fileCount, result.fileCount);
});

test('rejects a missing referenced asset without activating the pointer', () => {
  const { root, output } = fixture();
  const file = join(root, 'assets/data/builtin-world/generated/v1/index.json');
  writeFileSync(file, JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:2,entities:[{file:'countries/missing.gz',sha256:'0'.repeat(64)}]}));
  assert.throws(() => assembleLibraryRelease({ root, output, revision, sourceRevision }), /Missing|missing|없습니다/);
  assert.throws(() => readFileSync(join(output, 'assets/data/library-channel/current.json')));
});

test('rejects an unlisted file in the active public release', () => {
  const { root, output } = fixture();
  assembleLibraryRelease({ root, output, revision, sourceRevision });
  writeFileSync(join(output, `assets/data/library-releases/${revision}/unlisted.txt`), 'private');
  assert.throws(() => verifyLibraryRelease({ output, revision }), /Unlisted|unlisted|Unexpected/);
});

test('rejects a release manifest asset URL outside its immutable revision', () => {
  const { root, output } = fixture();
  assembleLibraryRelease({ root, output, revision, sourceRevision });
  const manifestPath = join(output, `assets/data/library-releases/${revision}/manifest.json`);
  const pointerPath = join(output, 'assets/data/library-channel/current.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.assets.worldBundle.url = `assets/data/library-releases/${'c'.repeat(64)}/world/current.json`;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const pointer = JSON.parse(readFileSync(pointerPath));
  pointer.manifestSha256 = hash(readFileSync(manifestPath));
  writeFileSync(pointerPath, JSON.stringify(pointer));
  assert.throws(() => verifyLibraryRelease({ output, revision }), /immutable release|asset URL/);
});

test('verifies every retained immutable release before a new Pages activation', () => {
  const first = fixture();
  assembleLibraryRelease({ ...first, revision, sourceRevision });
  const second = fixture();
  const nextRevision = 'c'.repeat(64);
  assembleLibraryRelease({ ...second, revision: nextRevision, sourceRevision });
  const oldRelease = join(first.output, `assets/data/library-releases/${revision}`);
  cpSync(oldRelease, join(second.output, `assets/data/library-releases/${revision}`), { recursive: true });
  assert.equal(verifyLibraryReleaseArchive({ output: second.output }).releaseCount, 2);
  writeFileSync(join(second.output, `assets/data/library-releases/${revision}/world/current.json`), 'tampered');
  assert.throws(() => verifyLibraryReleaseArchive({ output: second.output }), /verification|mismatch|failed/i);
});
