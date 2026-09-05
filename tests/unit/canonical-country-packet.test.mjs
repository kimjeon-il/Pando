import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_COUNTRY_PACKET_MAGIC,
  canonicalCountryPacketTransferables,
  createCanonicalCountryStore,
  inspectCanonicalCountryPacket,
} from '../../assets/js/modules/canonical-country-packet.js';
import { encodeCanonicalCountryPacket } from '../../tools/canonical-country-packet-encoder.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));

test('canonical packet round trips all country ids and Float64 geometry exactly', () => {
  const packet = encodeCanonicalCountryPacket(canonical);
  const header = inspectCanonicalCountryPacket(packet);
  const store = createCanonicalCountryStore(packet, { expectedHeader: header.words });
  const roundTrip = store.materializeCollectionSync();

  assert.equal(header.magic, CANONICAL_COUNTRY_PACKET_MAGIC);
  assert.equal(store.featureCount, 258);
  assert.deepEqual(store.ids(), canonical.features.map(feature => String(feature.id)));
  assert.deepEqual(roundTrip.features.map(feature => feature.geometry), canonical.features.map(feature => feature.geometry));
  assert.deepEqual(roundTrip.features.map(feature => feature.properties.name), canonical.features.map(feature => feature.properties.name));
  assert.ok(packet.byteLength < 10 * 1024 * 1024);
  assert.ok(zlib.gzipSync(Buffer.from(packet), { level: 9, mtime: 0 }).byteLength < 5.5 * 1024 * 1024);
  assert.deepEqual(canonicalCountryPacketTransferables(packet), [packet]);
});

test('materialized geometry cannot mutate the retained pristine packet', () => {
  const store = createCanonicalCountryStore(encodeCanonicalCountryPacket(canonical));
  const id = store.ids()[0];
  const feature = store.materializeFeature(id);
  assert.equal(store.geometryEquals(id, feature.geometry), true);
  const coordinates = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates
    : feature.geometry.coordinates[0];
  coordinates[0][0][0] += 1;
  assert.equal(store.geometryEquals(id, feature.geometry), false);
  assert.equal(store.geometryEquals(id, store.materializeFeature(id).geometry), true);
});

test('packet preserves dateline, polar, hole, Polygon, and MultiPolygon structure', () => {
  const fixture = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'DATELINE',
        properties: { name: 'Dateline', validFrom: '1900' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[179, 70], [-179, 70], [-179, 80], [179, 80], [179, 70]],
            [[179.5, 72], [-179.5, 72], [-179.5, 74], [179.5, 74], [179.5, 72]],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'POLAR',
        properties: { name: 'Polar', validTo: '2000' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[0, 89.9], [120, 89.8], [-120, 89.8], [0, 89.9]]],
            [[[10, -89.9], [20, -89.8], [0, -89.8], [10, -89.9]]],
          ],
        },
      },
    ],
  };
  const roundTrip = createCanonicalCountryStore(encodeCanonicalCountryPacket(fixture)).materializeCollectionSync();
  assert.deepEqual(roundTrip, fixture);
});

test('cooperative materialization respects the 4096-coordinate slice ceiling', async () => {
  const store = createCanonicalCountryStore(encodeCanonicalCountryPacket(canonical));
  const slices = [];
  let quietWaits = 0;
  let yields = 0;
  const result = await store.materializeCollection({
    budgetMs: Number.POSITIVE_INFINITY,
    coordinateBudget: 4096,
    now: () => 0,
    waitForQuiet: async () => { quietWaits += 1; },
    yieldFrame: async () => { yields += 1; },
    onSlice: slice => slices.push(slice),
  });
  assert.equal(result.collection.features.length, 258);
  assert.equal(result.metrics.coordinateCount, 548464);
  assert.ok(slices.every(slice => slice.coordinateCount <= 4096));
  assert.equal(yields, slices.filter(slice => !slice.final).length);
  assert.ok(quietWaits >= yields + 1);
});

test('packet validation rejects corrupted headers and offsets', () => {
  const packet = encodeCanonicalCountryPacket(canonical);
  const corruptedMagic = packet.slice(0);
  new Uint32Array(corruptedMagic)[0] = 0;
  assert.throws(() => inspectCanonicalCountryPacket(corruptedMagic), /header/);

  const corruptedLength = packet.slice(0);
  new Uint32Array(corruptedLength)[19] -= 8;
  assert.throws(() => inspectCanonicalCountryPacket(corruptedLength), /byte length/);
});

test('canonical packet gzip is deterministic', () => {
  const packet = encodeCanonicalCountryPacket(canonical);
  const first = zlib.gzipSync(Buffer.from(packet), { level: 9, mtime: 0 });
  const second = zlib.gzipSync(Buffer.from(packet), { level: 9, mtime: 0 });
  assert.deepEqual(first, second);
});
