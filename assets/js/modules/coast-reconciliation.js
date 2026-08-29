const EARTH_RADIUS_METERS = 6371008.8;

export const COAST_RECONCILIATION_DEFAULTS = Object.freeze({
  searchDistanceMeters: 2500,
  alignedToleranceMeters: 250,
  minMatchLengthMeters: 500,
  sampleCount: 5,
});

const clone = value => structuredClone(value);
const text = value => String(value ?? '').trim();

function polygonsFor(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function openRing(ring) {
  if (!Array.isArray(ring)) return [];
  const points = ring
    .filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
    .map(point => [Number(point[0]), Number(point[1])]);
  if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
  return points;
}

function longitudeDelta(a, b) {
  let delta = Number(a) - Number(b);
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function localMetricDistance(a, b, referenceLatitude = ((Number(a?.[1]) || 0) + (Number(b?.[1]) || 0)) / 2) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Number.POSITIVE_INFINITY;
  const latitude = Number(referenceLatitude) * Math.PI / 180;
  const dx = longitudeDelta(a[0], b[0]) * Math.PI / 180 * Math.cos(latitude) * EARTH_RADIUS_METERS;
  const dy = (Number(a[1]) - Number(b[1])) * Math.PI / 180 * EARTH_RADIUS_METERS;
  return Math.hypot(dx, dy);
}

function segmentLength(segment) {
  return localMetricDistance(segment.a, segment.b);
}

function midpoint(a, b) {
  const delta = longitudeDelta(b[0], a[0]);
  return [Number(a[0]) + delta / 2, (Number(a[1]) + Number(b[1])) / 2];
}

function segmentDistance(segment, point) {
  const steps = 8;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const coordinate = [Number(segment.a[0]) + longitudeDelta(segment.b[0], segment.a[0]) * t, Number(segment.a[1]) + (Number(segment.b[1]) - Number(segment.a[1])) * t];
    nearest = Math.min(nearest, localMetricDistance(coordinate, point));
  }
  return nearest;
}

export function extractExteriorSegments(feature) {
  const output = [];
  for (let polygonIndex = 0; polygonIndex < polygonsFor(feature?.geometry).length; polygonIndex += 1) {
    const polygon = polygonsFor(feature.geometry)[polygonIndex];
    const ring = openRing(polygon?.[0]);
    for (let index = 0; index < ring.length; index += 1) {
      const nextIndex = (index + 1) % ring.length;
      if (ring.length < 3 || !ring[nextIndex]) continue;
      output.push({
        id: `${text(feature?.id || feature?.properties?.editor_id)}:${polygonIndex}:0:${index}`,
        featureId: text(feature?.id || feature?.properties?.editor_id),
        polygonIndex,
        ringIndex: 0,
        index,
        a: ring[index],
        b: ring[nextIndex],
        lengthMeters: localMetricDistance(ring[index], ring[nextIndex]),
      });
    }
  }
  return output;
}

function countryCoastSegments(countryFeature, topology) {
  const countryId = text(countryFeature?.properties?.editor_id || countryFeature?.id);
  const segments = [...(topology?.segments?.values?.() || [])]
    .filter(segment => segment.kind === 'coast'
      && segment.ownerIds?.size === 1
      && [...segment.ownerIds][0] === countryId
      && (segment.refs || []).some(ref => Number(ref.ringIndex) === 0))
    .map((segment, index) => ({
      id: segment.key || `${countryId}:coast:${index}`,
      featureId: countryId,
      polygonIndex: segment.refs?.[0]?.polygonIndex ?? 0,
      ringIndex: segment.refs?.[0]?.ringIndex ?? 0,
      index: segment.refs?.[0]?.segmentIndex ?? index,
      a: [...segment.a],
      b: [...segment.b],
      lengthMeters: localMetricDistance(segment.a, segment.b),
    }));
  return segments.length ? segments : extractExteriorSegments(countryFeature);
}

