import { EXCHANGE_TARGETS, normalizeExchangeTarget } from './exchange-adapter-registry.js';
import { createGisImportPlan } from './gis-import-plan.js';
import { sharedCalculationCore } from '../../../../../shared/frontend/js/modules/temporal.js';
import {
  WORKER_RPC_ERROR_CATEGORIES,
  createWorkerRpcClient,
} from "../../../../../shared/frontend/js/modules/worker-rpc.js";

export const GIS_GEOMETRY_TIMEOUT_MS = 60_000;

const text = value => String(value ?? '');

export function createGisGeometryValidator({ createWorker, timeoutMs = GIS_GEOMETRY_TIMEOUT_MS }) {
  let rpc = null;

  function ensureRpc() {
    if (rpc) return rpc;
    rpc = createWorkerRpcClient({
      createWorker,
      defaultTimeoutMs: timeoutMs,
      restartOnCrash: true,
    });
    return rpc;
  }

  function dispose() {
    rpc?.stop('disposed');
    rpc = null;
  }

  async function validate(collection, affectedIds = null, options = undefined) {
    const scopedIds = affectedIds
      ? [...new Set([...affectedIds].map(text).filter(Boolean))]
      : null;
    try {
      const overlapAffectedIds = Array.isArray(options?.overlapAffectedIds) && options.overlapAffectedIds.length
        ? [...new Set(options.overlapAffectedIds.map(text).filter(Boolean))] : null;
      const response = await ensureRpc().request('gis.validate', {
        collection,
        affectedIds: scopedIds?.length ? scopedIds : null,
        ...(overlapAffectedIds?.length ? { overlapAffectedIds } : {}),
      }, { timeoutMs, priority: 300 });
      return response.result;
    } catch (error) {
      if (error?.category === WORKER_RPC_ERROR_CATEGORIES.TIMEOUT) dispose();
      throw error;
    }
  }

  return Object.freeze({ dispose, validate, stats: () => rpc?.stats?.() || Object.freeze({ pendingCount: 0, workerActive: false }) });
}

