const clone = value => value == null ? value : structuredClone(value);

function polygonCoordinates(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function geometryFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  return { type: 'MultiPolygon', coordinates: clone(coordinates) };
}

function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

function pointOnSegment(point, a, b, epsilon = 1e-9) {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > epsilon) return false;
  return point[0] >= Math.min(a[0], b[0]) - epsilon && point[0] <= Math.max(a[0], b[0]) + epsilon
    && point[1] >= Math.min(a[1], b[1]) - epsilon && point[1] <= Math.max(a[1], b[1]) + epsilon;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    j = i;
  }
  return inside;
}

function pointInPolygonSet(point, polygon) {
  if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some(ring => pointInRing(point, ring));
}

function pointInGeometry(point, geometry) {
  return polygonCoordinates(geometry).some(polygon => pointInPolygonSet(point, polygon));
}

function segmentIntersectionParameter(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return [];
  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
  return [Math.max(0, Math.min(1, t))];
}

function boundaryParameters(a, b, geometry) {
  const parameters = [0, 1];
  for (const polygon of polygonCoordinates(geometry)) {
    for (const ring of polygon) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        parameters.push(...segmentIntersectionParameter(a, b, ring[index], ring[index + 1]));
      }
    }
  }
  return [...new Set(parameters.map(value => Number(value.toFixed(12))))].sort((left, right) => left - right);
}

function interpolate(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function sameCoordinate(a, b) {
  return !!a && !!b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function extractLineSections(lineGeometry, containerGeometry) {
  const sections = [];
  for (const line of lineParts(lineGeometry)) {
    let current = [];
    const flush = () => {
      const deduped = current.filter((point, index) => index === 0 || !sameCoordinate(point, current[index - 1]));
      if (deduped.length >= 2) sections.push({ type: 'LineString', coordinates: deduped });
      current = [];
    };
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index];
      const b = line[index + 1];
      const parameters = boundaryParameters(a, b, containerGeometry);
      let segmentAdded = false;
      for (let partIndex = 0; partIndex < parameters.length - 1; partIndex += 1) {
        const start = parameters[partIndex];
        const end = parameters[partIndex + 1];
        if (end - start < 1e-10) continue;
        const midpoint = interpolate(a, b, (start + end) / 2);
        if (!pointInGeometry(midpoint, containerGeometry)) {
          if (segmentAdded) flush();
          segmentAdded = false;
          continue;
        }
        const startPoint = interpolate(a, b, start);
        const endPoint = interpolate(a, b, end);
        if (!current.length) current.push(startPoint);
        else if (!sameCoordinate(current[current.length - 1], startPoint)) current.push(startPoint);
        current.push(endPoint);
        segmentAdded = true;
      }
      if (!segmentAdded && current.length) flush();
    }
    flush();
  }
  return sections;
}

export function planDrawnTerritoryAnnex({ drawnGeometry, donorFeatures = [], targetFeature = null, clipper } = {}) {
  if (!drawnGeometry || !clipper?.intersection || !clipper?.difference || !clipper?.union) return null;
  const donors = donorFeatures.filter(feature => polygonCoordinates(feature?.geometry).length);
  if (!donors.length || !targetFeature?.geometry) return null;
  const donorUnionCoordinates = clipper.union(...donors.map(feature => polygonCoordinates(feature.geometry)));
  let transferCoordinates = clipper.intersection(polygonCoordinates(drawnGeometry), donorUnionCoordinates);
  if (!transferCoordinates?.length) return null;
  transferCoordinates = clipper.difference(transferCoordinates, polygonCoordinates(targetFeature.geometry));
  const transferGeometry = geometryFromCoordinates(transferCoordinates);
  if (!transferGeometry) return null;
  const donorChanges = donors.map(feature => {
    const overlap = clipper.intersection(polygonCoordinates(feature.geometry), transferCoordinates);
    return { countryId: String(feature.properties?.editor_id || feature.id || ''), geometry: geometryFromCoordinates(overlap) };
  }).filter(item => item.geometry);
  return {
    transferGeometry,
    donorChanges,
    targetCountryId: String(targetFeature.properties?.editor_id || targetFeature.id || ''),
  };
}

