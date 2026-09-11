import {
  EXCHANGE_TARGETS,
  EXCHANGE_TARGET_DESCRIPTORS,
  normalizeExchangeTarget,
} from './exchange-adapter-registry.js';

export const TERRITORIAL_IMPORT_TARGETS = Object.freeze({
  SUBUNIT: EXCHANGE_TARGETS.SUBUNIT,
  REGION: EXCHANGE_TARGETS.REGION,
});
export const SOVEREIGN_SELECTION_TARGETS = Object.freeze(new Set(Object.values(TERRITORIAL_IMPORT_TARGETS)));
export const PARTITION_IMPORT_TARGETS = Object.freeze(new Set([TERRITORIAL_IMPORT_TARGETS.SUBUNIT]));
const TARGET_TYPES = new Set(Object.keys(EXCHANGE_TARGET_DESCRIPTORS));
const OPEN_MODES = new Set(['replace', 'merge']);
const SOURCE_KINDS = new Set(['project', 'vector']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function normalizeImportPlan(raw = {}) {
  const targetType = TARGET_TYPES.has(raw.targetType)
    ? raw.targetType
    : normalizeExchangeTarget(raw.targetType, EXCHANGE_TARGETS.GENERIC);
  const sourceKind = SOURCE_KINDS.has(raw.sourceKind) ? raw.sourceKind : (targetType === EXCHANGE_TARGETS.PROJECT ? 'project' : 'vector');
  const openMode = targetType === EXCHANGE_TARGETS.PROJECT
    ? 'replace'
    : targetType === EXCHANGE_TARGETS.COUNTRY
      ? (OPEN_MODES.has(raw.openMode) ? raw.openMode : 'replace')
      : 'merge';
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
    distributionType: targetType === EXCHANGE_TARGETS.DISTRIBUTION && ['language', 'ethnicity', 'religion'].includes(raw.distributionType) ? raw.distributionType : '',
    propertyMapping: {
      id: text(mapping.id), name: text(mapping.name), country: text(mapping.country),
      parent: text(mapping.parent), level: text(mapping.level), color: text(mapping.color),
    },
    targetCountryId: SOVEREIGN_SELECTION_TARGETS.has(targetType) ? text(raw.targetCountryId) : '',
    useFeatureCountryField: SOVEREIGN_SELECTION_TARGETS.has(targetType) && raw.useFeatureCountryField === true,
    fallbackCountryId: SOVEREIGN_SELECTION_TARGETS.has(targetType) ? text(raw.fallbackCountryId, raw.targetCountryId) : '',
    parentId: targetType === TERRITORIAL_IMPORT_TARGETS.ADMINISTRATIVE ? text(raw.parentId) : '',
    landPolicy: PARTITION_IMPORT_TARGETS.has(targetType) ? 'transfer-to-owner' : 'preserve',
    openMode,
    mergePolicy: targetType === EXCHANGE_TARGETS.COUNTRY ? 'same-id-multipolygon' : text(raw.mergePolicy, 'preserve-features'),
  };
}

export function targetRequiresExistingProject(targetType) {
  return ![EXCHANGE_TARGETS.PROJECT, EXCHANGE_TARGETS.COUNTRY].includes(normalizeExchangeTarget(targetType));
}
