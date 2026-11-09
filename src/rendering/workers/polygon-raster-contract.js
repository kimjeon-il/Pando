'use strict';
((scope) => {
// A no-fill packet must prove that every polygon lies on one exact integer
// render-grid line (or point). Signed-area cancellation is not such a proof.
// Native generated-ring predicates also reject forged degenerate originals.
// Full shell/hole triangulation remains the producer's responsibility. This
// neither weakens strict source admission nor rewrites stored Float64 rings.
function isGridCollapsedPolygonPacket(packet) {
  const { positions, indices, boundaryIndices, ringCoordinates: coordinates, ringOffsets: rings, polygonOffsets: polygons } = packet || {};
  if (!(positions instanceof Float32Array) || positions.length < 6 || positions.length % 2
    || !(indices instanceof Uint32Array) || indices.length
    || !(boundaryIndices instanceof Uint32Array) || boundaryIndices.length
    || !(coordinates instanceof Float64Array) || coordinates.length % 2
    || !(rings instanceof Uint32Array) || rings.length < 2 || rings[0] !== 0 || rings.at(-1) * 2 !== coordinates.length
    || !(polygons instanceof Uint32Array) || polygons.length < 2 || polygons[0] !== 0 || polygons.at(-1) !== rings.length - 1) return false;
  const displayVertices = new Set(), sourcePolygons = [];
  for (let polygon = 1; polygon < polygons.length; polygon++) {
    if (polygons[polygon] <= polygons[polygon - 1]) return false;
    let origin, direction;
    const sourcePolygon = []; sourcePolygons.push(sourcePolygon);
    for (let ring = polygons[polygon - 1]; ring < polygons[polygon]; ring++) {
      const first = rings[ring], end = rings[ring + 1];
      if (end - first < 4 || end * 2 > coordinates.length
        || coordinates[first * 2] !== coordinates[(end - 1) * 2]
        || coordinates[first * 2 + 1] !== coordinates[(end - 1) * 2 + 1]) return false;
      const originals = new Set(), sourceRing = []; sourcePolygon.push(sourceRing);
      for (let vertex = first; vertex < end; vertex++) {
        const x = coordinates[vertex * 2], y = coordinates[vertex * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) return false;
        originals.add(x + ',' + y); sourceRing.push([x, y]);
        const px = Math.round(x * 1e6), py = Math.round(y * 1e6);
        displayVertices.add(Math.fround(px * 1e-6) + ',' + Math.fround(py * 1e-6));
        const point = [BigInt(px), BigInt(py)];
        if (!origin) origin = point;
        else {
          const dx = point[0] - origin[0], dy = point[1] - origin[1];
          if (!direction && (dx !== 0n || dy !== 0n)) direction = [dx, dy];
          else if (direction && dx * direction[1] !== dy * direction[0]) return false;
        }
      }
      if (originals.size < 3) return false;
    }
  }
  for (let index = 0; index < positions.length; index += 2)
    if (!displayVertices.has(positions[index] + ',' + positions[index + 1])) return false;
  const core = scope.PandoLabSphericalCore;
  return typeof core?.validateClippedGisGeometry === 'function'
    && core.validateClippedGisGeometry(sourcePolygons) === true;
}

scope.PandoLabPolygonRasterContract = Object.freeze({ isGridCollapsedPolygonPacket });
})(typeof self !== 'undefined' ? self : globalThis);
