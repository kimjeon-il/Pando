import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

await import('../../assets/js/modules/polygon-geometry.js');

const {
  ensureClosedRing,
  hasCanonicalPolygonWinding,
  normalizePolygonGeometry,
  ringDistinctCoordinateCount,
  ringSignedArea,
} = globalThis.PandoLabPolygonGeometry;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const counterClockwiseOuter = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
const clockwiseHole = [[0.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1.5, 0.5], [0.5, 0.5]];

test('country geometry normalizer rewinds clipping output for D3 spherical paths', () => {
  const normalized = normalizePolygonGeometry([[counterClockwiseOuter, clockwiseHole]]);
  assert.equal(normalized.type, 'Polygon');
  assert.ok(ringSignedArea(normalized.coordinates[0]) < 0);
  assert.ok(ringSignedArea(normalized.coordinates[1]) > 0);
  assert.equal(hasCanonicalPolygonWinding(normalized), true);
});

test('country geometry normalizer closes open rings and rejects degenerate polygons', () => {
  const normalized = normalizePolygonGeometry([[[[0, 0], [0, 2], [2, 2], [2, 0]]]]);
  assert.deepEqual(normalized.coordinates[0][0], normalized.coordinates[0].at(-1));
  assert.equal(normalizePolygonGeometry([[[[0, 0], [1, 1], [0, 0]]]]), null);
  assert.equal(ringDistinctCoordinateCount([[0, 0], [1, 0], [0, 0], [0, 0]]), 2);
});

test('country geometry normalizer never promotes a surviving hole when the outer ring degenerates', () => {
  const degenerateOuter = [[0, 0], [1, 1], [0, 0], [0, 0]];
  const validHole = [[0.2, 0.2], [0.2, 0.8], [0.8, 0.8], [0.8, 0.2], [0.2, 0.2]];
  assert.equal(normalizePolygonGeometry({ type: 'Polygon', coordinates: [degenerateOuter, validHole] }), null);

  const validOuter = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
  const normalized = normalizePolygonGeometry({ type: 'Polygon', coordinates: [validOuter, degenerateOuter] });
  assert.equal(normalized.coordinates.length, 1);
});

test('legacy counter-clockwise country geometry is detected before project restore', () => {
  const legacy = { type: 'Polygon', coordinates: [counterClockwiseOuter] };
  assert.equal(hasCanonicalPolygonWinding(legacy), false);
  assert.equal(hasCanonicalPolygonWinding(normalizePolygonGeometry(legacy)), true);
});

test('country geometry normalizer removes consecutive duplicate vertices', () => {
  const duplicate = [117.703608, 4.163415];
  const ring = [duplicate, duplicate, [117.738071, 4.157242], [117.75, 4.1], duplicate];
  const normalizedRing = ensureClosedRing(ring);

  assert.equal(normalizedRing.length, ring.length - 1);
  assert.deepEqual(normalizedRing[0], normalizedRing.at(-1));
  assert.equal(normalizedRing.some((coord, index) => index > 0
    && coord[0] === normalizedRing[index - 1][0]
    && coord[1] === normalizedRing[index - 1][1]), false);
});

test('country geometry normalizer removes a zero-area collinear backtrack', () => {
  const ring = [[0, 0], [4, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const normalized = normalizePolygonGeometry({ type: 'Polygon', coordinates: [ring] });

  assert.equal(normalized.coordinates[0].some(coord => coord[0] === 4 && coord[1] === 0), false);
  assert.equal(normalized.coordinates[0].some(coord => coord[0] === 2 && coord[1] === 0), true);
  assert.equal(hasCanonicalPolygonWinding(normalized), true);
});

test('Borneo canonical country rings are clean before runtime normalization', () => {
  const countries = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
  const borneoCountries = countries.features.filter(feature => ['IDN', 'MYS'].includes(feature.id));

  assert.equal(borneoCountries.length, 2);
  for (const feature of borneoCountries) {
    assert.equal(hasCanonicalPolygonWinding(feature.geometry), true);
    const normalized = normalizePolygonGeometry(feature.geometry);
    assert.ok(normalized);
    assert.equal(hasCanonicalPolygonWinding(normalized), true);
    assert.deepEqual(normalized, feature.geometry);
    const polygons = normalized.type === 'Polygon' ? [normalized.coordinates] : normalized.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      assert.equal(ring.some((coord, index) => index > 0
        && coord[0] === ring[index - 1][0]
        && coord[1] === ring[index - 1][1]), false);
    }
  }
});

test('geographic wrapping preserves ordinary and exact full-world seam polygons by identity', () => {
  const { wrapPolygonGeometry } = globalThis.PandoLabPolygonGeometry;
  const forbidden = { intersection() { assert.fail('already planar geometry must not be clipped'); } };
  const ordinary = { type: 'Polygon', coordinates: [counterClockwiseOuter] };
  const world = { type: 'Polygon', coordinates: [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]] };
  assert.equal(wrapPolygonGeometry(ordinary, forbidden), ordinary);
  assert.equal(wrapPolygonGeometry(world, forbidden), world);
});

test('wrapping a dateline component does not normalize or drop an untouched tiny island', async () => {
  await import('../../assets/js/vendor/polygon-clipping.min.js');
  const crossing = [[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]];
  const island = [[[20,0],[20,1e-9],[20+1e-9,1e-9],[20+1e-9,0],[20,0]]];
  const source = { type: 'MultiPolygon', coordinates: [crossing, island] };
  const before = structuredClone(source);
  const result = globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry(source, globalThis.polygonClipping);
  assert.equal(result.coordinates.length, 3);
  assert.equal(result.coordinates[2], island);
  assert.deepEqual(source, before);
});

test('full-world seam wrapping retains both sides of a dateline-crossing hole', async () => {
  await import('../../assets/js/vendor/polygon-clipping.min.js');
  const pc = globalThis.polygonClipping;
  const world = [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]];
  const hole = [[179,-2],[-179,-2],[-179,2],[179,2],[179,-2]];
  const source = { type: 'Polygon', coordinates: [...world, hole] };
  const expected = pc.difference([world], [
    [[[179,-2],[180,-2],[180,2],[179,2],[179,-2]]],
    [[[-180,-2],[-179,-2],[-179,2],[-180,2],[-180,-2]]],
  ]);
  const result = globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry(source, pc);
  assert.deepEqual(pc.xor(result.type === 'Polygon' ? [result.coordinates] : result.coordinates, expected), []);
});

test('wrapping is idempotent when strip clipping creates a long planar edge', async () => {
  await import('../../assets/js/vendor/polygon-clipping.min.js');
  const pc = globalThis.polygonClipping, wrap = globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry;
  const source = { type: 'Polygon', coordinates: [[[170,0],[170,10],[-40,10],[110,10],[110,0],[-40,0],[170,0]]] };
  const first = wrap(source, pc), second = wrap(first, pc);
  const polygons = value => value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  assert.deepEqual(pc.xor(polygons(first), polygons(second)), []);
});
