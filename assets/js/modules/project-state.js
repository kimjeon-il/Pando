export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_FORMATS = Object.freeze(new Set([
  'pandolab-project-state',
  'pandolab-autosave-full',
  'pandolab-autosave-delta',
]));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = value => String(value ?? '').trim();
const LAYER_VISIBILITY_KEYS = new Set(['countries', 'territories', 'administrative', 'regions', 'languages', 'ethnicities', 'religions', 'rivers', 'lakes', 'drawings', 'labels', 'basemapLabels']);
const LEGACY_LAYER_VISIBILITY_INPUT_KEYS = new Set([...LAYER_VISIBILITY_KEYS, 'hydro']);
const ITEM_VISIBILITY_KEYS = new Set(['countries', 'territories', 'administrative', 'regions', 'languages', 'ethnicities', 'religions', 'hydro', 'drawings', 'labels', 'countryLabels']);
const PRESENTATION_GROUP_KEYS = new Set(['countries', 'territories', 'administrative', 'regions', 'languages', 'ethnicities', 'religions', 'rivers', 'lakes', 'hydro', 'userDrawings', 'labels', 'countryLabels', 'terrain']);

export function createProjectObjectId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('이 환경에서는 안전한 프로젝트 ID를 만들 수 없습니다.');
  return globalThis.crypto.randomUUID();
}

export function isProjectObjectId(value) {
  return UUID_PATTERN.test(text(value));
}

function schemaError(message, code = 'PL-SCHEMA-001') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireSchemaVersion(value, label, expected = PROJECT_SCHEMA_VERSION) {
  if (value == null) throw schemaError(`${label}에 schemaVersion이 없습니다. 현재 형식의 파일만 열 수 있습니다.`, 'PL-SCHEMA-MISSING');
  if (Number(value) !== expected) {
    throw schemaError(`${label}의 schemaVersion ${value}은 지원하지 않습니다. 현재 버전은 ${expected}입니다.`, 'PL-SCHEMA-OLD');
  }
}

function assertUniqueProjectIds(rows, label, idOf = row => row?.id) {
  const seen = new Set();
  for (const row of rows || []) {
    const id = text(idOf(row));
    if (!id) throw schemaError(`${label} ID가 비어 있습니다.`, 'PL-SCHEMA-ID-MISSING');
    if (!isProjectObjectId(id)) throw schemaError(`${label} ID가 UUID 형식이 아닙니다: ${id}`, 'PL-SCHEMA-ID-FORMAT');
    if (seen.has(id)) throw schemaError(`${label} ID가 중복되었습니다: ${id}`, 'PL-SCHEMA-ID-DUPLICATE');
    seen.add(id);
  }
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) {
      throw schemaError(`${label}에 지원하지 않는 필드 ${key}가 있습니다.`, 'PL-SCHEMA-FIELD');
    }
  }
}

