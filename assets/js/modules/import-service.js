import {
  EXCHANGE_TARGETS,
  createExchangeAdapterRegistry,
  normalizeExchangeTarget,
} from './exchange-adapter-registry.js';
import { TERRITORIAL_IMPORT_TARGETS } from './import-plan.js';

export const GIS_GEOMETRY_TIMEOUT_MS = 60_000;

const text = value => String(value ?? '');

export function createGisGeometryValidator({ createWorker, timeoutMs = GIS_GEOMETRY_TIMEOUT_MS }) {
  let worker = null;
  let sequence = 0;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeoutId);
      request.reject(error);
    }
    pending.clear();
  }

  function dispose() {
    worker?.terminate();
    worker = null;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = event => {
      const request = pending.get(event.data?.id);
      if (!request) return;
      pending.delete(event.data.id);
      clearTimeout(request.timeoutId);
      if (event.data.ok) request.resolve(event.data);
      else request.reject(new Error(event.data.error || 'GIS 지오메트리 검증에 실패했습니다.'));
    };
    worker.onerror = event => {
      rejectPending(new Error(event.message || 'GIS 지오메트리 Worker 오류'));
      dispose();
    };
    return worker;
  }

  function validate(collection, affectedIds = null) {
    return new Promise((resolve, reject) => {
      const activeWorker = ensureWorker();
      const id = ++sequence;
      const scopedIds = affectedIds
        ? [...new Set([...affectedIds].map(text).filter(Boolean))]
        : null;
      const timeoutId = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('GIS 국가 경계 검사가 제한 시간 안에 끝나지 않았습니다.'));
        rejectPending(new Error('GIS 국가 경계 Worker가 응답하지 않아 검사를 중단했습니다.'));
        dispose();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeoutId });
      activeWorker.postMessage({
        id,
        action: 'validate',
        collection,
        affectedIds: scopedIds?.length ? scopedIds : null,
      });
    });
  }

  return Object.freeze({ dispose, validate });
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
    const current = (currentCountries?.features || []).map(feature => clone(feature));
    const imported = (clone(importedCountries)?.features || []).map((feature, index) => {
      feature.id = featureCountryId(feature, index);
      return feature;
    });
    if (!imported.length) throw new Error('병합할 국가 객체가 없습니다.');
    const incomingIds = imported.map(feature => text(feature?.id));
    if (incomingIds.some(id => !id) || new Set(incomingIds).size !== incomingIds.length) {
      throw new Error('가져온 국가 ID 연결 결과가 비어 있거나 중복되었습니다.');
    }

    const currentById = new Map(current.map(feature => [text(feature?.id), feature]));
    const importedById = new Map(imported.map(feature => [text(feature?.id), feature]));
    const importedIds = new Set(importedById.keys());
    const affectedIds = new Set(importedIds);
    const matched = [...importedIds].filter(id => currentById.has(id)).length;
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

    if (strategy === 'id-replace') {
      counts.replaced = matched;
      result = current.filter(feature => !importedIds.has(text(feature?.id)));
      result.push(...imported.map(feature => mergeImportedCountryProperties(
        currentById.get(text(feature?.id)),
        feature,
        clone(feature.geometry),
      )));
      const unaffected = result.filter(feature => !importedIds.has(text(feature?.id)));
      for (const incoming of imported) {
        for (const other of unaffected) {
          if (!boundsOverlap(geometryBounds(incoming.geometry), geometryBounds(other.geometry))) continue;
          const overlap = normalizeGeometry(clipper.intersection(incoming.geometry.coordinates, other.geometry.coordinates));
          if (!overlap || planarArea(geometryCoordinates(overlap)) <= 1e-8) continue;
          counts.overlapAreaKm2 += areaKm2(overlap);
        }
      }
      return {
        countriesData: { type: 'FeatureCollection', features: result },
        counts,
        affectedIds: [...affectedIds],
        canCommit: counts.overlapAreaKm2 <= 0.001,
      };
    }

    const importedRawUnion = normalizeGeometry(clipper.union(...imported.map(feature => feature.geometry.coordinates)));
    if (!importedRawUnion) throw new Error('가져온 영토를 결합할 수 없습니다.');
    result = [];
    for (const existing of current) {
      const id = text(existing?.id);
      if (importedIds.has(id)) continue;
      if (!boundsOverlap(geometryBounds(existing.geometry), geometryBounds(importedRawUnion))) {
        result.push(existing);
        continue;
      }
      const overlap = normalizeGeometry(clipper.intersection(existing.geometry.coordinates, importedRawUnion.coordinates));
      if (!overlap || planarArea(geometryCoordinates(overlap)) <= 1e-8) {
        result.push(existing);
        continue;
      }
      counts.overlapAreaKm2 += areaKm2(overlap);
      const remainder = normalizeGeometry(clipper.difference(existing.geometry.coordinates, importedRawUnion.coordinates));
      affectedIds.add(id);
      counts.subtracted += 1;
      if (!remainder) {
        counts.deleted += 1;
        continue;
      }
      existing.geometry = remainder;
      result.push(existing);
    }
    for (const incoming of imported) {
      const id = text(incoming?.id);
      const existing = currentById.get(id);
      const geometry = clone(incoming.geometry);
      if (!geometry) throw new Error(`${countryName(incoming)} 영토를 결합할 수 없습니다.`);
      result.push(mergeImportedCountryProperties(existing, incoming, geometry));
    }
    const countriesData = { type: 'FeatureCollection', features: result };
    counts.residualOverlapAreaKm2 = (await validateCountryCollection(countriesData, affectedIds)).overlapAreaKm2;
    return { countriesData, counts, affectedIds: [...affectedIds], canCommit: counts.residualOverlapAreaKm2 <= 0.001 };
  };
}

