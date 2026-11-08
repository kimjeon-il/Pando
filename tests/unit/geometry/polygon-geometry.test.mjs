import * as __polygon_native_0 from "node:assert/strict";
import * as __polygon_native_1 from "node:test";
import * as __polygon_native_2 from "../../helpers/node-core-wasm-loader.mjs";
import assert from 'node:assert/strict';

import test from 'node:test';

import "../../helpers/spherical-core.mjs";

await import("../../../src/geometry/polygon-geometry.js");

const {
  ensureClosedRing,
  hasCanonicalPolygonWinding,
  normalizePolygonGeometry,
  ringDistinctCoordinateCount,
  ringSignedArea,
} = globalThis.PandoLabPolygonGeometry;

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
  await import("../../../assets/js-vendor/polygon-clipping.min.js");
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
  await import("../../../assets/js-vendor/polygon-clipping.min.js");
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
  await import("../../../assets/js-vendor/polygon-clipping.min.js");
  const pc = globalThis.polygonClipping, wrap = globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry;
  const source = { type: 'Polygon', coordinates: [[[170,0],[170,10],[-40,10],[110,10],[110,0],[-40,0],[170,0]]] };
  const first = wrap(source, pc), second = wrap(first, pc);
  const polygons = value => value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  assert.deepEqual(pc.xor(polygons(first), polygons(second)), []);
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

test('audited shared-boundary zero-area retrace is not promoted to a historical island',()=>{
  const {normalizePolygonGeometry,normalizeClippedPolygonGeometry}=globalThis.PandoLabPolygonGeometry;
  const original=[[18.62310395972329,52.865064843259695],[18.62310395972331,52.86506484325972],
    [18.65694287507342,52.88613406982571],[18.69982606372881,52.89817847593115],
    [18.718115696644393,52.896766975148424],[18.69982606372883,52.89817847593119],
    [18.65694287507341,52.88613406982573],[18.6231039597233,52.86506484325975],
    [18.62310395972329,52.865064843259695]];
  const valid=[[0,0],[0,1],[1,1],[1,0],[0,0]];
  const input=[[valid],[original]],unchanged=structuredClone(input);
  assert.throws(()=>normalizePolygonGeometry([[original]]),/INVALID_POLYGON_RING/);
  assert.throws(()=>normalizeClippedPolygonGeometry([[original]]),/INVALID_POLYGON_RING/);
  const audit=[],result=normalizeClippedPolygonGeometry(input,{onPrecisionDiscard:entry=>audit.push(entry)});
  assert.deepEqual(result.coordinates,[valid]);assert.deepEqual(input,unchanged);
  assert.equal(audit.length,1);assert.equal(audit[0].polygonIndex,1);
  assert.ok(audit[0].areaM2>=0&&audit[0].areaM2<=0.1);
  const wrong=[[0,0],[0.01,0.01],[0.02,0],[0,0.01],[0,0]];
  assert.throws(()=>normalizeClippedPolygonGeometry([[wrong]],{
    onPrecisionDiscard(){assert.fail('a non-retraced self-crossing boundary cannot be deleted');}
  }),/INVALID_POLYGON_RING|INVALID_SPHERICAL_WINDING|AMBIGUOUS_SPHERICAL_RING/);
});

// polygon native contracts share this owner suite.
{
const assert = __polygon_native_0.default;
const test = __polygon_native_1.default;
const loadVerifiedCore = __polygon_native_2["loadVerifiedCore"];
const box = (x, y, w, h) => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];
test('shared polygon operation owns multi-operand union, holes and empty intersection', async () => {
  const core = await loadVerifiedCore();
  const a = box(0,0,2,2), b = box(1,0,2,2);
  const union = core.polygonOperation('union', [a,b], false);
  assert.deepEqual(union, [[[[0,0],[3,0],[3,2],[0,2],[0,0]]]]);
  const hole = core.polygonOperation('difference', [box(0,0,5,5),box(1,1,1,1)], false);
  assert.equal(hole.length,1);
  assert.equal(hole[0].length,2);
  assert.deepEqual(core.polygonOperation('intersection',[a,box(10,10,1,1)],false),[]);
  assert.deepEqual(a,box(0,0,2,2));
});


test('WASM wrapping preserves the current baseline and explicit winding corrections', async () => {
  const { readFileSync } = await import('node:fs');
  const core = await loadVerifiedCore();
  const fixture = JSON.parse(readFileSync(new URL("../../fixtures/p6/wrapping-baseline.json", import.meta.url)));
  const corrections = new Map(JSON.parse(readFileSync(new URL("../../fixtures/p6/wrapping-corrections.json", import.meta.url))).cases.map(row => [row.id, row.expected]));
  for (const row of fixture.cases.filter(row => row.operation === 'wrap')) {
    assert.deepEqual(JSON.parse(core.wrapPolygonGeometry(JSON.stringify(row.input))), corrections.get(row.id) ?? row.expected, row.id);
  }
});

test('cut and wrapping failures retain technical JavaScript errors', async () => {
  const core = await loadVerifiedCore();
  assert.throws(() => core.wrapPolygonGeometry('{'), error => error instanceof Error && error.code === 'PL-GEOMETRY-CALCULATION');
  assert.throws(() => new core.PreparedCutGeometry('{'), error => error instanceof Error && error.code === 'PL-CUT-CALCULATION');
});

test('subdivided wide shells and holes have canonical winding and preserve planar area', async () => {
  const { readFileSync } = await import('node:fs');
  const core = await loadVerifiedCore();
  const baseline = JSON.parse(readFileSync(new URL("../../fixtures/p6/wrapping-baseline.json", import.meta.url))).cases;
  const corrections = JSON.parse(readFileSync(new URL("../../fixtures/p6/wrapping-corrections.json", import.meta.url))).cases;
  const area = geometry => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
    .reduce((sum, polygon) => sum + polygon.reduce((part, ring, index) => part + (index ? -1 : 1)
      * Math.abs(ring.slice(1).reduce((value, point, i) => value + ring[i][0] * point[1] - point[0] * ring[i][1], 0) / 2), 0), 0);
  for (const row of corrections) {
    const old = baseline.find(old => old.id === row.id), input = old.input;
    const before = structuredClone(input);
    const result = row.operation === 'wrap' ? JSON.parse(core.wrapPolygonGeometry(JSON.stringify(input))) : core.normalizePolygonGeometry(input, true);
    assert.deepEqual(result, row.expected, row.id);
    assert.equal(core.hasCanonicalPolygonWinding(result), true, row.id);
    assert.equal(core.hasCanonicalPolygonWinding(old.expected), false, row.id + ' corrects a formerly invalid result');
    assert.equal(area(result), area(old.expected), row.id + ' preserves area');
    assert.deepEqual(input, before);
  }
});

test('polygon difference is stable for nearly coincident boundaries without mutating inputs', async () => {
  const core=await loadVerifiedCore();
  const p=[12.09703138349695,50.25690418331658],
    q=[12.102393,50.259156];
  const subject=[[[12.09,50.25],[12.11,50.25],[12.11,50.27],[12.09,50.27],[12.09,50.25]]];
  const cutter=[[p,q,[12.102393+1e-12,50.27],[12.09703138349695-1e-12,50.27],p]];
  const original=structuredClone([subject,cutter]);
  const first=core.polygonOperation('difference',[subject,cutter],false);
  const second=core.polygonOperation('difference',[subject,cutter],false);
  assert.deepEqual(first,second,'the exact source geometry must produce stable output');
  assert.deepEqual([subject,cutter],original,'the cutter and country borders must remain unchanged');
  assert.ok(first.length>0);
});
}