function orientationScore(admin, country) {
  const adminDx = longitudeDelta(admin.b[0], admin.a[0]);
  const adminDy = Number(admin.b[1]) - Number(admin.a[1]);
  const countryDx = longitudeDelta(country.b[0], country.a[0]);
  const countryDy = Number(country.b[1]) - Number(country.a[1]);
  const left = Math.hypot(adminDx, adminDy) || 1;
  const right = Math.hypot(countryDx, countryDy) || 1;
  return (adminDx * countryDx + adminDy * countryDy) / left / right;
}

function chainLength(chain) {
  return (chain || []).reduce((sum, segment) => sum + segmentLength(segment), 0);
}

function chainCoordinates(chain) {
  if (!chain?.length) return [];
  const coordinates = [chain[0].a];
  for (const segment of chain) coordinates.push(segment.b);
  return coordinates.map(point => [...point]);
}

function chooseCountrySegment(adminSegment, candidates, used, searchDistanceMeters) {
  const center = midpoint(adminSegment.a, adminSegment.b);
  let best = null;
  for (const candidate of candidates) {
    if (used.has(candidate.id)) continue;
    const distance = segmentDistance(candidate, center);
    if (distance > Number(searchDistanceMeters)) continue;
    const orientation = orientationScore(adminSegment, candidate);
    if (orientation < 0.25) continue;
    const score = distance - orientation * 100;
    if (!best || score < best.score) best = { candidate, distance, orientation, score };
  }
  return best;
}

function deviationMetrics(adminChain, countryChain) {
  const count = Math.max(adminChain.length, countryChain.length, 1);
  const deviations = [];
  for (let index = 0; index < count; index += 1) {
    const admin = adminChain[Math.min(index, adminChain.length - 1)];
    const country = countryChain[Math.min(index, countryChain.length - 1)];
    deviations.push(localMetricDistance(midpoint(admin.a, admin.b), midpoint(country.a, country.b)));
  }
  const matchedLength = Math.min(chainLength(adminChain), chainLength(countryChain));
  return {
    matchedLength,
    meanDeviation: deviations.reduce((sum, value) => sum + value, 0) / deviations.length,
    maxDeviation: Math.max(...deviations),
  };
}

function chainCanContinue(previous, next) {
  if (previous.adminSegment.polygonIndex !== next.adminSegment.polygonIndex
      || previous.adminSegment.ringIndex !== next.adminSegment.ringIndex
      || next.adminSegment.index !== previous.adminSegment.index + 1) return false;
  if (previous.countrySegment.polygonIndex !== next.countrySegment.polygonIndex
      || previous.countrySegment.ringIndex !== next.countrySegment.ringIndex) return false;
  return Math.abs(next.countrySegment.index - previous.countrySegment.index) === 1;
}