export function applyImportedPackageAssets(metadata, overrides) {
  const output = structuredClone(overrides || {});
  for (const asset of metadata?.countryAssets || []) {
    if (!asset?.countryId || !asset?.base64) continue;
    const id = text(asset.countryId);
    output[id] = { ...(output[id] || {}), flagDataUrl: `data:${asset.mimeType || 'application/octet-stream'};base64,${asset.base64}` };
  }
  return output;
}

export function importedCountryOverrides(collection) {
  void collection;
  return {};
}

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

function createMaterializerExchangeRegistry(materializers) {
  const territorialImport = (result, context) => materializers.territorial(result, context.fileName || '벡터 파일');
  const geoJsonImport = (result, context) => {
    const target = result.targetType === EXCHANGE_TARGETS.DISTRIBUTION
      ? result.distributionType
      : result.targetType;
    return materializers.geoJson(context.file, {
      parsed: result.collection,
      target,
      mapping: {
        nameField: result.mapping?.nameField || '',
        countryField: result.mapping?.countryField || '',
        parentField: result.mapping?.parentField || '',
        levelField: result.mapping?.levelField || '',
      },
    });
  };
  return createExchangeAdapterRegistry({
    adapters: {
      [EXCHANGE_TARGETS.PROJECT]: { importPayload: result => materializers.replaceProject(result) },
      [EXCHANGE_TARGETS.TERRITORY]: { importPayload: territorialImport },
      [EXCHANGE_TARGETS.ADMINISTRATIVE]: { importPayload: territorialImport },
      [EXCHANGE_TARGETS.REGION]: { importPayload: territorialImport },
      [EXCHANGE_TARGETS.DISTRIBUTION]: { importPayload: geoJsonImport },
      [EXCHANGE_TARGETS.GENERIC]: { importPayload: geoJsonImport },
    },
  });
}

export function createImportService({
  openImportWizard,
  getWizardOptions,
  validateStructuredGeometry,
  featureCountryId,
  validateCountryCollection,
  getCurrentCountries,
  materializeCountryImport = null,
  planCountryMerge,
  materializers,
  exchangeRegistry = null,
  onStage = () => {},
}) {
  const adapters = exchangeRegistry || createMaterializerExchangeRegistry(materializers);

  async function openFiles(files, { targetType = '' } = {}) {
    if (!files?.length) return { status: 'empty' };
    const result = await openImportWizard(files, {
      targetType,
      ...getWizardOptions(),
    });
    const resolvedTarget = normalizeExchangeTarget(result.importPlan?.targetType || result.targetType);
    const context = { file: files[0], fileName: files[0]?.name || '벡터 파일' };

    if (result.sourceKind === 'project' || result.importPlan?.sourceKind === 'project') {
      await adapters.importPayload(EXCHANGE_TARGETS.PROJECT, result, context);
      return { status: 'project-replaced', result };
    }
    if (Object.values(TERRITORIAL_IMPORT_TARGETS).includes(resolvedTarget)) {
      await adapters.importPayload(resolvedTarget, result, context);
      return { status: 'territorial-imported', result };
    }
    if (![EXCHANGE_TARGETS.COUNTRY, EXCHANGE_TARGETS.PROJECT].includes(resolvedTarget)) {
      await adapters.importPayload(resolvedTarget, result, context);
      return { status: 'object-imported', result };
    }

    if (resolvedTarget === EXCHANGE_TARGETS.COUNTRY && typeof materializeCountryImport === 'function') {
      result.countriesData = materializeCountryImport(result.countriesData, {
        manualMappings: result.identityMappings || {},
        allowImplicitNew: result.openMode === 'replace',
      });
    }

    onStage('국가 경계 확인 중…');
    const structuredIssues = (result.countriesData?.features || []).flatMap(validateStructuredGeometry);
    if (structuredIssues.length) throw new Error(`가져온 geometry가 올바르지 않습니다. ${structuredIssues[0].message}`);
    const importedFeatures = result.countriesData?.features || [];
    const importedOverlapAreaKm2 = (await validateCountryCollection(
      result.countriesData,
      importedFeatures.map(featureCountryId),
    )).overlapAreaKm2;
    if (importedOverlapAreaKm2 > 0.001) {
      throw new Error(`가져온 레이어 안에서 서로 다른 국가가 ${Math.round(importedOverlapAreaKm2).toLocaleString()} km² 겹칩니다.`);
    }
    if (result.openMode === 'replace') {
      await materializers.replaceProject(result);
      return { status: 'countries-replaced', result };
    }
    const plan = await planCountryMerge(getCurrentCountries(), result.countriesData, result.mergeStrategy);
    if (!plan.canCommit) {
      throw new Error(plan.counts.residualOverlapAreaKm2 > 0.001
        ? '자동 차감 후에도 국가 간 중첩이 남아 가져올 수 없습니다.'
        : 'ID 기준 교체 후 다른 국가와 영토가 겹쳐 가져올 수 없습니다.');
    }
    await materializers.mergeCountries(result, plan);
    return { status: 'countries-merged', result, plan };
  }

  return Object.freeze({ openFiles, exchangeRegistry: adapters });
}
