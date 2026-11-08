import { describe as contractSuite } from 'node:test';
import * as __boundary_dep0 from "../helpers/gis-polygon-fixture.mjs";
import "../helpers/spherical-core.mjs";
import * as __boundary_dep1 from "node:assert/strict";
import * as __boundary_dep2 from "node:test";
import "../../assets/js-vendor/earcut.min.js";
import "../../src/rendering/workers/gpu-mesh-core.js";
import * as __boundary_dep3 from "../../src/geometry/geographic-boundary.js";
import * as __boundary_dep4 from "../../src/geometry/boundary-topology.js";
import * as __boundary_dep5 from "../../src/rendering/country-shared-boundary-packet.js";
import * as __boundary_dep6 from "../../src/rendering/territorial-highlight-boundary.js";
import * as __boundary_dep7 from "../../tools/gis/measure-border-detail.mjs";
contractSuite("boundary-display-refinement", () => {
const { rectanglePolygon } = __boundary_dep0;
const assert = __boundary_dep1.default;
const test = __boundary_dep2.default;
const { buildRefinedBoundarySegments, MAX_BOUNDARY_EDGE_DEGREES } = __boundary_dep3;
const { buildTerritorialInternalBoundarySegments, buildCountrySharedBoundarySegments } = __boundary_dep4;
const { prepareCountrySharedBoundaryPacket } = __boundary_dep5;
const { excludeAncestorHighlightBoundary } = __boundary_dep6;











const rectangle = (id, west, south, east, north, rootId = id) => ({
  type: 'Feature', id, boundaryRootId: rootId,
  properties: { entityKind: 'general', parentId: id === rootId ? '' : rootId },
  geometry: rectanglePolygon(west, south, east, north),
});
const length = segments => segments.reduce((sum, segment) =>
  sum + Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]), 0);
const edgeKey = (a, b) => [a, b].map(point => point.map(value => Math.round(value * 1e6)).join(',')).sort().join('|');

test('canonical and preview subdivision reproduces the country mesh boundary vertices', () => {
  const geometry = rectangle('RECT', 0, 0, 8, 5).geometry;
  const source = structuredClone(geometry);
  for (const maxEdgeDegrees of [MAX_BOUNDARY_EDGE_DEGREES, 2]) {
    const mesh = globalThis.PandoLabGpuMeshCore.buildGpuMeshFeatures(
      [{ id: 'RECT', geometry }], { validate: true, maxEdgeDegrees });
    const fillBoundary = [];
    for (let index = 0; index < mesh.lineIndices.length; index += 2) {
      const pair = [mesh.lineIndices[index], mesh.lineIndices[index + 1]];
      fillBoundary.push(edgeKey(...pair.map(vertex =>
        [mesh.positions[vertex * 2] * 1e-6, mesh.positions[vertex * 2 + 1] * 1e-6])));
    }
    const display = buildRefinedBoundarySegments(geometry, maxEdgeDegrees)
      .map(([a, b]) => edgeKey(a, b));
    assert.deepEqual(display.sort(), fillBoundary.sort());
  }
  assert.deepEqual(geometry, source, 'display refinement must not rewrite editable geometry');
});

test('classified shared boundaries retain owner ranges and dash phases at both qualities', () => {
  const parent = rectangle('ROOT', 0, 0, 2, 6);
  const child = rectangle('CHILD', 2, 1, 3, 5, 'ROOT');
  const features = [parent, child];
  const before = structuredClone(features);
  const sources = buildCountrySharedBoundarySegments(features);
  const canonical = prepareCountrySharedBoundaryPacket(sources, features);
  const preview = prepareCountrySharedBoundaryPacket(sources, features, { maxEdgeDegrees: 2 });
  assert.deepEqual(canonical.internalOwners['CHILD|ROOT'], ['CHILD']);
  assert.deepEqual(preview.internalOwners, canonical.internalOwners);
  assert.deepEqual(canonical.outlineOverrides.ownerIds, ['CHILD', 'ROOT']);
  assert.equal(length(canonical.segments), 4);
  assert.equal(length(canonical.outlineOverrides.segments), 18);
  assert.deepEqual(preview.segments, canonical.segments, 'the common internal boundary already owns canonical subdivision');
  assert.ok(canonical.outlineOverrides.segments.length > preview.outlineOverrides.segments.length);
  for (const packet of [canonical, preview]) {
    // The child extends beyond its parent: retain both exposed coastlines,
    // while their four-degree shared contact remains an internal boundary.
    for (const [id, expectedLength] of [['ROOT', 12], ['CHILD', 6]]) {
      assert.equal(length(packet.outlineOverrides.segments.filter(segment => segment.ownerIds.includes(id))), expectedLength);
    }
    assert.equal(packet.startsEnds.length, packet.segments.length * 4);
    assert.equal(packet.chainPhase.length, packet.segments.length);
    assert.equal(packet.preparedGeometry.segmentCount, packet.segments.length);
    assert.equal(packet.preparedGeometry.capCount, 2);
    for (let index = 0; index < packet.segments.length; index++) {
      const segment = packet.segments[index];
      assert.ok(packet.chainPhase[index] >= 0);
      assert.ok(Math.abs(segment.end[1] - segment.start[1]) <=
        (packet === preview ? 2 : MAX_BOUNDARY_EDGE_DEGREES) + 1e-6);
    }
    assert.ok(packet.outlineOverrides.segments.every(segment =>
      !(segment.start[0] === 2 && segment.end[0] === 2
        && Math.min(segment.start[1], segment.end[1]) < 5
        && Math.max(segment.start[1], segment.end[1]) > 1)));
  }
  assert.deepEqual(features, before);
});

