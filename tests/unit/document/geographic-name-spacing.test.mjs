import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeCountryFeature} from '../../../src/document/country-feature.js';

test('GIS and user-assigned names are literal even when they resemble retired display defaults', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  for (const [id, name] of [['ALD', '올란드 제도'], ['TUR', '터키'], ['custom', '내가 만든 제도']]) {
    assert.equal(normalizeCountryFeature({ type: 'Feature', id, properties: { name }, geometry }).properties.name, name);
  }
});
