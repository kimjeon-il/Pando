import { createDocumentMutationRunner } from './document-mutation-runner.js';
import { normalizeTemporalInterval } from './temporal.js';
import { validateSubunitParentChanges } from './territorial-scope.js';
import { TERRITORIAL_UNIT_TYPES } from './territorial-units.js';

const text = value => String(value ?? '').trim();

export function createTerritorialApplicationService({
  entityRepository,
  entityStore,
  commandPipeline,
}) {
  if (!entityStore) throw new TypeError('영역 애플리케이션 서비스에는 엔티티 저장소가 필요합니다.');
  const mutateDocument = createDocumentMutationRunner({ commandPipeline });
  const entity = (type, id) => {
    const feature = entityRepository.get(id);
    return feature?.properties?.unitType === type ? feature : null;
  };
  const country = id => entity(TERRITORIAL_UNIT_TYPES.COUNTRY, id);

  function canDelete(type, id) {
    const key = text(id);
    const feature = entity(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (isLocked(type, key)) return { ok: false, code: 'locked', unit: feature };
    const children = entityRepository.children(key);
    if (children.length) return { ok: false, code: 'has-children', unit: feature, children };
    return { ok: true, unit: feature, children: [] };
  }

  function isLocked(type, id) {
    return entity(type, id)?.properties?.locked === true;
  }

  function updateMetadata(type, id, field, value) {
    const key = text(id);
    const feature = entityRepository.get(key);
    if (feature?.properties?.unitType !== type) return { ok: false, code: 'not-found' };
    if (!feature) return { ok: false, code: 'not-found' };
    if (isLocked(type, key)) return { ok: false, code: 'locked', unit: feature };
    if (field === 'parentId' || field === 'associatedCountryId' || field === 'unitType') {
      return { ok: false, code: 'unsupported-relation-field', unit: feature };
    }
    if (!['name', 'notes', 'color', 'capital', 'flagDataUrl', 'validFrom', 'validTo'].includes(field)) {
      return { ok: false, code: 'unsupported-field', unit: feature };
    }
    let nextValue = value;
    if (['name', 'color', 'capital'].includes(field)) nextValue = text(value);
    if (field === 'notes') nextValue = String(value ?? '');
    if (field === 'flagDataUrl' && value !== null && value !== undefined) {
      if (typeof value !== 'string' || !value.trim()) return { ok: false, code: 'invalid-flag', unit: feature };
      nextValue = value.trim();
    }
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
    const currentValue = field === 'color' ? text(feature.properties?.style?.color)
      : ['capital', 'flagDataUrl'].includes(field) ? feature.properties?.metadata?.[field] : feature.properties?.[field];
    const comparable = ['validFrom', 'validTo'].includes(field) ? currentValue ?? null
      : ['name', 'color', 'capital'].includes(field) ? text(currentValue)
      : field === 'notes' ? String(currentValue ?? '') : currentValue;
    if (comparable === nextValue && (nextValue !== undefined || !entityStore.hasField(type, key, field))) return { ok: true, changed: false, unit: feature };
    mutateDocument({ type: 'territorial-metadata', affectedIds: [key] }, () => {
      entityStore.setField(type, key, field, nextValue);
    }, { renderDirty: { domain: 'territorial', change: 'metadata' } });
    return { ok: true, changed: true, unit: entityRepository.get(key) };
  }

  function changeAdministrativeParent(type, id, parentId, { validateCandidate = null } = {}) {
    const key = text(id);
    const feature = entity(type, key);
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
    const feature = entity(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if (feature.properties?.locked === true) return { ok: false, code: 'locked', unit: feature };
    const nextCountryId = text(countryId);
    if (type === TERRITORIAL_UNIT_TYPES.SUBUNIT) {
      return { ok: false, code: 'requires-geometry-transfer', unit: feature };
    }
    if (type !== TERRITORIAL_UNIT_TYPES.REGION) {
      return { ok: false, code: 'unsupported-country-type', unit: feature };
    }
    if (text(feature.properties.associatedCountryId) === nextCountryId) return { ok: true, changed: false, unit: feature };
    if (nextCountryId && !country(nextCountryId)) {
      return { ok: false, code: 'invalid-country', issues: [`${key}의 소속 국가 ${nextCountryId}이 존재하지 않습니다.`], unit: feature };
    }

    mutateDocument({ type: 'territorial-country-membership', affectedIds: [key] }, () => {
      entityStore.setField(type, key, 'associatedCountryId', nextCountryId);
    }, { renderDirty: { domain: 'territorial', change: 'structure' } });
    return { ok: true, changed: true, unit: entityRepository.get(key) };
  }

  function setColorBatch(items, color, { history = {} } = {}) {
    const requested = (items || []).map(item => ({ type: text(item?.type), id: text(item?.id) }))
      .filter(item => item.type && item.id);
    if (!requested.length) return { ok: true, changed: false, units: [] };

    const units = [];
    for (const item of requested) {
      const feature = entity(item.type, item.id);
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
      () => entityStore.transaction(() => {
        for (const item of changed) {
          entityStore.setField(item.type, item.id, 'color', color);
        }
      }),
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
      const feature = entity(item.type, item.id);
      if (!feature) return { ok: false, code: 'not-found', id: item.id, type: item.type };
      units.push(feature);
    }
    const changed = requested.filter((item, index) => {
      const feature = units[index];
      return (feature.properties?.locked === true) !== next;
    });
    if (!changed.length) return { ok: true, changed: false, units };

    mutateDocument(
      {
        ...history,
        type: history.type || 'territorial-lock-batch',
        affectedIds: changed.map(item => item.id),
      },
      () => entityStore.transaction(() => {
        for (const item of changed) {
          entityStore.setLocked(item.type, item.id, next);
        }
      }),
      { renderDirty: { domain: 'territorial', change: 'metadata' } },
    );
    return { ok: true, changed: true, units: requested.map(item => entityRepository.get(item.id)).filter(Boolean) };
  }

  function setLocked(type, id, locked, { history = {} } = {}) {
    const key = text(id);
    const next = !!locked;
    const feature = entity(type, key);
    if (!feature) return { ok: false, code: 'not-found' };
    if ((feature.properties?.locked === true) === next) return { ok: true, changed: false, unit: feature };
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

    setColorBatch,
    setLocked,
    setLockedBatch,
  });
}
