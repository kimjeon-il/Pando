export const TERRITORIAL_SCHEMA_VERSION = 1;

export const TERRITORIAL_UNIT_TYPES = Object.freeze({
  COUNTRY: 'country',
  TERRITORY: 'territory',
  ADMIN: 'admin',
  REGION: 'region',
});

export const TERRITORIAL_COVERAGE_MODES = Object.freeze({
  PARTITION: 'partition',
  EXPLICIT: 'explicit',
});

export const TERRITORIAL_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  UNASSIGNED: 'unassigned',
});

const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);
const UNIT_TYPES = new Set(Object.values(TERRITORIAL_UNIT_TYPES));
const text = value => String(value ?? '').trim();
const clone = value => structuredClone(value);

function normalizedDate(value) {
  const source = text(value);
  if (!source) return null;
  if (!/^[-+]?\d{4,6}(?:-\d{2}-\d{2})?$/.test(source)) return null;
  return source;
}

export function territorialUnitType(feature) {
  const properties = feature?.properties || {};
  const value = text(properties.unitType || properties.type).toLowerCase();
  if (UNIT_TYPES.has(value)) return value;
  const legacy = text(properties.kind).toLowerCase();
  if (legacy === 'administrative') return TERRITORIAL_UNIT_TYPES.ADMIN;
  if (legacy === 'region') return TERRITORIAL_UNIT_TYPES.TERRITORY;
  return '';
}

export function isTerritorialFeature(feature) {
  return !!territorialUnitType(feature) && POLYGON_TYPES.has(feature?.geometry?.type);
}

function legacyCountryId(source) {
  return text(source.countryId || source.country_id || source.sovereignId || source.sovereign_id);
}

function normalizedProperties(feature, type) {
  const source = feature?.properties || {};
  const legacyCountry = legacyCountryId(source);
  const parentId = text(source.parentId || source.parent_id || source.parentRegionId || source.parent_region_id)
    || ([TERRITORIAL_UNIT_TYPES.TERRITORY, TERRITORIAL_UNIT_TYPES.ADMIN].includes(type) ? legacyCountry : '');
  const sovereignId = text(source.sovereignId || source.sovereign_id) || legacyCountry;
  const coverageMode = source.coverageMode === TERRITORIAL_COVERAGE_MODES.EXPLICIT
    ? TERRITORIAL_COVERAGE_MODES.EXPLICIT
    : source.coverageMode === TERRITORIAL_COVERAGE_MODES.PARTITION
      ? TERRITORIAL_COVERAGE_MODES.PARTITION
      : type === TERRITORIAL_UNIT_TYPES.REGION
        ? TERRITORIAL_COVERAGE_MODES.EXPLICIT
        : TERRITORIAL_COVERAGE_MODES.PARTITION;
  const status = source.status === TERRITORIAL_STATUS.UNASSIGNED || !sovereignId
    ? TERRITORIAL_STATUS.UNASSIGNED
    : TERRITORIAL_STATUS.ASSIGNED;
  const sourceStyle = source.style && typeof source.style === 'object' ? source.style : {};
  const color = text(sourceStyle.color || source.color || source.editorColor);
  const properties = {
    schemaVersion: TERRITORIAL_SCHEMA_VERSION,
    unitType: type,
    name: text(source.name),
    parentId,
    sovereignId,
    coverageMode,
    adminLevel: type === TERRITORIAL_UNIT_TYPES.ADMIN
      ? Math.max(1, Number.parseInt(source.adminLevel ?? source.level, 10) || 1)
      : null,
    style: color ? { ...sourceStyle, color } : { ...sourceStyle },
    visible: source.visible !== false,
    locked: source.locked === true,
    validFrom: normalizedDate(source.validFrom ?? source.valid_from),
    validTo: normalizedDate(source.validTo ?? source.valid_to),
    status,
    notes: text(source.notes),
    metadata: source.metadata && typeof source.metadata === 'object' ? clone(source.metadata) : {},
    sourceFolderId: text(source.sourceFolderId || source.source_folder_id),
    sourceLibraryId: text(source.sourceLibraryId || source.source_library_id),
    sourceGeometryVersion: text(source.sourceGeometryVersion || source.source_geometry_version),
  };
  if (!color) delete properties.style.color;
  return properties;
}

