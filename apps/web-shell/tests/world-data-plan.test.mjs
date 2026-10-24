import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFullWorldAssetPlan } from '../world-data-plan.mjs';

const SHA = 'a'.repeat(64);
const pin = (path, bytes = 3) => ({ url: path, sha256: SHA, compressedBytes: bytes, decodedBytes: bytes });
function fixture() {
  const roles = ['previewCountries', 'previewMesh', 'canonicalCountryPacket', 'canonicalMesh', 'labelAnchors'];
  const world = { schema: 'pandolab-world-bundle', schemaVersion: 1,
    source: { countryCount: 258, sha256: SHA },
    assets: Object.fromEntries(roles.map(role => [role, pin('world/objects/' + role + '-sha256-' + SHA + '.bin.gz')])),
    compatibility: { sharedBoundaries: {
      preview: 'countries-preview-shared-v0.36.1.json.gz',
      canonical: 'countries-canonical-shared-v0.36.1.json.gz',
    } },
  };
  world.defaultClassification = {
    countries: Object.fromEntries(Array.from({ length: 207 }, (_, i) => ['root-' + i, 'source'])),
    units: Object.fromEntries(Array.from({ length: 47 }, (_, i) => ['unit-' + i, { parentId: 'root-0' }])),
    removedIds: Array.from({ length: 51 }, (_, i) => 'removed-' + i),
  };
  const meta = { dataRevision: 'data-' + 'b'.repeat(32),
    builtinWorld: pin('assets/data/builtin-world/generated/v1/index.json'),
    territorialIndex: pin('assets/data/territorial-entities/generated/v2/index.json'),
    preparedPolygonMeshes: pin('assets/data/prepared-polygons/generated/v2/manifest.json'),
  };
  const historical={schema:'pandolab-builtin-world',schemaVersion:2,
    transport:{...pin('transport/countries-sha256-'+SHA+'.bin'),schemaVersion:1,encoding:'identity'},
    entities:[{file:'countries/state-ABC-sha256-'+SHA+'.json.gz',sha256:SHA,compressedBytes:3,decodedBytes:3,offset:0}]};
  const library = { schemaVersion: 2, entities: [{ file: 'state-ABC.json.gz', sha256: SHA, compressedBytes: 3 }] };
  const prepared = { schemaVersion: 2, meshes: {
    first: pin('assets/data/prepared-polygons/generated/v2/polygon-mesh-sha256-' + SHA + '.bin.gz'),
  } };
  const terrain = {
    version: '0.13.3-p1', representation: 'raster-rgba-v1',
    urlTemplate: 'terrain-preview/v0.13.3-p1/{level}/{column}-{row}.webp',
    tiles: Object.fromEntries([
      '0/0-0.webp', '0/1-0.webp',
      '1/0-0.webp', '1/1-0.webp', '1/2-0.webp',
      '1/0-1.webp', '1/1-1.webp', '1/2-1.webp',
    ].map(path => [path, { sha256: SHA, bytes: 3 }])),
  };
  const hydro = {
    version: '0.13.2', schema: 'pandolab-water-shards-v5',
    container: { url: 'hydro.bin', sha256: SHA, bytes: 3 },
    stats: { compressedBytes: 3 },
  };
  const places = {
    version: 1, revision: 'test',
    shards: { 'places-v1': { url: 'places-v1.bin', sha256: SHA, bytes: 3 } },
  };
  return { meta, world, historical, library, prepared, terrain, hydro, places };
}
test('map-data manifest closure includes active historical and prepared geometry only', () => {
  const plan = buildFullWorldAssetPlan(fixture());
  const paths = plan.entries.map(item => item.path);
  assert.equal(plan.countryCount, 258);
  assert.equal(plan.modelEntityCount, 254);
  assert.equal(plan.rootCount, 207);
  assert.equal(plan.unitCount, 47);
  assert.equal(plan.mergedSourceCount, 4);
  assert.equal(plan.entries.length, 18);
  assert.equal(plan.worldFileCount, 14);
  assert.equal(plan.physicalFileCount, 4);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('assets/data/world/current.json'));
  assert.ok(paths.includes('assets/data/builtin-world/generated/v1/transport/countries-sha256-'+SHA+'.bin'));
  assert.equal(paths.some(path => path.includes('builtin-world/generated/v1/countries/')), false);
  assert.ok(paths.includes('assets/data/territorial-entities/generated/v2/state-ABC.json.gz'));
  assert.ok(paths.includes('assets/data/hydro/v0.13.2/hydro.bin'));
  assert.equal(paths.some(path=>path.includes('terrain')),false);
  assert.ok(paths.includes('assets/data/places/places-v1.bin'));
  assert.equal(paths.filter(path => /terrain-preview|hydro|places/.test(path)).length, 4);
});
test('map-data manifest closure rejects traversal, remote paths and altered hash paths', () => {
  const bad = fixture();
  bad.library.entities[0].file = '../outside.json.gz';
  assert.throws(() => buildFullWorldAssetPlan(bad), /resource name/);
  const remote = fixture();
  remote.prepared.meshes.first.url = 'https://remote.invalid/malicious.gz';
  assert.throws(() => buildFullWorldAssetPlan(remote), /Invalid pinned polygon/);
  const mismatch = fixture();
  mismatch.world.assets.previewMesh.sha256 = 'b'.repeat(64);
  assert.throws(() => buildFullWorldAssetPlan(mismatch), /immutable path/);
});

test('map-data packaging requires the current pinned country transport', () => {
  for (const change of [
    value => { delete value.historical.transport; },
    value => { value.historical.transport.url = '../outside.bin'; },
    value => { value.historical.transport.sha256 = 'b'.repeat(64); },
    value => { value.historical.transport.encoding = 'gzip'; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => buildFullWorldAssetPlan(value), /country transport/);
  }
});
