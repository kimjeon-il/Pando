import './territorial-edit-plan.js';
import {
  normalizeTemporalInterval,
  temporalIntervalsOverlap,
} from './temporal.js';

export const TERRITORIAL_SCHEMA_VERSION = 3;

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
  const associatedCountryId = text(source.associatedCountryId);
  if (Object.hasOwn(source, 'sovereignId')) throw new Error('sovereignId는 현재 영역 모델의 필드가 아닙니다.');
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
    associatedCountryId,
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
  if (!color) delete properties.style.color;
  return properties;
}

export function normalizeTerritorialFeature(feature, { cloneGeometry = clone } = {}) {
  const type = territorialUnitType(feature);
  if (!type || !isTerritorialFeature(feature)) return null;
  const id = text(feature.id);
  if (!id) throw new Error('영역 ID가 비어 있습니다.');
  return {
    type: 'Feature',
    id,
    properties: normalizedProperties(feature, type),
    geometry: cloneGeometry(feature.geometry),
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

export const administrativeCountryId = globalThis.PandoLabTerritorialEdit.administrativeCountryId;

export function normalizeTerritorialEntities(value, {
  getEntity = () => null,
  validatedUnchanged = null,
  cloneGeometry = clone,
} = {}) {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const feature = validatedUnchanged?.has(raw) ? raw : normalizeTerritorialFeature(raw, { cloneGeometry });
    if (!feature) throw new Error('영역 형식이 올바르지 않습니다.');
    if (seen.has(feature.id)) throw new Error(`영역 ID가 중복되었습니다: ${feature.id}`);
    seen.add(feature.id);
    normalized.push(feature);
  }

  const byId = new Map(normalized.map(feature => [feature.id, feature]));
  const resolve = id => byId.get(text(id)) || getEntity(text(id));
  for (const feature of normalized) {
    const properties = feature.properties;
    if (properties.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY && properties.parentId) throw new Error('국가에는 행정 부모를 지정할 수 없습니다.');
    if (properties.unitType !== TERRITORIAL_UNIT_TYPES.REGION && properties.associatedCountryId) throw new Error('국가 연결은 지방에만 지정할 수 있습니다.');
    if (properties.unitType !== TERRITORIAL_UNIT_TYPES.SUBUNIT && properties.coverageMode !== TERRITORIAL_COVERAGE_MODES.EXPLICIT) throw new Error('국가·지방은 explicit 형상이어야 합니다.');
    if (properties.unitType === TERRITORIAL_UNIT_TYPES.SUBUNIT) administrativeCountryId(feature, resolve);
    if (properties.associatedCountryId && resolve(properties.associatedCountryId)?.properties?.unitType !== TERRITORIAL_UNIT_TYPES.COUNTRY) {
      throw new Error(`${feature.id}의 연결 국가 ${properties.associatedCountryId}이 존재하지 않습니다.`);
    }
    if (properties.parentId && (!resolve(properties.parentId)
      || properties.parentId === feature.id
      || parentCreatesCycle(feature.id, properties.parentId, byId))) {
      throw new Error(`${feature.id}의 상위 단위 ${properties.parentId}이 존재하지 않거나 순환합니다.`);
    }
  }
  return normalized;
}

export function validateTerritorialRelations(units, {
  getEntity = () => null,
  relations = [],
} = {}) {
  const issues = [];
  const byId = new Map((units || []).map(feature => [text(feature.id), feature]));
  const resolve = id => byId.get(text(id)) || getEntity(text(id));
  const exists = id => !!resolve(id);
  for (const feature of units || []) {
    const id = text(feature.id);
    const properties = feature.properties || {};
    if (!id) issues.push('영역 ID가 비어 있습니다.');
    if (!POLYGON_TYPES.has(feature.geometry?.type)) issues.push(`${id || '영역'}의 형상이 Polygon이 아닙니다.`);
    if (!UNIT_TYPES.has(properties.unitType)) issues.push(`${id || '영역'}의 유형이 올바르지 않습니다.`);
    if (properties.parentId && !exists(properties.parentId)) issues.push(`${id}의 상위 단위가 존재하지 않습니다.`);
    try { administrativeCountryId(feature, resolve); }
    catch (error) { issues.push(error.message); }
    if (properties.associatedCountryId && resolve(properties.associatedCountryId)?.properties?.unitType !== 'country') issues.push(`${id}의 연결 국가가 존재하지 않습니다.`);
    if (properties.parentId === id || parentCreatesCycle(id, properties.parentId, byId)) issues.push(`${id}의 상위 관계가 순환합니다.`);
    try { normalizeTemporalInterval(properties.validFrom, properties.validTo); }
    catch (error) { issues.push(`${id}의 유효기간이 올바르지 않습니다. ${error.message}`); }
  }
  const byRelationUnit = new Map();
  for (const relation of Array.isArray(relations) ? relations : []) {
    const unitId = text(relation?.unitId);
    if (!exists(unitId)) issues.push(`${unitId || '관계'}의 대상 영역이 존재하지 않습니다.`);
    if (relation?.parentId && !exists(relation.parentId)) issues.push(`${unitId}의 기간별 상위 단위가 존재하지 않습니다.`);
    if (relation?.associatedCountryId && (resolve(unitId)?.properties?.unitType !== 'region'
      || resolve(relation.associatedCountryId)?.properties?.unitType !== 'country')) issues.push(`${unitId}의 기간별 연결 국가가 올바르지 않습니다.`);
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
    if (Number(raw?.schemaVersion) !== 2 || Object.hasOwn(raw, 'sovereignId')) throw new Error('기간별 관계 schemaVersion이 현재 형식과 일치하지 않습니다.');
    const unitId = text(raw?.unitId);
    if (!unitId) throw new Error('기간별 관계의 대상 영역 ID가 비어 있습니다.');
    const id = text(raw.id);
    if (!id) throw new Error('기간별 관계 ID가 비어 있습니다.');
    if (seen.has(id)) throw new Error(`기간별 관계 ID가 중복되었습니다: ${id}`);
    seen.add(id);
    const interval = normalizeTemporalInterval(raw.validFrom, raw.validTo);
    output.push({
      id,
      schemaVersion: 2,
      unitId,
      parentId: text(raw.parentId),
      associatedCountryId: text(raw.associatedCountryId),
      validFrom: interval.validFrom,
      validTo: interval.validTo,
    });
  }
  return output;
}

export function createTerritorialFeature({
  id,
  unitType,
  name = '',
  geometry,
  parentId = '',
  associatedCountryId = '',
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
    parentId = text(parentId);
    if (!parentId) throw new Error('하위단위의 상위 단위를 지정해야 합니다.');
  }
  const resolvedCoverageMode = coverageMode || (unitType !== TERRITORIAL_UNIT_TYPES.SUBUNIT
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
      associatedCountryId,
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
