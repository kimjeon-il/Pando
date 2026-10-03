import './territorial-edit-plan.js';
import {
  normalizeTemporalInterval,
  temporalIntervalsOverlap,
} from './temporal.js';

export const TERRITORIAL_SCHEMA_VERSION = 4;

export const TERRITORIAL_ENTITY_KINDS = Object.freeze({ GENERAL: 'general', REGIONAL: 'regional' });

export const TERRITORIAL_COVERAGE_MODES = Object.freeze({
  PARTITION: 'partition',
  EXPLICIT: 'explicit',
});

const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);
const ENTITY_KINDS = new Set(Object.values(TERRITORIAL_ENTITY_KINDS));
const text = value => String(value ?? '').trim();
const clone = value => structuredClone(value);

function territorialEntityKind(feature) {
  const properties = feature?.properties || {};
  const value = text(properties.entityKind).toLowerCase();
  return ENTITY_KINDS.has(value) ? value : '';
}

function isTerritorialFeature(feature) {
  return !!territorialEntityKind(feature)
    && POLYGON_TYPES.has(feature?.geometry?.type)
    && Array.isArray(feature.geometry.coordinates)
    && feature.geometry.coordinates.length > 0;
}

function normalizedProperties(feature, type) {
  const source = feature?.properties || {};
  if (Number(source.schemaVersion) !== TERRITORIAL_SCHEMA_VERSION) throw new Error('영역 schemaVersion이 현재 형식과 일치하지 않습니다.');
  const parentId = text(source.parentId);
  for (const field of ['unitType', 'associatedCountryId', 'sovereignId']) {
    if (Object.hasOwn(source, field)) throw new Error(`${field}는 현재 객체 모델의 필드가 아닙니다.`);
  }
  const coverageMode = text(source.coverageMode);
  if (![TERRITORIAL_COVERAGE_MODES.EXPLICIT, TERRITORIAL_COVERAGE_MODES.PARTITION].includes(coverageMode)) {
    throw new Error('영역 coverageMode가 올바르지 않습니다.');
  }
  const interval = normalizeTemporalInterval(source.validFrom, source.validTo);
  const sourceStyle = source.style && typeof source.style === 'object' ? source.style : {};
  const color = text(sourceStyle.color);
  const properties = {
    schemaVersion: TERRITORIAL_SCHEMA_VERSION,
    entityKind: type,
    name: text(source.name),
    parentId,
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
  const type = territorialEntityKind(feature);
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

export const territorialRootId = globalThis.PandoLabTerritorialEdit.territorialRootId;

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
    if (properties.entityKind === 'regional' && properties.parentId) throw new Error('독립 권역에는 부모를 지정할 수 없습니다.');
    if (!properties.parentId && properties.coverageMode !== 'explicit') throw new Error('최상위 객체와 독립 권역은 explicit 형상이어야 합니다.');
    territorialRootId(feature, resolve);
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
  try { normalizeTerritorialEntities(units, { getEntity, cloneGeometry: geometry => geometry }); }
  catch (error) { issues.push(error.message); }
  const byRelationUnit = new Map();
  for (const relation of Array.isArray(relations) ? relations : []) {
    const unitId = text(relation?.unitId);
    if (!exists(unitId)) issues.push(`${unitId || '관계'}의 대상 영역이 존재하지 않습니다.`);
    if (relation?.parentId && (resolve(unitId)?.properties.entityKind !== 'general' || resolve(relation.parentId)?.properties.entityKind !== 'general')) issues.push(unitId + '의 기간별 부모는 일반객체여야 합니다.');
    if (relation?.parentId === unitId) issues.push(unitId + '의 기간별 상위 관계가 순환합니다.');
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
  // Relationships change only at interval boundaries. Validate each distinct
  // parent graph, including the base parent when a dated relationship expires.
  if (!issues.length && relations.length) {
    const key = values => values[0] * 372 + (values[1] - 1) * 31 + values[2] - 1;
    const intervals = relations.map(relation => {
      const interval = normalizeTemporalInterval(relation.validFrom, relation.validTo);
      return { relation, start: interval.start ? key(interval.start.startKey) : -Infinity,
        end: interval.end ? key(interval.end.endKey) : Infinity };
    });
    const boundaries = new Set([-Infinity]);
    for (const interval of intervals) {
      boundaries.add(interval.start);
      if (Number.isFinite(interval.end)) boundaries.add(interval.end + 1);
    }
    for (const point of boundaries) {
      const parents = new Map(intervals.filter(interval => interval.start <= point && point <= interval.end)
        .map(({ relation }) => [text(relation.unitId), text(relation.parentId)]));
      for (const id of byRelationUnit.keys()) {
        const visited = new Set();
        let cursor = id;
        while (cursor) {
          if (visited.has(cursor)) { issues.push(id + '의 기간별 상위 관계가 순환합니다.'); break; }
          visited.add(cursor);
          cursor = parents.has(cursor) ? parents.get(cursor) : text(resolve(cursor)?.properties.parentId);
        }
      }
      if (issues.length) break;
    }
  }
  return { ok: issues.length === 0, issues };
}

export function normalizeTerritorialRelations(value) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    if (Number(raw?.schemaVersion) !== 3 || ['sovereignId', 'associatedCountryId'].some(field => Object.hasOwn(raw, field))) throw new Error('기간별 관계 schemaVersion이 현재 형식과 일치하지 않습니다.');
    const unitId = text(raw?.unitId);
    if (!unitId) throw new Error('기간별 관계의 대상 영역 ID가 비어 있습니다.');
    const id = text(raw.id);
    if (!id) throw new Error('기간별 관계 ID가 비어 있습니다.');
    if (seen.has(id)) throw new Error(`기간별 관계 ID가 중복되었습니다: ${id}`);
    seen.add(id);
    const interval = normalizeTemporalInterval(raw.validFrom, raw.validTo);
    output.push({
      id,
      schemaVersion: 3,
      unitId,
      parentId: text(raw.parentId),
      validFrom: interval.validFrom,
      validTo: interval.validTo,
    });
  }
  return output;
}

export function createTerritorialFeature({
  id,
  entityKind,
  name = '',
  geometry,
  parentId = '',
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
  const resolvedCoverageMode = coverageMode || (entityKind === 'general' && text(parentId) ? 'partition' : 'explicit');
  const feature = normalizeTerritorialFeature({
    type: 'Feature',
    id,
    properties: {
      schemaVersion: TERRITORIAL_SCHEMA_VERSION,
      entityKind,
      name,
      parentId,
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