// River annex candidates are faces made only by the current target/donor
// frontier and canonical river centerlines.  This deliberately does not use a
// river buffer or add any connector segment: an open river cannot create land.
const RIVER_ANNEX_SNAP_TOLERANCE = 1e-6;
const RIVER_ANNEX_MIN_AREA = 1e-10;
const RIVER_ANNEX_MIN_EDGE_LENGTH = 1e-7;

function coordinateDistance(a, b) {
  return Math.hypot(Number(a?.[0]) - Number(b?.[0]), Number(a?.[1]) - Number(b?.[1]));
}

function segmentLength(a, b) {
  return coordinateDistance(a, b);
}

function projectionParameter(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-20) return 0;
  return ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
}

function pointNearSegment(point, a, b, tolerance) {
  const t = projectionParameter(point, a, b);
  if (t < -tolerance || t > 1 + tolerance) return false;
  return coordinateDistance(point, interpolate(a, b, Math.max(0, Math.min(1, t)))) <= tolerance;
}

function appendParameter(parameters, value) {
  if (!Number.isFinite(value) || value < -1e-9 || value > 1 + 1e-9) return;
  parameters.add(Number(Math.max(0, Math.min(1, value)).toFixed(12)));
}

function splitParametersForSegments(a, b, c, d, tolerance) {
  const parameters = new Set([0, 1]);
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) > 1e-12) {
    const qpx = c[0] - a[0];
    const qpy = c[1] - a[1];
    const t = (qpx * sy - qpy * sx) / denominator;
    const u = (qpx * ry - qpy * rx) / denominator;
    if (t >= -tolerance && t <= 1 + tolerance && u >= -tolerance && u <= 1 + tolerance) appendParameter(parameters, t);
    return [...parameters].sort((left, right) => left - right);
  }
  // Coincident or near-coincident borders are split at their real overlap
  // endpoints.  They never form area alone, but a divergence/rejoin around an
  // overlap can still form a valid pocket.
  if (!pointNearSegment(c, a, b, tolerance) && !pointNearSegment(d, a, b, tolerance)) return [...parameters];
  if (pointNearSegment(c, a, b, tolerance)) appendParameter(parameters, projectionParameter(c, a, b));
  if (pointNearSegment(d, a, b, tolerance)) appendParameter(parameters, projectionParameter(d, a, b));
  return [...parameters].sort((left, right) => left - right);
}

function sharedOverlapSegment(a, b, c, d, tolerance = RIVER_ANNEX_SNAP_TOLERANCE) {
  if (segmentLength(a, b) <= tolerance || segmentLength(c, d) <= tolerance) return null;
  if (!pointNearSegment(c, a, b, tolerance) && !pointNearSegment(d, a, b, tolerance)
    && !pointNearSegment(a, c, d, tolerance) && !pointNearSegment(b, c, d, tolerance)) return null;
  const start = Math.max(0, Math.min(projectionParameter(c, a, b), projectionParameter(d, a, b)));
  const end = Math.min(1, Math.max(projectionParameter(c, a, b), projectionParameter(d, a, b)));
  if (end - start <= tolerance) return null;
  const left = interpolate(a, b, start);
  const right = interpolate(a, b, end);
  return segmentLength(left, right) > tolerance ? [left, right] : null;
}

function ringSegments(geometry) {
  const result = [];
  for (const polygon of polygonCoordinates(geometry)) {
    for (const ring of polygon || []) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        if (segmentLength(ring[index], ring[index + 1]) > RIVER_ANNEX_MIN_EDGE_LENGTH) result.push([ring[index], ring[index + 1]]);
      }
    }
  }
  return result;
}

export function sharedFrontierSegments(targetGeometry, donorGeometry, { tolerance = RIVER_ANNEX_SNAP_TOLERANCE } = {}) {
  const result = [];
  const seen = new Set();
  for (const [a, b] of ringSegments(targetGeometry)) {
    for (const [c, d] of ringSegments(donorGeometry)) {
      const overlap = sharedOverlapSegment(a, b, c, d, tolerance);
      if (!overlap) continue;
      const key = undirectedCoordinateKey(overlap[0], overlap[1]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(overlap);
    }
  }
  return result;
}

function boundsForSegments(segments) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const segment of segments || []) for (const point of segment || []) {
    bounds[0] = Math.min(bounds[0], point[0]);
    bounds[1] = Math.min(bounds[1], point[1]);
    bounds[2] = Math.max(bounds[2], point[0]);
    bounds[3] = Math.max(bounds[3], point[1]);
  }
  return bounds.every(Number.isFinite) ? bounds : null;
}

