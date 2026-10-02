import {
  normalizeTemporalInterval,
  parseTemporal,
  temporalContains,
  temporalIntervalsOverlap,
} from './temporal.js';

export const TERRITORIAL_SCHEMA_VERSION = 2;

export const TERRITORIAL_UNIT_TYPES = Object.freeze({
  COUNTRY: 'country',
  SUBUNIT: 'subunit',
  REGION: 'region',
});

export const TERRITORIAL_COVERAGE_MODES = Object.freeze({
  PARTITION: 'partition',
  EXPLICIT: 'explicit',
});

const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);
const UNIT_TYPES = new Set(Object.values(TERRITORIAL_UNIT_TYPES));
const text = value => String(value ?? '').trim();
const clone = value => structuredClone(value);

function territorialUnitType(feature) {
  const properties = feature?.properties || {};
  const value = text(properties.unitType).toLowerCase();
  return UNIT_TYPES.has(value) ? value : '';
}

function isTerritorialFeature(feature) {
  return !!territorialUnitType(feature)
    && POLYGON_TYPES.has(feature?.geometry?.type)
    && Array.isArray(feature.geometry.coordinates)
    && feature.geometry.coordinates.length > 0;
}

function normalizedProperties(feature, type) {
  const source = feature?.properties || {};
  if (Number(source.schemaVersion) !== TERRITORIAL_SCHEMA_VERSION) throw new Error('영역 schemaVersion이 현재 형식과 일치하지 않습니다.');
  const parentId = text(source.parentId);
  const sovereignId = text(source.sovereignId);
  const coverageMode = text(source.coverageMode);
  if (![TERRITORIAL_COVERAGE_MODES.EXPLICIT, TERRITORIAL_COVERAGE_MODES.PARTITION].includes(coverageMode)) {
    throw new Error('영역 coverageMode가 올바르지 않습니다.');
  }
  const interval = normalizeTemporalInterval(source.validFrom, source.validTo);
  const sourceStyle = source.style && typeof source.style === 'object' ? source.style : {};
  const color = text(sourceStyle.color);
  const properties = {
    schemaVersion: TERRITORIAL_SCHEMA_VERSION,
    unitType: type,
    name: text(source.name),
    parentId,
    sovereignId,
    coverageMode,
    style: color ? { ...sourceStyle, color } : { ...sourceStyle },
    locked: source.locked === true,
    validFrom: interval.validFrom,
    validTo: interval.validTo,
    notes: text(source.notes),
    metadata: source.metadata && typeof source.metadata === 'object' ? clone(source.metadata) : {},
    sourceFolderId: text(source.sourceFolderId),
    sourceLibraryId: text(source.sourceLibraryId),
    sourceGeometryVersion: text(source.sourceGeometryVersion),
  };
  delete properties.metadata.legacyTerritorialPartition;
  if (!color) delete properties.style.color;
  return properties;
}

function normalizeTerritorialFeature(feature) {
  const type = territorialUnitType(feature);
  if (!type || !isTerritorialFeature(feature)) return null;
  const id = text(feature.id);
  if (!id) throw new Error('영역 ID가 비어 있습니다.');
  return {
    type: 'Feature',
    id,
    properties: normalizedProperties(feature, type),
    geometry: clone(feature.geometry),
  };
}

function parentCreatesCycle(id, parentId, byId) {
  let cursor = text(parentId);
  const seen = new Set([text(id)]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = text(byId.get(cursor)?.properties?.parentId);
  }
  return false;
}

export function normalizeTerritorialUnits(value, {
  countryExists = () => true,
  validatedUnchanged = null,
} = {}) {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const feature = validatedUnchanged?.has(raw) ? raw : normalizeTerritorialFeature(raw);
    if (!feature) throw new Error('영역 형식이 올바르지 않습니다.');
    if (feature.properties.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) throw new Error('국가는 countriesData에 저장해야 합니다.');
    if (seen.has(feature.id)) throw new Error(`영역 ID가 중복되었습니다: ${feature.id}`);
    seen.add(feature.id);
    normalized.push(feature);
  }

  const byId = new Map(normalized.map(feature => [feature.id, feature]));
  const unitExists = id => byId.has(text(id)) || countryExists(text(id));
  for (const feature of normalized) {
    const properties = feature.properties;
    if (properties.unitType === TERRITORIAL_UNIT_TYPES.SUBUNIT) {
      const parent = byId.get(properties.parentId);
      if (!properties.sovereignId || !properties.parentId || (properties.parentId !== properties.sovereignId
        && (parent?.properties?.unitType !== TERRITORIAL_UNIT_TYPES.SUBUNIT || parent.properties.sovereignId !== properties.sovereignId))) {
        throw new Error(feature.id + ': 같은 소속 국가의 상위 단위를 지정해야 합니다.');
      }
    }
    if (properties.sovereignId && !countryExists(properties.sovereignId)) {
      throw new Error(`${feature.id}의 소속 국가 ${properties.sovereignId}이 존재하지 않습니다.`);
    }
    if (properties.parentId && (!unitExists(properties.parentId)
      || properties.parentId === feature.id
      || parentCreatesCycle(feature.id, properties.parentId, byId))) {
      throw new Error(`${feature.id}의 상위 단위 ${properties.parentId}이 존재하지 않거나 순환합니다.`);
    }
  }
  return normalized;
}

