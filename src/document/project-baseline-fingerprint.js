// Pure deterministic project source fingerprint, shared by GIS data and Core fixtures.
import {normalizeTerritorialEntities} from "./territorial-units.js";

/** Hash the canonical baseline, including every omitted identity and exact shape. */
export async function fingerprintProjectBaseline(features) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  };
  const baseline = normalizeTerritorialEntities(features, { cloneGeometry: geometry => geometry })
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bytes = new TextEncoder().encode(JSON.stringify(stable(baseline)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

// Exact per-geometry identity retained by the current world classification manifest.
export function geometryFingerprint(geometry) {
  const source = JSON.stringify(geometry ?? null);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}