export function analyzeAdminCountryCoast({
  adminFeature,
  countryFeature,
  countryTopology,
  tolerance = {},
} = {}) {
  const options = { ...COAST_RECONCILIATION_DEFAULTS, ...tolerance };
  const adminSegments = extractExteriorSegments(adminFeature);
  const countrySegments = countryCoastSegments(countryFeature, countryTopology);
  const usedCountry = new Set();
  const matches = [];
  for (const adminSegment of adminSegments) {
    const match = chooseCountrySegment(adminSegment, countrySegments, usedCountry, options.searchDistanceMeters);
    if (!match) continue;
    usedCountry.add(match.candidate.id);
    matches.push({ adminSegment, countrySegment: match.candidate, distance: match.distance, orientation: match.orientation });
  }

  const orderedMatches = matches.sort((left, right) => left.adminSegment.polygonIndex - right.adminSegment.polygonIndex
    || left.adminSegment.ringIndex - right.adminSegment.ringIndex
    || left.adminSegment.index - right.adminSegment.index);
  const chains = [];
  for (const match of orderedMatches) {
    const previous = chains.at(-1)?.at(-1);
    if (!previous || !chainCanContinue(previous, match)) chains.push([match]);
    else chains.at(-1).push(match);
  }

  const conflicts = [];
  for (const chain of chains) {
    const adminChain = chain.map(match => match.adminSegment);
    const countryChain = chain.map(match => match.countrySegment);
    const metrics = deviationMetrics(adminChain, countryChain);
    if (metrics.matchedLength < Number(options.minMatchLengthMeters)) continue;
    if (metrics.maxDeviation <= Number(options.alignedToleranceMeters)) continue;
    const firstAdmin = adminChain[0];
    const lastAdmin = adminChain.at(-1);
    const firstCountry = countryChain[0];
    const lastCountry = countryChain.at(-1);
    const points = [...adminChain, ...countryChain].flatMap(segment => [segment.a, segment.b]);
    conflicts.push({
      id: `${text(adminFeature?.id)}:${firstAdmin.polygonIndex}:${firstAdmin.index}`,
      adminChain,
      countryChain,
      adminRingRef: { polygonIndex: firstAdmin.polygonIndex, ringIndex: firstAdmin.ringIndex, startIndex: firstAdmin.index, endIndex: lastAdmin.index },
      countryRingRef: { polygonIndex: firstCountry.polygonIndex, ringIndex: firstCountry.ringIndex, startIndex: Math.min(firstCountry.index, lastCountry.index), endIndex: Math.max(firstCountry.index, lastCountry.index) },
      countryGeometry: clone(countryFeature.geometry),
      adminGeometry: clone(adminFeature.geometry),
      startAnchor: [...firstAdmin.a],
      endAnchor: [...lastAdmin.b],
      bounds: [
        Math.min(...points.map(point => point[0])),
        Math.min(...points.map(point => point[1])),
        Math.max(...points.map(point => point[0])),
        Math.max(...points.map(point => point[1])),
      ],
      ...metrics,
    });
  }
  return { conflicts };
}

function ringWithReplacement(geometry, ref, sourceChain) {
  const polygons = polygonsFor(geometry).map(polygon => polygon.map(ring => ring.map(point => [...point])));
  const ring = polygons[ref.polygonIndex]?.[ref.ringIndex];
  if (!ring || ring.length < 4) throw new Error('해안선 연결에 필요한 ring을 찾을 수 없습니다.');
  const open = openRing(ring);
  const start = Math.max(0, Math.min(open.length - 1, Number(ref.startIndex) || 0));
  const end = Math.max(start, Math.min(open.length - 1, Number(ref.endIndex) || start));
  const replacement = chainCoordinates(sourceChain);
  if (replacement.length < 2) throw new Error('교체할 해안선 구간이 비어 있습니다.');
  const nextOpen = [...open.slice(0, start), ...replacement, ...open.slice(end + 1)];
  nextOpen.push([...nextOpen[0]]);
  polygons[ref.polygonIndex][ref.ringIndex] = nextOpen;
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}

export function planCoastReconciliation({ conflict, direction } = {}) {
  if (!conflict || !['country-to-admin', 'admin-to-country'].includes(direction)) throw new Error('해안선 정합 방향이 올바르지 않습니다.');
  const countryGeometry = direction === 'admin-to-country'
    ? ringWithReplacement(conflict.countryGeometry, conflict.countryRingRef, conflict.adminChain)
    : clone(conflict.countryGeometry);
  const adminGeometry = direction === 'country-to-admin'
    ? ringWithReplacement(conflict.adminGeometry, conflict.adminRingRef, conflict.countryChain)
    : clone(conflict.adminGeometry);
  return {
    countryGeometry,
    adminGeometry,
    affectedBounds: conflict.bounds ? [...conflict.bounds] : null,
    changedCountry: direction === 'admin-to-country',
    changedAdmin: direction === 'country-to-admin',
  };
}

export function validateCoastReplacement(geometry) {
  for (const polygon of polygonsFor(geometry)) {
    for (const ring of polygon) {
      if (openRing(ring).length < 3) return { ok: false, issues: ['ring에 유효한 점이 3개 미만입니다.'] };
      if (ring.length < 4 || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return { ok: false, issues: ['ring이 닫혀 있지 않습니다.'] };
    }
  }
  return { ok: true, issues: [] };
}
