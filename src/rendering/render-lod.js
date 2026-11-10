const RENDER_LOD_LEVELS = Object.freeze({
  COARSE: 'coarse',
  MEDIUM: 'medium',
  HIGH: 'high',
});

function finiteCoordinate(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function cloneCoordinate(value) {
  return [Number(value[0]), Number(value[1])];
}

function hasDatelineJump(coordinates) {
  for (let index = 1; index < coordinates.length; index += 1) {
    if (Math.abs(Number(coordinates[index][0]) - Number(coordinates[index - 1][0])) > 180) return true;
  }
  return false;
}

function distanceToSegmentSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  const x = start[0] + ratio * dx;
  const y = start[1] + ratio * dy;
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

function simplifyOpenLine(coordinates, tolerance) {
  if (coordinates.length <= 2 || tolerance <= 0 || hasDatelineJump(coordinates)) return coordinates.map(cloneCoordinate);
  const threshold = tolerance * tolerance;
  const keep = new Uint8Array(coordinates.length);
  keep[0] = keep[coordinates.length - 1] = 1;
  const stack = [[0, coordinates.length - 1]];
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    let furthest = -1;
    let maximum = threshold;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = distanceToSegmentSquared(coordinates[index], coordinates[startIndex], coordinates[endIndex]);
      if (distance > maximum) {
        maximum = distance;
        furthest = index;
      }
    }
    if (furthest < 0) continue;
    keep[furthest] = 1;
    stack.push([startIndex, furthest], [furthest, endIndex]);
  }
  return coordinates.filter((_coordinate, index) => keep[index]).map(cloneCoordinate);
}

function densifyLine(coordinates, maxEdgeDegrees) {
  if (!(maxEdgeDegrees > 0) || coordinates.length < 2) return coordinates;
  const result = [cloneCoordinate(coordinates[0])];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    let deltaLongitude = Number(end[0]) - Number(start[0]);
    while (deltaLongitude > 180) deltaLongitude -= 360;
    while (deltaLongitude < -180) deltaLongitude += 360;
    const deltaLatitude = Number(end[1]) - Number(start[1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(deltaLongitude, deltaLatitude) / maxEdgeDegrees));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      let longitude = Number(start[0]) + deltaLongitude * ratio;
      while (longitude > 180) longitude -= 360;
      while (longitude < -180) longitude += 360;
      result.push([longitude, Number(start[1]) + deltaLatitude * ratio]);
    }
  }
  return result;
}

function simplifyLine(coordinates, tolerance, { maxEdgeDegrees = 0 } = {}) {
  const source = (coordinates || []).filter(finiteCoordinate).map(cloneCoordinate);
  if (!source.length) return [];
  return densifyLine(simplifyOpenLine(source, tolerance), maxEdgeDegrees);
}

export function resolveRenderLod({ requested = 'high', policy = 'exact', protected: protectedGeometry = false } = {}) {
  if (protectedGeometry || policy !== 'independent') return RENDER_LOD_LEVELS.HIGH;
  return Object.values(RENDER_LOD_LEVELS).includes(requested) ? requested : RENDER_LOD_LEVELS.HIGH;
}

export function simplifyRenderGeometry(geometry, {
  lod = RENDER_LOD_LEVELS.HIGH,
  policy = 'exact',
  projection = 'flat',
} = {}) {
  const level = resolveRenderLod({ requested: lod, policy });
  if (!geometry || level === RENDER_LOD_LEVELS.HIGH || policy !== 'independent') return geometry;
  // Independent ring reduction can move holes outside their shell or create crossings.
  // Preserve polygon topology; the common mesh engine refines its interior edges.
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return geometry;
  const tolerance = level === RENDER_LOD_LEVELS.COARSE ? 0.075 : 0.018;
  const maxEdgeDegrees = projection === 'globe' ? (level === RENDER_LOD_LEVELS.COARSE ? 4 : 2.5) : 0;
  const line = coordinates => simplifyLine(coordinates, tolerance, { maxEdgeDegrees });
  if (geometry.type === 'LineString') return { type: 'LineString', coordinates: line(geometry.coordinates) };
  if (geometry.type === 'MultiLineString') return {
    type: 'MultiLineString', coordinates: (geometry.coordinates || []).map(line).filter(part => part.length >= 2),
  };
  return geometry;
}


/**
 * A display-only, source-revision-owned shared arc index. Matching reverse
 * country borders reuse one vertex-importance sequence. The screen error is
 * conservatively bounded in both flat and orthographic globe projections.
 */
