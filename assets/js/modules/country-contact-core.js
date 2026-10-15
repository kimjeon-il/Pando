import { sharedCalculationCore } from './temporal.js';

// The Worker retains live feature, ring and cache identity. Shared C++ owns
// geographic edge candidate discovery, split topology and display seam pieces.
if (typeof sharedCalculationCore?.countryContactPairsBatch !== 'function') {
  throw Object.assign(new Error('Compiled country contact calculation is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}
const invalid = detail => {
  throw Object.assign(new Error('Invalid compiled country contact result: ' + detail),
    { code: 'PL-COUNTRY-CONTACT' });
};

/** Exactly one WASM crossing for all touched pairs, without source ring rescans. */
export function computeCountrySharedContacts(pairs = []) {
  if (!pairs.length) return [];
  const features = [], identities = new Map();
  const indexOf = prepared => {
    if (!prepared || !Array.isArray(prepared.segments)) invalid('missing prepared feature');
    if (!identities.has(prepared)) {
      identities.set(prepared, features.length);
      features.push(prepared);
    }
    return identities.get(prepared);
  };
  const indices = pairs.map(pair => {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1])
      invalid('invalid feature pair');
    return [indexOf(pair[0]), indexOf(pair[1])];
  });
  const source = features.map(prepared => prepared.segments.map(row =>
    [row.a, row.b, row.polygonIndex, row.ringIndex, row.segmentIndex]));
  const compiled = sharedCalculationCore.countryContactPairsBatch(source, indices);
  if (!Array.isArray(compiled) || compiled.length !== pairs.length) invalid('missing pair outputs');
  return compiled.map((pairResult, index) => {
    if (!Array.isArray(pairResult) || pairResult.length !== 2 || !Array.isArray(pairResult[1]))
      invalid('malformed pair output');
    const [left, right] = pairs[index];
    const ownerIds = [String(left.id), String(right.id)].sort();
    return pairResult[1].map(row => {
      if (!Array.isArray(row) || row.length !== 3 || !Array.isArray(row[2]))
        invalid('malformed shared segment');
      const [start, end, rawReferences] = row;
      const refs = rawReferences.map(ref => {
        if (!Array.isArray(ref) || ref.length !== 4)
          invalid('malformed source reference');
        const [owner, sourceIndex, startT, endT] = ref;
        const original = owner === 0 ? left : owner === 1 ? right : null;
        const sourceRow = original?.segments[sourceIndex];
        if (!sourceRow || String(sourceRow.featureId) !== String(original.id)
          || !Number.isFinite(startT) || !Number.isFinite(endT))
          invalid('missing source segment');
        return { ...sourceRow, startT, endT };
      });
      return { start, end, ownerIds: [...ownerIds], refs };
    });
  });
}
