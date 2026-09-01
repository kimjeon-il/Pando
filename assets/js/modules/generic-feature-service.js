export const GENERIC_FEATURE_SCHEMA_VERSION = 1;
export const GENERIC_FEATURE_ROLE_RULES = Object.freeze({
  generic: Object.freeze({ role: 'generic', geometry: 'any', binding: 'none', label: '일반 객체' }),
  territory: Object.freeze({ role: 'territory', geometry: 'polygon', binding: 'none', label: '권역 객체' }),
  administrative: Object.freeze({ role: 'administrative', geometry: 'polygon', binding: 'none', label: '행정구역 객체' }),
});
export const GENERIC_FEATURE_ROLE_LABELS = Object.freeze({ generic: '일반 객체', territory: '권역 객체', administrative: '행정구역 객체' });

const text = value => String(value ?? '').trim();
const GENERIC_FEATURE_PROPERTY_KEYS = new Set([
  'schemaVersion', 'name', 'notes', 'color', 'role', 'ownerId', 'parentId',
  'landBinding', 'topologyGroup', 'locked', 'source',
]);

export function genericFeatureGeometryKind(feature) {
  const type = feature?.geometry?.type || '';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  return 'unknown';
}

export function genericFeatureRoleRule(role) {
  return GENERIC_FEATURE_ROLE_RULES[role] || GENERIC_FEATURE_ROLE_RULES.generic;
}

export function genericFeatureRoleCompatible(feature, role) {
  const expected = genericFeatureRoleRule(role).geometry;
  return expected === 'any' || expected === genericFeatureGeometryKind(feature);
}

export function genericFeatureRole(feature) {
  return feature?.properties?.role || genericFeatureRoleRule(feature?.properties?.role).role;
}

export function genericFeatureLandBinding(feature) {
  return feature?.properties?.landBinding || genericFeatureRoleRule(feature?.properties?.role).binding;
}

export function normalizeGenericFeatureSemantics(feature) {
  if (!feature) return feature;
  feature.properties ||= {};
  const properties = feature.properties;
  const unsupported = Object.keys(properties).find(key => !GENERIC_FEATURE_PROPERTY_KEYS.has(key));
  if (unsupported) throw new Error(`일반 객체에 지원하지 않는 필드 ${unsupported}가 있습니다.`);
  if (properties.schemaVersion != null && Number(properties.schemaVersion) !== GENERIC_FEATURE_SCHEMA_VERSION) {
    throw new Error(`일반 객체 schemaVersion ${properties.schemaVersion}은 지원하지 않습니다.`);
  }
  let role = properties.role == null || properties.role === '' ? 'generic' : properties.role;
  if (!GENERIC_FEATURE_ROLE_RULES[role]) throw new Error(`일반 객체 역할 ${role}은 지원하지 않습니다.`);
  if (!genericFeatureRoleCompatible(feature, role)) {
    throw new Error(`일반 객체 역할 ${role}은(는) ${genericFeatureGeometryKind(feature)} geometry와 함께 사용할 수 없습니다.`);
  }
  const rule = genericFeatureRoleRule(role);
  properties.schemaVersion = GENERIC_FEATURE_SCHEMA_VERSION;
  properties.role = rule.role;
  const allowedBindings = new Set(['none', 'clip', 'hard']);
  const requestedBinding = String(properties.landBinding || rule.binding);
  properties.landBinding = allowedBindings.has(requestedBinding) ? requestedBinding : rule.binding;
  properties.ownerId = String(properties.ownerId || '');
  properties.parentId = String(properties.parentId || '');
  properties.topologyGroup = properties.topologyGroup || `${rule.role}`;
  properties.color ||= '#8c68d8';
  return feature;
}

export function normalizeGenericFeatureCollection(genericFeatures) {
  const output = [];
  const seen = new Set();
  for (const feature of Array.isArray(genericFeatures) ? genericFeatures : []) {
    const id = text(feature?.id);
    if (!id) throw new Error('일반 객체 ID가 비어 있습니다.');
    if (seen.has(id)) throw new Error(`일반 객체 ID가 중복되었습니다: ${id}`);
    if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
      || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) {
      throw new Error(`${id}의 일반 객체 geometry가 비어 있거나 지원되지 않습니다.`);
    }
    seen.add(id);
    output.push(normalizeGenericFeatureSemantics(feature));
  }
  return output;
}

export function createGenericFeatureService({ documentStore, runDocumentMutation, writeColor }) {
  const genericFeatures = () => documentStore.readFeatures();
  const get = id => genericFeatures().find(feature => text(feature.id) === text(id)) || null;

  function add(feature) {
    const normalized = normalizeGenericFeatureSemantics(feature);
    if (get(normalized.id)) throw new Error(`일반 객체 ID가 중복되었습니다: ${normalized.id}`);
    runDocumentMutation({ type: 'generic-feature-create', affectedIds: [text(normalized.id)] }, () => {
      documentStore.replaceFeatures(normalizeGenericFeatureCollection([...genericFeatures(), normalized]));
    });
    return get(normalized.id);
  }

  function addMany(features) {
    const normalized = normalizeGenericFeatureCollection(features);
    runDocumentMutation({ type: 'generic-feature-import', affectedIds: normalized.map(feature => text(feature.id)) }, () => {
      documentStore.replaceFeatures(normalizeGenericFeatureCollection([...genericFeatures(), ...normalized]));
    });
    return normalized.map(feature => get(feature.id));
  }

  function updateMetadata(id, field, value) {
    const current = get(id);
    if (!current) return { ok: false, code: 'not-found' };
    runDocumentMutation({ type: 'generic-feature-metadata', affectedIds: [text(current.id)] }, () => {
      if (field === 'color') writeColor(current, value);
      else current.properties[field] = value;
      if (['role', 'ownerId', 'parentId', 'landBinding'].includes(field)) {
        normalizeGenericFeatureSemantics(current);
      }
    });
    return { ok: true, feature: current };
  }

  function remove(id, { beforeRemove = () => {} } = {}) {
    const feature = get(id);
    if (!feature) return { ok: false, code: 'not-found' };
    runDocumentMutation({ type: 'generic-feature-delete', affectedIds: [text(feature.id)] }, () => {
      beforeRemove(feature);
      documentStore.replaceFeatures(genericFeatures().filter(candidate => text(candidate.id) !== text(feature.id)));
    });
    return { ok: true, feature };
  }

  return Object.freeze({ get, list: () => genericFeatures(), add, addMany, updateMetadata, remove });
}
