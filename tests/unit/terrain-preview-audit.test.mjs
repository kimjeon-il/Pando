import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validatePreviewCorpus } from '../../tools/check-terrain-preview.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['0/0-0.webp', '0/1-0.webp', ...[0, 1].flatMap(row => [0, 1, 2].map(column => `1/${column}-${row}.webp`))];
const dem = { version: '0.13.3', assetsSha256: hash('DEM'), tint: { sha256: hash('tint') } };
const landMaskSha256 = hash('land mask');
function fixture() {
  const files = new Map(paths.map(path => [path, Buffer.from(path)]));
  const digest = createHash('sha256');
  const tiles = Object.fromEntries([...files].map(([path, bytes]) => {
    const pin = { bytes: bytes.length, sha256: hash(bytes) };
    digest.update(path + '\0').update(Buffer.from(pin.sha256, 'hex'));
    return [path, pin];
  }));
  const manifest = { version: '0.13.3-p2', representation: 'raster-rgba-v1', levels: [{ id: 0 }, { id: 1 }], gutter: 1,
    tiles, assetsSha256: digest.digest('hex'), sourceDem: { version: dem.version, assetsSha256: dem.assetsSha256,
      tintSha256: dem.tint.sha256, landMaskSha256 } };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  return { manifest, files };
}
const verify = ({ manifest, files }, source = dem, land = landMaskSha256) => validatePreviewCorpus(manifest, files, source, land);

test('Web preview validates tile bytes and pinned DEM sources without an app mirror', () => {
  assert.deepEqual(verify(fixture()).errors, []);
});
test('preview corruption and missing files cannot pass', () => {
  const input = fixture();input.files.set('0/0-0.webp', Buffer.from('altered'));
  assert.ok(verify(input).errors.some(error => error.includes('0/0-0.webp')));
  input.files.delete('0/0-0.webp');assert.ok(verify(input).errors.some(error => error.includes('inventory')));
});
test('changed DEM, tint and land-mask pins cannot pass', () => {
  for (const source of [{ ...dem, version: 'changed' }, { ...dem, assetsSha256: hash('changed') },
    { ...dem, tint: { sha256: hash('changed') } }])
    assert.ok(verify(fixture(), source).errors.some(error => error.includes('source pin')));
  assert.ok(verify(fixture(), dem, hash('changed')).errors.some(error => error.includes('source pin')));
});

test('manifest corruption and undeclared tiles cannot pass', () => {
  const input = fixture();input.files.set('manifest.json', Buffer.from('{}'));
  assert.ok(verify(input).errors.some(error => error.includes('manifest bytes')));
  input.files.set('2/0-0.webp', Buffer.from('extra'));
  assert.ok(verify(input).errors.some(error => error.includes('inventory')));
});
