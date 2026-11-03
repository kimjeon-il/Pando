// R4-E2: test-only import wizard facade; actual geometry RPC lives in tools/gis.
import { EXCHANGE_TARGETS, normalizeExchangeTarget } from '../../../tools/gis/exchange-adapter-registry.js';
import { createGisImportPlan } from '../../../tools/gis/gis-import-plan.js';

export {GIS_GEOMETRY_TIMEOUT_MS,createGisGeometryValidator} from "../../../tools/gis/gis-geometry-validator.js";

export { applyImportedPackageAssets } from "../../../shared/frontend/js/modules/project-package-assets.js";

export function appendImportedSourceInfo(previous, next, now = () => new Date().toISOString()) {
  const imports = [];
  const append = value => {
    if (!value) return;
    if (Array.isArray(value.imports)) imports.push(...value.imports);
    else imports.push(value);
  };
  append(previous);
  append(next);
  return { mergedAt: now(), imports };
}

export function createImportService({
  openImportWizard,
  getWizardOptions,
  validateStructuredGeometry,

  exchangeRegistry = null,
  getProjectGeneration = () => 0,

}) {
  const buildPlan = (kind, result, context, extra = {}) => createGisImportPlan({
    kind,
    projectGeneration: getProjectGeneration(),
    source: { fileName: context.fileName, sourceKind: result.sourceKind || result.importPlan?.sourceKind || '' },
    payload: { result, ...extra },
    affectedIds: extra.plan?.affectedIds || [],
    render: kind === 'project-replace'
      ? { kind: 'territorial-patch', domain: 'territorial' }
      : kind === 'territorial'
        ? { kind: 'territorial-patch', domain: 'territorial' }
        : kind === 'distribution'
          ? { kind: 'overlay-geometry', domain: 'distribution' }
          : { kind: 'generic-patch', domain: 'generic' },
    summary: extra.plan?.counts || result.summary || {},
  });

  async function openFiles(files, { targetType = '', sourceKind = '' } = {}) {
    if (!files?.length) return { status: 'empty' };
    const result = await openImportWizard(files, {
      targetType,
      sourceKind,
      ...getWizardOptions(),
    });
    const resolvedTarget = normalizeExchangeTarget(result.importPlan?.targetType || result.targetType, '');
    if (!resolvedTarget) throw new Error('가져올 객체 종류가 올바르지 않습니다.');
    const context = { fileName: files[0]?.name || '벡터 파일' };

    if (result.sourceKind === 'project' || result.importPlan?.sourceKind === 'project') {
      return { status: 'planned', plan: buildPlan('project-replace', result, context) };
    }
    if (['general', 'regional'].includes(resolvedTarget)) {
      return { status: 'planned', plan: buildPlan('territorial', result, context) };
    }
    const importedFeatures = result.collection?.features || [];
    const structuredIssues = importedFeatures
      .filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type))
      .flatMap(validateStructuredGeometry);
    if (structuredIssues.length) throw new Error(`가져온 geometry가 올바르지 않습니다. ${structuredIssues[0].message}`);
    const kind = resolvedTarget === EXCHANGE_TARGETS.DISTRIBUTION ? 'distribution' : 'generic';
    return { status: 'planned', plan: buildPlan(kind, result, context) };
  }

  return Object.freeze({ openFiles, exchangeRegistry });
}
