/** Shared topology simplification. Callers supply validation and TopoJSON adapters. */
export function buildTopologyPreview(canonicalFeatures, {
  maxCoordinates,
  normalizeGeometry,
  hasCanonicalWinding,
  topology,
  presimplify,
  quantile,
  topologyFeature,
  validateGeometry,
  inspectCandidate,
  proportions = [0.16, 0.14, 0.12, 0.10, 0.08],
}) {
  function ringArcs(geometry, polygonIndex, ringIndex) {
    return geometry.type === 'Polygon'
      ? geometry.arcs?.[ringIndex]
      : geometry.arcs?.[polygonIndex]?.[ringIndex];
  }

  function arcIndex(reference) {
    return reference < 0 ? ~reference : reference;
  }

  function allArcReferences(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
    return polygons.flatMap(polygon => polygon.flatMap(ring => ring));
  }

  function segmentDistanceSquared(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared ? Math.max(0, Math.min(1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
    const x = start[0] + amount * dx - point[0];
    const y = start[1] + amount * dy - point[1];
    return x * x + y * y;
  }

  function restoreNearIssue(issue, prepared, kept, restorePoint, byId) {
    const locations = issue.points || [issue.point];
    if (!locations.length || locations.some(point => !Array.isArray(point))) {
      throw new Error(`미리보기 형상 문제의 위치가 없습니다: ${issue.reason}`);
    }
    let additions = 0;
    for (const id of issue.ids) {
      const geometry = byId.get(String(id));
      if (!geometry) throw new Error(`미리보기 형상 문제의 국가가 없습니다: ${id}`);
      for (const location of locations) {
        const candidates = [];
        for (const reference of new Set(allArcReferences(geometry).map(arcIndex))) {
          const arc = prepared.arcs[reference];
          const indices = [];
          for (let index = 0; index < arc.length; index += 1) if (kept[reference][index]) indices.push(index);
          for (let index = 1; index < indices.length; index += 1) {
            const start = indices[index - 1];
            const end = indices[index];
            if (end - start <= 1) continue;
            const distance = segmentDistanceSquared(location, arc[start], arc[end]);
            candidates.push({ reference, start, end, distance });
          }
        }
        candidates.sort((left, right) => left.distance - right.distance || left.reference - right.reference || left.start - right.start);
        for (const segment of candidates.slice(0, issue.reason === 'overlap' ? 1 : 3)) {
          const points = [];
          for (let index = segment.start + 1; index < segment.end; index += 1) {
            if (!kept[segment.reference][index]) points.push(index);
          }
          points.sort((left, right) => prepared.arcs[segment.reference][right][2] - prepared.arcs[segment.reference][left][2] || left - right);
          for (const pointIndex of points.slice(0, issue.reason === 'overlap' ? 2 : 4)) {
            restorePoint(segment.reference, pointIndex);
            additions += 1;
          }
        }
      }
    }
    return additions;
  }

  function ringCounts(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map(polygon => polygon.length);
  }

  function createCandidate(prepared, threshold) {
    const kept = prepared.arcs.map(arc => Uint8Array.from(arc, point => point[2] >= threshold ? 1 : 0));
    const candidate = {
      type: 'Topology',
      bbox: prepared.bbox,
      objects: prepared.objects,
      arcs: prepared.arcs.map((arc, index) => arc.filter((_, pointIndex) => kept[index][pointIndex]).map(point => point.slice(0, 2))),
    };
    const restorePoint = (index, pointIndex) => {
      if (kept[index][pointIndex]) return;
      kept[index][pointIndex] = 1;
      candidate.arcs[index] = prepared.arcs[index]
        .filter((_, current) => kept[index][current])
        .map(point => point.slice(0, 2));
    };
    return { candidate, kept, restorePoint };
  }

  function repairCandidate(prepared, threshold, canonicalFeatures) {
    const { candidate, kept, restorePoint } = createCandidate(prepared, threshold);
    const geometries = prepared.objects.countries.geometries;
    const byId = new Map(geometries.map(geometry => [String(geometry.id), geometry]));
    for (let pass = 0; pass < 30; pass += 1) {
      for (let countryIndex = 0; countryIndex < geometries.length; countryIndex += 1) {
        const country = () => topologyFeature(candidate, geometries[countryIndex]);
        const failures = validateGeometry(country());
        const affectedRings = new Set(failures.map(issue => `${issue.polygonIndex ?? 0}:${issue.ringIndex ?? 0}`));
        for (const ringKey of affectedRings) {
          const [polygonIndex, ringIndex] = ringKey.split(':').map(Number);
          const references = ringArcs(geometries[countryIndex], polygonIndex, ringIndex) || [];
          const points = [];
          for (const reference of references) {
            const index = arcIndex(reference);
            prepared.arcs[index].forEach((point, pointIndex) => {
              if (!kept[index][pointIndex]) points.push({ index, pointIndex, weight: point[2] });
            });
          }
          points.sort((left, right) => right.weight - left.weight || left.index - right.index || left.pointIndex - right.pointIndex);
          let cursor = 0;
          let batch = 1;
          while (validateGeometry(country()).some(issue => (issue.polygonIndex ?? 0) === polygonIndex && (issue.ringIndex ?? 0) === ringIndex)) {
            if (cursor >= points.length) throw new Error(`미리보기 고리를 복구할 수 없습니다: ${canonicalFeatures[countryIndex].id}:${ringKey}`);
            for (let added = 0; added < batch && cursor < points.length; added += 1) {
              const point = points[cursor++];
              restorePoint(point.index, point.pointIndex);
            }
            batch = Math.min(batch * 2, 32);
          }
        }
      }
      const strictIssues = inspectCandidate(candidate);
      if (globalThis.process?.env?.PANDOLAB_TOPOLOGY_DEBUG) {
        console.error(`topology repair pass ${pass}: ${strictIssues.length} strict issues ${JSON.stringify(strictIssues.slice(0, 2))}`);
      }
      if (!strictIssues.length) return candidate;
      let additions = 0;
      for (const issue of strictIssues) {
        additions += restoreNearIssue(issue, prepared, kept, restorePoint, byId);
      }
      if (!additions) throw new Error(`미리보기 정밀 형상을 복구할 수 없습니다: ${JSON.stringify(strictIssues.slice(0, 3))}`);
    }
    throw new Error('미리보기 topology 복구가 안정화되지 않았습니다.');
  }

  const original = topology({ countries: { type: 'FeatureCollection', features: canonicalFeatures } });
  const prepared = presimplify(original);
  const sourceCounts = canonicalFeatures.map(featureValue => ringCounts(featureValue.geometry));
  const countCoordinates = value => Array.isArray(value) && typeof value[0] === 'number'
    ? 1
    : Array.isArray(value) ? value.reduce((total, part) => total + countCoordinates(part), 0) : 0;
  let lastFailure = '';
  for (const proportion of proportions) {
    try {
      if (globalThis.process?.env?.PANDOLAB_TOPOLOGY_DEBUG) console.error(`topology quantile ${proportion}`);
      const candidate = repairCandidate(prepared, quantile(prepared, proportion), canonicalFeatures);
      const generated = topologyFeature(candidate, candidate.objects.countries).features;
      const byId = new Map(generated.map(item => [String(item.id), item]));
      if (byId.size !== canonicalFeatures.length) throw new Error('미리보기 국가 ID가 중복되거나 누락됐습니다.');
      const features = canonicalFeatures.map((source, index) => {
        const raw = byId.get(String(source.id));
        if (!raw) throw new Error(`미리보기 국가가 누락됐습니다: ${source.id}`);
        const geometry = normalizeGeometry(raw.geometry);
        if (!geometry) throw new Error(`미리보기 국가 형상이 비었습니다: ${source.id}`);
        const result = { ...source, geometry };
        if (JSON.stringify(ringCounts(geometry)) !== JSON.stringify(sourceCounts[index])) {
          throw new Error(`미리보기 국가의 섬 또는 구멍이 누락됐습니다: ${source.id}`);
        }
        const issues = validateGeometry(result);
        if (issues.length || !hasCanonicalWinding(geometry)) throw new Error(`미리보기 국가 형상이 유효하지 않습니다: ${source.id} ${JSON.stringify(issues[0] || 'winding')}`);
        return result;
      });
      const coordinateCount = countCoordinates(features.map(item => item.geometry.coordinates));
      if (coordinateCount > maxCoordinates) throw new Error(`미리보기 좌표 수가 상한을 초과했습니다: ${coordinateCount}`);
      return { features, coordinateCount, simplificationQuantile: proportion };
    } catch (error) {
      if (error.code === 'PREVIEW_VALIDATOR_UNAVAILABLE') throw error;
      lastFailure = error.message;
      if (globalThis.process?.env?.PANDOLAB_TOPOLOGY_DEBUG) console.error(lastFailure);
    }
  }
  throw new Error(`canonical topology에서 유효한 미리보기를 만들지 못했습니다: ${lastFailure}`);
}


function bounds(geometry) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  const scan = value => {
    if (typeof value?.[0] === 'number') {
      result[0] = Math.min(result[0], value[0]); result[1] = Math.min(result[1], value[1]);
      result[2] = Math.max(result[2], value[0]); result[3] = Math.max(result[3], value[1]);
    } else for (const part of value || []) scan(part);
  };
  scan(geometry.coordinates);
  return result;
}

function area(ring) {
  let total = 0;
  for (let index = 1; index < ring.length; index += 1) {
    total += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  }
  return Math.abs(total) / 2;
}

function components(geometry) {
  return (geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates])
    .map(polygon => ({ polygon, box: bounds({ coordinates: polygon }) }));
}

