import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import zlib from 'node:zlib';

const data = new URL('../../assets/data/', import.meta.url);
const worldBundle = JSON.parse(fs.readFileSync(new URL('world/current.json', data), 'utf8'));
const canonical = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson', data)));
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(worldBundle.assets.previewCountries.url, data))));
const anchors = JSON.parse(fs.readFileSync(new URL('country-label-anchors-v0.10.1.json', data))).anchors;

function coordinates(geometry) {
  const result = [];
  const visit = value => {
    if (typeof value[0] === 'number') result.push(value);
    else value.forEach(visit);
  };
  visit(geometry.coordinates);
  return result;
}

test('Bajo Nuevo and Serranilla use their Korean geographic names at both map qualities', () => {
  for (const collection of [canonical, preview]) {
    for (const [id, name] of [
      ['BJN', '바호누에보환초'],
      ['SER', '세라니야환초'],
    ]) {
      const feature = collection.features.find(item => item.id === id);
      assert.ok(feature, id);
      assert.equal(feature.properties.name, name, id);
    }
  }
});

test('Bajo Nuevo and Serranilla polygons and label anchors match their real locations', () => {
  // Colombian official ranges place Bajo Nuevo near 78.6 W and Serranilla near 79.9 W.
  for (const collection of [canonical, preview]) {
    for (const [id, west, east] of [
      ['BJN', -78.82, -78.50],
      ['SER', -80.05, -79.60],
    ]) {
      const feature = collection.features.find(item => item.id === id);
      assert.ok(feature, id);
      for (const [longitude] of coordinates(feature.geometry)) {
        assert.ok(longitude >= west && longitude <= east, `${id}: ${longitude}`);
      }
      assert.ok(anchors[id][0] >= west && anchors[id][0] <= east, `${id} label anchor`);
    }
  }
});
