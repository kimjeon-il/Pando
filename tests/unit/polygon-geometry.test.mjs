import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import '../helpers/spherical-core.mjs';

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
  assert.throws(() => normalizePolygonGeometry([[[[0, 0], [1, 1], [0, 0]]]]), /INVALID_POLYGON_RING/);
  assert.equal(ringDistinctCoordinateCount([[0, 0], [1, 0], [0, 0], [0, 0]]), 2);
});

test('country geometry normalizer never promotes a surviving hole when the outer ring degenerates', () => {
  const degenerateOuter = [[0, 0], [1, 1], [0, 0], [0, 0]];
  const validHole = [[0.2, 0.2], [0.2, 0.8], [0.8, 0.8], [0.8, 0.2], [0.2, 0.2]];
  assert.throws(() => normalizePolygonGeometry({ type: 'Polygon', coordinates: [degenerateOuter, validHole] }), /INVALID_POLYGON_RING/);

  const validOuter = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
  assert.throws(() => normalizePolygonGeometry({ type: 'Polygon', coordinates: [validOuter, degenerateOuter] }),
    /INVALID_POLYGON: component 0 ring 1: INVALID_POLYGON_RING/);
});

test('legacy counter-clockwise country geometry is detected before project restore', () => {
  const legacy = { type: 'Polygon', coordinates: [counterClockwiseOuter] };
  assert.equal(hasCanonicalPolygonWinding(legacy), false);
  assert.equal(hasCanonicalPolygonWinding(normalizePolygonGeometry(legacy)), true);
});


test('normalizer rejects invalid coordinates rather than silently changing the border', () => {
  const ring = [[0, 0], [1, 0], [1, Number.NaN], [0, 1], [0, 0]];
  assert.throws(() => normalizePolygonGeometry({ type: 'Polygon', coordinates: [ring] }), /INVALID_JSON: expected numeric value/);
  assert.equal(hasCanonicalPolygonWinding({ type: 'Polygon', coordinates: [ring] }), false);
});

test('D3 spherical winding preserves a small antimeridian-crossing interior', () => {
  const crossing = [[179, -2], [179, 2], [-179, 2], [-179, -2], [179, -2]];
  const reversed = [...crossing.slice(0, -1)].reverse().concat([crossing[3]]);
  const normalized = normalizePolygonGeometry({ type: 'Polygon', coordinates: [reversed] });
  assert.equal(hasCanonicalPolygonWinding({ type: 'Polygon', coordinates: [reversed] }), false);
  assert.equal(hasCanonicalPolygonWinding(normalized), true);
  const area = globalThis.PandoLabPolygonGeometry.sphericalSignedArea(normalized.coordinates[0]);
  assert.ok(area > 0 && area < 0.01, `expected the small 2-degree dateline area, got ${area}`);
});

