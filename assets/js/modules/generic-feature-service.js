import {
  SOURCE_KINDS,
  normalizeSourceProvenance,
} from './source-provenance.js';
import { GENERIC_FEATURE_SCHEMA_VERSION } from './version-contract.js';

export { GENERIC_FEATURE_SCHEMA_VERSION };
const LEGACY_GENERIC_FEATURE_SCHEMA_VERSION = 1;

// Deprecated compatibility metadata. Generic Feature v2 has no territorial role semantics;
// these values only expose preserved v1 data to legacy callers until their UI paths are removed.
export const GENERIC_FEATURE_ROLE_RULES = Object.freeze({
  generic: Object.freeze({ role: 'generic', geometry: 'any', binding: 'none', label: '기타 객체' }),
  territory: Object.freeze({ role: 'territory', geometry: 'polygon', binding: 'none', label: '권역 객체' }),
  administrative: Object.freeze({ role: 'administrative', geometry: 'polygon', binding: 'none', label: '행정구역 객체' }),
});
export const GENERIC_FEATURE_ROLE_LABELS = Object.freeze({ generic: '기타 객체', territory: '권역 객체', administrative: '행정구역 객체' });
export const GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS = Object.freeze([
  'schemaVersion', 'name', 'notes', 'color', 'locked', 'source',
]);

const CANONICAL_PROPERTY_KEYS = new Set(GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS);
const LEGACY_SEMANTIC_KEYS = Object.freeze(['role', 'ownerId', 'parentId', 'landBinding', 'topologyGroup']);
const LEGACY_SEMANTIC_KEY_SET = new Set(LEGACY_SEMANTIC_KEYS);
const text = value => String(value ?? '').trim();
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => value == null ? value : structuredClone(value);

export function genericFeatureGeometryKind(feature) {
  const type = feature?.geometry?.type || '';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  return 'unknown';
}

function legacyDetails(feature) {
  const details = feature?.properties?.source?.details;
  return plainObject(details?.legacyGenericSemantics) ? details.legacyGenericSemantics : {};
}

export function genericFeatureRole(feature) {
  const role = text(legacyDetails(feature).role);
  return GENERIC_FEATURE_ROLE_RULES[role] ? role : 'generic';
}

function legacySemanticsFrom(properties = {}) {
  const output = {};
  for (const key of LEGACY_SEMANTIC_KEYS) {
    if (properties[key] == null || properties[key] === '') continue;
    output[key] = clone(properties[key]);
  }
  return output;
}

function unmappedLegacyProperties(properties = {}) {
  const output = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (CANONICAL_PROPERTY_KEYS.has(key) || LEGACY_SEMANTIC_KEY_SET.has(key) || value === undefined) continue;
    output[key] = clone(value);
  }
  return output;
}

function normalizeGenericSource(properties = {}) {
  const inputVersion = Number(properties.schemaVersion || LEGACY_GENERIC_FEATURE_SCHEMA_VERSION);
  const legacySemantics = legacySemanticsFrom(properties);
  const legacyProperties = unmappedLegacyProperties(properties);
  const hasLegacyPayload = Object.keys(legacySemantics).length > 0 || Object.keys(legacyProperties).length > 0;
  const legacyInput = inputVersion <= LEGACY_GENERIC_FEATURE_SCHEMA_VERSION || hasLegacyPayload;
  const defaultKind = legacyInput ? SOURCE_KINDS.LEGACY : SOURCE_KINDS.UNSUPPORTED;
  const normalized = normalizeSourceProvenance(properties.source, {
    kind: defaultKind,
    sourceFormat: inputVersion <= LEGACY_GENERIC_FEATURE_SCHEMA_VERSION
      ? 'pandolab-generic-v1'
      : hasLegacyPayload ? 'pandolab-generic-compat' : '',
  });
  const details = { ...(normalized.details || {}) };
  if (Object.keys(legacySemantics).length) {
    details.legacyGenericSemantics = {
      ...(plainObject(details.legacyGenericSemantics) ? details.legacyGenericSemantics : {}),
      ...legacySemantics,
    };
  }
  if (Object.keys(legacyProperties).length) {
    details.legacyProperties = {
      ...(plainObject(details.legacyProperties) ? details.legacyProperties : {}),
      ...legacyProperties,
    };
  }
  return normalizeSourceProvenance({ ...normalized, details });
}

function canonicalProperties(properties = {}) {
  return {
    schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION,
    name: text(properties.name),
    notes: text(properties.notes),
    color: text(properties.color) || '#8c68d8',
    locked: properties.locked === true,
    source: normalizeGenericSource(properties),
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
