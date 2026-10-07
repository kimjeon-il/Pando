import { isDeepStrictEqual } from 'node:util';

export const AXES = ['availability', 'rules', 'data', 'state', 'interaction'];
export const STATUSES = ['PASS', 'FAIL', 'KNOWN_DIFFERENCE', 'UNSUPPORTED', 'NOT_RUN', 'ERROR', 'N/A'];
const escapePointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const container = value => value !== null && typeof value === 'object';

/** Complete three-way JSON comparison. Presence is distinct from null/value. */
export function compareObservations(web, app, expected) {
  const differences = [];
  function visit(w, a, e, path, wp = true, ap = true, ep = true) {
    if (wp === ap && ap === ep && isDeepStrictEqual(w, a) && isDeepStrictEqual(a, e)) return;
    if (wp && ap && ep && container(w) && container(a) && container(e)
        && Array.isArray(w) === Array.isArray(a) && Array.isArray(a) === Array.isArray(e)) {
      const keys = new Set([...Object.keys(w), ...Object.keys(a), ...Object.keys(e)]);
      for (const key of keys) visit(w[key], a[key], e[key], `${path}/${escapePointer(key)}`,
        Object.hasOwn(w, key), Object.hasOwn(a, key), Object.hasOwn(e, key));
      return;
    }
    differences.push({ path: path || '/', webPresent: wp, appPresent: ap, expectedPresent: ep,
      ...(wp ? { web: w } : {}), ...(ap ? { app: a } : {}), ...(ep ? { expected: e } : {}) });
  }
  visit(web, app, expected, '');
  return differences;
}

const ordered = (left, right) => {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const result = ordered(left[i], right[i]); if (result) return result;
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Test-only representation equivalence; no projection, repair or precision loss. */
export function normalizeGeometry(geometry, policy = {}) {
  for (const [key, value] of Object.entries(policy)) {
    if (!['ringStart', 'ringDirection', 'holeOrder', 'polygonOrder'].includes(key) || typeof value !== 'boolean') {
      throw new Error(`Unknown geometry policy: ${key}`);
    }
  }
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('Expected Polygon/MultiPolygon');
  function ring(input) {
    if (!Array.isArray(input) || input.length < 4 || !isDeepStrictEqual(input[0], input.at(-1))) {
      throw new Error('Geometry ring must be closed with at least four positions');
    }
    for (const position of input) {
      if (!Array.isArray(position) || position.length < 2 || !position.every(Number.isFinite)) throw new Error('Invalid coordinate');
    }
    const vertices = input.slice(0, -1).map(position => [...position]);
    const candidates = [vertices];
    if (policy.ringDirection) candidates.push([vertices[0], ...vertices.slice(1).reverse()]);
    const rotate = rows => {
      if (!policy.ringStart) return rows;
      let best = rows;
      for (let i = 1; i < rows.length; i++) {
        const candidate = [...rows.slice(i), ...rows.slice(0, i)];
        if (ordered(candidate, best) < 0) best = candidate;
      }
      return best;
    };
    const result = candidates.map(rotate).sort(ordered)[0];
    return [...result, [...result[0]]];
  }
  function polygon(input) {
    if (!Array.isArray(input) || !input.length) throw new Error('Polygon requires an exterior');
    const [exterior, ...holes] = input.map(ring);
    return [exterior, ...(policy.holeOrder ? holes.sort(ordered) : holes)];
  }
  let coordinates;
  if (geometry.type === 'Polygon') coordinates = polygon(geometry.coordinates);
  else {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new Error('Empty MultiPolygon');
    coordinates = geometry.coordinates.map(polygon);
    if (policy.polygonOrder) coordinates.sort(ordered);
  }
  return { ...structuredClone(geometry), coordinates };
}

export function classifyResult(caseId, differences, known = null) {
  if (known) return known.caseId === caseId && known.reason && differences.length
    && isDeepStrictEqual(known.differences, differences) ? 'KNOWN_DIFFERENCE' : 'FAIL';
  return differences.length ? 'FAIL' : 'PASS';
}

export function evaluateGates(rows, { complete, provenanceVerified, unclassifiedPaths = [] }) {
  const valid = rows.length > 0 && rows.every(row => STATUSES.includes(row.status))
    && provenanceVerified && unclassifiedPaths.length === 0;
  const regression = valid && rows.every(row => ['PASS', 'KNOWN_DIFFERENCE', 'N/A'].includes(row.status))
    && rows.some(row => row.status !== 'N/A');
  return { regression: regression ? 'PASS' : 'BLOCKED',
    behavioral: regression && complete && rows.every(row => ['PASS', 'N/A'].includes(row.status)) ? 'PASS' : 'BLOCKED' };
}
