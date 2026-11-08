// Original feature contract: map-editing-foundation.test.mjs
// Retained geometry validity, label layout and atomic display-state contracts.
import "../../helpers/spherical-core.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';

import { geometryAreaKm2, lineDistanceKm, percentChange } from "../../../tools/gis/geometry-metrics.js";
import { validateGeometry } from "../../../src/geometry/geometry-validation.js";
import * as validation from "../../../src/geometry/geometry-validation.js";
import { automaticLabelSettings, LABEL_PRIORITIES, layoutLabels } from "../../../src/rendering/label-layout.js";
import { createAtomicMapStateController } from "../../../src/app/map-state-transition.js";
import { sharedCalculationCore } from "../../../src/document/temporal.js";

const feature = (id, coordinates) => ({
  type: 'Feature',
  id,
  properties: { name: id },
  geometry: { type: 'Polygon', coordinates: [coordinates] },
});

test('the shared geometry validator exposes no retired editing audit', () => {
  assert.equal('runMapAudit' in validation, false);
  assert.equal('validateTerritorialGeometry' in validation, false);
  assert.equal(typeof validation.validateGeometry, 'function');
});

test('C++ ring validation preserves the current located geometry issues', () => {
  const rings = [
    [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    [[0, 0], [1, 0], [1, 0], [0, 1], [0, 0]],
    [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]],
    [[0, 0], [1, 0], [2, 0], [0, 0]],
    [[0, 0], [1, 0], [0, 0]],
  ];
  const expectedRows = [
    [],
    [{ kind: 'open-ring', coordinate: [0, 1] }],
    [{ kind: 'duplicate-vertex', coordinate: [1, 0], vertexIndex: 2 }, { kind: 'self-intersection', coordinate: [1, -0], segmentIndex: 0 }],
    [{ kind: 'zero-area', coordinate: [0, 0] }, { kind: 'self-intersection', coordinate: [1, 1], segmentIndex: 0 }],
    [{ kind: 'zero-area', coordinate: [0, 0] }],
    [{ kind: 'invalid-geometry', coordinate: [0, 0] }],
  ];
  for (const [index, ring] of rings.entries()) {
    const actual = globalThis.PandoLabSphericalCore.validateTerritorialRing(ring).map(({ kind, coordinate, vertexIndex, segmentIndex }) =>
      ({ kind, coordinate, vertexIndex, segmentIndex }));
    const expected = expectedRows[index].map(({ kind, coordinate, vertexIndex, segmentIndex }) =>
      ({ kind, coordinate, vertexIndex, segmentIndex }));
    assert.deepEqual(actual, expected);
    assert.deepEqual(validateGeometry(feature('R', ring)).map(({ kind, coordinate, vertexIndex, segmentIndex }) =>
      ({ kind, coordinate, vertexIndex, segmentIndex })), expected);
  }
  const short = [[3, 4, 5]];
  assert.deepEqual(validateGeometry(feature('R', short))[0].coordinate, short[0]);
  assert.equal(validateGeometry(feature('R', []))[0].kind, 'invalid-geometry');
});

test('nonfinite ring coordinates report their vertex without a map location', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const ring = [[0, 0], [1, 0], [value, 1], [0, 0]];
    const issues = validateGeometry(feature('R', ring));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'invalid-geometry');
    assert.equal(issues[0].vertexIndex, 2);
    assert.equal(issues[0].coordinate, undefined);
    assert.match(issues[0].message, /좌표/);
    const short = validateGeometry(feature('R', [[value, 1]]));
    assert.equal(short[0].kind, 'invalid-geometry');
    assert.equal(short[0].vertexIndex, 0);
    assert.equal(short[0].coordinate, undefined);
  }
  let seed = 17;
  const next = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % 101 - 50; };
  const longer = Array.from({ length: 65 }, () => [next(), next()]);
  longer[0][0] = NaN;
  const issues = validateGeometry(feature('R', longer));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'invalid-geometry');
  assert.equal(issues[0].vertexIndex, 0);
  assert.equal(issues[0].coordinate, undefined);
});

