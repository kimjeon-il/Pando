export const TERRITORIAL_IMPORT_TARGETS = Object.freeze({
  TERRITORY: 'territory',
  ADMINISTRATIVE: 'administrative',
  REGION: 'region',
});
const PARTITION_TARGETS = new Set([TERRITORIAL_IMPORT_TARGETS.TERRITORY, TERRITORIAL_IMPORT_TARGETS.ADMINISTRATIVE]);
const TARGET_TYPES = new Set(['project', 'country', 'drawing', ...Object.values(TERRITORIAL_IMPORT_TARGETS), 'distribution']);
const OPEN_MODES = new Set(['replace', 'merge']);
const SOURCE_KINDS = new Set(['project', 'vector']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function normalizeImportPlan(raw = {}) {
  const requestedTarget = raw.targetType === 'historicalRegion' ? TERRITORIAL_IMPORT_TARGETS.REGION : raw.targetType;
  const targetType = TARGET_TYPES.has(requestedTarget) ? requestedTarget : 'drawing';
  const sourceKind = SOURCE_KINDS.has(raw.sourceKind) ? raw.sourceKind : (targetType === 'project' ? 'project' : 'vector');
  const openMode = targetType === 'project'
    ? 'replace'
    : targetType === 'country'
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
    distributionType: targetType === 'distribution' && ['language', 'ethnicity', 'religion'].includes(raw.distributionType) ? raw.distributionType : '',
    propertyMapping: {
      id: text(mapping.id), name: text(mapping.name), country: text(mapping.country),
      parent: text(mapping.parent), level: text(mapping.level), color: text(mapping.color),
    },
    targetCountryId: PARTITION_TARGETS.has(targetType) ? text(raw.targetCountryId) : '',
    useFeatureCountryField: PARTITION_TARGETS.has(targetType) && raw.useFeatureCountryField === true,
    fallbackCountryId: PARTITION_TARGETS.has(targetType) ? text(raw.fallbackCountryId, raw.targetCountryId) : '',
    parentId: targetType === TERRITORIAL_IMPORT_TARGETS.ADMINISTRATIVE ? text(raw.parentId, raw.parentRegionId) : '',
    landPolicy: PARTITION_TARGETS.has(targetType) ? 'transfer-to-owner' : 'preserve',
    openMode,
    mergePolicy: targetType === 'country' ? 'same-id-multipolygon' : text(raw.mergePolicy, 'preserve-features'),
  };
}

export function targetRequiresExistingProject(targetType) {
  return !['project', 'country'].includes(targetType);
}
