(function initializeCountryGeometry(root) {
  'use strict';

  const COORDINATE_TOLERANCE = 1e-10;

  function coordinatesNear(left, right, tolerance = COORDINATE_TOLERANCE) {
    return Array.isArray(left) && Array.isArray(right)
      && Math.abs(Number(left[0]) - Number(right[0])) <= tolerance
      && Math.abs(Number(left[1]) - Number(right[1])) <= tolerance;
  }

  function pointOnSegment(point, start, end, tolerance = COORDINATE_TOLERANCE) {
    const dx = Number(end?.[0]) - Number(start?.[0]);
    const dy = Number(end?.[1]) - Number(start?.[1]);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= tolerance * tolerance) return coordinatesNear(point, start, tolerance);
    const offsetX = Number(point?.[0]) - Number(start?.[0]);
    const offsetY = Number(point?.[1]) - Number(start?.[1]);
    const position = (offsetX * dx + offsetY * dy) / lengthSquared;
    if (position < -tolerance || position > 1 + tolerance) return false;
    return Math.abs(offsetX * dy - offsetY * dx) <= tolerance * Math.sqrt(lengthSquared);
  }

  function removeCollinearBacktracks(rawRing) {
    const vertices = rawRing.slice(0, -1);
    let changed = true;
    while (changed && vertices.length >= 3) {
      changed = false;
      for (let index = 0; index < vertices.length; index += 1) {
        const previous = vertices[(index + vertices.length - 1) % vertices.length];
        const current = vertices[index];
        const next = vertices[(index + 1) % vertices.length];
        if (pointOnSegment(next, previous, current)
          || pointOnSegment(previous, current, next)) {
          vertices.splice(index, 1);
          changed = true;
          break;
        }
      }
    }
    return vertices.length ? [...vertices, vertices[0].slice()] : [];
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

  function normalizeRing(rawRing) {
    const ring = ensureClosedRing(rawRing);
    return ring.length >= 4 ? removeCollinearBacktracks(ring) : ring;
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

  // D3 chooses the complement of a negatively oriented spherical ring.
  // A planar shoelace test is not equivalent at the antimeridian or poles.
  function sphericalSignedArea(rawRing) {
    const radians = Math.PI / 180;
    const quarterPi = Math.PI / 4;
    let area = 0;
    let previousLongitude = rawRing[0][0] * radians;
    let previousPhi = rawRing[0][1] * radians / 2 + quarterPi;
    let previousCos = Math.cos(previousPhi), previousSin = Math.sin(previousPhi);
    for (let index = 1; index < rawRing.length; index += 1) {
      const longitude = rawRing[index][0] * radians;
      const phi = rawRing[index][1] * radians / 2 + quarterPi;
      const delta = longitude - previousLongitude;
      const sin = Math.sin(phi), cos = Math.cos(phi);
      const k = previousSin * sin;
      area += Math.atan2(k * Math.sin(delta), previousCos * cos + k * Math.cos(delta));
      previousLongitude = longitude;
      previousSin = sin;
      previousCos = cos;
    }
    return area * 2;
  }

  function isGlobalSeamRing(ring) {
    if (ring.length !== 5) return false;
    const vertices = new Set(ring.slice(0, -1).map(([x, y]) => `${x}:${y}`));
    return vertices.size === 4 && [-180, 180].every(x => [-90, 90].every(y => vertices.has(`${x}:${y}`)));
  }

  function sphericalInteriorArea(ring) {
    const signed = sphericalSignedArea(ring);
    const sphere = Math.PI * 4;
    if (!Number.isFinite(signed)) throw new Error('AMBIGUOUS_SPHERICAL_RING: nonfinite spherical area');
    // D3's spherical accumulator can cancel tiny, otherwise valid islands.
    // Only use a local planar fallback when the entire ring is away from seams/poles.
    if (Math.abs(signed) <= 1e-15) {
      const discontinuity = ring.some((point, index) => Math.abs(point[1]) === 90
        || (index && Math.abs(point[0] - ring[index - 1][0]) >= 180));
      if (discontinuity) throw new Error('AMBIGUOUS_SPHERICAL_RING: spherical interior cannot be determined');
      const [ox, oy] = ring[0];
      let planar = 0;
      for (let index = 1; index < ring.length; index += 1) {
        const previous = ring[index - 1], current = ring[index];
        planar += (previous[0] - ox) * (current[1] - oy) - (current[0] - ox) * (previous[1] - oy);
      }
      if (planar === 0) throw new Error('INVALID_POLYGON_RING: zero-area ring');
      const tiny = Math.max(Math.abs(planar) * Math.PI * Math.PI / (180 * 180) / 2, Number.MIN_VALUE);
      return planar < 0 ? tiny : sphere - tiny;
    }
    const area = signed < 0 ? sphere + signed : signed;
    if (!(area > 0 && area < sphere)) {
      throw new Error('AMBIGUOUS_SPHERICAL_RING: hemisphere or pole topology requires an explicit source');
    }
    return area;
  }

  function orientRing(rawRing, wantClockwise) {
    let ring = normalizeRing(rawRing);
    if (ring.length < 4 || ringDistinctCoordinateCount(ring) < 3) {
      throw new Error('INVALID_POLYGON_RING: fewer than three distinct vertices');
    }
    if (isGlobalSeamRing(ring)) {
      if (!wantClockwise) throw new Error('INVALID_POLYGON_HOLE: global seam shell cannot be a hole');
      return ring;
    }
    const area = sphericalInteriorArea(ring);
    const canonical = wantClockwise ? area < 2 * Math.PI : area > 2 * Math.PI;
    if (!canonical) ring = normalizeRing(ring.slice(0, -1).reverse());
    return ring;
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
    const polygons = source.map((polygon, polygonIndex) => {
      if (!Array.isArray(polygon) || !polygon.length) {
        throw new Error(`INVALID_POLYGON: missing shell at polygon ${polygonIndex}`);
      }
      const outer = orientRing(polygon[0], true);
      const holes = polygon.slice(1).map((ring, holeIndex) => {
        try { return orientRing(ring, false); }
        catch (error) { throw new Error(`INVALID_POLYGON_HOLE: polygon ${polygonIndex} hole ${holeIndex}: ${error.message}`); }
      });
      return [outer, ...holes];
    });
    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
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
    if (smallestEdge > 1e-9) return null;
    const areaDegrees = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    const latitude = (a[1] + b[1] + c[1]) / 3;
    const areaM2 = areaDegrees * (111195 ** 2) * Math.cos(latitude * Math.PI / 180);
    return Number.isFinite(areaM2) && areaM2 <= 0.1 ? areaM2 : null;
  }

  function normalizeClippedPolygonGeometry(value, { onPrecisionDiscard } = {}) {
    let normalized;
    try { normalized = normalizePolygonGeometry(value); }
    catch (error) {
      if (typeof onPrecisionDiscard !== 'function') throw error;
      const kept = [], discarded = [];
      for (const [index, polygon] of multiPolygonCoordinates(value).entries()) {
        try {
          normalizePolygonGeometry([polygon]);
          kept.push(polygon);
        } catch {
          const areaM2 = certifiedClipArtifact(polygon);
          if (areaM2 === null) throw error;
          discarded.push({ polygonIndex: index, areaM2, ringCount: 1, vertexCount: 4 });
        }
      }
      normalized = normalizePolygonGeometry(kept);
      for (const item of discarded) onPrecisionDiscard(item);
    }
    if (!normalized) return null;
    const polygons = multiPolygonCoordinates(normalized).map(polygon => polygon.map(ring => {
      const segmented = [ring[0]];
      for (let index = 1; index < ring.length; index += 1) {
        const a = ring[index - 1], b = ring[index];
        const count = Math.max(1, Math.ceil(Math.abs(b[0] - a[0]) / 180));
        for (let part = 1; part < count; part += 1) segmented.push([
          a[0] + (b[0] - a[0]) * part / count, a[1] + (b[1] - a[1]) * part / count,
        ]);
        segmented.push(b);
      }
      return segmented;
    }));
    return normalized.type === 'Polygon' ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  }

  // Boolean operations are planar. Put raw dateline rings and already split
  // candidates in the same longitude strips without changing source snapshots.
  function wrapPolygonGeometry(geometry, clipper) {
    if (!geometry) return geometry;
    const polygons = multiPolygonCoordinates(geometry);
    const crossesStrip = polygons.some(polygon => polygon.some(ring => ring.some(([x], index) => {
      const jump = index ? Math.abs(x - ring[index - 1][0]) : 0;
      return x < -180 || x > 180 || (jump > 180 && jump < 360);
    })));
    if (!crossesStrip) return geometry;
    let changed = false;
    const result = [];
    for (const polygon of polygons) {
      const reference = polygon[0]?.[0]?.[0];
      const unwrapped = polygon.map(ring => {
        let previous = reference;
        return ring.map(([longitude, latitude], index) => {
          let x = longitude;
          // Exact full-world edges are already a deliberate seam, not a wrap.
          const fullWorldEdge = index > 0 && Math.abs(longitude - ring[index - 1][0]) === 360;
          if (!fullWorldEdge) {
            while (x - previous > 180) x -= 360;
            while (x - previous < -180) x += 360;
          }
          previous = x;
          return [x, latitude];
        });
      });
      let west = Infinity, east = -Infinity;
      for (const ring of unwrapped) for (const [x] of ring) {
        west = Math.min(west, x); east = Math.max(east, x);
      }
      const unchanged = unwrapped.every((ring, ri) => ring.every((point, i) => point[0] === polygon[ri][i][0]));
      if (unchanged && west >= -180 && east <= 180) { result.push(polygon); continue; }
      changed = true;
      // A full-world seam shell can contain both longitude copies of a hole
      // that crosses the seam. Subtract every overlapping periodic copy before
      // clipping; treating it as a single planar hole would fill its other half.
      let outerWest = Infinity, outerEast = -Infinity;
      for (const [x] of unwrapped[0]) { outerWest = Math.min(outerWest, x); outerEast = Math.max(outerEast, x); }
      const holes = [];
      let periodicHoles = false;
      for (const ring of unwrapped.slice(1)) {
        let holeWest = Infinity, holeEast = -Infinity;
        for (const [x] of ring) { holeWest = Math.min(holeWest, x); holeEast = Math.max(holeEast, x); }
        const firstCopy = Math.ceil((outerWest - holeEast) / 360), lastCopy = Math.floor((outerEast - holeWest) / 360);
        if (firstCopy !== 0 || lastCopy !== 0) periodicHoles = true;
        for (let copy = firstCopy; copy <= lastCopy; copy += 1) holes.push([[ring.map(([x, y]) => [x + copy * 360, y])]]);
      }
      const component = periodicHoles && holes.length ? clipper.difference([[unwrapped[0]]], ...holes) : [unwrapped];
      const first = Math.floor((west + 180) / 360), last = Math.floor((east + 180) / 360);
      for (let strip = first; strip <= last; strip += 1) {
        const left = -180 + strip * 360, right = 180 + strip * 360;
        const clipped = clipper.intersection(component, [[[[left, -90], [right, -90], [right, 90], [left, 90], [left, -90]]]]);
        const normalized = normalizeClippedPolygonGeometry(clipped.map(part => part.map(ring => ring.map(([x, y]) => [x - strip * 360, y]))));
        result.push(...multiPolygonCoordinates(normalized));
      }
    }
    if (!changed) return geometry;
    if (!result.length) return null;
    return result.length === 1 ? { type: 'Polygon', coordinates: result[0] }
      : { type: 'MultiPolygon', coordinates: result };
  }

  function hasCanonicalPolygonWinding(value) {
    const polygons = multiPolygonCoordinates(value);
    if (!polygons.length) return false;
    try {
      return polygons.every(polygon => Array.isArray(polygon) && polygon.length
        && polygon.every((rawRing, index) => {
          const ring = ensureClosedRing(rawRing);
          if (ring.length !== rawRing?.length || ring.length < 4 || ringDistinctCoordinateCount(ring) < 3) return false;
          if (isGlobalSeamRing(ring)) return index === 0;
          const area = sphericalInteriorArea(ring);
          return index === 0 ? area < 2 * Math.PI : area > 2 * Math.PI;
        }));
    } catch { return false; }
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
  });
})(globalThis);