test('territorial overlap area preserves per-polygon holes and empty input', () => {
  const square = [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]];
  const hole = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const small = [[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]];
  assert.equal(globalThis.PandoLabSphericalCore.territorialValidationArea([[square, hole], [small]]), 9);
  assert.equal(globalThis.PandoLabSphericalCore.territorialValidationArea([]), 0);
  const decision = globalThis.PandoLabSphericalCore.territorialAreaDecision;
  assert.equal(decision(1e-10, 'overlap'), false);
  assert.equal(decision(1.01e-10, 'overlap'), true);
  assert.equal(decision(1e-10, 'gap'), false);
  assert.equal(decision(1e-8, 'verification'), false);
  assert.equal(decision(1.01e-8, 'verification'), true);
});

test('territorial overlap candidates preserve affected direction and diagnostic counts', () => {
  const boxes = [[0, 0, 2, 2], [1, 1, 3, 3], [2, 2, 4, 4]];
  const iterator = new globalThis.PandoLabSphericalCore.TerritorialOverlapCandidates(
    ['A', 'B', 'C'], boxes, [false, true, false], true, null);
  try {
    assert.deepEqual(iterator.next(), { leftIndex: 1, rightIndex: 0 });
    assert.deepEqual(iterator.components([boxes[1]], [boxes[0]]), [[0, 0]]);
    assert.deepEqual(iterator.next(), { leftIndex: 1, rightIndex: 2 });
    assert.deepEqual(iterator.components([boxes[1]], [boxes[2]]), [[0, 0]]);
    assert.equal(iterator.next(), null);
    assert.deepEqual(iterator.diagnostics(), { boundsCandidatePairs: 2, componentCandidatePairs: 2, componentEvaluated: true });
  } finally { iterator.delete(); }
  const astral = '\u{10000}', bmp = '\ue000';
  const unicode = new globalThis.PandoLabSphericalCore.TerritorialOverlapCandidates(
    [astral, bmp], boxes.slice(0, 2), [false, false], false, [`${astral}|${bmp}`]);
  try {
    assert.deepEqual(unicode.next(), { leftIndex: 0, rightIndex: 1 });
    assert.equal(unicode.next(), null);
  } finally { unicode.delete(); }
});

test('territorial coarse overlap preserves containment and hole behavior', () => {
  const box = (x, y, w, h) => [[x, y], [x+w, y], [x+w, y+h], [x, y+h], [x, y]];
  const left = new globalThis.PandoLabSphericalCore.TerritorialPolygonIndex([box(0, 0, 10, 10), box(3, 3, 4, 4)]);
  const filled = new globalThis.PandoLabSphericalCore.TerritorialPolygonIndex([box(1, 1, 1, 1)]);
  const hole = new globalThis.PandoLabSphericalCore.TerritorialPolygonIndex([box(4, 4, 1, 1)]);
  try {
    assert.equal(left.mayOverlap(filled, [0, 0, 10, 10], [1, 1, 2, 2]), true);
    assert.equal(left.mayOverlap(hole, [0, 0, 10, 10], [4, 4, 5, 5]), false);
  } finally { left.delete(); filled.delete(); hole.delete(); }
});

test('territorial verification sampling preserves short rings and closes long samples', () => {
  const sample = globalThis.PandoLabSphericalCore.territorialSampleIndices;
  assert.deepEqual(sample(3, 512), [0, 1, 2]);
  const long = sample(514, 512);
  assert.equal(long.length, 513);
  assert.equal(long[0], 0);
  assert.equal(long[511], 511);
  assert.equal(long[512], 0);
});

test('spherical metrics provide useful live distance, area and percentage feedback', () => {
  assert.ok(lineDistanceKm([[0, 0], [1, 0]]) > 111);
  assert.ok(lineDistanceKm([[0, 0], [1, 0]]) < 112);
  assert.ok(geometryAreaKm2(feature('A', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]).geometry) > 12_000);
  assert.equal(percentChange(100, 125), 25);
  assert.equal(percentChange(0, 10), null);
});