export function territorialChildren(units, id) {
  const key = text(id);
  return (units || []).filter(feature => text(feature.properties?.parentId) === key);
}

export function territorialSiblings(units, source) {
  if (!source) return [];
  const properties = source.properties || {};
  return (units || []).filter(candidate => candidate.id !== source.id
    && candidate.properties?.unitType === properties.unitType
    && text(candidate.properties?.parentId) === text(properties.parentId)
    && (properties.unitType !== TERRITORIAL_UNIT_TYPES.SUBUNIT
      || text(candidate.properties?.sovereignId) === text(properties.sovereignId)));
}

export function validateTerritorialRelations(units, {
  countryExists = () => true,
  relations = [],
} = {}) {
  const issues = [];
  const byId = new Map((units || []).map(feature => [text(feature.id), feature]));
  const exists = id => byId.has(text(id)) || countryExists(text(id));
  for (const feature of units || []) {
    const id = text(feature.id);
    const properties = feature.properties || {};
    if (!id) issues.push('영역 ID가 비어 있습니다.');
    if (!POLYGON_TYPES.has(feature.geometry?.type)) issues.push(`${id || '영역'}의 형상이 Polygon이 아닙니다.`);
    if (!UNIT_TYPES.has(properties.unitType)) issues.push(`${id || '영역'}의 유형이 올바르지 않습니다.`);
    if (properties.parentId && !exists(properties.parentId)) issues.push(`${id}의 상위 단위가 존재하지 않습니다.`);
    if (properties.sovereignId && !countryExists(properties.sovereignId)) issues.push(`${id}의 소속 국가가 존재하지 않습니다.`);
    if (properties.parentId === id || parentCreatesCycle(id, properties.parentId, byId)) issues.push(`${id}의 상위 관계가 순환합니다.`);
    try { normalizeTemporalInterval(properties.validFrom, properties.validTo); }
    catch (error) { issues.push(`${id}의 유효기간이 올바르지 않습니다. ${error.message}`); }
  }
  const byRelationUnit = new Map();
  for (const relation of Array.isArray(relations) ? relations : []) {
    const unitId = text(relation?.unitId);
    if (!exists(unitId)) issues.push(`${unitId || '관계'}의 대상 영역이 존재하지 않습니다.`);
    if (relation?.parentId && !exists(relation.parentId)) issues.push(`${unitId}의 기간별 상위 단위가 존재하지 않습니다.`);
    if (relation?.sovereignId && !countryExists(relation.sovereignId)) issues.push(`${unitId}의 기간별 소속 국가가 존재하지 않습니다.`);
    try { normalizeTemporalInterval(relation?.validFrom, relation?.validTo); }
    catch (error) { issues.push(`${unitId}의 기간별 관계가 올바르지 않습니다. ${error.message}`); }
    const list = byRelationUnit.get(unitId) || [];
    list.push(relation);
    byRelationUnit.set(unitId, list);
  }
  for (const [unitId, list] of byRelationUnit) {
    for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
        if (temporalIntervalsOverlap(list[leftIndex], list[rightIndex])) issues.push(`${unitId}의 기간별 관계가 서로 겹칩니다.`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function normalizeTerritorialRelations(value) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    if (Number(raw?.schemaVersion) !== 1) throw new Error('기간별 관계 schemaVersion이 현재 형식과 일치하지 않습니다.');
    const unitId = text(raw?.unitId);
    if (!unitId) throw new Error('기간별 관계의 대상 영역 ID가 비어 있습니다.');
    const id = text(raw.id);
    if (!id) throw new Error('기간별 관계 ID가 비어 있습니다.');
    if (seen.has(id)) throw new Error(`기간별 관계 ID가 중복되었습니다: ${id}`);
    seen.add(id);
    const interval = normalizeTemporalInterval(raw.validFrom, raw.validTo);
    output.push({
      id,
      schemaVersion: 1,
      unitId,
      parentId: text(raw.parentId),
      sovereignId: text(raw.sovereignId),
      validFrom: interval.validFrom,
      validTo: interval.validTo,
    });
  }
  return output;
}

export function resolveTerritorialRelation(unit, relations, referenceDate) {
  if (!unit) return null;
  const date = parseTemporal(referenceDate);
  if (!date) return unit;
  const relation = (relations || []).find(candidate => text(candidate.unitId) === text(unit.id)
    && temporalContains(candidate, date));
  if (!relation) return unit;
  return {
    ...unit,
    properties: {
      ...unit.properties,
      parentId: text(relation.parentId),
      sovereignId: text(relation.sovereignId),
    },
  };
}

export function createTerritorialFeature({
  id,
  unitType,
  name = '',
  geometry,
  parentId = '',
  sovereignId = '',
  coverageMode,
  color = '',
  locked = false,
  validFrom = null,
  validTo = null,
  notes = '',
  metadata = {},
  sourceFolderId = '',
  sourceLibraryId = '',
  sourceGeometryVersion = '',
}) {
  if (unitType === TERRITORIAL_UNIT_TYPES.SUBUNIT) {
    parentId = text(parentId || sovereignId);
    if (!parentId) throw new Error('하위단위의 상위 단위를 지정해야 합니다.');
  }
  const resolvedCoverageMode = coverageMode || (unitType === TERRITORIAL_UNIT_TYPES.REGION
    ? TERRITORIAL_COVERAGE_MODES.EXPLICIT
    : TERRITORIAL_COVERAGE_MODES.PARTITION);
  const feature = normalizeTerritorialFeature({
    type: 'Feature',
    id,
    properties: {
      schemaVersion: TERRITORIAL_SCHEMA_VERSION,
      unitType,
      name,
      parentId,
      sovereignId,
      coverageMode: resolvedCoverageMode,
      style: color ? { color } : {},
      locked,
      validFrom,
      validTo,
      notes,
      metadata,
      sourceFolderId,
      sourceLibraryId,
      sourceGeometryVersion,
    },
    geometry,
  });
  if (!feature) throw new Error('영역 형식이 올바르지 않습니다.');
  return feature;
}

export function createCountryTerritorialEntity(feature, override = {}) {
  if (!feature?.geometry) return null;
  const properties = feature.properties || {};
  const id = text(feature.id);
  if (!id) return null;
  const interval = normalizeTemporalInterval(properties.validFrom, properties.validTo);
  const color = text(override.color);
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
      metadata: {},
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
}) {
  if (typeof getCountries !== 'function' || typeof getUnits !== 'function') {
    throw new TypeError('영역 엔티티 저장소에는 국가와 하위 영역 공급자가 필요합니다.');
  }

  const countries = () => (getCountries()?.features || [])
    .map(feature => createCountryTerritorialEntity(feature, getCountryOverride(text(feature?.id))))
    .filter(Boolean);
  const units = () => Array.isArray(getUnits()) ? getUnits() : [];

  function snapshot() {
    const values = [...countries(), ...units()];
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
    return { values, byId, childrenByParent };
  }

  const entityFrom = (state, id) => state.byId.get(text(id)) || null;
  const parentFrom = (state, id) => {
    const entity = entityFrom(state, id);
    const parentId = text(entity?.properties?.parentId);
    return parentId ? entityFrom(state, parentId) : null;
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
      if (!key || seen.has(key)) continue;
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

  function sovereign(id) {
    const state = snapshot();
    const entity = entityFrom(state, id);
    if (!entity) return null;
    if (entity.properties?.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY) return entity;
    const sovereignId = text(entity.properties?.sovereignId);
    const sovereignEntity = sovereignId ? entityFrom(state, sovereignId) : null;
    return sovereignEntity?.properties?.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY ? sovereignEntity : null;
  }

  return Object.freeze({
    get,
    has: id => !!get(id),
    list,
    children,
    parent,
    ancestors,
    descendants,
    root,
    sovereign,
  });
}

export function changeParent(unit, newParentId) {
  if (!unit) throw new Error('상위 단위를 변경할 대상을 찾을 수 없습니다.');
  if (text(unit.id) === text(newParentId)) throw new Error('영역 자신을 상위 단위로 지정할 수 없습니다.');
  const next = clone(unit);
  next.properties.parentId = text(newParentId);
  return next;
}

export function changeSovereign(unit, newSovereignId) {
  if (!unit) throw new Error('주권을 변경할 대상을 찾을 수 없습니다.');
  const next = clone(unit);
  next.properties.sovereignId = text(newSovereignId);
  return next;
}

export function changeUnitType(unit, newType) {
  if (!unit) throw new Error('유형을 변경할 영역을 찾을 수 없습니다.');
  const type = text(newType);
  if (!UNIT_TYPES.has(type)) throw new Error('변경할 영역 유형이 올바르지 않습니다.');
  const next = clone(unit);
  next.properties.unitType = type;
  next.properties.coverageMode = type === TERRITORIAL_UNIT_TYPES.REGION
    ? TERRITORIAL_COVERAGE_MODES.EXPLICIT
    : next.properties.coverageMode;
  return next;
}

export async function runTerritorialTransaction({
  snapshot,
  calculate,
  validate = () => ({ ok: true }),
  apply,
  restore,
  recordHistory,
  autosave,
}) {
  const before = snapshot();
  try {
    const result = await calculate();
    const validation = await validate(result);
    if (validation === false || validation?.ok === false) {
      throw new Error(validation?.message || validation?.issues?.[0] || '영역 관계가 올바르지 않습니다.');
    }
    await apply(result);
    recordHistory(before);
    autosave();
    return result;
  } catch (error) {
    await restore(before);
    throw error;
  }
}