test('territorial internal boundaries refine after ownership without touching source rings', () => {
  const parent = rectangle('ROOT', 0, 0, 4, 4);
  const child = rectangle('CHILD', 1, 1, 3, 3, 'ROOT');
  const before = structuredClone([parent, child]);
  const segments = buildTerritorialInternalBoundarySegments([parent], [child]);
  assert.ok(segments.length > 4);
  assert.ok(segments.every(segment => segment.styleType === 'subunit-internal'));
  assert.ok(segments.every(segment => segment.unitOwners[0].id === 'CHILD'));
  const unique = new Set(segments.map(segment => segment.key));
  assert.equal(unique.size, segments.length);
  for (const segment of segments) assert.ok(Math.hypot(
    segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]) <= MAX_BOUNDARY_EDGE_DEGREES + 1e-6);
  assert.deepEqual([parent, child], before);
});

test('child selection hides inherited coast and refines only the remaining edge', () => {
  const parent = rectangle('ROOT', 0, 0, 4, 4);
  const child = rectangle('CHILD', 0, 0, 2, 4, 'ROOT');
  const before = structuredClone([parent, child]);
  const highlight = excludeAncestorHighlightBoundary(child, [parent]);
  const lines = highlight.geometry.coordinates;
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0][0], 2);
  assert.equal(lines[0].at(-1)[0], 2);
  assert.ok(lines[0].length > 2);
  assert.ok(lines[0].every(point => point[0] === 2));
  assert.deepEqual([parent, child], before);
});
});
contractSuite("border-detail-measurement", () => {
const test = __boundary_dep2.default;
const assert = __boundary_dep1.default;
const { compareChains, detailMetrics, sampleChain, measureSamples } = __boundary_dep7;



test('uniform arc-length distances do not depend on native vertex density',()=>{
 const sparse=[[0,0],[1000,0]],dense=Array.from({length:101},(_,n)=>[n*10,10]);
 const result=compareChains(sparse,dense,{spacingMeters:25});
 assert.equal(result.leftToRight.samples,41);assert.equal(result.rightToLeft.samples,41);
 assert.equal(result.pooled.median,10);assert.equal(result.sampledMaximumMeters,10);assert.equal(result.lengthRatio,1);
 assert.equal(detailMetrics(dense).vertices,101);assert.equal(detailMetrics(dense).lengthKm,1);
});
test('metric length, common-window turns and fixed endpoints remain separate measurements',()=>{
 const line=[[0,0],[1000,0],[1000,1000]];const m=detailMetrics(line);
 assert.equal(m.lengthKm,2);assert.equal(m.verticesPerKm,1.5);assert.equal(m.turnDegrees.median,90);
 assert.deepEqual(sampleChain(line,1000),line);assert.deepEqual(line,[[0,0],[1000,0],[1000,1000]]);
 const q=compareChains(line,[[10,0],[1010,0],[1010,1000]]);assert.deepEqual(q.endpointOffsetsMeters,[10,10]);
});
test('explicit finite metric chains and positive sample spacing are required',()=>{
 assert.throws(()=>detailMetrics([[0,0],[NaN,1]]));assert.throws(()=>sampleChain([[0,0],[1,1]],0));assert.throws(()=>detailMetrics([[0,0],[0,0]]));
});

test('the file workflow requires metre CRS metadata and keeps input chains immutable',()=>{
 const input={schema:'pando-border-detail-samples-v1',samples:[{id:'synthetic',metricCrs:'+proj=aeqd +lat_0=0 +lon_0=0 +units=m',public:[[0,0],[1000,0]],work:[[0,0],[1000,0]],reference:[[0,10],[1000,10]]}]};
 const before=structuredClone(input),result=measureSamples(input);
 assert.equal(result.schema,'pando-border-detail-metrics-v1');assert.equal(result.samples[0].comparison50m.pooled.median,10);assert.deepEqual(input,before);
 input.samples[0].metricCrs='EPSG:4326';assert.throws(()=>measureSamples(input),/metre projection/);
});

test('closed outlines have no chord ratio and short lines have no 1km turn statistic',()=>{const closed=detailMetrics([[0,0],[1000,0],[1000,1000],[0,0]]);assert.equal(closed.lengthToChordRatio,null);assert.equal(closed.lengthToChordApplicability,'not-applicable-closed-chain');assert.equal(detailMetrics([[0,0],[10,0]]).turnDegrees,null);});
});
