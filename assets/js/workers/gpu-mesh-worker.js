'use strict';
importScripts('../vendor/earcut.min.js');

function buildGpuMeshFeatures(features, earcutImpl) {
    const MAX_RENDER_EDGE_DEGREES = 0.499;
    const MAX_REFINEMENT_PASSES = 16;
    const DEG_TO_RAD = Math.PI / 180;
    const MIN_EDGE_DOT = Math.cos(MAX_RENDER_EDGE_DEGREES * DEG_TO_RAD);

    function samePoint(a, b) {
      return a && b && Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
    }
    function polygonsFor(geometry) {
      if (!geometry) return [];
      if (geometry.type === 'Polygon') return [geometry.coordinates || []];
      if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
      return [];
    }
    function unwrapRing(rawRing, anchor = null) {
      let ring = rawRing || [];
      if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
      if (ring.length < 3) return [];
      const out = [[Number(ring[0][0]), Number(ring[0][1])]];
      if (anchor !== null) {
        while (out[0][0] - anchor > 180) out[0][0] -= 360;
        while (out[0][0] - anchor < -180) out[0][0] += 360;
      }
      for (let i = 1; i < ring.length; i += 1) {
        let lon = Number(ring[i][0]);
        const prev = out[i - 1][0];
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
        out.push([lon, Number(ring[i][1])]);
      }
      return out;
    }

    function unitVector(point) {
      const lon = point[0] * DEG_TO_RAD;
      const lat = point[1] * DEG_TO_RAD;
      const cosLat = Math.cos(lat);
      return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
    }

    function edgeKey(a, b) {
      return a < b ? `${a}:${b}` : `${b}:${a}`;
    }

    function sphericalMidpoint(a, b, va, vb) {
      const x = va[0] + vb[0];
      const y = va[1] + vb[1];
      const z = va[2] + vb[2];
      const length = Math.hypot(x, y, z);
      if (length < 1e-12) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let lon = Math.atan2(y / length, x / length) / DEG_TO_RAD;
      const lat = Math.asin(Math.max(-1, Math.min(1, z / length))) / DEG_TO_RAD;
      const anchor = (a[0] + b[0]) / 2;
      while (lon - anchor > 180) lon -= 360;
      while (lon - anchor < -180) lon += 360;
      return [lon, lat];
    }

    function refineTriangles(points, sourceTriangles) {
      const vectors = points.map(unitVector);
      let triangles = Array.from(sourceTriangles || []);
      const edgeDot = (a, b) => {
        const va = vectors[a];
        const vb = vectors[b];
        return va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
      };
      const edgeNeedsSplit = (a, b) => edgeDot(a, b) < MIN_EDGE_DOT - 1e-14;
      for (let pass = 0; pass < MAX_REFINEMENT_PASSES; pass += 1) {
        const splitEdges = new Map();
        const markEdge = (a, b) => {
          if (!edgeNeedsSplit(a, b)) return;
          const key = edgeKey(a, b);
          if (!splitEdges.has(key)) splitEdges.set(key, [a, b]);
        };
        for (let index = 0; index < triangles.length; index += 3) {
          const a = triangles[index];
          const b = triangles[index + 1];
          const c = triangles[index + 2];
          markEdge(a, b);
          markEdge(b, c);
          markEdge(c, a);
        }
        if (!splitEdges.size) return triangles;

        const midpointIndices = new Map();
        for (const [key, edge] of splitEdges) {
          const a = points[edge[0]];
          const b = points[edge[1]];
          const midpoint = sphericalMidpoint(a, b, vectors[edge[0]], vectors[edge[1]]);
          const midpointIndex = points.length;
          points.push(midpoint);
          vectors.push(unitVector(midpoint));
          midpointIndices.set(key, midpointIndex);
        }

        const next = [];
        const add = (a, b, c) => next.push(a, b, c);
        for (let index = 0; index < triangles.length; index += 3) {
          const a = triangles[index];
          const b = triangles[index + 1];
          const c = triangles[index + 2];
          const ab = midpointIndices.get(edgeKey(a, b));
          const bc = midpointIndices.get(edgeKey(b, c));
          const ca = midpointIndices.get(edgeKey(c, a));
          const mask = (ab === undefined ? 0 : 1) | (bc === undefined ? 0 : 2) | (ca === undefined ? 0 : 4);
          if (mask === 0) add(a, b, c);
          else if (mask === 1) {
            add(a, ab, c); add(ab, b, c);
          } else if (mask === 2) {
            add(b, bc, a); add(bc, c, a);
          } else if (mask === 4) {
            add(c, ca, b); add(ca, a, b);
          } else if (mask === 3) {
            add(ab, b, bc);
            if (edgeDot(a, bc) >= edgeDot(ab, c)) {
              add(a, ab, bc); add(a, bc, c);
            } else {
              add(a, ab, c); add(ab, bc, c);
            }
          } else if (mask === 6) {
            add(bc, c, ca);
            if (edgeDot(b, ca) >= edgeDot(bc, a)) {
              add(b, bc, ca); add(b, ca, a);
            } else {
              add(b, bc, a); add(bc, ca, a);
            }
          } else if (mask === 5) {
            add(ca, a, ab);
            if (edgeDot(c, ab) >= edgeDot(ca, b)) {
              add(c, ca, ab); add(c, ab, b);
            } else {
              add(c, ca, b); add(ca, ab, b);
            }
          } else {
            add(a, ab, ca); add(ab, b, bc); add(ca, bc, c); add(ab, bc, ca);
          }
        }
        triangles = next;
      }
      let worst = null;
      for (let index = 0; index < triangles.length; index += 3) {
        const a = triangles[index];
        const b = triangles[index + 1];
        const c = triangles[index + 2];
        for (const edge of [[a, b], [b, c], [c, a]]) {
          if (!edgeNeedsSplit(edge[0], edge[1])) continue;
          const va = vectors[edge[0]];
          const vb = vectors[edge[1]];
          const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
          const degrees = Math.acos(dot) / DEG_TO_RAD;
          if (!worst || degrees > worst.degrees) worst = { degrees, a: points[edge[0]], b: points[edge[1]] };
        }
      }
      if (worst) throw new Error(`GPU 면 세분화가 수렴하지 않았습니다: ${worst.degrees.toFixed(6)}° ${worst.a.join(',')} → ${worst.b.join(',')}`);
      return triangles;
    }

    if (typeof earcutImpl !== 'function') throw new Error('GPU 삼각분할 엔진이 없습니다.');
    const positions = [];
    const countryIndices = [];
    const triangleIndices = [];
    const lineIndices = [];
    const countryIds = [];
    for (let countryIndex = 0; countryIndex < features.length; countryIndex += 1) {
      const feature = features[countryIndex];
      countryIds.push(String(feature.properties?.editor_id || feature.properties?.iso_a3 || countryIndex));
      for (const polygon of polygonsFor(feature.geometry)) {
        if (!polygon?.length) continue;
        const outer = unwrapRing(polygon[0]);
        if (outer.length < 3) continue;
        const anchor = outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
        const rings = [outer];
        for (let ringIndex = 1; ringIndex < polygon.length; ringIndex += 1) {
          const hole = unwrapRing(polygon[ringIndex], anchor);
          if (hole.length >= 3) rings.push(hole);
        }
        const flat = [];
        const holes = [];
        const ringStarts = [];
        const ringCounts = [];
        for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
          if (ringIndex > 0) holes.push(flat.length / 2);
          ringStarts.push(flat.length / 2);
          ringCounts.push(rings[ringIndex].length);
          for (const point of rings[ringIndex]) flat.push(point[0], point[1]);
        }
        const points = [];
        for (let index = 0; index < flat.length; index += 2) points.push([flat[index], flat[index + 1]]);
        const localTriangles = refineTriangles(points, earcutImpl(flat, holes, 2));
        const vertexOffset = positions.length / 2;
        for (const point of points) {
          positions.push(Math.round(point[0] * 1e6), Math.round(point[1] * 1e6));
          countryIndices.push(countryIndex);
        }
        for (const index of localTriangles) triangleIndices.push(vertexOffset + index);
        for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
          const start = vertexOffset + ringStarts[ringIndex];
          const count = ringCounts[ringIndex];
          for (let index = 0; index < count; index += 1) lineIndices.push(start + index, start + ((index + 1) % count));
        }
      }
    }
    return {
      countryIds,
      positions: new Int32Array(positions),
      countryIndices: new Uint16Array(countryIndices),
      triangleIndices: new Uint32Array(triangleIndices),
      lineIndices: new Uint32Array(lineIndices),
    };
  }

function gpuMeshWorkerMain() {
    self.onmessage = event => {
      const token = event.data?.token;
      try {
        const mesh = buildGpuMeshFeatures(event.data?.features || [], self.earcut);
        self.postMessage({ token, ok: true, mesh }, [
          mesh.positions.buffer,
          mesh.countryIndices.buffer,
          mesh.triangleIndices.buffer,
          mesh.lineIndices.buffer,
        ]);
      } catch (error) {
        self.postMessage({ token, ok: false, message: error?.message || String(error) });
      }
    };
  }

gpuMeshWorkerMain();