export function assertCurrentProjectSchema(project) {
  if (!project || typeof project !== 'object') throw schemaError('프로젝트 형식이 올바르지 않습니다.');
  if (!PROJECT_FORMATS.has(text(project.format))) throw schemaError(`지원하지 않는 프로젝트 형식입니다: ${text(project.format) || '(없음)'}`, 'PL-SCHEMA-FORMAT');
  requireSchemaVersion(project.schemaVersion, '프로젝트');
  requireSchemaVersion(project.landObjectModel?.schemaVersion, '지형지물 모델', 1);
  requireSchemaVersion(project.territorialModel?.schemaVersion, '영토 모델', 1);
  requireSchemaVersion(project.distributionModel?.schemaVersion, '분포 모델', 2);
  requireSchemaVersion(project.layerPresentation?.schemaVersion, '레이어 표현', 2);
  assertAllowedKeys(project, new Set([
    'format', 'schemaVersion', 'version', 'savedAt', 'countriesData', 'countryDelta',
    'countryOverrides', 'sourceInfo', 'labels', 'drawings', 'hydroEdits',
    'territorialUnits', 'territorialRelations', 'distributionLayers', 'distributionEntries',
    'labelSettings', 'distributionSettings', 'layerPresentation', 'physicalSettings',
    'layerVisibility', 'itemVisibility', 'baseDataset', 'landObjectModel', 'territorialModel',
    'distributionModel', 'physicalSourceInfo',
  ]), '프로젝트');
  assertAllowedKeys(project.distributionSettings, new Set(['renderMode', 'boundaryVisible']), '분포 표시 설정');
  assertAllowedKeys(project.layerVisibility, LEGACY_LAYER_VISIBILITY_INPUT_KEYS, '레이어 표시 상태');
  assertAllowedKeys(project.itemVisibility, ITEM_VISIBILITY_KEYS, '객체 표시 상태');
  assertAllowedKeys(project.layerPresentation, new Set(['schemaVersion', 'overlayOrder', 'styles']), '레이어 표현');
  assertAllowedKeys(project.layerPresentation?.styles, PRESENTATION_GROUP_KEYS, '레이어 표현 스타일');
  for (const [group, style] of Object.entries(project.layerPresentation?.styles || {})) {
    assertAllowedKeys(style, new Set(['opacity', 'boundaryVisible', 'boundaryWidth', 'labelsVisible', 'blendMode']), `${group} 레이어 스타일`);
  }

  const countries = project.countriesData?.features || [];
  const countryIds = new Set();
  for (const feature of countries) {
    const id = text(feature?.properties?.editor_id || feature?.id);
    if (!id) throw schemaError('국가 ID가 비어 있습니다.', 'PL-SCHEMA-ID-MISSING');
    if (countryIds.has(id)) throw schemaError(`국가 ID가 중복되었습니다: ${id}`, 'PL-SCHEMA-ID-DUPLICATE');
    if (feature?.properties?.editor_custom === true && !isProjectObjectId(id)) {
      throw schemaError(`프로젝트에서 만든 국가 ID가 UUID 형식이 아닙니다: ${id}`, 'PL-SCHEMA-ID-FORMAT');
    }
    countryIds.add(id);
  }

  assertUniqueProjectIds(project.territorialUnits, '영역');
  assertUniqueProjectIds(project.territorialRelations, '기간별 관계');
  assertUniqueProjectIds(project.distributionLayers, '분포 레이어');
  assertUniqueProjectIds(project.distributionEntries, '분포 엔트리');
  assertUniqueProjectIds(project.drawings, '지형지물');
  assertUniqueProjectIds(project.hydroEdits, '편집 수계');
  assertUniqueProjectIds(project.labels, '지명');

  for (const feature of project.territorialUnits || []) {
    requireSchemaVersion(feature?.properties?.schemaVersion, `영역 ${text(feature?.id)}`, 1);
    assertAllowedKeys(feature?.properties, new Set([
      'schemaVersion', 'unitType', 'name', 'parentId', 'sovereignId', 'coverageMode',
      'adminLevel', 'style', 'locked', 'validFrom', 'validTo', 'isRemainder', 'notes',
      'metadata', 'sourceFolderId', 'sourceLibraryId', 'sourceGeometryVersion',
    ]), `영역 ${text(feature?.id)}`);
    if (typeof feature?.properties?.isRemainder !== 'boolean') throw schemaError(`영역 ${text(feature?.id)}에 isRemainder가 없습니다.`, 'PL-SCHEMA-REMAINDER');
  }
  for (const relation of project.territorialRelations || []) requireSchemaVersion(relation?.schemaVersion, `기간별 관계 ${text(relation?.id)}`, 1);
  for (const layer of project.distributionLayers || []) {
    requireSchemaVersion(layer?.schemaVersion, `분포 레이어 ${text(layer?.id)}`);
    assertAllowedKeys(layer, new Set(['id', 'schemaVersion', 'type', 'name', 'color', 'locked', 'parentId', 'groups', 'validFrom', 'validTo', 'metadata']), `분포 레이어 ${text(layer?.id)}`);
  }
  for (const entry of project.distributionEntries || []) {
    requireSchemaVersion(entry?.schemaVersion, `분포 엔트리 ${text(entry?.id)}`);
    assertAllowedKeys(entry, new Set(['id', 'schemaVersion', 'layerId', 'mode', 'territorialUnitId', 'geometry', 'share', 'certainty', 'validFrom', 'validTo', 'metadata']), `분포 엔트리 ${text(entry?.id)}`);
  }
  for (const feature of [...(project.drawings || []), ...(project.hydroEdits || [])]) {
    requireSchemaVersion(feature?.properties?.pandolab_schema_version, `지도 객체 ${text(feature?.id)}`, 1);
  }
  return project;
}

export const PROJECT_STATE_FIELDS = Object.freeze([
  Object.freeze({ name: 'countryOverrides', scope: 'document', fallback: () => ({}) }),
  Object.freeze({ name: 'sourceInfo', scope: 'document', fallback: () => null }),
  Object.freeze({ name: 'labels', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'drawings', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'hydroEdits', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'territorialUnits', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'territorialRelations', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'distributionLayers', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'distributionEntries', scope: 'document', fallback: () => [] }),
  Object.freeze({ name: 'labelSettings', scope: 'presentation', fallback: () => ({}) }),
  Object.freeze({ name: 'distributionSettings', scope: 'presentation', fallback: current => current || { renderMode: 'dominant', boundaryVisible: true } }),
  Object.freeze({ name: 'layerPresentation', scope: 'presentation', fallback: () => ({}) }),
  Object.freeze({ name: 'physicalSettings', scope: 'presentation', fallback: current => current || {} }),
  Object.freeze({ name: 'layerVisibility', scope: 'presentation', fallback: current => current || {} }),
  Object.freeze({ name: 'itemVisibility', scope: 'presentation', fallback: () => ({}) }),
  Object.freeze({ name: 'projection', scope: 'session', fallback: () => 'globe' }),
  Object.freeze({ name: 'layerFolders', scope: 'session', fallback: () => ({}) }),
  Object.freeze({ name: 'view', scope: 'session', fallback: current => current || {} }),
]);

const fieldsFor = scope => {
  if (scope === 'project') return PROJECT_STATE_FIELDS.filter(field => ['document', 'presentation'].includes(field.scope));
  if (scope === 'history' || scope === 'document') return PROJECT_STATE_FIELDS.filter(field => field.scope === 'document');
  if (scope === 'presentation') return PROJECT_STATE_FIELDS.filter(field => field.scope === 'presentation');
  if (scope === 'session') return PROJECT_STATE_FIELDS.filter(field => field.scope === 'session');
  throw new Error(`알 수 없는 프로젝트 상태 범위입니다: ${scope}`);
};

export function pickProjectFields(state, { scope = 'project', clone = structuredClone } = {}) {
  return Object.fromEntries(fieldsFor(scope).map(field => [field.name, clone(state[field.name])]));
}

export function applyProjectFields(target, source, {
  scope = 'project',
  clone = structuredClone,
  normalizers = {},
} = {}) {
  for (const field of fieldsFor(scope)) {
    const current = target[field.name];
    const raw = Object.prototype.hasOwnProperty.call(source || {}, field.name) && source[field.name] !== undefined
      ? source[field.name]
      : field.fallback(current);
    const normalize = normalizers[field.name];
    target[field.name] = normalize ? normalize(raw, current, source || {}) : clone(raw);
  }
  return target;
}
