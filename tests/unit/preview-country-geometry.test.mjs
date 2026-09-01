import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { validateGeometry } from '../../assets/js/modules/geometry-validation.js';
await import('../../assets/js/modules/country-geometry.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/countries-preview-v0.30.0.geojson.gz'))));
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const source50Text = fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1-50m.geojson'), 'utf8').replaceAll('\r\n', '\n');
const source50Bytes = Buffer.from(source50Text);
const source50 = JSON.parse(source50Text);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/world-preview-v0.30.0.json'), 'utf8'));
const { hasCanonicalCountryWinding } = globalThis.PandoLabCountryGeometry;

function consecutiveDuplicates(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon, polygonIndex) => polygon.flatMap((ring, ringIndex) => ring.flatMap((coordinate, vertexIndex) => {
    if (!vertexIndex || coordinate[0] !== ring[vertexIndex - 1][0] || coordinate[1] !== ring[vertexIndex - 1][1]) return [];
    return [{ polygonIndex, ringIndex, vertexIndex, coordinate }];
  })));
}

test('canonical and preview built-in countries require no runtime geometry repair', () => {
  for (const [label, collection] of [['canonical', canonical], ['preview', preview]]) {
    assert.equal(collection.features.length, 258, label);
    for (const feature of collection.features) {
      const id = feature.id;
      assert.deepEqual(validateGeometry(feature), [], `${label}:${id}`);
      assert.equal(hasCanonicalCountryWinding(feature.geometry), true, `${label}:${id}`);
      assert.deepEqual(consecutiveDuplicates(feature.geometry), [], `${label}:${id}`);
    }
  }
});

test('Egypt and the Borneo shared coordinate remain clean in both built-in quality levels', () => {
  for (const collection of [canonical, preview]) {
    const egypt = collection.features.find(feature => feature.id === 'EGY');
    assert.ok(egypt);
    assert.equal(JSON.stringify(egypt.geometry.coordinates).includes('[35.429207,22.97833]'), false);

    for (const id of ['IDN', 'MYS']) {
      const feature = collection.features.find(item => item.id === id);
      assert.ok(feature);
      assert.deepEqual(consecutiveDuplicates(feature.geometry), []);
    }
  }
});

test('preview uses the vendored 50m source without an additional simplification pass', () => {
  assert.equal(manifest.previewSourceScale, '50m');
  assert.equal(manifest.previewSourceVersion, '5.1.1');
  assert.equal(manifest.previewSourceSha256, crypto.createHash('sha256').update(source50Bytes).digest('hex'));
  assert.equal(source50.features.length, 242);
  assert.deepEqual(new Set(manifest.supplementedCountryIds), new Set([
    'BJN', 'BRI', 'BRT', 'CLP', 'CNM', 'CSI', 'ESB', 'GIB', 'KAB', 'PGA', 'SCR', 'SER', 'SPI', 'UMI', 'USG', 'WSB',
  ]));
  const count = geometry => {
    if (Array.isArray(geometry) && typeof geometry[0] === 'number') return 1;
    return (geometry || []).reduce((sum, item) => sum + count(item), 0);
  };
  for (const id of ['KOR', 'PRK']) {
    const feature = preview.features.find(item => item.id === id);
    assert.ok(feature);
    assert.ok(count(feature.geometry.coordinates) >= 200);
  }
});
