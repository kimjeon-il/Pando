import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagePrototype } from '../stage.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pandolab-full-world-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, value) => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), value);
  };
  const pinned = async (path, bytes = Buffer.from('DATA')) => {
    await put(path, bytes);
    return { url: path, sha256: sha(bytes), compressedBytes: bytes.byteLength, decodedBytes: bytes.byteLength };
  };
  await put('index.html', '<html><script src="assets/js/bootstrap.js?v=test" defer></script></html>');
  await put('assets/js/app.js', 'export const originalWeb = true;');
  await put('assets/js/bootstrap.js', 'globalThis.startedByWebBootstrap = true;');
  const wasmJs = await pinned('assets/wasm/pandoeditor-core.js', Buffer.from('export default ()=>({});'));
  const wasm = await pinned('assets/wasm/pandoeditor-core.wasm', Buffer.from([0, 97, 115, 109]));
  await put('assets/wasm/pandoeditor-core.manifest.json', JSON.stringify({
    schema: 'pandoeditor-core-wasm', abiVersion: 1,
    assets: { js: { file: 'pandoeditor-core.js', sha256: wasmJs.sha256 },
      wasm: { file: 'pandoeditor-core.wasm', sha256: wasm.sha256 } },
  }));
  const worldRoles = ['previewCountries', 'previewMesh', 'canonicalCountryPacket', 'canonicalMesh', 'labelAnchors'];
  const world = { schema: 'pandolab-world-bundle', schemaVersion: 1,
    source: { countryCount: 258, sha256: 'a'.repeat(64) },
    assets: {}, compatibility: { sharedBoundaries: {} },
  };
  for (const role of worldRoles) {
    const data = Buffer.from(role);
    const path = 'assets/data/world/objects/' + role + '-sha256-' + sha(data) + '.bin.gz';
    world.assets[role] = { ...await pinned(path, data), url: path.slice('assets/data/'.length) };
  }
  for (const role of ['preview', 'canonical']) {
    const name = 'countries-' + role + '-shared-v0.36.1.json.gz';
    await put('assets/data/' + name, 'SHARED');
    world.compatibility.sharedBoundaries[role] = name;
  }
  await put('assets/data/world/current.json', JSON.stringify(world));
  const historicalProjectPath = 'assets/data/historical-world/generated/v1/world-project.json.gz';
  const historicalProject = await pinned(historicalProjectPath);
  const historicPath = 'assets/data/historical-world/generated/v1/manifest.json';
  const historicSpec = await pinned(historicPath, Buffer.from(JSON.stringify({
    schemaVersion: 1, sourceMonth: '2026-10',
    project: { ...historicalProject, encoding: 'gzip' },
  })));
  const libPath = 'assets/data/territorial-entities/generated/v2/';
  const libraryChunk = await pinned(libPath + 'state-ABC.json.gz');
  const indexSpec = await pinned(libPath + 'index.json', Buffer.from(JSON.stringify({
    schemaVersion: 2, entities: [{ file: 'state-ABC.json.gz',
      sha256: libraryChunk.sha256, compressedBytes: libraryChunk.compressedBytes }],
  })));
  const prepPath = 'assets/data/prepared-polygons/generated/v2/';
  const data = Buffer.from('PREPARED');
  const mesh = await pinned(prepPath + 'polygon-mesh-sha256-' + sha(data) + '.bin.gz', data);
  const prepSpec = await pinned(prepPath + 'manifest.json', Buffer.from(JSON.stringify({
    schemaVersion: 2, meshes: { key: mesh },
  })));
  const meta = { appVersion: '0.36.0', assetRevision: 'test-full-world', dataRevision: 'data-' + 'b'.repeat(32),
    historicalWorld: historicSpec, territorialIndex: indexSpec, preparedPolygonMeshes: prepSpec };
  await put('assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify(meta) + ');\n');
  return { root, put, mesh };
}
test('full-world stage selects manifest-pinned Web resources and keeps the canonical bootstrap intact', async t => {
  const { root } = await fixture(t);
  const staged = await stagePrototype({ root, profile: 'full-world' });
  assert.equal(staged.profile, 'full-world');
  assert.equal(staged.worldData.countryCount, 258);
  assert.equal(staged.worldData.fileCount, 14);
  assert.equal(staged.fixture, null);
  assert.equal(await readFile(join(staged.directory, 'assets/js/bootstrap.js'), 'utf8'),
    'globalThis.startedByWebBootstrap = true;');
  const mode = JSON.parse(await readFile(join(staged.directory, 'shell/stage-profile.json')));
  assert.equal(mode.mode, 'full-world');
  assert.equal(mode.dataRevision, 'data-' + 'b'.repeat(32));
  assert.ok(staged.files.some(file => file.path.endsWith('/state-ABC.json.gz')));
  assert.ok(staged.files.every(file => !/assets\/data\/(?:hydro|places|terrain)/.test(file.path)));
});
test('full-world stage refuses tampered pinned immutable data', async t => {
  const { root, put, mesh } = await fixture(t);
  await put(mesh.url, 'TAMPERED');
  await assert.rejects(stagePrototype({ root, profile: 'full-world' }), /Pinned world resource mismatch/);
});