test('geometry validation returns a located self-intersection issue', () => {
  const invalid = feature('BAD', [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]);
  const issues = validateGeometry(invalid);
  assert.ok(issues.some(issue => issue.kind === 'self-intersection' && issue.coordinate));
});

test('administrative containment retains its exact outside-area threshold', () => {
  const core = sharedCalculationCore;
  assert.equal(core.territorialAreaDecision(1e-10, 'containment'), false);
  assert.equal(core.territorialAreaDecision(2e-10, 'containment'), true);
  assert.equal(core.territorialAreaDecision(Number.NaN, 'containment'), false);
});

test('batched C++ display metrics retain holes, date-line wrapping and empty inputs', () => {
  const polygons = [[], [[[[0,0],[2,0],[2,2],[0,2],[0,0]]]],
    [[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]],
    [[[[179,10],[-179,10],[-179,12],[179,12],[179,10]]]]];
  const results = sharedCalculationCore.displayGeometryAreasKm2(polygons);
  const expected = [0, 49447.34036408627, 98868.32141153161, 48546.24727917458];
  assert.deepEqual(results, expected);
  assert.equal(sharedCalculationCore.displayLineDistancesKm([[[179,10],[-179,10],[-178,11]]])[0], 374.95264909590503);
  assert.deepEqual(sharedCalculationCore.displayLineDistancesKm([[], [null,[1,2]]]), [0,0]);
});

test('label layout respects priority and pinned labels', () => {
  const common = { point: [50, 50], width: 40, height: 15, collisionGroup: 'map', minZoom: 0, maxZoom: 10 };
  const output = layoutLabels([
    { ...common, key: 'place', priority: LABEL_PRIORITIES.place },
    { ...common, key: 'country', priority: LABEL_PRIORITIES.country },
    { ...common, key: 'pinned', priority: 1, pinned: true },
  ], { zoom: 2 });
  assert.deepEqual(output.map(item => item.key), ['pinned']);
});

test('a selected label wins a collision without persisting a raw priority override', () => {
  const common = { point: [50, 50], width: 40, height: 15, collisionGroup: 'country', minZoom: 0, maxZoom: 10 };
  const output = layoutLabels([
    { ...common, key: 'ordinary', priority: LABEL_PRIORITIES.country },
    { ...common, key: 'selected', priority: LABEL_PRIORITIES.country, selected: true },
  ], { zoom: 1 });
  assert.deepEqual(output.map(item => item.key), ['selected']);
});

test('label layout culls ordinary labels whose full box crosses viewport bounds', () => {
  const output = layoutLabels([
    { key: 'inside', point: [50, 50], width: 20, height: 10, priority: 1 },
    { key: 'clipped', point: [96, 10], width: 20, height: 10, priority: 2 },
    { key: 'selected', point: [96, 30], width: 20, height: 10, priority: 3, selected: true },
  ], { bounds: { left: 0, top: 0, right: 100, bottom: 100 } });
  assert.deepEqual(output.map(item => item.key), ['selected', 'inside']);
});

test('label policies override legacy tuning while preserving established manual placement', () => {
  const settings = automaticLabelSettings('city', {
    priority: 999,
    minZoom: 0,
    maxZoom: 1,
    collisionGroup: 'legacy',
    manualPosition: [127, 37],
    pinned: false,
  });

  assert.equal(settings.priority, LABEL_PRIORITIES.majorCity);
  assert.equal(settings.minZoom, 1.25);
  assert.equal(settings.maxZoom, Infinity);
  assert.equal(settings.collisionGroup, 'place');
  assert.deepEqual(settings.manualPosition, [127, 37]);
  assert.equal(settings.pinned, true);
});

test('atomic map state rejects stale snapshots', () => {
  const applied = [];
  const controller = createAtomicMapStateController({ applySnapshot: snapshot => applied.push(snapshot) });
  const first = controller.begin({ year: 1900 });
  const second = controller.begin({ year: 1910 });
  assert.equal(controller.commit(first, { countries: ['old'] }), false);
  assert.equal(controller.commit(second, { countries: ['new'] }), true);
  assert.deepEqual(applied[0].countries, ['new']);
});
