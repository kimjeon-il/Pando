/** Canonical Generic Feature v2 schema/normalization only.
 * No app editor state, document mutation commands, native IPC or storage owner.
 */
import {DEFAULT_GENERIC_FEATURE_COLOR} from "../ui/color-adapter.js";
import {
  SOURCE_KINDS,
  normalizeSourceProvenance,
} from "./source-provenance.js";
import { GENERIC_FEATURE_SCHEMA_VERSION } from "../runtime/version-contract.js";

export { GENERIC_FEATURE_SCHEMA_VERSION };
export const GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS = Object.freeze([
  'schemaVersion', 'name', 'notes', 'color', 'locked', 'source',
]);

const CANONICAL_PROPERTY_KEYS = new Set(GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS);
const text = value => String(value ?? '').trim();
const clone = value => value == null ? value : structuredClone(value);

export function genericFeatureGeometryKind(feature) {
  const type = feature?.geometry?.type || '';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  return 'unknown';
}

function canonicalProperties(properties = {}) {
  if (properties.schemaVersion !== GENERIC_FEATURE_SCHEMA_VERSION
    || Object.keys(properties).some(key => !CANONICAL_PROPERTY_KEYS.has(key))) {
    throw Object.assign(new Error('기타 객체는 현재 v2 필드만 지원합니다.'), { code: 'PL-GENERIC-SCHEMA' });
  }
  return {
    schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION,
    name: text(properties.name),
    notes: text(properties.notes),
    color: text(properties.color) || DEFAULT_GENERIC_FEATURE_COLOR,
    locked: properties.locked === true,
    source: normalizeSourceProvenance(properties.source, { kind: SOURCE_KINDS.UNSUPPORTED }),
  };
}

export function normalizeGenericFeatureSemantics(feature) {
  if (!feature) return feature;
  feature.properties = canonicalProperties(feature.properties || {});
  return feature;
}

export function normalizeGenericFeatureCollection(genericFeatures, { cloneFeature = clone } = {}) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(genericFeatures) ? genericFeatures : []) {
    const feature = normalizeGenericFeatureSemantics(cloneFeature(raw));
    const id = text(feature?.id);
    if (!id) throw new Error('기타 객체 ID가 비어 있습니다.');
    if (seen.has(id)) throw new Error(`기타 객체 ID가 중복되었습니다: ${id}`);
    if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
      || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) {
      throw new Error(`${id}의 기타 객체 geometry가 비어 있거나 지원되지 않습니다.`);
    }
    seen.add(id);
    output.push(feature);
  }
  return output;
}

