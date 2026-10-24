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
  await put('index.html', '<html>Viewer only</html>');
  await put('apps/web-shell/editor.html', '<html><base href="../../" data-product-base="editor" /><script src="assets/js/bootstrap.js?v=test" defer></script></html>');
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
  world.defaultClassification = {
    countries: Object.fromEntries(Array.from({ length: 207 }, (_, i) => ['root-' + i, 'source'])),
    units: Object.fromEntries(Array.from({ length: 47 }, (_, i) => ['unit-' + i, { parentId: 'root-0' }])),
    removedIds: Array.from({ length: 51 }, (_, i) => 'removed-' + i),
  };
  for (const role of ['preview', 'canonical']) {
    const name = 'countries-' + role + '-shared-v0.36.1.json.gz';
    await put('assets/data/' + name, 'SHARED');
    world.compatibility.sharedBoundaries[role] = name;
  }
  await put('assets/data/world/current.json', JSON.stringify(world));
  const country=await pinned('assets/data/builtin-world/generated/v1/countries/state-ABC-sha256-'+sha(Buffer.from('COUNTRY'))+'.json.gz',Buffer.from('COUNTRY'));
  const historicPath='assets/data/builtin-world/generated/v1/index.json';
  const transport=await pinned('assets/data/builtin-world/generated/v1/transport/countries-sha256-'+country.sha256+'.bin',Buffer.from('COUNTRY'));
  const historicSpec=await pinned(historicPath,Buffer.from(JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:2,
    transport:{...transport,url:transport.url.split('/v1/')[1],schemaVersion:1,encoding:'identity'},
    entities:[{...country,file:country.url.split('/v1/')[1],offset:0}]})));
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
  const terrain = {
    version: '0.13.3-p1', representation: 'raster-rgba-v1',
    urlTemplate: 'terrain-preview/v0.13.3-p1/{level}/{column}-{row}.webp',
    tiles: {},
  };
  const tiles = ['0/0-0.webp','0/1-0.webp','1/0-0.webp','1/1-0.webp','1/2-0.webp',
    '1/0-1.webp','1/1-1.webp','1/2-1.webp'];
  for (const tile of tiles) {
    const path = 'assets/data/terrain-preview/v0.13.3-p1/' + tile;
    const bytes = Buffer.from(tile);
    terrain.tiles[tile] = { sha256: (await pinned(path, bytes)).sha256, bytes: bytes.length };
  }
  await put('assets/data/terrain-preview/v0.13.3-p1/manifest.json', JSON.stringify(terrain));
  const hydroBin = await pinned('assets/data/hydro/v0.13.2/hydro.bin', Buffer.from('HYDRO'));
  await put('assets/data/hydro/v0.13.2/manifest.json', JSON.stringify({
    version: '0.13.2', schema: 'pandolab-water-shards-v5',
    container: { url: 'hydro.bin', sha256: hydroBin.sha256, bytes: hydroBin.compressedBytes },
    stats: { compressedBytes: hydroBin.compressedBytes },
  }));
  const placeBin = await pinned('assets/data/places/places-v1.bin', Buffer.from('PLACES'));
  await put('assets/data/places/manifest.json', JSON.stringify({
    version: 1, revision: 'test', shards: {
      'places-v1': { url: 'places-v1.bin', sha256: placeBin.sha256, bytes: placeBin.compressedBytes },
    },
  }));
  const ocrBytes = Buffer.from('OCR'), runtimeBytes = Buffer.from('export default {};');
  const languages = { eng: { url: 'eng.traineddata.gz', bytes: ocrBytes.length, sha256: sha(ocrBytes) } };
  await put('assets/vendor/reference-analysis/tesseract.mjs', runtimeBytes);
  await put('assets/vendor/reference-analysis/manifest.json', JSON.stringify({ schemaVersion: 1, languages,
    files: { 'tesseract.mjs': { bytes: runtimeBytes.length, sha256: sha(runtimeBytes) } } }));
  await put('assets/data/reference-analysis/v1/ocr/eng.traineddata.gz', ocrBytes);
  await put('assets/data/reference-analysis/v1/ocr/manifest.json', JSON.stringify({ schemaVersion: 1, languages }));
  const meta = { appVersion: '0.36.0', assetRevision: 'test-full-world', dataRevision: 'data-' + 'b'.repeat(32),
    builtinWorld: historicSpec, territorialIndex: indexSpec, preparedPolygonMeshes: prepSpec };
  await put('assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify(meta) + ');\n');
  return { root, put, mesh, transport };
}
test('full-world stage selects manifest-pinned Web resources and keeps the canonical bootstrap intact', async t => {
  const { root, transport } = await fixture(t);
  const staged = await stagePrototype({ root, profile: 'full-world' });
  assert.equal(staged.profile, 'full-world');
  assert.equal(staged.worldData.countryCount, 258);
  assert.equal(staged.worldData.modelEntityCount, 254);
  assert.equal(staged.worldData.mergedSourceCount, 4);
  assert.equal(staged.worldData.fileCount, 18);
  assert.equal(staged.worldData.worldFileCount, 14);
  assert.equal(staged.worldData.physicalFileCount, 4);
  assert.equal(staged.fixture, null);
  assert.equal(staged.referenceAnalysis.modelAvailable, false);
  assert.ok(staged.files.some(file => file.path === 'assets/data/reference-analysis/v1/ocr/eng.traineddata.gz'));
  assert.equal(await readFile(join(staged.directory, 'assets/js/bootstrap.js'), 'utf8'),
    'globalThis.startedByWebBootstrap = true;');
  const mode = JSON.parse(await readFile(join(staged.directory, 'shell/stage-profile.json')));
  assert.equal(mode.mode, 'full-world');
  assert.equal(mode.dataRevision, 'data-' + 'b'.repeat(32));
  assert.ok(staged.files.some(file => file.path.endsWith('/state-ABC.json.gz')));
  assert.ok(staged.files.some(file => file.path.endsWith('/hydro.bin')));
  assert.ok(staged.files.some(file => file.path.endsWith('/places-v1.bin')));
  assert.equal(staged.files.some(file=>file.path.includes('terrain-preview')),false);
  assert.equal(await readFile(join(staged.directory, transport.url), 'utf8'), 'COUNTRY');
  assert.equal(staged.files.some(file => file.path.includes('builtin-world/generated/v1/countries/')), false);
});
test('full-world stage refuses tampered pinned immutable data', async t => {
  const { root, put, mesh } = await fixture(t);
  await put(mesh.url, 'TAMPERED');
  await assert.rejects(stagePrototype({ root, profile: 'full-world' }), /Pinned world resource mismatch/);
});

test('full-world stage rejects a corrupted builtin country transport before packaging', async t => {
  const { root, put, transport } = await fixture(t);
  await put(transport.url, 'TAMPERED');
  await assert.rejects(stagePrototype({ root, profile: 'full-world' }), /Pinned world resource mismatch/);
});
