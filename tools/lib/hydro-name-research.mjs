const EUROPE_COUNTRIES = new Set([
  '그리스', '네덜란드', '노르웨이', '덴마크', '독일', '라트비아', '루마니아', '룩셈부르크',
  '리투아니아', '리히텐슈타인', '맨섬', '모나코', '몬테네그로', '몰도바', '몰타',
  '바티칸 시국', '벨기에', '벨라루스', '보스니아 헤르체고비나', '북마케도니아', '불가리아',
  '산마리노', '세르비아', '스웨덴', '스위스', '스페인', '슬로바키아', '슬로베니아',
  '아이슬란드', '아일랜드', '안도라', '알바니아', '에스토니아', '영국', '오스트리아',
  '올란드 제도', '우크라이나', '이탈리아', '저지섬', '지브롤터', '체코', '코소보',
  '크로아티아', '페로 제도', '포르투갈', '폴란드', '프랑스', '핀란드', '헝가리',
]);

const EXCLUDED_COUNTRIES = new Set([
  '러시아', '북키프로스', '아르메니아', '아제르바이잔', '조지아', '카자흐스탄', '키프로스', '터키',
]);

export function collectMajorUnnamedEuropeanCandidates(features) {
  const systems = new Map();
  for (const feature of features || []) {
    const systemId = String(feature?.systemId || '');
    if (feature?.category !== 'river'
      || !systemId.startsWith('2')
      || ![0, 1].includes(Number(feature.stage))
      || feature.name !== `미명명 수계 ${systemId}`) continue;
    const current = systems.get(systemId) || {
      systemId,
      stage: Number(feature.stage),
      bounds: [Infinity, Infinity, -Infinity, -Infinity],
      featureIds: [],
    };
    current.stage = Math.min(current.stage, Number(feature.stage));
    current.featureIds.push(Number(feature.fid));
    const bounds = feature.bounds || [];
    current.bounds[0] = Math.min(current.bounds[0], Number(bounds[0]));
    current.bounds[1] = Math.min(current.bounds[1], Number(bounds[1]));
    current.bounds[2] = Math.max(current.bounds[2], Number(bounds[2]));
    current.bounds[3] = Math.max(current.bounds[3], Number(bounds[3]));
    systems.set(systemId, current);
  }
  return [...systems.values()]
    .map(system => ({ ...system, featureIds: system.featureIds.sort((a, b) => a - b) }))
    .sort((left, right) => Number(left.systemId) - Number(right.systemId));
}

export function classifyEuropeanGeometry(geometry, countryFeatures) {
  const points = flattenLineCoordinates(geometry);
  const matchedCountries = [];
  for (const country of countryFeatures || []) {
    if (!points.some(point => pointInGeometry(point, country.geometry))) continue;
    const name = String(country.properties?.name || '');
    if (name && !matchedCountries.includes(name)) matchedCountries.push(name);
  }
  matchedCountries.sort((a, b) => a.localeCompare(b, 'ko'));

  if (matchedCountries.some(name => EUROPE_COUNTRIES.has(name))) {
    return { inScope: true, matchedCountries, reason: 'geographic-europe' };
  }
  if (matchedCountries.includes('러시아')) {
    const russianPoints = points.filter(point => point[0] <= 60);
    if (russianPoints.length) {
      return { inScope: true, matchedCountries, reason: 'european-russia-west-of-60e' };
    }
    return { inScope: false, matchedCountries, reason: 'russia-east-of-60e' };
  }
  if (matchedCountries.some(name => EXCLUDED_COUNTRIES.has(name))) {
    return { inScope: false, matchedCountries, reason: 'excluded-country' };
  }
  return { inScope: false, matchedCountries, reason: 'outside-geographic-europe' };
}

export function scoreGeometryCandidate(hydroGeometry, candidateGeometry, {
  matchDistanceKm = 2,
  sampleCount = 41,
} = {}) {
  const candidateParts = lineParts(candidateGeometry);
  const samples = sampleGeometry(hydroGeometry, sampleCount);
  const distances = samples.map(point => minimumDistanceKm(point, candidateParts));
  const meanDistanceKm = distances.length
    ? distances.reduce((sum, distance) => sum + distance, 0) / distances.length
    : Infinity;
  const sorted = [...distances].sort((a, b) => a - b);
  const coverage = distances.length
    ? distances.filter(distance => distance <= matchDistanceKm).length / distances.length
    : 0;
  const endpoints = samples.length ? [samples[0], samples.at(-1)] : [];
  const endpointMatches = endpoints.filter(point => minimumDistanceKm(point, candidateParts) <= matchDistanceKm).length;
  return {
    coverage: round(coverage, 4),
    meanDistanceKm: round(meanDistanceKm, 3),
    medianDistanceKm: round(median(sorted), 3),
    endpointMatches,
  };
}

