import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { inventoryOsmHydronyms, readHydroMetadataSection, main } from '../../tools/inventory-osm-hydronyms.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const core = [
    { fid: 1, category: 'river', systemId: '20', name: '확인강', role: 'mainstem',
      bounds: [-12_345_650, 100_000, -12_345_550, 200_000] },
    { fid: 2, category: 'river', systemId: '20', name: '확인강', role: 'tributary',
      bounds: [-12_345_651, -200_000, -12_345_500, 250_000] },
    { fid: 3, category: 'lake', systemId: '', name: '湖', bounds: [0, 0, 1, 1] },
    { fid: 4, category: 'river', systemId: '8', name: '검증강', role: 'mainstem', bounds: [0, 0, 1_000_000, 2_000_000] },
  ];
  const detail = [
    { fid: 1, source: 'HydroRIVERS', sourceId: '7,8', osmRelationIds: [25, 9],
      aliases: ['Alfa'], tributaryNames: ['지류'] },
    { fid: 2, source: 'HydroRIVERS', sourceId: '8,9', osmRelationIds: [9],
      aliases: ['Alfa', 'Beta'], tributaryNames: [] },
    { fid: 3, source: 'Natural Earth', sourceId: '1' },
    { fid: 4, source: 'HydroRIVERS', sourceId: '11', osmRelationIds: [], aliases: [] },
  ];
  const one = gzipSync(JSON.stringify({ version: 5, features: core }), { mtime: 0 });
  const two = gzipSync(JSON.stringify({ version: 5, features: detail }), { mtime: 0 });
  const bundle = Buffer.concat([one, two]);
  const section = (offset, bytes) => ({ offset, bytes: bytes.length, sha256: hash(bytes) });
  const manifest = { version: '0.13.2', dataset: 'pinned fixture',
    metadata: { core: section(0, one), detail: section(one.length, two) },
    sources: { osmWaterways: { matchedSystems: 1, sha256: 'a'.repeat(64) } },
    stats: { osmWaterwayMatchCount: 1 } };
  return { core, detail, manifest, bundle };
}
test('v5 Hydro inventory retains exact FIDs, reach identity, aliases, roles and independent provenance disclaimer', () => {
  const { manifest, bundle } = fixture();
  const result = inventoryOsmHydronyms(manifest, bundle);
  assert.equal(result.matchedSystems, 1);
  assert.equal(result.schema, 'pando-osm-hydro-inventory-v1');
  assert.match(result.disclaimer, /does NOT establish/);
  assert.deepEqual(result.items, [{
    systemId: '20', nameKo: '확인강', osmRelationIds: [9, 25],
    aliases: ['Alfa', 'Beta'], tributaryNames: ['지류'],
    sourceLabels: ['HydroRIVERS'], roles: ['mainstem', 'tributary'],
    featureCount: 2, bounds: [-12.3457, -0.2, -12.3455, 0.25], hydroReachCount: 3,
  }]);
});
test('metadata compression offsets, lengths and hashes must match source bytes', () => {
  const { manifest, bundle } = fixture();
  assert.equal(readHydroMetadataSection(bundle, manifest.metadata.core).length, 4);
  assert.throws(() => inventoryOsmHydronyms(manifest, Buffer.from(bundle).fill(0, 0, 1)), /integrity/);
  assert.throws(() => inventoryOsmHydronyms(manifest, bundle.subarray(0, 10)), /outside bundle/);
  manifest.metadata.detail.sha256 = '0'.repeat(64);
  assert.throws(() => inventoryOsmHydronyms(manifest, bundle), /integrity/);
});
test('schema, matched-count, missing source keys and repeated FIDs fail closed', () => {
  const a = fixture();
  assert.throws(() => inventoryOsmHydronyms({ ...a.manifest, version: 'old' }, a.bundle), /v0.13.2/);
  assert.throws(() => inventoryOsmHydronyms({ ...a.manifest, stats: {osmWaterwayMatchCount: 2} }, a.bundle), /count mismatch/);
  const duplicate = fixture();
  const copy = gzipSync(JSON.stringify({ version: 5, features: [...duplicate.detail, duplicate.detail[0]] }), { mtime: 0 });
  const offset = duplicate.manifest.metadata.core.bytes;
  duplicate.manifest.metadata.detail = { offset, bytes: copy.length, sha256: hash(copy) };
  assert.throws(() => inventoryOsmHydronyms(duplicate.manifest,
    Buffer.concat([duplicate.bundle.subarray(0, offset), copy])), /Duplicate Hydro detail fid/);
});
test('CLI emits both Python-compatible log records and immutable input files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hydro-osm-b1-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { manifest, bundle } = fixture();
  const m = join(dir, 'manifest.json'), b = join(dir, 'hydro.bin'), out = join(dir, 'inventory.json');
  writeFileSync(m, JSON.stringify(manifest)); writeFileSync(b, bundle);
  const result = spawnSync(process.execPath, [new URL('../../tools/inventory-osm-hydronyms.mjs', import.meta.url).pathname,
    '--manifest', m, '--bundle', b, '--output', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OSM_AUDIT_TOTAL=1\n/m);
  assert.match(result.stdout, /^OSM_AUDIT_ROW=\{"systemId":"20"/m);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), inventoryOsmHydronyms(manifest, bundle));
  assert.equal(hash(readFileSync(b)), hash(bundle));
  assert.equal(readFileSync(m, 'utf8'), JSON.stringify(manifest));
  assert.throws(() => main(['--manifest', m, '--bundle', b, '--output', m]), /Refusing to overwrite/);
});