export function normalizeTerritorialFeature(feature, { makeId } = {}) {
  const type = territorialUnitType(feature);
  if (!type || !POLYGON_TYPES.has(feature?.geometry?.type)) return null;
  const id = text(feature.id || feature.properties?.id || feature.properties?.pandolab_id)
    || (typeof makeId === 'function' ? text(makeId(type)) : '');
  if (!id) return null;
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

function resolveAdminLevel(feature, byId, cache) {
  if (feature.properties.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN) return null;
  if (cache.has(feature.id)) return cache.get(feature.id);
  const parent = byId.get(text(feature.properties.parentId));
  const level = parent?.properties?.unitType === TERRITORIAL_UNIT_TYPES.ADMIN
    ? resolveAdminLevel(parent, byId, cache) + 1
    : 1;
  cache.set(feature.id, level);
  return level;
}

export function normalizeTerritorialUnits(value, {
  countryExists = () => true,
  makeId,
} = {}) {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const feature = normalizeTerritorialFeature(raw, { makeId });
    if (!feature || feature.properties.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY || seen.has(feature.id)) continue;
    seen.add(feature.id);
    normalized.push(feature);
  }

  const byId = new Map(normalized.map(feature => [feature.id, feature]));
  const unitExists = id => byId.has(text(id)) || countryExists(text(id));
  for (const feature of normalized) {
    const properties = feature.properties;
    if (properties.sovereignId && !countryExists(properties.sovereignId)) {
      properties.sovereignId = '';
      properties.status = TERRITORIAL_STATUS.UNASSIGNED;
    }
    if (!properties.sovereignId && properties.coverageMode === TERRITORIAL_COVERAGE_MODES.PARTITION) {
      properties.parentId = '';
    }
    if (properties.parentId && (!unitExists(properties.parentId)
      || properties.parentId === feature.id
      || parentCreatesCycle(feature.id, properties.parentId, byId))) {
      properties.parentId = '';
    }
    if (properties.coverageMode === TERRITORIAL_COVERAGE_MODES.PARTITION
      && !properties.parentId
      && properties.sovereignId
      && countryExists(properties.sovereignId)) {
      properties.parentId = properties.sovereignId;
    }
  }

  const levelCache = new Map();
  for (const feature of normalized) {
    if (feature.properties.unitType === TERRITORIAL_UNIT_TYPES.ADMIN) {
      feature.properties.adminLevel = resolveAdminLevel(feature, byId, levelCache);
    }
  }
  return normalized;
}

