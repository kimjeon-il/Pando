import { createDocumentMutationRunner } from './document-mutation-runner.js';
import { normalizeTemporalInterval } from './temporal.js';
import { validateSubunitParentChanges } from './territorial-scope.js';
import {
  TERRITORIAL_UNIT_TYPES,
  runTerritorialTransaction,
  validateTerritorialRelations,
} from './territorial-units.js';

const text = value => String(value ?? '').trim();

export function createTerritorialApplicationService({
  entityRepository,
  entityStore,
  commandPipeline,
}) {
  if (!entityStore) throw new TypeError('영역 애플리케이션 서비스에는 엔티티 저장소가 필요합니다.');
  const mutateDocument = createDocumentMutationRunner({ commandPipeline });
  const country = id => {
    const feature = entityRepository.get(id);
    return feature?.properties?.unitType === TERRITORIAL_UNIT_TYPES.COUNTRY ? feature : null;
  };
  const unit = (type, id) => {
    const feature = entityRepository.get(id);
    return feature?.properties?.unitType === type && type !== TERRITORIAL_UNIT_TYPES.COUNTRY ? feature : null;
  };

  function canDelete(type, id) {
    const key = text(id);
    const feature = type === TERRITORIAL_UNIT_TYPES.COUNTRY ? country(key) : unit(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (isLocked(type, key)) return { ok: false, code: 'locked', unit: feature };
    const children = entityRepository.children(key);
    if (children.length) return { ok: false, code: 'has-children', unit: feature, children };
    return { ok: true, unit: feature, children: [] };
  }

  function isLocked(type, id) {
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) return !!country(id) && entityStore.isLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, id);
    return unit(type, id)?.properties?.locked === true;
  }

  function updateMetadata(type, id, field, value) {
    const key = text(id);
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const feature = country(key);
      if (!feature) return { ok: false, code: 'not-found' };
      if (field === 'parentId' || field === 'sovereignId' || field === 'unitType') {
        return { ok: false, code: 'unsupported-relation-field', unit: feature };
      }
      const currentValue = field === 'color'
        ? text(feature.properties?.style?.color)
        : field === 'capital' || field === 'flagDataUrl'
          ? feature.properties?.metadata?.[field]
          : feature.properties?.[field];
      const hasExplicitValue = field === 'flagDataUrl'
        ? entityStore.hasField(TERRITORIAL_UNIT_TYPES.COUNTRY, key, field)
        : currentValue !== undefined;
      if (currentValue === value && (value !== undefined || !hasExplicitValue)) return { ok: true, changed: false, unit: feature };
      mutateDocument({ type: 'country-metadata', affectedIds: [key] }, () => {
        entityStore.setField(TERRITORIAL_UNIT_TYPES.COUNTRY, key, field, value);
      }, { renderDirty: { domain: 'country', change: 'metadata' } });
      return { ok: true, changed: true, unit: entityRepository.get(key) };
    }
    const feature = unit(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (feature.properties?.locked === true && field !== 'locked') return { ok: false, code: 'locked', unit: feature };
    if (field === 'parentId' || field === 'sovereignId' || field === 'unitType') {
      return { ok: false, code: 'unsupported-relation-field', unit: feature };
    }
    let nextValue = value;
    if (field === 'validFrom' || field === 'validTo') {
      try {
        const interval = normalizeTemporalInterval(
          field === 'validFrom' ? value : feature.properties?.validFrom,
          field === 'validTo' ? value : feature.properties?.validTo,
        );
        nextValue = interval[field];
      } catch (error) {
        return { ok: false, code: 'invalid-temporal', issues: [String(error?.message || error)], unit: feature };
      }
    }
    const currentValue = field === 'color' ? text(feature.properties?.style?.color) : feature.properties?.[field];
    if (currentValue === nextValue) return { ok: true, changed: false, unit: feature };
    mutateDocument({ type: 'territorial-metadata', affectedIds: [key] }, () => {
      entityStore.setField(type, key, field, nextValue);
    }, { renderDirty: { domain: 'territorial', change: 'metadata' } });
    return { ok: true, changed: true, unit: entityRepository.get(key) };
  }

  function changeAdministrativeParent(type, id, parentId, { validateCandidate = null } = {}) {
    const key = text(id);
    const feature = unit(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (feature.properties?.locked === true) return { ok: false, code: 'locked', unit: feature };
    if (type !== TERRITORIAL_UNIT_TYPES.SUBUNIT) {
      return { ok: false, code: 'unsupported-parent-type', unit: feature };
    }
    const nextParentId = text(parentId);
    if (text(feature.properties?.parentId) === nextParentId) return { ok: true, changed: false, unit: feature };

    const previousUnits = entityRepository.list()
      .filter(candidate => candidate.properties?.unitType !== TERRITORIAL_UNIT_TYPES.COUNTRY);
    const candidateUnits = previousUnits.map(candidate => String(candidate.id) === key
      ? { ...candidate, properties: { ...candidate.properties, parentId: nextParentId } }
      : candidate);
    const validation = validateSubunitParentChanges(previousUnits, candidateUnits, candidateId => !!country(candidateId));
    if (!validation.ok) return { ok: false, code: 'invalid-parent', issues: validation.issues, unit: feature };
    if (typeof validateCandidate === 'function') {
      try {
        const extraValidation = validateCandidate({ feature, previousUnits, candidateUnits, parentId: nextParentId });
        if (extraValidation === false || extraValidation?.ok === false) {
          return {
            ok: false,
            code: 'invalid-parent-geometry',
            issues: extraValidation?.issues || [extraValidation?.message || '상위 단위 변경 조건을 만족하지 않습니다.'],
            unit: feature,
          };
        }
      } catch (error) {
        return { ok: false, code: 'invalid-parent-geometry', issues: [String(error?.message || error)], unit: feature };
      }
    }

    mutateDocument({ type: 'territorial-parent', affectedIds: [key] }, () => {
      entityStore.setField(type, key, 'parentId', nextParentId);
    }, { renderDirty: { domain: 'territorial', change: 'structure' } });
    return { ok: true, changed: true, unit: entityRepository.get(key) };
  }

  function changeAdministrativeCountry(type, id, countryId) {
    const key = text(id);
    const feature = unit(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (feature.properties?.locked === true) return { ok: false, code: 'locked', unit: feature };
    const nextCountryId = text(countryId);
    if (text(feature.properties?.sovereignId) === nextCountryId) return { ok: true, changed: false, unit: feature };
    if (type === TERRITORIAL_UNIT_TYPES.SUBUNIT) {
      return { ok: false, code: 'requires-geometry-transfer', unit: feature };
    }
    if (type !== TERRITORIAL_UNIT_TYPES.REGION) {
      return { ok: false, code: 'unsupported-country-type', unit: feature };
    }
    if (nextCountryId && !country(nextCountryId)) {
      return { ok: false, code: 'invalid-country', issues: [`${key}의 소속 국가 ${nextCountryId}이 존재하지 않습니다.`], unit: feature };
    }

    mutateDocument({ type: 'territorial-country-membership', affectedIds: [key] }, () => {
      entityStore.setField(type, key, 'sovereignId', nextCountryId);
    }, { renderDirty: { domain: 'territorial', change: 'structure' } });
    return { ok: true, changed: true, unit: entityRepository.get(key) };
  }

  function replaceUnits(units, { type = 'territorial-metadata', affectedIds = [] } = {}) {
    const parentValidation = validateSubunitParentChanges(entityRepository.list(), units, id => !!country(id));
    if (!parentValidation.ok) throw new Error(parentValidation.issues[0]);
    if (JSON.stringify(entityRepository.list().filter(feature => feature?.properties?.unitType !== TERRITORIAL_UNIT_TYPES.COUNTRY)) === JSON.stringify(units)) {
      return { ok: true, changed: false };
    }
    mutateDocument({ type, affectedIds: affectedIds.map(text).filter(Boolean) }, () => {
      entityStore.replaceCollections({ units });
    }, { renderDirty: { domain: 'territorial', change: 'structure' } });
    return { ok: true, changed: true };
  }

  function setColorBatch(items, color, { history = {} } = {}) {
    const requested = (items || []).map(item => ({ type: text(item?.type), id: text(item?.id) }))
      .filter(item => item.type && item.id);
    if (!requested.length) return { ok: true, changed: false, units: [] };

    const units = [];
    for (const item of requested) {
      const feature = item.type === TERRITORIAL_UNIT_TYPES.COUNTRY
        ? country(item.id)
        : unit(item.type, item.id);
      if (!feature) return { ok: false, code: 'not-found', id: item.id, type: item.type };
      units.push(feature);
    }
    const changed = requested.filter((item, index) => units[index].properties?.style?.color !== color);
    if (!changed.length) return { ok: true, changed: false, units };

    mutateDocument(
      {
        ...history,
        type: history.type || 'territorial-color-batch',
        affectedIds: changed.map(item => item.id),
      },
      () => {
        for (const item of changed) {
          if (item.type === TERRITORIAL_UNIT_TYPES.COUNTRY) entityStore.setField(TERRITORIAL_UNIT_TYPES.COUNTRY, item.id, 'color', color);
          else entityStore.setField(item.type, item.id, 'color', color);
        }
      },
      { renderDirty: { domain: 'territorial', change: 'metadata' } },
    );
    return { ok: true, changed: true, units: requested.map(item => entityRepository.get(item.id)).filter(Boolean) };
  }

  function setLockedBatch(items, locked, { history = {} } = {}) {
    const next = !!locked;
    const requested = (items || []).map(item => ({ type: text(item?.type), id: text(item?.id) }))
      .filter(item => item.type && item.id);
    if (!requested.length) return { ok: true, changed: false, units: [] };

    const units = [];
    for (const item of requested) {
      const feature = item.type === TERRITORIAL_UNIT_TYPES.COUNTRY
        ? country(item.id)
        : unit(item.type, item.id);
      if (!feature) return { ok: false, code: 'not-found', id: item.id, type: item.type };
      units.push(feature);
    }
    const changed = requested.filter((item, index) => {
      const feature = units[index];
      return item.type === TERRITORIAL_UNIT_TYPES.COUNTRY
        ? entityStore.isLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, item.id) !== next
        : feature.properties?.locked !== next;
    });
    if (!changed.length) return { ok: true, changed: false, units };

    mutateDocument(
      {
        ...history,
        type: history.type || 'territorial-lock-batch',
        affectedIds: changed.map(item => item.id),
      },
      () => {
        for (const item of changed) {
          if (item.type === TERRITORIAL_UNIT_TYPES.COUNTRY) entityStore.setLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, item.id, next);
          else entityStore.setLocked(item.type, item.id, next);
        }
      },
      { renderDirty: { domain: 'territorial', change: 'metadata' } },
    );
    return { ok: true, changed: true, units: requested.map(item => entityRepository.get(item.id)).filter(Boolean) };
  }

  function setLocked(type, id, locked, { history = {} } = {}) {
    const key = text(id);
    const next = !!locked;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      if (!country(key)) return { ok: false, code: 'not-found' };
      if (entityStore.isLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, key) === next) return { ok: true, changed: false, unit: entityRepository.get(key) };
      mutateDocument(
        { ...history, type: 'country-lock', affectedIds: [key] },
        () => entityStore.setLocked(TERRITORIAL_UNIT_TYPES.COUNTRY, key, next),
        { renderDirty: { domain: 'country', change: 'metadata' } },
      );
      return { ok: true, changed: true, unit: entityRepository.get(key) };
    }
    const feature = unit(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (feature.properties?.locked === next) return { ok: true, changed: false, unit: feature };
    mutateDocument(
      { ...history, type: 'territorial-lock', affectedIds: [key] },
      () => entityStore.setLocked(type, key, next),
      { renderDirty: { domain: 'territorial', change: 'metadata' } },
    );
    return { ok: true, changed: true, unit: entityRepository.get(key) };
  }

  return Object.freeze({
    canDelete,
    isLocked,
    updateMetadata,
    changeAdministrativeParent,
    changeAdministrativeCountry,
    replaceUnits,
    setColorBatch,
    setLocked,
    setLockedBatch,
    runGeometryTransaction: options => runTerritorialTransaction(options),
    validateRelations: (units, options) => validateTerritorialRelations(units, options),
  });
}