function boxesOverlap(left, right) {
  return left[0] < right[2] && right[0] < left[2]
    && left[1] < right[3] && right[1] < left[3];
}

function intersectionIssues(features, unitParents, clipper) {
  const rows = features.map(feature => ({ id: String(feature.id), feature,
    components: components(feature.geometry), box: bounds(feature.geometry) }))
    .sort((a, b) => a.box[0] - b.box[0]);
  const isAncestor = (parent, child) => {
    let id = child;
    const seen = new Set();
    while (unitParents.has(id) && !seen.has(id)) {
      seen.add(id); id = unitParents.get(id);
      if (id === parent) return true;
    }
    return false;
  };
  const issues = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      if (right.box[0] > left.box[2]) break;
      if (right.box[1] > left.box[3] || right.box[3] < left.box[1]
        || isAncestor(left.id, right.id) || isAncestor(right.id, left.id)) continue;
      const points = [];
      for (const leftPart of left.components) for (const rightPart of right.components) {
        if (!boxesOverlap(leftPart.box, rightPart.box)) continue;
        const overlap = clipper.intersection([leftPart.polygon], [rightPart.polygon]);
        for (const polygon of overlap || []) {
          const size = area(polygon[0]) - polygon.slice(1).reduce((sum, hole) => sum + area(hole), 0);
          if (size <= 1e-14) continue;
          const ring = polygon[0];
          const stride = Math.max(1, Math.floor(ring.length / 8));
          for (let index = 0; index < ring.length - 1 && points.length < 8; index += stride) points.push(ring[index]);
        }
      }
      if (points.length) issues.push({ ids: [left.id, right.id], points, reason: 'overlap' });
    }
  }
  return issues;
}

