import { TERRITORIAL_UNIT_TYPES, normalizeTerritorialEntities, normalizeTerritorialFeature } from './territorial-units.js';
import { normalizeColorValue } from './color-adapter.js';

const text = value => String(value ?? '').trim();
const types = new Set(Object.values(TERRITORIAL_UNIT_TYPES));

/** Sole writer of the unified Feature collection, including country metadata. */
export function createTerritorialEntityStore({ getState, onEntitiesReplaced = () => {} } = {}) {
  if (typeof getState !== 'function') throw new TypeError('영역 Store에는 상태 공급자가 필요합니다.');
  let cached = null;
  let staging = null;
  const state = () => {
    const value = getState();
    if (!Array.isArray(value?.territorialEntities)) throw new TypeError('territorialEntities 배열이 필요합니다.');
    return staging?.state || value;
  };
  function normalize(entities, unchanged) {
    if (!staging) return normalizeTerritorialEntities(entities, { validatedUnchanged: unchanged, cloneGeometry: geometry => geometry });
    const ids = new Set();
    return entities.map(entity => {
      const next = unchanged?.has(entity) ? entity : normalizeTerritorialFeature(entity, { cloneGeometry: geometry => geometry });
      if (!next || ids.has(next.id)) throw new Error('영역 변경 ID 또는 형식이 올바르지 않습니다.');
      ids.add(next.id);
      return next;
    });
  }
  // Synchronous multi-entity edits have one validation/publication boundary.
  // Removed country anchors remain available to dependent-edit calculations only
  // inside the transaction. They never reach the published collection.
  function transaction(apply) {
    if (typeof apply !== 'function') throw new TypeError('영역 transaction 콜백이 필요합니다.');
    if (staging) return apply();
    const current = state();
    const previous = current.territorialEntities;
    staging = { state: { ...current, territorialEntities: previous }, removed: new Set() };
    try {
      const result = apply();
      if (result?.then) throw new TypeError('영역 transaction은 비동기 계산을 포함할 수 없습니다.');
      const pending = staging;
      const next = normalizeTerritorialEntities(pending.state.territorialEntities.filter(entity => !pending.removed.has(entity.id)), {
        validatedUnchanged: new Set(previous), cloneGeometry: geometry => geometry });
      staging = null;
      publish(next, previous);
      return result;
    } finally {
      staging = null;
      cached = null;
    }
  }
  function snapshot() {
    const current = state();
    if (cached?.source === current.territorialEntities && cached.revision === current.stateRevision) return cached.entities;
    const entities = current.territorialEntities.map(feature => ({ ...feature,
      properties: structuredClone(feature.properties), geometry: feature.geometry }));
    cached = { source: current.territorialEntities, revision: current.stateRevision, entities };
    return entities;
  }
  const entity = (type, id) => state().territorialEntities.find(feature => text(feature.id) === text(id)
    && feature.properties.unitType === type);
  function hasField(type, id, field) {
    const properties = entity(type, id)?.properties;
    if (!properties) return false;
    return Object.hasOwn(field === 'color' ? properties.style : ['capital', 'flagDataUrl'].includes(field)
      ? properties.metadata : properties, field === 'color' ? 'color' : field);
  }
  function setField(type, id, field, value) {
    const feature = entity(type, id);
    if (!feature) return false;
    const properties = { ...feature.properties };
    if (field === 'color') {
      properties.style = { ...properties.style };
      if (value) properties.style.color = normalizeColorValue(value);
      else delete properties.style.color;
    } else if (['capital', 'flagDataUrl'].includes(field)) {
      properties.metadata = { ...properties.metadata };
      if (value === undefined) delete properties.metadata[field];
      else properties.metadata[field] = value;
    } else {
      if (!Object.hasOwn(properties, field)) throw new Error(`지원하지 않는 영역 필드: ${field}`);
      properties[field] = value;
    }
    applyChanges({ features: [{ ...feature, properties }] });
    return true;
  }
  function replaceEntities(entities, { types: requestedTypes = [...types] } = {}) {
    if (!Array.isArray(entities)) throw new TypeError('영역 엔티티 배열이 필요합니다.');
    const selectedTypes = new Set(requestedTypes);
    if ([...selectedTypes].some(type => !types.has(type))) throw new Error('교체할 영역 종류가 올바르지 않습니다.');
    if (entities.some(feature => !selectedTypes.has(feature?.properties?.unitType))) throw new Error('교체 범위 밖의 영역입니다.');
    const previous = state().territorialEntities;
    const incoming = new Set(entities.map(entity => text(entity.id)));
    const unchanged = previous.filter(feature => !selectedTypes.has(feature.properties.unitType)
      && !(staging?.removed.has(feature.id) && incoming.has(feature.id)));
    if (staging) for (const id of incoming) staging.removed.delete(id);
    const next = normalize([...unchanged, ...entities], new Set(unchanged));
    publish(next, previous);
    return snapshot();
  }
  function publish(next, previous) {
    if (staging) {
      staging.state.territorialEntities = next;
      cached = null;
      return;
    }
    const before = new Map(previous.map(feature => [text(feature.id), feature]));
    const after = new Map(next.map(feature => [text(feature.id), feature]));
    const changedIds = new Set([...before.keys(), ...after.keys()].filter(id => before.get(id) !== after.get(id)));
    state().territorialEntities = next;
    cached = null;
    state().historyDirtyEntityIds ||= new Set();
    for (const id of changedIds) state().historyDirtyEntityIds.add(id);
    onEntitiesReplaced(next, { changedIds, previous });
  }
  function applyChanges({ features = [], removedIds = [] }) {
    const previous = state().territorialEntities;
    const removed = new Set(removedIds.map(text));
    const changes = new Map();
    for (const feature of features) {
      const id = text(feature?.id);
      if (!id || changes.has(id) || removed.has(id)) throw new Error(`영역 변경 ID가 올바르지 않습니다: ${id}`);
      changes.set(id, feature);
    }
    if (staging) {
      for (const entity of previous) if (removed.has(entity.id) && entity.properties.unitType === 'country') {
        staging.removed.add(entity.id);
        removed.delete(entity.id);
      }
      for (const id of changes.keys()) staging.removed.delete(id);
    }
    const unchanged = new Set();
    const candidate = previous.filter(feature => !removed.has(text(feature.id))).map(feature => {
      const replacement = changes.get(text(feature.id));
      changes.delete(text(feature.id));
      if (!replacement) unchanged.add(feature);
      return replacement || feature;
    }).concat([...changes.values()]);
    const next = normalize(candidate, unchanged);
    publish(next, previous);
    return snapshot();
  }
  function appendEntities(entities, options = {}) {
    if (!Array.isArray(entities)) throw new TypeError('추가할 영역 배열이 필요합니다.');
    const ids = new Set(state().territorialEntities.map(feature => text(feature.id)));
    for (const feature of entities) {
      const id = text(feature?.id);
      if (!id || ids.has(id)) throw new Error(`영역 엔티티 ID가 중복되었거나 비어 있습니다: ${id}`);
      ids.add(id);
    }
    if (!entities.length) return [];
    const added = new Set(entities.map(feature => text(feature.id)));
    return applyChanges({ features: entities }, options).filter(feature => added.has(text(feature.id)));
  }
  function removeEntities(refs, options = {}) {
    const deleted = snapshot().filter(feature => refs.some(ref => text(ref.id) === text(feature.id)
      && ref.type === feature.properties.unitType));
    if (deleted.length) applyChanges({ removedIds: deleted.map(feature => feature.id) }, options);
    return deleted;
  }
  return Object.freeze({ snapshot, setField, hasField, replaceEntities, applyChanges, appendEntities, removeEntities, transaction,
    setLocked: (type, id, locked) => setField(type, id, 'locked', !!locked),
    isLocked: (type, id) => entity(type, id)?.properties.locked === true });
}
