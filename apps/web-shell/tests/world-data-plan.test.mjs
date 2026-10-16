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
  const meta = { dataRevision: 'data-' + 'b'.repeat(32),
    historicalWorld: pin('assets/data/historical-world/generated/v1/manifest.json'),
    territorialIndex: pin('assets/data/territorial-entities/generated/v2/index.json'),
    preparedPolygonMeshes: pin('assets/data/prepared-polygons/generated/v2/manifest.json'),
  };
  const historical = { schemaVersion: 1, sourceMonth: '2026-10',
    project: { ...pin('assets/data/historical-world/generated/v1/world-project.json.gz'), encoding: 'gzip' } };
  const library = { schemaVersion: 2, entities: [{ file: 'state-ABC.json.gz', sha256: SHA, compressedBytes: 3 }] };
  const prepared = { schemaVersion: 2, meshes: {
    first: pin('assets/data/prepared-polygons/generated/v2/polygon-mesh-sha256-' + SHA + '.bin.gz'),
  } };
  return { meta, world, historical, library, prepared };
}
test('full-world manifest closure includes active historical and prepared geometry only', () => {
  const plan = buildFullWorldAssetPlan(fixture());
  const paths = plan.entries.map(item => item.path);
  assert.equal(plan.countryCount, 258);
  assert.equal(plan.entries.length, 13);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('assets/data/world/current.json'));
  assert.ok(paths.includes('assets/data/historical-world/generated/v1/world-project.json.gz'));
  assert.ok(paths.includes('assets/data/territorial-entities/generated/v2/state-ABC.json.gz'));
  assert.ok(!paths.some(path => /terrain|hydro|places/.test(path)));
});
test('full-world manifest closure rejects traversal, remote paths and altered hash paths', () => {
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
