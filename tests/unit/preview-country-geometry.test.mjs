import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { topology } from 'topojson-server';

import { validateGeometry } from '../../assets/js/modules/geometry-validation.js';
await import('../../assets/js/modules/country-geometry.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, `assets/data/countries-preview-v${appVersion}.geojson.gz`))));
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const canonicalBytes = Buffer.from(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8').replaceAll('\r\n', '\n'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, `assets/data/world-preview-v${appVersion}.json`), 'utf8'));
const { hasCanonicalCountryWinding } = globalThis.PandoLabCountryGeometry;

function consecutiveDuplicates(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon, polygonIndex) => polygon.flatMap((ring, ringIndex) => ring.flatMap((coordinate, vertexIndex) => {
    if (!vertexIndex || coordinate[0] !== ring[vertexIndex - 1][0] || coordinate[1] !== ring[vertexIndex - 1][1]) return [];
    return [{ polygonIndex, ringIndex, vertexIndex, coordinate }];
  })));
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[1]) !== (previousY > point[1])
      && point[0] < (previousX - x) * (point[1] - y) / ((previousY - y) || Number.EPSILON) + x) inside = !inside;
  }
  return inside;
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

test('preview derives every country and component from the canonical source', () => {
  assert.equal(manifest.previewDerivation, 'canonical-topology-simplified');
  assert.equal(manifest.previewSourceScale, 'derived');
  assert.equal(manifest.previewSourceSha256, crypto.createHash('sha256').update(canonicalBytes).digest('hex'));
  assert.equal(manifest.previewSourceSha256, manifest.canonicalSourceSha256);
  assert.equal(manifest.source, 'countries-ne-5.1.1.geojson');
  assert.equal(manifest.supplementedCountryIds, undefined);
  const ringCounts = geometry => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
    .map(polygon => polygon.length);
  assert.deepEqual(preview.features.map(feature => feature.id), canonical.features.map(feature => feature.id));
  for (let index = 0; index < canonical.features.length; index += 1) {
    assert.deepEqual(ringCounts(preview.features[index].geometry), ringCounts(canonical.features[index].geometry), canonical.features[index].id);
  }
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

test('neighboring countries retain shared topology arcs in the preview', () => {
  const result = topology({ countries: preview });
  const byId = new Map(result.objects.countries.geometries.map(geometry => [geometry.id, geometry]));
  const arcIds = geometry => new Set(geometry.arcs.flat(Infinity).map(reference => reference < 0 ? ~reference : reference));
  for (const [leftId, rightId] of [['DEU', 'POL'], ['DEU', 'CZE'], ['FRA', 'ESP']]) {
    const left = arcIds(byId.get(leftId));
    const right = arcIds(byId.get(rightId));
    assert.ok([...left].some(id => right.has(id)), `${leftId}/${rightId}`);
  }
});

test('Egypt canonical mainland has no internal holes in either built-in quality level', () => {
  const representativeCoordinates = [[34.832422, 22.61675475], [34.4595285, 22.2542175]];
  for (const collection of [canonical, preview]) {
    const egypt = collection.features.find(feature => feature.id === 'EGY');
    assert.ok(egypt);
    const polygons = egypt.geometry.type === 'Polygon' ? [egypt.geometry.coordinates] : egypt.geometry.coordinates;
    const mainland = polygons[0];
    assert.equal(mainland.length, 1);
    for (const coordinate of representativeCoordinates) assert.equal(pointInRing(coordinate, mainland[0]), true, `${collection === canonical ? 'canonical' : 'preview'}:${coordinate}`);
  }
});