export function migrateLegacyCountryRegions(value, options = {}) {
  return normalizeTerritorialUnits(value, options);
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
    && (properties.unitType !== TERRITORIAL_UNIT_TYPES.ADMIN
      || Number(candidate.properties?.adminLevel || 0) === Number(properties.adminLevel || 0)));
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
    if (properties.parentId && !exists(properties.parentId)) issues.push(`${id}의 상위 영역이 존재하지 않습니다.`);
    if (properties.sovereignId && !countryExists(properties.sovereignId)) issues.push(`${id}의 주권 국가가 존재하지 않습니다.`);
    if (properties.parentId === id || parentCreatesCycle(id, properties.parentId, byId)) issues.push(`${id}의 상위 관계가 순환합니다.`);
    if (properties.validFrom && properties.validTo && properties.validFrom > properties.validTo) issues.push(`${id}의 유효기간이 역전되어 있습니다.`);
  }
  const byRelationUnit = new Map();
  for (const relation of Array.isArray(relations) ? relations : []) {
    const unitId = text(relation?.unitId);
    if (!exists(unitId)) issues.push(`${unitId || '관계'}의 대상 영역이 존재하지 않습니다.`);
    if (relation?.parentId && !exists(relation.parentId)) issues.push(`${unitId}의 기간별 상위 영역이 존재하지 않습니다.`);
    if (relation?.sovereignId && !countryExists(relation.sovereignId)) issues.push(`${unitId}의 기간별 주권 국가가 존재하지 않습니다.`);
    if (relation?.validFrom && relation?.validTo && relation.validFrom > relation.validTo) issues.push(`${unitId}의 기간별 관계가 역전되어 있습니다.`);
    const list = byRelationUnit.get(unitId) || [];
    list.push(relation);
    byRelationUnit.set(unitId, list);
  }
  for (const [unitId, list] of byRelationUnit) {
    const sorted = [...list].sort((left, right) => text(left.validFrom).localeCompare(text(right.validFrom)));
    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = text(sorted[index - 1].validTo) || '\uffff';
      const currentStart = text(sorted[index].validFrom);
      if (currentStart <= previousEnd) issues.push(`${unitId}의 기간별 관계가 서로 겹칩니다.`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function normalizeTerritorialRelations(value, { makeId } = {}) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const unitId = text(raw?.unitId);
    if (!unitId) continue;
    const id = text(raw.id) || (typeof makeId === 'function' ? text(makeId('relation')) : `relation:${unitId}:${output.length + 1}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({
      id,
      unitId,
      parentId: text(raw.parentId),
      sovereignId: text(raw.sovereignId),
      validFrom: normalizedDate(raw.validFrom),
      validTo: normalizedDate(raw.validTo),
    });
  }
  return output;
}

export function resolveTerritorialRelation(unit, relations, referenceDate) {
  if (!unit) return null;
  const date = normalizedDate(referenceDate);
  if (!date) return unit;
  const relation = (relations || []).find(candidate => text(candidate.unitId) === text(unit.id)
    && (!candidate.validFrom || candidate.validFrom <= date)
    && (!candidate.validTo || candidate.validTo >= date));
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
  status,
  coverageMode,
  adminLevel = null,
  color = '',
  visible = true,
  locked = false,
  validFrom = null,
  validTo = null,
  notes = '',
  metadata = {},
  sourceFolderId = '',
  sourceLibraryId = '',
  sourceGeometryVersion = '',
}) {
  const feature = normalizeTerritorialFeature({
    type: 'Feature',
    id,
    properties: {
      unitType,
      name,
      parentId,
      sovereignId,
      status,
      coverageMode,
      adminLevel,
      style: color ? { color } : {},
      visible,
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

export function createCountryTerritorialAdapter(feature, override = {}) {
  if (!feature?.geometry) return null;
  const properties = feature.properties || {};
  const id = text(properties.editor_id || feature.id);
  if (!id) return null;
  return {
    type: 'Feature',
    id,
    properties: {
      schemaVersion: TERRITORIAL_SCHEMA_VERSION,
      unitType: TERRITORIAL_UNIT_TYPES.COUNTRY,
      name: text(override.name || properties.editor_name || properties.editor_original_name || properties.name || id),
      parentId: '',
      sovereignId: id,
      coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT,
      adminLevel: null,
      style: { color: text(override.color || properties.editor_color) },
      visible: true,
      locked: false,
      validFrom: normalizedDate(properties.validFrom),
      validTo: normalizedDate(properties.validTo),
      metadata: { adapter: 'countriesData' },
      sourceLibraryId: text(properties.sourceLibraryId),
      sourceGeometryVersion: text(properties.sourceGeometryVersion),
    },
    geometry: feature.geometry,
  };
}

export function createTerritorialRepository({
  getCountries,
  getUnits,
  getCountryOverride = () => ({}),
}) {
  const countries = () => (getCountries()?.features || [])
    .map(feature => createCountryTerritorialAdapter(feature, getCountryOverride(text(feature.properties?.editor_id))))
    .filter(Boolean);
  const units = () => Array.isArray(getUnits()) ? getUnits() : [];
  return Object.freeze({
    get(id) {
      const key = text(id);
      return units().find(feature => text(feature.id) === key)
        || countries().find(feature => text(feature.id) === key)
        || null;
    },
    list({ type } = {}) {
      const values = [...countries(), ...units()];
      return type ? values.filter(feature => feature.properties?.unitType === type) : values;
    },
    children(id) {
      return territorialChildren(units(), id);
    },
  });
}

export function changeParent(unit, newParentId) {
  if (!unit) throw new Error('상위 영역을 변경할 대상을 찾을 수 없습니다.');
  if (text(unit.id) === text(newParentId)) throw new Error('영역 자신을 상위 영역으로 지정할 수 없습니다.');
  const next = clone(unit);
  next.properties.parentId = text(newParentId);
  return next;
}

export function changeSovereign(unit, newSovereignId) {
  if (!unit) throw new Error('주권을 변경할 대상을 찾을 수 없습니다.');
  const next = clone(unit);
  next.properties.sovereignId = text(newSovereignId);
  next.properties.status = next.properties.sovereignId ? TERRITORIAL_STATUS.ASSIGNED : TERRITORIAL_STATUS.UNASSIGNED;
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
  next.properties.adminLevel = type === TERRITORIAL_UNIT_TYPES.ADMIN
    ? Math.max(1, Number(next.properties.adminLevel) || 1)
    : null;
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