const RADIANS_PER_LOD_DEGREE = Math.PI / 180;
export const MAX_MAP_GEOMETRY_ERROR_PX = 0.5;

function lodNodeKey(coordinate, precision) {
  const factor = 10 ** precision;
  return `${Math.round(coordinate[0] * factor)},${Math.round(coordinate[1] * factor)}`;
}
function lodCartesian([longitude, latitude]) {
  const lon = longitude * RADIANS_PER_LOD_DEGREE;
  const lat = latitude * RADIANS_PER_LOD_DEGREE;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
function lodPointSegmentSquared(point, start, end) {
  const delta = end.map((value, axis) => value - start[axis]);
  const length = delta.reduce((sum, value) => sum + value * value, 0);
  const t = length ? Math.max(0, Math.min(1,
    delta.reduce((sum, value, axis) => sum + value * (point[axis] - start[axis]), 0) / length)) : 0;
  return delta.reduce((sum, _, axis) => sum + (point[axis] - start[axis] - t * delta[axis]) ** 2, 0);
}
function lodVertexImportance(points) {
  const importance = new Float64Array(points.length);
  importance[0] = importance[points.length - 1] = Infinity;
  const unit = points.map(lodCartesian);
  const stack = [[0, points.length - 1, Infinity]];
  while (stack.length) {
    const [first, last, cap] = stack.pop();
    let maximum = 0, furthest = -1;
    for (let index = first + 1; index < last; index += 1) {
      const flat = distanceToSegmentSquared(points[index], points[first], points[last])
        * RADIANS_PER_LOD_DEGREE ** 2;
      const globe = lodPointSegmentSquared(unit[index], unit[first], unit[last]);
      const candidate = Math.sqrt(Math.max(flat, globe));
      if (candidate > maximum) { maximum = candidate; furthest = index; }
    }
    if (furthest < 0 || !maximum) continue;
    const significance = Math.min(cap, maximum);
    importance[furthest] = significance;
    stack.push([first, furthest, significance], [furthest, last, significance]);
  }
  return importance;
}
function lodSignedArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index], b = points[(index + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/**
 * Buckets represent an upper bound on cssScale, never the rounded-down scale.
 * Increases take effect immediately; 15% hysteresis applies only to zoom-out.
 */
export function resolveScreenLodBucket({ cssScale, previous = null,
  errorPx = MAX_MAP_GEOMETRY_ERROR_PX } = {}) {
  if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(errorPx) || errorPx <= 0)
    throw new TypeError('Screen LOD needs positive CSS scale and pixel error.');
  const step = Math.SQRT2;
  const target = Math.pow(2, Math.ceil(Math.log2(cssScale) * 2) / 2);
  const keep = previous?.upperScale >= cssScale && cssScale > previous.upperScale / step * 0.85;
  const upperScale = keep ? previous.upperScale : target;
  return Object.freeze({ upperScale, errorPx, toleranceRadians: errorPx / upperScale,
    key: `${upperScale}:${errorPx}` });
}

/**
 * Bound spherical mesh chord/sagitta deviation independently of boundary DP.
 * Unlike a fixed world-wide 0.499-degree subdivision, this creates fewer
 * interior triangles at small screen scales without changing source geometry.
 */
export function resolveScreenLodEdgeDegrees({
  cssScale, errorPx = MAX_MAP_GEOMETRY_ERROR_PX,
  minDegrees = 0.499, maxDegrees = 8,
} = {}) {
  if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(errorPx)
    || errorPx <= 0 || !Number.isFinite(minDegrees) || minDegrees <= 0
    || !Number.isFinite(maxDegrees) || maxDegrees < minDegrees)
    throw new TypeError('Invalid screen LOD tessellation budget.');
  const permittedSagitta = Math.min(2, errorPx / cssScale);
  const angleRadians = 2 * Math.acos(1 - permittedSagitta);
  return Math.max(minDegrees, Math.min(maxDegrees, angleRadians / RADIANS_PER_LOD_DEGREE));
}

