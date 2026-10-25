import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stagePrototype } from '../stage.mjs';
import { worldFixture as fixture } from './helpers/world-fixture.mjs';

test('map-data stage selects manifest-pinned Web resources and keeps the canonical bootstrap intact', async t => {
  const { root, transport } = await fixture(t);
  const staged = await stagePrototype({ root, profile: 'map-data' });
  assert.equal(staged.profile, 'map-data');
  assert.equal(staged.worldData.countryCount, 258);
  assert.equal(staged.worldData.modelEntityCount, 254);
  assert.equal(staged.worldData.mergedSourceCount, 4);
  assert.equal(staged.worldData.fileCount, 18);
  assert.equal(staged.worldData.worldFileCount, 14);
  assert.equal(staged.worldData.physicalFileCount, 4);
  assert.equal(staged.fixture, null);
  assert.equal(await readFile(join(staged.directory, 'assets/js/bootstrap.js'), 'utf8'),
    'globalThis.startedByWebBootstrap = true;');
  const mode = JSON.parse(await readFile(join(staged.directory, 'shell/stage-profile.json')));
  assert.equal(mode.mode, 'map-data');
  assert.equal(mode.dataRevision,staged.dataRevision);
  assert.match(mode.dataRevision,/^data-[a-f0-9]{32}$/);
  assert.ok(staged.files.some(file => file.path.endsWith('/state-ABC.json.gz')));
  assert.ok(staged.files.some(file => file.path.endsWith('/hydro.bin')));
  assert.ok(staged.files.some(file => file.path.endsWith('/places-v1.bin')));
  assert.equal(staged.files.some(file=>file.path.includes('terrain-preview')),false);
  assert.equal(await readFile(join(staged.directory, transport.url), 'utf8'), 'COUNTRY');
  assert.equal(staged.files.some(file => file.path.includes('builtin-world/generated/v1/countries/')), false);
});
test('map-data stage refuses tampered pinned immutable data', async t => {
  const { root, put, mesh } = await fixture(t);
  await put(mesh.url, 'TAMPERED');
  await assert.rejects(stagePrototype({ root, profile: 'map-data' }), /Pinned world resource mismatch/);
});

test('map-data stage rejects a corrupted builtin country transport before packaging', async t => {
  const { root, put, transport } = await fixture(t);
  await put(transport.url, 'TAMPERED');
  await assert.rejects(stagePrototype({ root, profile: 'map-data' }), /Pinned world resource mismatch/);
});