function ringRelation(point, ring, tolerance = 1e-12) {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1], b = ring[index];
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) <= tolerance * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
      && point[0] >= Math.min(a[0], b[0]) - tolerance && point[0] <= Math.max(a[0], b[0]) + tolerance
      && point[1] >= Math.min(a[1], b[1]) - tolerance && point[1] <= Math.max(a[1], b[1]) + tolerance) return 0;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}

function geometryRelation(point, parts) {
  for (const { polygon, box } of parts) {
    if (point[0] < box[0] || point[0] > box[2] || point[1] < box[1] || point[1] > box[3]) continue;
    const outer = ringRelation(point, polygon[0]);
    if (outer === 0) return 0;
    if (outer < 0) continue;
    let inHole = false;
    for (const hole of polygon.slice(1)) {
      const relation = ringRelation(point, hole);
      if (relation === 0) return 0;
      if (relation > 0) { inHole = true; break; }
    }
    if (!inHole) return 1;
  }
  return -1;
}

function segments(parts) {
  return parts.flatMap(({ polygon }) => polygon.flatMap(ring => ring.slice(0, -1).map((a, index) => {
    const b = ring[index + 1];
    return { a, b, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  })));
}

function properCrossing(first, second) {
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const a = orient(first.a, first.b, second.a), b = orient(first.a, first.b, second.b);
  const c = orient(second.a, second.b, first.a), d = orient(second.a, second.b, first.b);
  return a * b < -1e-24 && c * d < -1e-24;
}

export function previewContainmentIssue(child, parent) {
  const childParts = components(child), parentParts = components(parent);
  for (const { polygon } of childParts) for (const ring of polygon) for (const point of ring.slice(0, -1)) {
    if (geometryRelation(point, parentParts) < 0) return point;
  }
  const parentEdges = segments(parentParts);
  const parentBox = bounds(parent);
  const span = Math.max(1e-9, parentBox[2] - parentBox[0]);
  const buckets = Array.from({ length: 64 }, () => []);
  const bin = x => Math.max(0, Math.min(63, Math.floor((x - parentBox[0]) / span * 64)));
  for (const edge of parentEdges) for (let index = bin(edge.box[0]); index <= bin(edge.box[2]); index += 1) buckets[index].push(edge);
  for (const edge of segments(childParts)) {
    const checked = new Set();
    for (let index = bin(edge.box[0]); index <= bin(edge.box[2]); index += 1) for (const other of buckets[index]) {
      if (checked.has(other) || !boxesOverlap(edge.box, other.box)) continue;
      checked.add(other);
      if (properCrossing(edge, other)) return edge.a;
    }
  }
  // A parent hole can be wholly covered without crossing its boundary.
  for (const { polygon } of parentParts) for (const hole of polygon.slice(1)) {
    if (geometryRelation(hole[0], childParts) > 0) return hole[0];
  }
  return null;
}

function containmentIssues(features, requiredPairs) {
  const byId = new Map(features.map(feature => [String(feature.id), feature.geometry]));
  const issues = [];
  for (const [id, parentId] of requiredPairs) {
    const child = byId.get(id), parent = byId.get(parentId);
    if (!child || !parent) continue;
    const point = previewContainmentIssue(child, parent);
    if (point) issues.push({ ids: [id, parentId], points: [point], reason: 'containment' });
  }
  return issues;
}

// Ring validity alone does not guarantee valid Polygon/MultiPolygon topology.
// Keep this check shared by the preview Worker and build-time generator.
function boundaryContacts(left, right) {
  if (left.box[0] > right.box[2] || right.box[0] > left.box[2]
    || left.box[1] > right.box[3] || right.box[1] > left.box[3]) return { points: [] };
  const touches = new Map();
  const orient = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const on = (p, edge) => orient(edge.a, edge.b, p) === 0
    && p[0] >= edge.box[0] && p[0] <= edge.box[2] && p[1] >= edge.box[1] && p[1] <= edge.box[3];
  const span = Math.max(1e-9, right.box[2] - right.box[0]);
  const bin = x => Math.max(0, Math.min(63, Math.floor((x - right.box[0]) / span * 64)));
  const buckets = Array.from({ length: 64 }, () => []);
  for (const edge of right.edges) for (let i = bin(edge.box[0]); i <= bin(edge.box[2]); i++) buckets[i].push(edge);
  for (const edge of left.edges) {
    const seen = new Set();
    for (let i = bin(edge.box[0]); i <= bin(edge.box[2]); i++) for (const other of buckets[i]) {
      if (seen.has(other) || edge.box[0] > other.box[2] || other.box[0] > edge.box[2]
        || edge.box[1] > other.box[3] || other.box[1] > edge.box[3]) continue;
      seen.add(other);
      const a = orient(edge.a, edge.b, other.a), b = orient(edge.a, edge.b, other.b);
      const c = orient(other.a, other.b, edge.a), d = orient(other.a, other.b, edge.b);
      if (((a < 0 && b > 0) || (a > 0 && b < 0)) && ((c < 0 && d > 0) || (c > 0 && d < 0))) {
        const t = c / (c - d);
        return { invalid: 'ring-crossing', point: [edge.a[0] + t * (edge.b[0] - edge.a[0]), edge.a[1] + t * (edge.b[1] - edge.a[1])] };
      }
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        const axis = Math.abs(edge.b[0] - edge.a[0]) >= Math.abs(edge.b[1] - edge.a[1]) ? 0 : 1;
        const lo = Math.max(Math.min(edge.a[axis], edge.b[axis]), Math.min(other.a[axis], other.b[axis]));
        const hi = Math.min(Math.max(edge.a[axis], edge.b[axis]), Math.max(other.a[axis], other.b[axis]));
        if (hi > lo) {
          const t = ((lo + hi) / 2 - edge.a[axis]) / (edge.b[axis] - edge.a[axis]);
          return { invalid: 'shared-ring-segment', point: [edge.a[0] + t * (edge.b[0] - edge.a[0]), edge.a[1] + t * (edge.b[1] - edge.a[1])] };
        }
      }
      for (const [point, target] of [[edge.a, other], [edge.b, other], [other.a, edge], [other.b, edge]]) {
        if (on(point, target)) touches.set(JSON.stringify(point), point);
      }
    }
  }
  return { points: [...touches.values()] };
}

