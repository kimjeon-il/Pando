import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReferenceCoordinate, detectReferenceGraticule } from '../../plugins/pando-map-tools/lib/analysis/grid.mjs';

test('coordinate labels preserve original script while parsing mixed digits and DMS', () => {
  const raw = '\u200f۳۵° ٣٠′ ۰″ N';
  assert.deepEqual(parseReferenceCoordinate(raw), { originalText: raw, axis: 'latitude', value: 35.5 });
  assert.equal(parseReferenceCoordinate('١٢٠° ١٥′ W').value, -120.25);
  assert.equal(parseReferenceCoordinate('35° 60′ N'), null);
  assert.equal(parseReferenceCoordinate('91° N'), null);
  assert.equal(parseReferenceCoordinate('35°'), null, 'axis and hemisphere must be explicit');
  assert.equal(parseReferenceCoordinate('120 km'), null);
});

test('graticule matches coordinate labels to visible grid lines, retaining datum uncertainty', () => {
  const width = 240, height = 180, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x, y) => data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  for (const x of [60, 120, 180]) for (let y = 20; y <= 160; y++) pixel(x, y);
  for (const y of [60, 120]) for (let x = 20; x <= 220; x++) pixel(x, y);
  const blocks = [60, 120, 180].map((x, index) => ({ rawValue: `${index + 20}° E`, boundingBox: { x: x - 10, y: 5, width: 20, height: 10 } }));
  blocks.push(...[60, 120].map((y, index) => ({ rawValue: `${40 - index}° N`, boundingBox: { x: 0, y: y - 5, width: 15, height: 10 } })));
  const result = detectReferenceGraticule({ width, height, data }, blocks);
  assert.equal(result.points.length, 6);
  assert.equal(result.coordinateSystem, 'unverified');
  assert.deepEqual(result.points[0].image, [60 / 240, 60 / 180]);
  assert.deepEqual(result.points[0].coordinate, [20, 40]);
  assert.equal(result.independentLongitudeLabels, 3);
  assert.equal(result.independentLatitudeLabels, 2);
  const conflict = [...blocks, { ...blocks[0], rawValue: '70° E' }];
  assert.equal(detectReferenceGraticule({ width, height, data }, conflict).points.length, 4, 'conflicting labels cannot become controls');
});
