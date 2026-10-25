import '../helpers/spherical-core.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import "../../shared/frontend/js/vendor/earcut.min.js";
import "../../shared/frontend/js/workers/gpu-mesh-core.js";
import { buildRefinedBoundarySegments, MAX_BOUNDARY_EDGE_DEGREES } from "../../shared/frontend/js/modules/geographic-boundary.js";
import { buildTerritorialInternalBoundarySegments, buildCountrySharedBoundarySegments } from "../../shared/frontend/js/modules/boundary-topology.js";
import { prepareCountrySharedBoundaryPacket } from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";
import { excludeAncestorHighlightBoundary } from "../../shared/frontend/js/modules/territorial-highlight-boundary.js";

const rectangle = (id, west, south, east, north, rootId = id) => ({
  type: 'Feature', id, boundaryRootId: rootId,
  properties: { entityKind: 'general', parentId: id === rootId ? '' : rootId },
  geometry: { type: 'Polygon', coordinates: [[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]] },
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
  assert.deepEqual(canonical.outlineOverrides.ownerIds, ['ROOT']);
  assert.equal(length(canonical.segments), 4);
  assert.equal(length(canonical.outlineOverrides.segments), 12);
  assert.ok(canonical.segments.length > preview.segments.length);
  for (const packet of [canonical, preview]) {
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