function strictFeatureIssue(feature, clipper) {
  const parts = components(feature.geometry).map(part => ({ ...part, rings: part.polygon.map(ring => {
    const prepared = components({ type: 'Polygon', coordinates: [ring] });
    return { ring, box: prepared[0].box, edges: segments(prepared) };
  }) }));
  const issue = (reason, point) => ({ ids: [String(feature.id)], point, reason });
  if (!parts.length) return issue('empty-geometry', null);
  const positiveIntersection = (left, right) => {
    for (const polygon of clipper.intersection([left], [right]) || []) {
      // Intra-feature validity is strict; the inter-feature overlap threshold
      // remains separately fixed at 1e-14 above.
      if (area(polygon[0]) - polygon.slice(1).reduce((sum, hole) => sum + area(hole), 0) > 0) return polygon[0][0];
    }
    return null;
  };
  for (const part of parts) {
    // A bipartite ring/contact graph detects disconnected polygon interiors.
    // Several rings touching at the same single point remain a valid tree.
    const roots = new Map(), links = new Set();
    const root = id => { if (!roots.has(id)) roots.set(id, id); let key = id; while (roots.get(key) !== key) key = roots.get(key); return key; };
    for (let left = 0; left < part.rings.length; left++) for (let right = left + 1; right < part.rings.length; right++) {
      const contacts = boundaryContacts(part.rings[left], part.rings[right]);
      if (contacts.invalid) return issue(contacts.invalid, contacts.point);
      if (left === 0) {
        // Without a boundary contact or crossing, one point determines which
        // side of the shell the entire simple hole occupies. Touching rings
        // also need edge interiors checked at their contact-separated runs.
        const points = contacts.points.length ? part.rings[right].edges.map(edge =>
          [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2]) : [part.rings[right].ring[0]];
        for (const point of points) if (ringRelation(point, part.rings[0].ring, 0) < 0) return issue('hole-outside-shell', point);
      }
      if (left > 0 && boxesOverlap(part.rings[left].box, part.rings[right].box)) {
        const overlap = positiveIntersection([part.rings[left].ring], [part.rings[right].ring]);
        if (overlap) return issue('overlapping-holes', overlap);
      }
      for (const point of contacts.points) for (const index of [left, right]) {
        const contact = 'point:' + JSON.stringify(point), ring = 'ring:' + index, link = ring + '/' + contact;
        if (links.has(link)) continue;
        links.add(link);
        const a = root(ring), b = root(contact);
        if (a === b) return issue('disconnected-interior', point);
        roots.set(a, b);
      }
    }
  }
  const ordered = [...parts].sort((a, b) => a.box[0] - b.box[0]);
  for (let left = 0; left < ordered.length; left++) for (let right = left + 1; right < ordered.length; right++) {
    const a = ordered[left], b = ordered[right];
    if (b.box[0] > a.box[2]) break;
    if (b.box[1] > a.box[3] || b.box[3] < a.box[1]) continue;
    for (const first of a.rings) for (const second of b.rings) {
      const contact = boundaryContacts(first, second);
      if (contact.invalid) return issue(contact.invalid, contact.point);
    }
    if (boxesOverlap(a.box, b.box)) {
      const overlap = positiveIntersection(a.polygon, b.polygon);
      if (overlap) return issue('overlapping-polygon-parts', overlap);
    }
  }
  return null;
}

export function inspectTopologyPreviewFeatures(features, {
  validateGeometry, clipper, unitParents = new Map(), requiredContainment = [],
}) {
  const invalid=features.flatMap(feature=>validateGeometry(feature).map(issue=>({
    ids:[String(feature.id)],point:issue.coordinate||null,reason:issue.kind||'invalid',
  })));
  if (invalid.length) return invalid;
  const topologyInvalid = features.map(feature => strictFeatureIssue(feature, clipper)).filter(Boolean);
  return topologyInvalid.length ? topologyInvalid : [...intersectionIssues(features,unitParents,clipper),
    ...containmentIssues(features,requiredContainment)];
}
