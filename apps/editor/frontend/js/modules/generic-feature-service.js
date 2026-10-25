import {DEFAULT_GENERIC_FEATURE_COLOR} from "../../../../../shared/frontend/js/modules/color-adapter.js";
import {
  SOURCE_KINDS,
  normalizeSourceProvenance,
} from "../../../../../shared/frontend/js/modules/source-provenance.js";
import { GENERIC_FEATURE_SCHEMA_VERSION } from "../../../../../shared/frontend/js/modules/version-contract.js";

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

export function createGenericFeatureService({ documentModel, commandOwner } = {}) {
  if (typeof documentModel?.list !== 'function') throw new TypeError('The accepted Core document read model is required.');
  if (typeof commandOwner?.executeCommand !== 'function') throw new TypeError('The Core document command owner is required.');
  const genericFeatures = () => documentModel.list('generic');
  const get = id => genericFeatures().find(feature => text(feature.id) === text(id)) || null;
  const ref = id => ({ domain: 'generic', id: String(id ?? '') });
  const failure = result => Object.assign(new Error(result.error.message), result.error);
  async function execute(commandId, targets, payload) {
    const result = await commandOwner.executeCommand({ commandId, targets, payload: structuredClone(payload) });
    if (typeof result?.ok !== 'boolean' || typeof result.changed !== 'boolean'
      || (!result.ok && (typeof result.error?.code !== 'string' || typeof result.error?.message !== 'string'))) {
      throw Object.assign(new Error('A complete Core command acknowledgement is required.'), { code: 'PL-CORE-RESPONSE' });
    }
    return result;
  }
  function accepted(result, side, id) {
    const rows = result[side]?.genericFeatures;
    if (!Array.isArray(rows)) throw Object.assign(new Error('The accepted Core operation projection is required.'), { code: 'PL-CORE-RESPONSE' });
    const feature = rows.find(feature => text(feature.id) === text(id));
    if (!feature) throw Object.assign(new Error(`The accepted generic feature is missing from the read model: ${id}`), { code: 'PL-CORE-RESPONSE' });
    return feature;
  }
  async function add(feature) {
    const target = ref(feature?.id);
    const result = await execute('generic.create', [target], { feature });
    if (!result.ok) throw failure(result);
    return accepted(result, 'after', target.id);
  }
  async function addMany(features) {
    const ids = Array.isArray(features) ? features.map(feature => feature?.id) : [];
    const result = await execute('generic.import', ids.map(ref), { features });
    if (!result.ok) throw failure(result);
    return ids.map(id => accepted(result, 'after', id));
  }
  async function updateMetadata(id, field, value) {
    const current = get(id);
    const target = current?.id ?? text(id);
    const result = await execute('generic.metadata', [ref(target)], { id: target, field, value });
    if (!result.ok) {
      if (result.error.code === 'not-found') return { ok: false, code: 'not-found' };
      if (result.error.code === 'unsupported-field') throw new Error(result.error.message, { cause: failure(result) });
      throw failure(result);
    }
    return { ok: true, changed: result.changed, feature: accepted(result, 'after', target) };
  }
  async function remove(id) {
    const feature = get(id);
    const target = feature?.id ?? text(id);
    const result = await execute('generic.remove', [ref(target)], { id: target });
    if (!result.ok) {
      if (result.error.code === 'not-found') return { ok: false, code: 'not-found' };
      throw failure(result);
    }
    return { ok: true, feature: accepted(result, 'before', target) };
  }

  return Object.freeze({ get, list: () => genericFeatures(), add, addMany, updateMetadata, remove });
}