export function createCountryImportMergePlanner({
  clipper,
  clone,
  featureCountryId,
  countryName,
  geometryBounds,
  boundsOverlap,
  normalizeGeometry,
  geometryCoordinates,
  planarArea,
  areaKm2,
  validateCountryCollection,
}) {
  function mergeImportedCountryProperties(existing, imported, geometry) {
    const importedId = text(existing?.id || imported?.id);
    const existingProperties = existing?.properties || {};
    const importedProperties = imported?.properties || {};
    const properties = {
      name: text(existingProperties.name || importedProperties.name || importedId),
    };
    const validFrom = text(existingProperties.validFrom || importedProperties.validFrom);
    const validTo = text(existingProperties.validTo || importedProperties.validTo);
    if (validFrom) properties.validFrom = validFrom;
    if (validTo) properties.validTo = validTo;
    return {
      type: 'Feature',
      id: importedId,
      properties,
      geometry,
    };
  }

  return async function planMerge(currentCountries, importedCountries, strategy) {
    if (!clipper?.union || !clipper?.difference || !clipper?.intersection) throw new Error('국가 병합 연산 엔진을 불러오지 못했습니다.');
    // Only an affected wrapper is written; source geometries remain read-only.
    const current = (currentCountries?.features || []).map(feature => ({ ...feature }));
    const imported = (clone(importedCountries)?.features || []).map((feature, index) => {
      feature.id = featureCountryId(feature, index);
      return feature;
    });
    const incomingIds = imported.map(feature => text(feature?.id));
    if (typeof sharedCalculationCore.planGisCountryMerge !== 'function') {
      throw Object.assign(new Error('Canonical C++ GIS country merge planner is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
    }
    const identityPlan = sharedCalculationCore.planGisCountryMerge(current.map(feature => text(feature?.id)), incomingIds);
    if (identityPlan.status === 'empty') throw new Error('병합할 국가 객체가 없습니다.');
    if (identityPlan.status === 'invalid-ids') {
      throw new Error('가져온 국가 ID 연결 결과가 비어 있거나 중복되었습니다.');
    }
    if (identityPlan.status !== 'valid') throw new Error('Unknown C++ GIS country merge plan result.');
    const affectedIds = new Set(incomingIds);
    const matched = identityPlan.matched;
    const counts = {
      matched,
      added: imported.length - matched,
      replaced: 0,
      subtracted: 0,
      deleted: 0,
      overlapAreaKm2: 0,
      residualOverlapAreaKm2: 0,
    };
    let result;
    if (typeof sharedCalculationCore.planGisCountryGeometry !== 'function'
        || typeof sharedCalculationCore.gisCountryMergeCanCommit !== 'function') {
      throw Object.assign(new Error('Canonical C++ GIS geometry planner is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
    }
    let importedRawUnion, importedBounds, overlap;
    const incomingBounds = [], remainders = new Map();
    const operations = {
      prepare() {
        importedRawUnion = normalizeGeometry(clipper.union(...imported.map(feature => feature.geometry.coordinates)));
        if (!importedRawUnion) throw new Error('가져온 영토를 결합할 수 없습니다.');
      },
      bounds(index, currentIndex) {
        const existing = current[currentIndex];
        return index >= 0
          ? boundsOverlap(incomingBounds[index] ??= geometryBounds(imported[index].geometry), geometryBounds(existing.geometry))
          : boundsOverlap(geometryBounds(existing.geometry), importedBounds ??= geometryBounds(importedRawUnion));
      },
      intersection(index, currentIndex) {
        const existing = current[currentIndex];
        overlap = index >= 0
          ? normalizeGeometry(clipper.intersection(imported[index].geometry.coordinates, existing.geometry.coordinates))
          : normalizeGeometry(clipper.intersection(existing.geometry.coordinates, importedRawUnion.coordinates));
        return overlap ? planarArea(geometryCoordinates(overlap)) : null;
      },
      area() { return areaKm2(overlap); },
      subtract(index) {
        const remainder = normalizeGeometry(clipper.difference(current[index].geometry.coordinates, importedRawUnion.coordinates));
        remainders.set(index, remainder);
        return !!remainder;
      },
    };

    if (strategy === 'id-replace') {
      counts.replaced = matched;
      const unaffected = identityPlan.unaffected.map(index => current[index]);
      result = [...unaffected];
      result.push(...imported.map((feature, index) => mergeImportedCountryProperties(
        identityPlan.existing[index] < 0 ? undefined : current[identityPlan.existing[index]],
        feature,
        clone(feature.geometry),
      )));
      counts.overlapAreaKm2 = sharedCalculationCore.planGisCountryGeometry(imported.length, identityPlan.unaffected, true, operations).overlapAreaKm2;
      return {
        countriesData: { type: 'FeatureCollection', features: result },
        counts,
        affectedIds: [...affectedIds],
        canCommit: sharedCalculationCore.gisCountryMergeCanCommit(counts.overlapAreaKm2),
      };
    }

    const geometryPlan = sharedCalculationCore.planGisCountryGeometry(imported.length, identityPlan.unaffected, false, operations);
    counts.overlapAreaKm2 = geometryPlan.overlapAreaKm2;
    const donorIds = [];
    result = [];
    const donors = new Map(geometryPlan.donors.map(row => [row.index, row]));
    for (const currentIndex of identityPlan.unaffected) {
      const existing = current[currentIndex];
      const id = text(existing?.id);
      const donor = donors.get(currentIndex);
      if (!donor) {
        result.push(existing);
        continue;
      }
      affectedIds.add(id);
      donorIds.push(id);
      counts.subtracted += 1;
      if (donor.removed) {
        counts.deleted += 1;
        continue;
      }
      existing.geometry = remainders.get(currentIndex);
      result.push(existing);
    }
    for (const [index, incoming] of imported.entries()) {
      const existing = identityPlan.existing[index] < 0 ? undefined : current[identityPlan.existing[index]];
      const geometry = clone(incoming.geometry);
      if (!geometry) throw new Error(`${countryName(incoming)} 영토를 결합할 수 없습니다.`);
      result.push(mergeImportedCountryProperties(existing, incoming, geometry));
    }
    const countriesData = { type: 'FeatureCollection', features: result };
    counts.residualOverlapAreaKm2 = (await validateCountryCollection(countriesData, affectedIds)).overlapAreaKm2;
    return {
      countriesData,
      counts,
      affectedIds: [...affectedIds],
      donorIds,
      transferredGeometry: clone(importedRawUnion),
      canCommit: sharedCalculationCore.gisCountryMergeCanCommit(counts.residualOverlapAreaKm2),
    };
  };
}

export { applyImportedPackageAssets } from "../../../../../shared/frontend/js/modules/project-package-assets.js";

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
