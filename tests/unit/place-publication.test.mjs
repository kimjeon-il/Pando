import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generatePlaceRelease } from '../../tools/build-place-runtime.mjs';
import { decodePlaceTile } from '../../assets/js/modules/place-codec.js';
import { normalizePlace, resolvePlaceLabelRows, hasPlaceNameCoverage } from '../../assets/js/modules/place-contract.js';
import { createPlaceWorkerStore } from '../../assets/js/modules/place-worker-store.js';

const assets = new URL('../../assets/data/places/', import.meta.url);
const read = name => readFileSync(new URL(name, assets));
const catalog = JSON.parse(read('reviewed-records-v1.json').toString('utf8'));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const publishedBytes = read('places-v1.bin');
const triple = { ko: true, en: true, native: true };
const record = id => catalog.records.find(row => row.sourceId === String(id));

test('all 22 reviewed batches are reproducibly published, with no silent loss of names', () => {
  const generated = generatePlaceRelease();
  assert.equal(generated.recordCount, 264);
  assert.equal(catalog.reviewBatches.length, 22);
  assert.equal(catalog.stats.cityCount, 264);
  assert.equal(catalog.stats.timelineEntries, 482);
  assert.equal(new Set(catalog.records.map(row => row.sourceId)).size, 264);
  assert.equal(generated.catalogText, read('reviewed-records-v1.json').toString('utf8'));
  assert.ok(generated.bytes.equals(publishedBytes));
  assert.equal(generated.manifestText, read('manifest.json').toString('utf8'));
  assert.equal(manifest.shards['places-v1'].bytes, publishedBytes.byteLength);
  assert.equal(createHash('sha256').update(publishedBytes).digest('hex'), manifest.shards['places-v1'].sha256);
  assert.equal(manifest.tiles['0/0-0'].sha256, manifest.shards['places-v1'].sha256);
});

test('published PLAC v3 bytes decode every place with historical name transitions', () => {
  const decoded = decodePlaceTile(publishedBytes);
  assert.equal(decoded.length, 264);
  const byId = new Map(decoded.map(row => [row.sourceId, row]));
  for (const raw of catalog.records) assert.deepEqual(byId.get(raw.sourceId), normalizePlace(raw));
  const peter = byId.get('498817');
  assert.deepEqual(
    ['1913-08-31', '1914-08-31', '1924-01-26', '1991-09-06'].map(date =>
      resolvePlaceLabelRows(peter, triple, date)[0]?.text),
    ['상트페테르부르크', '페트로그라드', '레닌그라드', '상트페테르부르크']);
  const minsk = byId.get('625144');
  assert.deepEqual(resolvePlaceLabelRows(minsk, triple, '1995-12-31').map(x => x.text).filter(x => x === 'Минск'), []);
  assert.ok(resolvePlaceLabelRows(minsk, triple, '1997-01-01').map(x => x.text).includes('Минск'));
  assert.ok(!hasPlaceNameCoverage(byId.get('2172517'), '1900-01-01'));
  assert.ok(hasPlaceNameCoverage(byId.get('2172517'), '1913-03-12'));
});

test('all selected present and historic languages are searchable without custom project labels', async () => {
  const store = createPlaceWorkerStore({ manifest, fetchBytes: async () => new Uint8Array(publishedBytes) });
  for (const [term, id] of [['서울', '1835848'], ['Leningrad', '498817'],
    ['Saint Petersburg', '498817'], ['València', '2509954'], ['臺北', '1668341']]) {
    const found = await store.search(term);
    assert.ok(found.records.some(row => row.sourceId === id), term + ' missing ' + id);
  }
  assert.ok(store.stats().cacheBytes > 0);
});

test('ambiguous settlements remain unranked pending source review', () => {
  for (const id of ['8063361', '2110257', '2110394', '5881576', '7828758', '282239']) {
    assert.equal(record(id)?.kind, 'town', 'ambiguous place incorrectly promoted ' + id);
  }
  assert.equal(record('2172517')?.kind, 'city');
  assert.equal(record('2172517')?.population, 0);
});
