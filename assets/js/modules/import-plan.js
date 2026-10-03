import {
  EXCHANGE_TARGETS,
  EXCHANGE_TARGET_DESCRIPTORS,
  normalizeExchangeTarget,
} from './exchange-adapter-registry.js';

const TARGET_TYPES = new Set(Object.keys(EXCHANGE_TARGET_DESCRIPTORS));
const SOURCE_KINDS = new Set(['project', 'vector']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function normalizeImportPlan(raw = {}) {
  const targetType = TARGET_TYPES.has(raw.targetType)
    ? raw.targetType
    : normalizeExchangeTarget(raw.targetType, raw.targetType ? '' : EXCHANGE_TARGETS.GENERIC);
  if (!targetType) throw new Error('가져올 객체 종류가 올바르지 않습니다.');
  const sourceKind = SOURCE_KINDS.has(raw.sourceKind) ? raw.sourceKind : (targetType === EXCHANGE_TARGETS.PROJECT ? 'project' : 'vector');
  const openMode = targetType === EXCHANGE_TARGETS.PROJECT ? 'replace' : 'merge';
  const layerCandidates = Array.isArray(raw.layerCandidates) ? raw.layerCandidates.map(candidate => ({
    name: text(candidate?.name, 'layer'),
    geometryType: text(candidate?.geometryType, 'Unknown'),
    featureCount: Math.max(0, Number(candidate?.featureCount) || 0),
  })) : [];
  const mapping = raw.propertyMapping && typeof raw.propertyMapping === 'object' ? raw.propertyMapping : {};
  return {
    sourceKind,
    sourceFormat: text(raw.sourceFormat, 'unknown').toLowerCase(),
    layerCandidates,
    selectedLayer: text(raw.selectedLayer, layerCandidates[0]?.name || ''),
    geometryType: text(raw.geometryType, layerCandidates[0]?.geometryType || 'Unknown'),
    featureCount: Math.max(0, Number(raw.featureCount) || 0),
    detectedCrs: text(raw.detectedCrs, 'unknown'),
    targetType,
    propertyMapping: {
      id: text(mapping.id), name: text(mapping.name),
      parent: text(mapping.parent), level: text(mapping.level), color: text(mapping.color),
      value: text(mapping.value),
    },
    parentId: targetType === EXCHANGE_TARGETS.GENERAL ? text(raw.parentId) : '',
    openMode,
    mergePolicy: 'preserve-features',
  };
}

export function targetRequiresExistingProject(targetType) {
  return normalizeExchangeTarget(targetType) !== EXCHANGE_TARGETS.PROJECT;
}
