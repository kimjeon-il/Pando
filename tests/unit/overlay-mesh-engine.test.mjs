import assert from 'node:assert/strict';
import test from 'node:test';
import "../../shared/frontend/js/workers/gpu-mesh-core.js";
import { buildPolygonGeometryPacket } from "../../shared/frontend/js/modules/render-scene.js";

import { simplifyRenderGeometry } from "../../shared/frontend/js/modules/render-lod.js";

const polygon = rings => ({ type: 'Polygon', coordinates: rings });
const square = (left, bottom, right, top) => [[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]];
const angle = (a, b) => {
  const radians = Math.PI / 180;
  const vector = point => [Math.cos(point[1] * radians) * Math.cos(point[0] * radians), Math.cos(point[1] * radians) * Math.sin(point[0] * radians), Math.sin(point[1] * radians)];
  const x = vector(a), y = vector(b);
  return Math.acos(Math.min(1, Math.max(-1, x.reduce((sum, value, index) => sum + value * y[index], 0)))) / radians;
};
test('overlay and country fills use identical refined triangles, including their interior edges', () => {
  const geometry = polygon([square(0, 0, 8, 5)]);
  const packet = buildPolygonGeometryPacket(geometry);
  const mesh = globalThis.PandoLabGpuMeshCore.buildGpuMeshFeatures([{ id: 'fixture', geometry }], { validate: true });
  assert.deepEqual(packet.indices, mesh.triangleIndices);
  assert.ok(packet.triangleCount > 2);
  let longest = 0;
  for (let index = 0; index < packet.indices.length; index += 3) {
    const points = Array.from(packet.indices.slice(index, index + 3), vertex => Array.from(packet.positions.slice(vertex * 2, vertex * 2 + 2)));
    for (let edge = 0; edge < 3; edge++) longest = Math.max(longest, angle(points[edge], points[(edge + 1) % 3]));
  }
  assert.ok(longest <= 0.49901, `interior edge exceeds spherical precision: ${longest}`);
});

test('date-line and polar fills preserve the common engine contract and reject degenerate rings', () => {
  const fixtures = [polygon([square(179, -1, 181, 1).map(([x,y]) => [x > 180 ? x - 360 : x, y])]),
    polygon([[[-180,87],[-90,87],[0,87],[90,87],[180,87],[180,90],[-180,90],[-180,87]]])];
  for (const geometry of fixtures) {
    const packet = buildPolygonGeometryPacket(geometry);
    assert.ok(packet.triangleCount > 0);
    assert.ok(packet.maxEdgeDegrees <= 0.49901);
    assert.ok([...packet.positions].every(Number.isFinite));
    const canonical = globalThis.PandoLabGpuMeshCore.buildGpuMeshFeatures([{ id: 'fixture', geometry }], { validate: true });
    assert.deepEqual(packet.indices, canonical.triangleIndices);
  }
  assert.throws(() => buildPolygonGeometryPacket(polygon([[[0,0],[1,0],[2,0],[0,0]]])), /삼각분할/);
  assert.throws(() => buildPolygonGeometryPacket(polygon([square(0,0,2,2), [[1,1],[1,1],[1,1]]])), /삼각분할/);
});

test('holes remain empty after subdivision and failed triangulation is visible', () => {
  const geometry = polygon([square(0, 0, 4, 4), square(1, 1, 3, 3).reverse()]);
  const packet = buildPolygonGeometryPacket(geometry);
  for (let index = 0; index < packet.indices.length; index += 3) {
    const centroid = [0, 0];
    for (const vertex of packet.indices.slice(index, index + 3)) {
      centroid[0] += packet.positions[vertex * 2] / 3; centroid[1] += packet.positions[vertex * 2 + 1] / 3;
    }
    assert.ok(!(centroid[0] > 1 && centroid[0] < 3 && centroid[1] > 1 && centroid[1] < 3));
  }
  assert.throws(() => buildPolygonGeometryPacket(polygon([square(0,0,2,2), square(3,3,4,4)])),
    error => error.code === 'PL-MESH-TRIANGULATION', 'invalid hole must fail through the shared engine');
});

test('display LOD preserves a hole inside a narrow shell protrusion', () => {
  const geometry = polygon([
    [[0,0],[4,0],[4,4],[0,4],[0,2.1],[-.05,2],[0,1.9],[0,0]],
    [[-.03,2],[-.015,2.02],[-.015,1.98],[-.03,2]],
  ]);
  for (const type of ['Polygon', 'MultiPolygon']) {
    const source = type === 'Polygon' ? geometry : { type, coordinates: [geometry.coordinates] };
    for (const projection of ['flat', 'globe']) for (const lod of ['coarse', 'medium']) {
      const display = simplifyRenderGeometry(source, { lod, policy: 'independent', projection });
      assert.equal(display, source, 'ring topology must remain canonical');
      assert.ok(buildPolygonGeometryPacket(display).triangleCount > 0);
    }
  }
});
