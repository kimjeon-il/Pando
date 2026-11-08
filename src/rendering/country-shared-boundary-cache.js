// A display-cache fingerprint. Two independent 32-bit accumulators make stale
// derived borders extremely unlikely without serializing whole geometries.
export function countryGeometrySignature(feature) {
  let first = 2166136261;
  let second = 0x9e3779b9;
  const bytes = new DataView(new ArrayBuffer(8));
  const mix = value => {
    first = Math.imul(first ^ value, 16777619) >>> 0;
    second = (Math.imul(second ^ value, 2246822519) + 3266489917) >>> 0;
  };
  const visit = value => {
    if (!Array.isArray(value)) return;
    mix(value.length);
    if (typeof value[0] === 'number') {
      for (const coordinate of value) {
        bytes.setFloat64(0, Number(coordinate), true);
        mix(bytes.getUint32(0, true));
        mix(bytes.getUint32(4, true));
      }
      return;
    }
    for (const item of value) visit(item);
  };
  mix(feature?.geometry?.type === 'MultiPolygon' ? 2 : 1);
  visit(feature?.geometry?.coordinates);
  return `${first.toString(16)}:${second.toString(16)}`;
}

export function changedCountryGeometryIds(features, signatures = {}) {
  const current = new Map((features || []).map(feature => [String(feature.id), feature]));
  const changed = new Set(Object.keys(signatures).filter(id => !current.has(id)));
  for (const [id, feature] of current) {
    if (countryGeometrySignature(feature) !== signatures[id]) changed.add(id);
  }
  return changed;
}
