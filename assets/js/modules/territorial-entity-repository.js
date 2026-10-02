import { normalizeTemporalInterval } from './temporal.js';
import {
  TERRITORIAL_COVERAGE_MODES,
  TERRITORIAL_SCHEMA_VERSION,
  TERRITORIAL_UNIT_TYPES,
} from './territorial-units.js';

const text = value => String(value ?? '').trim();

export function createCountryTerritorialEntity(feature, override = {}) {
  if (!feature?.geometry) return null;
  const properties = feature.properties || {};
  const id = text(feature.id);
  if (!id) return null;
  const interval = normalizeTemporalInterval(properties.validFrom, properties.validTo);
  const color = text(override.color);
  const metadata = {};
  const capital = text(override.capital);
  if (capital) metadata.capital = capital;
  if (Object.hasOwn(override, 'flagDataUrl')) {
    const flagDataUrl = override.flagDataUrl === null ? null : text(override.flagDataUrl);
    if (flagDataUrl === null || flagDataUrl) metadata.flagDataUrl = flagDataUrl;
  }
  return {
    type: 'Feature',
    id,
    properties: {
      schemaVersion: TERRITORIAL_SCHEMA_VERSION,
      unitType: TERRITORIAL_UNIT_TYPES.COUNTRY,
      name: text(override.name || properties.name || id),
      parentId: '',
      sovereignId: id,
      coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT,
      style: color ? { color } : {},
      locked: override.locked === true,
      validFrom: interval.validFrom,
      validTo: interval.validTo,
      notes: text(override.notes),
      metadata,
      sourceFolderId: '',
      sourceLibraryId: '',
      sourceGeometryVersion: '',
    },
    geometry: feature.geometry,
  };
}

export function createTerritorialEntityRepository({
  getCountries,
  getUnits,
  getCountryOverride = () => ({}),
  getRevision = () => null,
}) {
  if (typeof getCountries !== 'function' || typeof getUnits !== 'function') {
    throw new TypeError('영역 엔티티 저장소에는 국가와 하위 영역 공급자가 필요합니다.');
  }

  let cached = null;

  function snapshot() {
    const countryFeatures = getCountries()?.features || [];
    const unitValues = Array.isArray(getUnits()) ? getUnits() : [];
    const revision = getRevision();
    if (revision != null && cached
      && cached.revision === revision
      && cached.countryFeatures === countryFeatures
      && cached.unitValues === unitValues) {
      return cached.state;
    }

    const values = [
      ...countryFeatures
        .map(feature => createCountryTerritorialEntity(feature, getCountryOverride(text(feature?.id))))
        .filter(Boolean),
      ...unitValues,
    ];
    const byId = new Map();
    const childrenByParent = new Map();
    for (const entity of values) {
      const id = text(entity?.id);
      if (!id) throw new Error('영역 엔티티 ID가 비어 있습니다.');
      if (byId.has(id)) throw new Error(`영역 엔티티 ID가 중복되었습니다: ${id}`);
      byId.set(id, entity);
      const parentId = text(entity?.properties?.parentId);
      if (!parentId) continue;
      const children = childrenByParent.get(parentId) || [];
      children.push(entity);
      childrenByParent.set(parentId, children);
    }
    const state = { values, byId, childrenByParent };
    cached = revision == null ? null : {
      revision,
      countryFeatures,
      unitValues,
      state,
    };
    return state;
  }

  const entityFrom = (state, id) => state.byId.get(text(id)) || null;
  const parentFrom = (state, id) => {
    const entity = entityFrom(state, id);
    const parentId = text(entity?.properties?.parentId);
    if (!parentId) return null;
    const parent = entityFrom(state, parentId);
    if (!parent) throw new Error(`${text(entity?.id) || text(id)}의 상위 영역 엔티티 ${parentId}이 존재하지 않습니다.`);
    return parent;
  };

  function get(id) {
    return entityFrom(snapshot(), id);
  }

  function list({ type = '', parentId = null, sovereignId = null } = {}) {
    let values = snapshot().values;
    if (type) values = values.filter(entity => entity.properties?.unitType === type);
    if (parentId !== null) {
      const key = text(parentId);
      values = values.filter(entity => text(entity.properties?.parentId) === key);
    }
    if (sovereignId !== null) {
      const key = text(sovereignId);
      values = values.filter(entity => text(entity.properties?.sovereignId) === key);
    }
    return values;
  }

  function children(id, { type = '' } = {}) {
    const state = snapshot();
    const values = [...(state.childrenByParent.get(text(id)) || [])];
    return type ? values.filter(entity => entity.properties?.unitType === type) : values;
  }

  function parent(id) {
    return parentFrom(snapshot(), id);
  }

  function ancestors(id) {
    const state = snapshot();
    const result = [];
    const seen = new Set([text(id)]);
    let cursor = parentFrom(state, id);
    while (cursor) {
      const key = text(cursor.id);
      if (seen.has(key)) throw new Error(`영역 엔티티 상위 관계가 순환합니다: ${key}`);
      seen.add(key);
      result.push(cursor);
      cursor = parentFrom(state, key);
    }
    return result;
  }

  function descendants(id, { type = '' } = {}) {
    const state = snapshot();
    const result = [];
    const seen = new Set([text(id)]);
    const pending = [...(state.childrenByParent.get(text(id)) || [])];
    while (pending.length) {
      const entity = pending.shift();
      const key = text(entity?.id);
      if (!key) continue;
      if (seen.has(key)) throw new Error(`영역 엔티티 상위 관계가 순환합니다: ${key}`);
      seen.add(key);
      if (!type || entity.properties?.unitType === type) result.push(entity);
      pending.push(...(state.childrenByParent.get(key) || []));
    }
    return result;
  }

  function root(id) {
    const state = snapshot();
    const entity = entityFrom(state, id);
    if (!entity) return null;
    const seen = new Set([text(entity.id)]);
    let cursor = entity;
    while (true) {
      const next = parentFrom(state, cursor.id);
      if (!next) return cursor;
      const key = text(next.id);
      if (seen.has(key)) throw new Error(`영역 엔티티 상위 관계가 순환합니다: ${key}`);
      seen.add(key);
      cursor = next;
    }
  }

  function administrativeCountry(id) {
    const state = snapshot();
    const entity = entityFrom(state, id);
    if (!entity) return null;
    if (entity.properties?.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) return entity;
    const countryId = text(entity.properties?.sovereignId);
    if (!countryId) return null;
    const countryEntity = entityFrom(state, countryId);
    if (!countryEntity) throw new Error(`${text(entity.id)}의 소속 국가 ${countryId}이 존재하지 않습니다.`);
    if (countryEntity.properties?.unitType !== TERRITORIAL_UNIT_TYPES.COUNTRY) {
      throw new Error(`${text(entity.id)}의 sovereignId는 국가를 가리켜야 합니다: ${countryId}`);
    }
    return countryEntity;
  }

  // Compatibility alias for the legacy sovereignId storage field. Political
  // dependency/sovereignty relations belong to TerritorialRelation, not here.
  const sovereign = administrativeCountry;

  return Object.freeze({
    get,
    has: id => !!get(id),
    list,
    children,
    parent,
    ancestors,
    descendants,
    root,
    administrativeRoot: root,
    administrativeCountry,
    sovereign,
  });
}
