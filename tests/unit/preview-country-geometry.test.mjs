import assert from 'node:assert/strict';
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
      const id = feature.properties?.editor_id;
      assert.deepEqual(validateGeometry(feature), [], `${label}:${id}`);
      assert.equal(hasCanonicalCountryWinding(feature.geometry), true, `${label}:${id}`);
      assert.deepEqual(consecutiveDuplicates(feature.geometry), [], `${label}:${id}`);
    }
  }
});

test('Egypt and the Borneo shared coordinate remain clean in both built-in quality levels', () => {
  for (const collection of [canonical, preview]) {
    const egypt = collection.features.find(feature => feature.properties?.editor_id === 'EGY');
    assert.ok(egypt);
    assert.equal(JSON.stringify(egypt.geometry.coordinates).includes('[35.429207,22.97833]'), false);

    for (const id of ['IDN', 'MYS']) {
      const feature = collection.features.find(item => item.properties?.editor_id === id);
      assert.ok(feature);
      assert.deepEqual(consecutiveDuplicates(feature.geometry), []);
    }
  }
});