test('polar rings select the small spherical cap, not its nearly-worldwide complement', () => {
  const northPole = [[170, 80], [-170, 80], [-90, 85], [0, 89], [90, 85], [170, 80]];
  const geometry = normalizePolygonGeometry({ type: 'Polygon', coordinates: [northPole] });
  assert.equal(hasCanonicalPolygonWinding(geometry), true);
  const signed = globalThis.PandoLabPolygonGeometry.sphericalSignedArea(geometry.coordinates[0]);
  assert.ok(signed < -2 * Math.PI && 4 * Math.PI + signed < 0.1);
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

test('geographic wrapping preserves ordinary and exact full-world seam coordinates without mutating input', () => {
  const { wrapPolygonGeometry } = globalThis.PandoLabPolygonGeometry;
  const ordinary = { type: 'Polygon', coordinates: [counterClockwiseOuter] };
  const world = { type: 'Polygon', coordinates: [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]] };
  const before = structuredClone([ordinary,world]);
  assert.deepEqual(wrapPolygonGeometry(ordinary), ordinary);
  assert.deepEqual(wrapPolygonGeometry(world), world);
  assert.deepEqual([ordinary,world],before);
});

test('wrapping a dateline component does not normalize or drop an untouched tiny island', async () => {
  await import('../../assets/js/vendor/polygon-clipping.min.js');
  const crossing = [[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]];
  const island = [[[20,0],[20,1e-9],[20+1e-9,1e-9],[20+1e-9,0],[20,0]]];
  const source = { type: 'MultiPolygon', coordinates: [crossing, island] };
  const before = structuredClone(source);
  const result = globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry(source, globalThis.polygonClipping);
  assert.equal(result.coordinates.length, 3);
  assert.deepEqual(result.coordinates[2], island);
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

test('Soviet Union geometry preserves its 231 land components under D3 spherical winding', () => {
  const source = JSON.parse(fs.readFileSync(
    path.join(root, 'assets/data/territorial-entities/source/countries/state-soviet-union.json'),
    'utf8',
  ));
  const entity = [source].find(item => item.entityId === 'state:soviet-union');
  assert.ok(entity, 'the USSR catalog identity must exist');
  const version = entity.geometryVersions.find(item =>
    item.versionId === 'state:soviet-union:1922-1991-baikonur-r1');
  assert.ok(version, 'the 1922–1991 reference shape must exist');
  const geometry = version.geometry;
  assert.equal(geometry.type, 'MultiPolygon');
  assert.equal(geometry.coordinates.length, 231);
  assert.equal(geometry.coordinates.reduce((sum, polygon) =>
    sum + polygon.reduce((count, ring) => count + ring.length, 0), 0), 40054);
  assert.ok(geometry.coordinates.every(polygon => polygon.length === 1),
    'source has no holes to reclassify or drop');
  assert.equal(hasCanonicalPolygonWinding(geometry), true,
    'otherwise D3 fills the spherical complement (sea) instead of USSR land');
});

test('numerical clipping artifacts require explicit bounded audit; non-numerical degeneracies remain errors', () => {
  const { normalizeClippedPolygonGeometry } = globalThis.PandoLabPolygonGeometry;
  const valid = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  const artifact = [
    [46.798053, 39.097382],
    [46.803617228283514, 39.10088708625098],
    [46.80361722811995, 39.10088708614795],
    [46.798053, 39.097382],
  ];
  const input = [[valid], [artifact]];
  assert.throws(() => normalizeClippedPolygonGeometry(input), /INVALID_POLYGON_RING/);
  const repairs = [];
  const normalized = normalizeClippedPolygonGeometry(input, { onPrecisionDiscard: repair => repairs.push(repair) });
  assert.equal(normalized.type, 'Polygon');
  assert.equal(normalized.coordinates.length, 1);
  assert.deepEqual(normalized.coordinates[0], valid);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].polygonIndex, 1);
  assert.ok(repairs[0].areaM2 >= 0 && repairs[0].areaM2 < 0.1);
  assert.deepEqual(input[1][0], artifact, 'the raw clipping result is never mutated');
  const unsupported = [[0, 0], [1, 1], [2, 2], [0, 0]];
  assert.throws(() => normalizeClippedPolygonGeometry([[valid], [unsupported]],
    { onPrecisionDiscard() { assert.fail('larger malformed rings may not be discarded'); } }), /INVALID_POLYGON_RING/);
});

test('audited shared-border clipping omits only submicroscopic-width triangular roundoff',()=>{
  const {normalizeClippedPolygonGeometry,normalizePolygonGeometry}=globalThis.PandoLabPolygonGeometry;
  const valid=[[0,0],[0,1],[1,1],[1,0],[0,0]];
  const artifact=[[14.077778600000045,50.81575200000003],[14.078463700000043,50.81248050000005],
    [14.077918587444104,50.81508352981577],[14.077778600000045,50.81575200000003]];
  assert.throws(()=>normalizePolygonGeometry([[artifact]]),/INVALID_POLYGON_RING/,'source admission stays strict');
  assert.throws(()=>normalizeClippedPolygonGeometry([[artifact]]),/INVALID_POLYGON_RING/,'audit is required');
  const audit=[],input=[[valid],[artifact]],before=structuredClone(input);
  const geometry=normalizeClippedPolygonGeometry(input,{onPrecisionDiscard:item=>audit.push(item)});
  assert.deepEqual(geometry.coordinates,[valid]);assert.deepEqual(input,before);
  assert.equal(audit.length,1);assert.ok(audit[0].areaM2<0.1);
  const finiteWidth=[[14,50],[14.001,50.001],[14.0005,50.00050001],[14,50]];
  assert.ok(normalizeClippedPolygonGeometry([[finiteWidth]],{onPrecisionDiscard(){assert.fail('non-roundoff geometry must not be discarded');}}));
});
