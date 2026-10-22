(function initializePolygonGeometry(root) {
  'use strict';

  const COORDINATE_TOLERANCE = 1e-10;
  const core = () => {
    const module = root.PandoLabSphericalCore;
    if (!module || typeof module.normalizePolygonGeometry !== 'function'
      || typeof module.normalizePolygonRing !== 'function'
      || typeof module.hasCanonicalPolygonWinding !== 'function') {
      throw Object.assign(new Error('공통 C++ 형상 정규화기를 불러오지 못했습니다.'), { code: 'PL-GEOMETRY-WASM-001' });
    }
    return module;
  };

  function coordinatesNear(left, right, tolerance = COORDINATE_TOLERANCE) {
    return Array.isArray(left) && Array.isArray(right)
      && Math.abs(Number(left[0]) - Number(right[0])) <= tolerance
      && Math.abs(Number(left[1]) - Number(right[1])) <= tolerance;
  }

  function ensureClosedRing(rawRing) {
    if (!Array.isArray(rawRing)) throw new Error('INVALID_POLYGON_RING: coordinates must be an array');
    const coordinates = rawRing.map((coord, index) => {
      if (!Array.isArray(coord) || coord.length !== 2
        || !coord.every(value => typeof value === 'number' && Number.isFinite(value))
        || Math.abs(coord[1]) > 90) {
        throw new Error(`INVALID_POLYGON_COORDINATE: vertex ${index}`);
      }
      return coord.slice();
    });
    const ring = [];
    for (const coordinate of coordinates) {
      if (!ring.length || !coordinatesNear(ring[ring.length - 1], coordinate)) ring.push(coordinate);
    }
    if (ring.length && !coordinatesNear(ring[0], ring[ring.length - 1])) ring.push(ring[0].slice());
    else if (ring.length > 1) ring[ring.length - 1] = ring[0].slice();
    return ring;
  }

  function ringSignedArea(rawRing) {
    const ring = rawRing || [];
    let sum = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      sum += Number(ring[index][0]) * Number(ring[index + 1][1])
        - Number(ring[index + 1][0]) * Number(ring[index][1]);
    }
    return sum / 2;
  }

  function ringDistinctCoordinateCount(rawRing) {
    const ring = rawRing || [];
    const limit = ring.length > 1 && coordinatesNear(ring[0], ring[ring.length - 1]) ? ring.length - 1 : ring.length;
    const keys = new Set();
    for (let index = 0; index < limit; index += 1) {
      const coordinate = ring[index];
      keys.add(`${Math.round(Number(coordinate[0]) / COORDINATE_TOLERANCE)}:${Math.round(Number(coordinate[1]) / COORDINATE_TOLERANCE)}`);
    }
    return keys.size;
  }

  // The signed spherical integral has a single owner: shared/core.
  // In Web workers it is exposed by verified WASM, and in Qt's QJSEngine
  // by a narrow QObject bridge. Keep UI-specific planar utilities below.
  function areaCore() {
    const owner = root.PandoLabSphericalAreaCore || root.PandoLabSphericalCore;
    if (typeof owner?.sphericalRingSignedArea !== 'function'
      || typeof owner?.sphericalRingSignedAreas !== 'function') {
      throw Object.assign(new Error('공통 C++ 구면 면적 계산기를 불러오지 못했습니다.'),
        { code: 'PL-GEOMETRY-WASM-001' });
    }
    return owner;
  }

  function sphericalSignedArea(rawRing) {
    return areaCore().sphericalRingSignedArea(rawRing);
  }

  function sphericalSignedAreas(rings) {
    if (!Array.isArray(rings)) throw new TypeError('INVALID_POLYGON_RING: rings array required');
    return areaCore().sphericalRingSignedAreas(rings);
  }

  function orientRing(rawRing, wantClockwise) {
    return core().normalizePolygonRing(rawRing, !!wantClockwise);
  }

  function multiPolygonCoordinates(value) {
    if (!value) return [];
    if (value.type === 'Polygon') return [value.coordinates || []];
    if (value.type === 'MultiPolygon') return value.coordinates || [];
    return Array.isArray(value) ? value : [];
  }

  function normalizePolygonGeometry(value) {
    const source = multiPolygonCoordinates(value);
    if (!source.length) return null;
    return core().normalizePolygonGeometry(value?.type ? value : { type: 'MultiPolygon', coordinates: source }, false);
  }

  // Clipping may remove collinear vertices and leave a >180-degree planar
  // edge. Retain its path with intermediate vertices so subsequent geographic
  // wrapping cannot reinterpret that edge as the shorter route across the seam.
  // Some Boolean intersections emit a 3-point sliver at their numerical
  // precision boundary. Only a caller that explicitly records the discarded
  // area may omit a certified sub-decimetre-square clipping artifact. Ordinary
  // shells, holes, islands and all malformed source geometry still fail.
  function certifiedClipArtifact(polygon) {
    if (!Array.isArray(polygon) || polygon.length !== 1) return null;
    const ring = polygon[0];
    if (!Array.isArray(ring) || ring.length !== 4 || ring.some(point =>
      !Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n))
        || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) return null;
    if (ring[0][0] !== ring[3][0] || ring[0][1] !== ring[3][1]) return null;
    const [a, b, c] = ring;
    const xs = [a[0], b[0], c[0]], ys = [a[1], b[1], c[1]];
    if (Math.max(...xs) - Math.min(...xs) > 1 || Math.max(...ys) - Math.min(...ys) > 1
      || Math.max(...ys.map(Math.abs)) >= 85) return null;
    const smallestEdge = Math.min(Math.hypot(a[0] - b[0], a[1] - b[1]),
      Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    const longestEdge = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]),
      Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    // A point inserted along a shared edge can leave three well-separated
    // vertices with only roundoff width. This applies to audited Boolean
    // results, never the strict source-geometry admission path.
    const roundoffWidth = longestEdge > 0 ? twiceArea / longestEdge : 0;
    if (smallestEdge > 1e-9 && roundoffWidth > 2e-12) return null;
    const areaDegrees = twiceArea / 2;
    const latitude = (a[1] + b[1] + c[1]) / 3;
    const areaM2 = areaDegrees * (111195 ** 2) * Math.cos(latitude * Math.PI / 180);
    return Number.isFinite(areaM2) && areaM2 <= 0.1 ? areaM2 : null;
  }

  function normalizeClippedPolygonGeometry(value, { onPrecisionDiscard } = {}) {
    let normalized;
    const normalize = geometry => {
      const coordinates = multiPolygonCoordinates(geometry);
      if (!coordinates.length) return null;
      return core().normalizePolygonGeometry(geometry?.type ? geometry
        : { type: 'MultiPolygon', coordinates }, true);
    };
    try { normalized = normalize(value); }
    catch (error) {
      if (typeof onPrecisionDiscard !== 'function') throw error;
      const kept = [], discarded = [];
      for (const [index, polygon] of multiPolygonCoordinates(value).entries()) {
        try {
          normalize([polygon]);
          kept.push(polygon);
        } catch (error) {
          const areaM2 = certifiedClipArtifact(polygon);
          if (areaM2 === null) throw error;
          discarded.push({ polygonIndex: index, areaM2, ringCount: 1, vertexCount: 4 });
        }
      }
      normalized = normalize(kept);
      for (const item of discarded) onPrecisionDiscard(item);
    }
    return normalized;
  }

  // Boolean operations are planar. Put raw dateline rings and already split
  // candidates in the same longitude strips without changing source snapshots.
  function wrapPolygonGeometry(geometry) {
    if (!geometry) return geometry;
    const wrapped = JSON.parse(core().wrapPolygonGeometry(JSON.stringify(geometry)));
    return wrapped;
  }

  function hasCanonicalPolygonWinding(value) {
    if (!multiPolygonCoordinates(value).length) return false;
    return core().hasCanonicalPolygonWinding(value);
  }

  root.PandoLabPolygonGeometry = Object.freeze({
    ensureClosedRing,
    hasCanonicalPolygonWinding,
    normalizePolygonGeometry,
    normalizeClippedPolygonGeometry,
    wrapPolygonGeometry,
    orientRing,
    ringDistinctCoordinateCount,
    ringSignedArea,
    sphericalSignedArea,
    sphericalSignedAreas,
  });
})(globalThis);