export function riverAnnexDiscoveryBounds(targetGeometry, donorGeometries = [], options = {}) {
  const segments = donorGeometries.flatMap(geometry => sharedFrontierSegments(targetGeometry, geometry, options));
  return boundsForSegments(segments);
}

function coordinateKey(point, precision = 1e-8) {
  return `${Math.round(point[0] / precision)}:${Math.round(point[1] / precision)}`;
}

function undirectedCoordinateKey(a, b) {
  const left = coordinateKey(a);
  const right = coordinateKey(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function ringSignedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  return area / 2;
}

function ringInteriorPoint(ring) {
  const area = ringSignedArea(ring);
  if (Math.abs(area) <= 1e-20) return ring[0]?.slice() || null;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const factor = ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
    x += (ring[index][0] + ring[index + 1][0]) * factor;
    y += (ring[index][1] + ring[index + 1][1]) * factor;
  }
  return [x / (6 * area), y / (6 * area)];
}

function canonicalRingKey(ring) {
  const points = ring.slice(0, -1).map(point => coordinateKey(point));
  if (!points.length) return '';
  const rotations = values => values.map((_, index) => [...values.slice(index), ...values.slice(0, index)].join('|'));
  return [...rotations(points), ...rotations([...points].reverse())].sort()[0];
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeNodeIndex(tolerance) {
  const nodes = [];
  const buckets = new Map();
  const bucketSize = tolerance;
  function bucketFor(point) {
    return [Math.round(point[0] / bucketSize), Math.round(point[1] / bucketSize)];
  }
  function get(point) {
    const [x, y] = bucketFor(point);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const ids = buckets.get(`${x + dx}:${y + dy}`) || [];
      for (const id of ids) if (coordinateDistance(nodes[id].coordinate, point) <= tolerance) return id;
    }
    const id = nodes.length;
    nodes.push({ coordinate: point.slice(), edges: new Set() });
    const key = `${x}:${y}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(id);
    return id;
  }
  return { nodes, get };
}

function splitLinework(rawEdges, tolerance) {
  const parameters = rawEdges.map(() => new Set([0, 1]));
  for (let leftIndex = 0; leftIndex < rawEdges.length; leftIndex += 1) {
    const left = rawEdges[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rawEdges.length; rightIndex += 1) {
      const right = rawEdges[rightIndex];
      const leftParameters = splitParametersForSegments(left.a, left.b, right.a, right.b, tolerance);
      const rightParameters = splitParametersForSegments(right.a, right.b, left.a, left.b, tolerance);
      leftParameters.forEach(value => appendParameter(parameters[leftIndex], value));
      rightParameters.forEach(value => appendParameter(parameters[rightIndex], value));
    }
  }
  const pieces = [];
  rawEdges.forEach((edge, index) => {
    const values = [...parameters[index]].sort((left, right) => left - right);
    for (let part = 0; part < values.length - 1; part += 1) {
      const a = interpolate(edge.a, edge.b, values[part]);
      const b = interpolate(edge.a, edge.b, values[part + 1]);
      if (segmentLength(a, b) > RIVER_ANNEX_MIN_EDGE_LENGTH) pieces.push({ ...edge, a, b });
    }
  });
  return pieces;
}

function buildFaces(rawEdges, tolerance) {
  const nodeIndex = makeNodeIndex(tolerance);
  const edges = [];
  const edgeByNodes = new Map();
  for (const piece of splitLinework(rawEdges, tolerance)) {
    const a = nodeIndex.get(piece.a);
    const b = nodeIndex.get(piece.b);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let edge = edgeByNodes.get(key);
    if (!edge) {
      edge = { id: edges.length, a, b, sources: new Set(), riverIds: new Set() };
      edgeByNodes.set(key, edge);
      edges.push(edge);
      nodeIndex.nodes[a].edges.add(edge.id);
      nodeIndex.nodes[b].edges.add(edge.id);
    }
    edge.sources.add(piece.source);
    for (const riverId of piece.riverIds || []) edge.riverIds.add(riverId);
  }
  const directed = [];
  for (const edge of edges) {
    directed.push({ edge, from: edge.a, to: edge.b });
    directed.push({ edge, from: edge.b, to: edge.a });
  }
  const outgoing = nodeIndex.nodes.map((node, nodeId) => [...node.edges].map(edgeId => {
    const edge = edges[edgeId];
    const to = edge.a === nodeId ? edge.b : edge.a;
    const point = nodeIndex.nodes[to].coordinate;
    return { edge, to, angle: Math.atan2(point[1] - node.coordinate[1], point[0] - node.coordinate[0]) };
  }).sort((left, right) => left.angle - right.angle));
  const directedKey = item => `${item.edge.id}:${item.from}:${item.to}`;
  const nextDirected = item => {
    const rows = outgoing[item.to];
    if (!rows?.length) return null;
    const index = rows.findIndex(row => row.edge.id === item.edge.id && row.to === item.from);
    if (index < 0) return null;
    const next = rows[(index - 1 + rows.length) % rows.length];
    return { edge: next.edge, from: item.to, to: next.to };
  };
  const visited = new Set();
  const faces = [];
  for (const start of directed) {
    const startKey = directedKey(start);
    if (visited.has(startKey)) continue;
    const local = new Map();
    const path = [];
    let current = start;
    while (current && !local.has(directedKey(current)) && path.length <= directed.length + 1) {
      local.set(directedKey(current), path.length);
      path.push(current);
      current = nextDirected(current);
    }
    for (const key of local.keys()) visited.add(key);
    if (!current || directedKey(current) !== startKey || path.length < 3) continue;
    const ring = path.map(item => nodeIndex.nodes[item.from].coordinate.slice());
    ring.push(ring[0].slice());
    if (ringSignedArea(ring) <= RIVER_ANNEX_MIN_AREA) continue;
    faces.push({ ring, edges: path.map(item => item.edge) });
  }
  return faces;
}

function candidateSampleIsInside(ring, donorGeometry, targetGeometry) {
  const samples = [ringInteriorPoint(ring)];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    const length = segmentLength(start, end);
    if (length <= RIVER_ANNEX_MIN_EDGE_LENGTH) continue;
    // Faces are emitted counter-clockwise, so a small left-side nudge from a
    // boundary midpoint is an interior point even when the area centroid of a
    // concave pocket falls outside the ring.
    const epsilon = Math.min(length * 0.2, Math.max(2e-8, RIVER_ANNEX_SNAP_TOLERANCE * 2));
    const midpoint = interpolate(start, end, 0.5);
    samples.push([
      midpoint[0] - (end[1] - start[1]) / length * epsilon,
      midpoint[1] + (end[0] - start[0]) / length * epsilon,
    ]);
  }
  const interior = samples.find(point => point
    && pointInGeometry(point, donorGeometry)
    && !pointInGeometry(point, targetGeometry));
  if (!interior) return false;
  // A face boundary created from donor-contained river segments and the shared
  // frontier should remain in the donor.  Midpoint checks reject numerical
  // loops that escape through an unrelated outer ring without modifying input.
  return ring.slice(0, -1).every((point, index) => {
    const next = ring[index + 1];
    return pointInGeometry(interpolate(point, next, 0.5), donorGeometry);
  });
}

function rawRiverEdgesForDonor(riverFeature, donorFeature) {
  const riverId = String(riverFeature?.properties?.pandolab_id || riverFeature?.id || '');
  if (!riverId || !riverFeature?.geometry) return [];
  const parts = lineParts(riverFeature.geometry).filter(line => (
    Array.isArray(line) && line.length >= 2 && line.every(point => (
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    ))
  ));
  if (!parts.length) throw new Error('유효한 하천 중심선이 없습니다.');
  const geometry = parts.length === 1
    ? { type: 'LineString', coordinates: parts[0] }
    : { type: 'MultiLineString', coordinates: parts };
  return extractLineSections(geometry, donorFeature.geometry).flatMap(section => (
    lineParts(section).flatMap(line => line.slice(0, -1).map((a, index) => ({
      a, b: line[index + 1], source: 'river', riverIds: [riverId],
    })))
  ));
}

function rawFrontierEdges(targetFeature, donorFeature, tolerance) {
  return sharedFrontierSegments(targetFeature.geometry, donorFeature.geometry, { tolerance })
    .map(([a, b]) => ({ a, b, source: 'frontier', riverIds: [] }));
}

export function buildRiverAnnexCandidates({
  targetFeature = null,
  donorFeatures = [],
  riverFeatures = [],
  topologyRevision = '',
  snapTolerance = RIVER_ANNEX_SNAP_TOLERANCE,
} = {}) {
  if (!targetFeature?.geometry || !polygonCoordinates(targetFeature.geometry).length) return { candidates: [], diagnostics: { reason: 'missing-target' } };
  const candidates = [];
  const topologyKey = stableTextHash(String(topologyRevision));
  const diagnostics = { scannedDonors: 0, scannedRivers: 0, skippedRivers: 0, rawFaceCount: 0, rejectedFaceCount: 0 };
  const seen = new Set();
  for (const donorFeature of donorFeatures.filter(feature => polygonCoordinates(feature?.geometry).length)) {
    const donorCountryId = String(donorFeature.properties?.editor_id || donorFeature.id || '');
    if (!donorCountryId) continue;
    const rawEdges = rawFrontierEdges(targetFeature, donorFeature, snapTolerance);
    if (!rawEdges.length) continue;
    diagnostics.scannedDonors += 1;
    for (const river of riverFeatures) {
      let riverEdges;
      try {
        riverEdges = rawRiverEdgesForDonor(river, donorFeature);
      } catch (_) {
        diagnostics.skippedRivers += 1;
        continue;
      }
      if (!riverEdges.length) continue;
      diagnostics.scannedRivers += 1;
      rawEdges.push(...riverEdges);
    }
    const graph = buildFaces(rawEdges, snapTolerance);
    diagnostics.rawFaceCount += graph.length;
    for (const face of graph) {
      const faceNodeKeys = face.ring.slice(0, -1).map(coordinateKey);
      if (new Set(faceNodeKeys).size !== faceNodeKeys.length) {
        diagnostics.rejectedFaceCount += 1;
        continue;
      }
      const sourceKinds = new Set(face.edges.flatMap(edge => [...edge.sources]));
      const frontierCount = face.edges.filter(edge => edge.sources.has('frontier')).length;
      if (!sourceKinds.has('river') || !sourceKinds.has('frontier') || !frontierCount) {
        diagnostics.rejectedFaceCount += 1;
        continue;
      }
      if (!candidateSampleIsInside(face.ring, donorFeature.geometry, targetFeature.geometry)) {
        diagnostics.rejectedFaceCount += 1;
        continue;
      }
      const ringKey = canonicalRingKey(face.ring);
      const riverIds = [...new Set(face.edges.flatMap(edge => [...edge.riverIds]))].sort();
      const key = `${donorCountryId}:${riverIds.join(',')}:${ringKey}:${topologyKey}`;
      if (seen.has(`${donorCountryId}:${ringKey}`)) continue;
      seen.add(`${donorCountryId}:${ringKey}`);
      const riverBoundarySegments = [];
      const sharedBorderSegments = [];
      for (let index = 0; index < face.edges.length; index += 1) {
        const start = face.ring[index].slice();
        const end = face.ring[index + 1].slice();
        if (face.edges[index].sources.has('river')) riverBoundarySegments.push([start, end]);
        if (face.edges[index].sources.has('frontier')) sharedBorderSegments.push([start, end]);
      }
      const riverBoundaryLength = riverBoundarySegments.reduce((sum, [a, b]) => sum + segmentLength(a, b), 0);
      const sharedBorderLength = sharedBorderSegments.reduce((sum, [a, b]) => sum + segmentLength(a, b), 0);
      if (riverBoundaryLength <= RIVER_ANNEX_MIN_EDGE_LENGTH || sharedBorderLength <= RIVER_ANNEX_MIN_EDGE_LENGTH) {
        diagnostics.rejectedFaceCount += 1;
        continue;
      }
      candidates.push({
        key,
        donorCountryId,
        geometry: { type: 'Polygon', coordinates: [face.ring.map(point => point.slice())] },
        area: Math.abs(ringSignedArea(face.ring)),
        riverBoundarySegments,
        sharedBorderSegments,
        sourceRiverIds: riverIds,
        sourceLogicalRiverIds: riverIds,
        topologyRevision: topologyKey,
      });
    }
  }
  candidates.sort((left, right) => left.key.localeCompare(right.key));
  return { candidates, diagnostics };
}

export { lineParts };