export function rankGeometryCandidates(candidates, {
  minimumCoverage = 0.6,
  maximumMedianDistanceKm = 1.5,
  minimumCoverageGap = 0.15,
} = {}) {
  const ranked = [...(candidates || [])]
    .map(candidate => ({
      ...candidate,
      score: round(
        Number(candidate.coverage || 0) * 100
          + Number(candidate.endpointMatches || 0) * 5
          - Number(candidate.medianDistanceKm || 0),
        3,
      ),
    }))
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return { status: 'unresolved', reason: 'no-candidate', candidates: [] };
  const [first, second] = ranked;
  const scoreGap = round(Number(first.coverage || 0) - Number(second?.coverage || 0), 4);
  if (Number(first.coverage || 0) < minimumCoverage
    || Number(first.medianDistanceKm) > maximumMedianDistanceKm) {
    return { status: 'unresolved', reason: 'weak-geometry-match', candidate: first, scoreGap, candidates: ranked };
  }
  if (second && scoreGap < minimumCoverageGap) {
    return { status: 'ambiguous', reason: 'candidate-score-gap', candidate: first, scoreGap, candidates: ranked };
  }
  return { status: 'accepted-candidate', reason: 'clear-geometry-match', candidate: first, scoreGap, candidates: ranked };
}

export function validateReviewEntries(entries, { expectedCount = 33 } = {}) {
  if (!Array.isArray(entries) || entries.length !== expectedCount) {
    throw new Error(`review must contain ${expectedCount} entries`);
  }
  const seen = new Set();
  for (const entry of entries) {
    const systemId = String(entry?.systemId || '');
    if (!systemId) throw new Error('review entry requires systemId');
    if (seen.has(systemId)) throw new Error(`duplicate systemId ${systemId}`);
    seen.add(systemId);
    if (!['accepted-candidate', 'ambiguous', 'unresolved', 'out-of-scope'].includes(entry.status)) {
      throw new Error(`${systemId} has invalid review status`);
    }
    if (entry.status === 'accepted-candidate') {
      if (!entry.localName || !entry.recommendedNameKo) throw new Error(`${systemId} accepted candidate requires names`);
      const hasGeometryEvidence = entry.geometryMatch && Number.isFinite(Number(entry.geometryMatch.coverage));
      const hasOfficialSystemEvidence = entry.officialSystemMatch?.authority
        && entry.officialSystemMatch?.identifier
        && entry.officialSystemMatch?.rationale;
      if (!hasGeometryEvidence && !hasOfficialSystemEvidence) {
        throw new Error(`${systemId} accepted candidate requires geometry or official system evidence`);
      }
      if (!Array.isArray(entry.sources) || entry.sources.length < 2) {
        throw new Error(`${systemId} accepted candidate requires at least two sources`);
      }
    }
    if (entry.hangulize) {
      const evidence = entry.hangulize;
      if (!evidence.language || !evidence.input || !evidence.output || !evidence.url) {
        throw new Error(`${systemId} requires complete Hangulize evidence`);
      }
    }
  }
  return true;
}

export function selectResearchMainstemFeatures(features, systemIds) {
  const allowed = systemIds instanceof Set ? systemIds : new Set(systemIds || []);
  return (features || []).filter(feature => allowed.has(String(feature?.metadata?.systemId))
    && Number(feature?.metadata?.stage) <= 1
    && feature?.metadata?.role === 'mainstem');
}

