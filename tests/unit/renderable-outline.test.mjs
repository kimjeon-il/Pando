import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { buildRenderableStrokeFeature, hasAreaGeometry } from '../../assets/js/modules/geometry-preview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const countries = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data/countries-preview-v0.30.0.geojson.gz'))));

function featureById(id) {
  return countries.features.find(feature => [
    feature.properties?.editor_id,
    feature.properties?.iso_a3,
    feature.properties?.adm0_a3,
  ].includes(id));
}

function isArtificialClosure([a, b]) {
  const atPole = point => Math.abs(Math.abs(Number(point[1])) - 90) <= 1e-7;
  const atDateLine = point => Math.abs(Math.abs(Number(point[0])) - 180) <= 1e-7;
  return atPole(a) || atPole(b) || (atDateLine(a) && atDateLine(b)) || Math.abs(Number(a[0]) - Number(b[0])) > 180;
}

test('renderable polygon outlines preserve land fill geometry but omit date-line and polar closures', () => {
  for (const id of ['RUS', 'ATA']) {
    const feature = featureById(id);
    assert.ok(feature, `${id} preview feature is required`);
    assert.equal(hasAreaGeometry(feature), true);

    const outline = buildRenderableStrokeFeature(feature);
    assert.equal(outline.geometry.type, 'MultiLineString');
    assert.ok(outline.geometry.coordinates.length > 0);
    assert.equal(outline.geometry.coordinates.some(isArtificialClosure), false);
    assert.equal(feature.geometry.type, 'MultiPolygon');
  }
});

test('renderable outlines retain ordinary line geometry without converting it to an area', () => {
  const line = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] } };
  assert.equal(hasAreaGeometry(line), false);
  assert.deepEqual(buildRenderableStrokeFeature(line).geometry.coordinates, [line.geometry.coordinates]);
});