export function createSharedPolygonLodIndex(features, { precision = 7 } = {}) {
  if (!Array.isArray(features) || !Number.isInteger(precision) || precision < 0 || precision > 9)
    throw new TypeError('Shared polygon LOD requires features and a valid precision.');
  const nodes = new Map(), edges = new Map(), allRings = [], sharedArcs = new Map();
  function requireNode(coordinate) {
    if (!finiteCoordinate(coordinate)) throw new TypeError('Invalid source polygon coordinate.');
    const key = lodNodeKey(coordinate, precision);
    if (!nodes.has(key)) nodes.set(key, { neighbors: new Set(), owners: new Set() });
    return key;
  }
  const byFeature = features.map((feature, featureIndex) => {
    const id = String(feature?.id ?? featureIndex), geometry = feature?.geometry;
    if (geometry && !['Polygon', 'MultiPolygon'].includes(geometry.type))
      throw new TypeError('Country LOD accepts only polygon geometry.');
    const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map((polygon, polygonIndex) => polygon.map((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4 || !finiteCoordinate(ring[0])
        || !finiteCoordinate(ring[ring.length - 1])
        || lodNodeKey(ring[0], precision) !== lodNodeKey(ring.at(-1), precision))
        throw new TypeError('Country polygon LOD requires closed rings.');
      const points = ring.slice(0, -1), keys = points.map(requireNode);
      if (new Set(keys).size < 3) throw new TypeError('Invalid polygon ring.');
      const edgeKeys = keys.map((key, index) => {
        const next = keys[(index + 1) % keys.length];
        if (key === next) throw new TypeError('Duplicated polygon edge.');
        nodes.get(key).owners.add(id);
        nodes.get(key).neighbors.add(next); nodes.get(next).neighbors.add(key);
        const edgeKey = key < next ? `${key}|${next}` : `${next}|${key}`;
        if (!edges.has(edgeKey)) edges.set(edgeKey, { owners: new Set() });
        edges.get(edgeKey).owners.add(id);
        return edgeKey;
      });
      const info = { id, polygonIndex, ringIndex, points, keys, edgeKeys,
        originalArea: lodSignedArea(points), importance: new Float64Array(points.length),
        protected: polygon.length > 1 || ringIndex > 0 || hasDatelineJump(ring)
          || points.some(point => Math.abs(point[1]) >= 85) };
      allRings.push(info);
      return info;
    }));
  });
  for (const edge of edges.values()) edge.signature = [...edge.owners].sort().join('|');
  for (const info of allRings) {
    const { points, keys, edgeKeys, importance } = info;
    if (info.protected) { importance.fill(Infinity); continue; }
    const anchors = new Set();
    for (let index = 0; index < keys.length; index += 1) {
      const node = nodes.get(keys[index]);
      const before = edges.get(edgeKeys[(index + keys.length - 1) % keys.length]);
      const after = edges.get(edgeKeys[index]);
      if (node.neighbors.size !== 2 || node.owners.size >= 3 || before.signature !== after.signature)
        anchors.add(index);
    }
    if (anchors.size < 3) {
      // Add anchors on private coastlines first; never split a shared arc on
      // just one side merely to meet the three-vertex ring minimum.
      const candidates = keys.map((key, index) => ({ key, index }))
        .filter(({ index }) => edges.get(edgeKeys[index]).owners.size === 1
          && edges.get(edgeKeys[(index + keys.length - 1) % keys.length]).owners.size === 1)
        .sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index);
      for (const { index } of candidates) {
        anchors.add(index);
        if (anchors.size >= 3) break;
      }
    }
    const ordered = [...anchors].sort((a, b) => a - b);
    if (!ordered.length) { importance.fill(Infinity); continue; }
    for (const index of ordered) importance[index] = Infinity;
    for (let anchor = 0; anchor < ordered.length; anchor += 1) {
      const start = ordered[anchor], end = ordered[(anchor + 1) % ordered.length];
      const path = [start];
      for (let pos = (start + 1) % keys.length; pos !== end; pos = (pos + 1) % keys.length)
        path.push(pos);
      path.push(end);
      if (path.length <= 2) continue;
      const forward = keys[start] < keys[end];
      const canonical = forward ? path : [...path].reverse();
      const arcKey = canonical.map(index => keys[index]).join(';');
      let ranked = sharedArcs.get(arcKey);
      if (!ranked) {
        ranked = lodVertexImportance(canonical.map(index => points[index]));
        sharedArcs.set(arcKey, ranked);
      }
      for (let offset = 1; offset < path.length - 1; offset++) {
        const rank = forward ? offset : path.length - 1 - offset;
        importance[path[offset]] = ranked[rank];
      }
    }
  }
  function derive({ cssScale, errorPx = MAX_MAP_GEOMETRY_ERROR_PX,
    protectedIds = [], visibleIds = null } = {}) {
    if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(errorPx) || errorPx <= 0)
      throw new TypeError('Invalid LOD screen scale or pixel error.');
    const tolerance = errorPx / cssScale;
    const protectedSet = new Set([...protectedIds].map(String));
    const visibleSet = visibleIds === null ? null : new Set([...visibleIds].map(String));
    const protectedNodes = new Set();
    if (protectedSet.size) for (const [key, node] of nodes)
      if ([...node.owners].some(owner => protectedSet.has(owner))) protectedNodes.add(key);
    let invalid = false, originalVertices = 0, keptVertices = 0;
    const sharedSegments = new Map();
    const output = features.map((feature, index) => {
      const featureId = String(feature?.id ?? index);
      if (visibleSet && !visibleSet.has(featureId)) {
        originalVertices += byFeature[index].reduce((count, polygon) =>
          count + polygon.reduce((sum, ring) => sum + ring.points.length, 0), 0);
        return { ...feature, geometry: null };
      }
      const polygons = byFeature[index].map(polygon => polygon.map(info => {
        originalVertices += info.points.length;
        const indices = [];
        // A feature smaller than the allowed pixel deviation is still a
        // real island: preserve its complete ring instead of erasing detail.
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        for (const point of info.points) {
          west = Math.min(west, point[0]); east = Math.max(east, point[0]);
          south = Math.min(south, point[1]); north = Math.max(north, point[1]);
        }
        const tinyRing = Math.hypot(east - west, north - south)
          * RADIANS_PER_LOD_DEGREE <= tolerance;
        for (let i = 0; i < info.points.length; i++)
          if (tinyRing || protectedSet.has(info.id) || info.importance[i] >= tolerance
            || protectedNodes.has(info.keys[i])) indices.push(i);
        // Preserve small islands and narrow rings in place instead of
        // invalidating an otherwise useful whole-world derivative. Shared
        // borders still undergo the complete cross-owner seam check below.
        const initial = indices.map(i => info.points[i]);
        if (initial.length < 3
          || Math.sign(lodSignedArea(initial)) !== Math.sign(info.originalArea)) {
          indices.length = 0;
          for (let i = 0; i < info.points.length; i++) indices.push(i);
        }
        const selected = indices.map(i => info.points[i]);
        keptVertices += selected.length;
        // A shared source chain must be represented by the same new segment
        // in every country that owns it. Abort the complete derivative if a
        // different ring cut or a protected neighbor causes a seam mismatch.
        for (let j = 0; j < indices.length; j++) {
          const from = indices[j], to = indices[(j + 1) % indices.length];
          const edge = edges.get(info.edgeKeys[from]);
          const owners = [...edge.owners].filter(id => !visibleSet || visibleSet.has(id));
          if (owners.length < 2) continue;
          let current = from, consistent = true;
          do {
            if (edges.get(info.edgeKeys[current]).signature !== edge.signature) {
              consistent = false; break;
            }
            current = (current + 1) % info.points.length;
          } while (current !== to);
          if (!consistent) { invalid = true; continue; }
          const firstKey = info.keys[from], secondKey = info.keys[to];
          const segmentKey = firstKey < secondKey
            ? `${firstKey};${secondKey}` : `${secondKey};${firstKey}`;
          const key = `${edge.signature}:${segmentKey}`;
          if (!sharedSegments.has(key)) sharedSegments.set(key, {
            expected: new Set(owners), actual: new Set(),
          });
          sharedSegments.get(key).actual.add(info.id);
        }
        return [...selected.map(cloneCoordinate), cloneCoordinate(selected[0] || info.points[0])];
      }));
      const type = feature?.geometry?.type;
      return { ...feature, geometry: !type ? null : { type,
        coordinates: type === 'Polygon' ? polygons[0] : polygons } };
    });
    for (const { expected, actual } of sharedSegments.values())
      if (expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
        invalid = true;
        break;
      }
    // Never restore only one country of a shared arc: fail closed as a frame.
    return Object.freeze({ features: invalid ? features : output, fallback: invalid,
      originalVertices, keptVertices: invalid ? originalVertices : keptVertices,
      visibleCountryCount: visibleSet ? output.filter(feature => !!feature.geometry).length : features.length,
      scoped: !!visibleSet });
  }
  return Object.freeze({ derive, stats: () => Object.freeze({
    featureCount: features.length, ringCount: allRings.length,
    vertexCount: allRings.reduce((sum, ring) => sum + ring.points.length, 0),
    sharedEdgeCount: [...edges.values()].filter(edge => edge.owners.size > 1).length,
    arcCount: sharedArcs.size,
  }) });
}