export function osmXmlToGeometry(xml, { relationId = '', wayIds = [] } = {}) {
  const nodes = new Map();
  for (const match of String(xml).matchAll(/<node\b([^>]*?)\/?\s*>/g)) {
    const attributes = parseXmlAttributes(match[1]);
    if (attributes.id && attributes.lon && attributes.lat) {
      nodes.set(attributes.id, [Number(attributes.lon), Number(attributes.lat)]);
    }
  }
  const ways = new Map();
  for (const match of String(xml).matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attributes = parseXmlAttributes(match[1]);
    const refs = [...match[2].matchAll(/<nd\b([^>]*?)\/?\s*>/g)]
      .map(node => parseXmlAttributes(node[1]).ref)
      .filter(Boolean);
    ways.set(attributes.id, refs);
  }

  let selected = new Set((wayIds || []).map(String));
  if (relationId) {
    const relation = [...String(xml).matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)]
      .find(match => parseXmlAttributes(match[1]).id === String(relationId));
    if (!relation) throw new Error(`OSM relation ${relationId} is missing from XML`);
    selected = new Set([...relation[2].matchAll(/<member\b([^>]*?)\/?\s*>/g)]
      .map(member => parseXmlAttributes(member[1]))
      .filter(member => member.type === 'way')
      .map(member => member.ref));
  }
  const coordinates = [];
  for (const wayId of selected) {
    const line = (ways.get(String(wayId)) || []).map(ref => nodes.get(ref)).filter(Boolean);
    if (line.length >= 2) coordinates.push(line);
  }
  return { type: 'MultiLineString', coordinates };
}

export function flattenLineCoordinates(geometry) {
  return lineParts(geometry).flat();
}

function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Feature') return lineParts(geometry.geometry);
  if (geometry.type === 'LineString') return [geometry.coordinates || []];
  if (geometry.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

function sampleGeometry(geometry, sampleCount) {
  const parts = lineParts(geometry).filter(part => part.length >= 2);
  const segments = [];
  let total = 0;
  for (const part of parts) {
    for (let index = 1; index < part.length; index += 1) {
      const length = haversineKm(part[index - 1], part[index]);
      if (!Number.isFinite(length) || length <= 0) continue;
      segments.push({ start: part[index - 1], end: part[index], length, from: total });
      total += length;
    }
  }
  if (!segments.length || total <= 0) return parts[0]?.slice(0, 1) || [];
  const count = Math.max(2, Number(sampleCount) || 2);
  const result = [];
  let segmentIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const target = total * index / (count - 1);
    while (segmentIndex < segments.length - 1
      && segments[segmentIndex].from + segments[segmentIndex].length < target) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const ratio = Math.max(0, Math.min(1, (target - segment.from) / segment.length));
    result.push([
      segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
      segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
    ]);
  }
  return result;
}

function minimumDistanceKm(point, parts) {
  let minimum = Infinity;
  for (const part of parts) {
    for (let index = 1; index < part.length; index += 1) {
      minimum = Math.min(minimum, pointSegmentDistanceKm(point, part[index - 1], part[index]));
    }
  }
  return minimum;
}

function pointSegmentDistanceKm(point, start, end) {
  const latitude = (Number(point[1]) + Number(start[1]) + Number(end[1])) / 3;
  const longitudeScale = 111.32 * Math.cos(latitude * Math.PI / 180);
  const latitudeScale = 110.574;
  const px = (Number(point[0]) - Number(start[0])) * longitudeScale;
  const py = (Number(point[1]) - Number(start[1])) * latitudeScale;
  const ex = (Number(end[0]) - Number(start[0])) * longitudeScale;
  const ey = (Number(end[1]) - Number(start[1])) * latitudeScale;
  const denominator = ex * ex + ey * ey;
  const ratio = denominator ? Math.max(0, Math.min(1, (px * ex + py * ey) / denominator)) : 0;
  return Math.hypot(px - ex * ratio, py - ey * ratio);
}

function haversineKm(left, right) {
  const toRadians = value => Number(value) * Math.PI / 180;
  const lat1 = toRadians(left[1]);
  const lat2 = toRadians(right[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(right[0]) - toRadians(left[0]);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => pointInPolygon(point, polygon));
  return false;
}

function pointInPolygon(point, rings) {
  if (!rings?.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some(ring => pointInRing(point, ring));
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const crosses = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function median(values) {
  if (!values.length) return Infinity;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseXmlAttributes(source) {
  const attributes = {};
  for (const match of String(source).matchAll(/([:\w-]+)="([^"]*)"/g)) attributes[match[1]] = decodeXml(match[2]);
  return attributes;
}

function decodeXml(value) {
  return String(value)
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
