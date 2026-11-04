import { normalizeClippedPolygonGeometry } from './map-edit-geometry.js';
import { geometryRevisionKey } from './geometry-versions.js';

const polygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const featureFor = (coordinates, entity, onPrecisionDiscard) => {
  if (!coordinates?.length) return null;
  const geometry = normalizeClippedPolygonGeometry({ type: 'MultiPolygon', coordinates }, { onPrecisionDiscard });
  return geometry ? { ...entity, geometry } : null;
};

/** Read model only. Its geometry never replaces canonical entity geometry.
 * parentId here is strictly the administrative/spatial hierarchy. Political
 * dependency relations must not participate in scope geometry.
 */
export function createTerritorialScopeResolver({ entityRepository, clipper }) {
  if (!entityRepository?.list || !entityRepository?.get) {
    throw new TypeError('영역 범위 계산에는 TerritorialEntityRepository가 필요합니다.');
  }
  let sourceEntities = null;
  const scopes = new Map();
  let displayValues = null, displayById = new Map();
  function refresh() {
    const entities = entityRepository.list();
    if (sourceEntities === entities) return;
    sourceEntities = entities;
    const ids = new Set(entities.map(entity => String(entity.id)));
    for (const id of scopes.keys()) if (!ids.has(id)) scopes.delete(id);
  }
  function members(entityId) {
    return entityRepository.descendants(entityId, { kind: 'general' });
  }

  function scope(entityId) {
    refresh();
    const id = String(entityId);
    const entity = entityRepository.get(id);
    const descendants = entity?.properties.entityKind === 'general' ? members(id) : [];
    const signature = [geometryRevisionKey(entity?.geometry), ...descendants.map(unit => `${unit.id}:${geometryRevisionKey(unit.geometry)}`)].join('|');
    const previous = scopes.get(id);
    if (previous?.signature === signature) {
      if (previous.result.entity === entity && descendants.every((unit, index) => unit === previous.result.members[index])) return previous.result;
      const rebind = feature => feature ? { ...entity, geometry: feature.geometry } : null;
      const result = Object.freeze({ entity, members: descendants,
        extent: previous.result.extent === previous.result.entity ? entity : rebind(previous.result.extent), extra: rebind(previous.result.extra),
        precisionDiscards: previous.result.precisionDiscards });
      scopes.set(id, { signature, result });
      return result;
    }
    const base = polygons(entity?.geometry);
    let extent = entity, extra = null;
    const precisionDiscards = [];
    if (descendants.length && base.length) {
      const engine = clipper();
      if (!engine?.union || !engine?.difference) throw new Error('객체 표시 범위 계산에 polygonClipping이 필요합니다.');
      const combined = engine.union(base, ...descendants.map(unit => polygons(unit.geometry)).filter(value => value.length));
      extent = featureFor(combined, entity, item => precisionDiscards.push(Object.freeze({ operation: 'union', ...item }))) || entity;
      extra = featureFor(engine.difference(combined, base), entity, item => precisionDiscards.push(Object.freeze({ operation: 'difference', ...item })));
    }
    const result = Object.freeze({ entity, members: descendants, extent, extra, precisionDiscards: Object.freeze(precisionDiscards) });
    scopes.set(id, { signature, result });
    return result;
  }

  // All presentation consumers share the canonical repository snapshot.
  function displayEntities() {
    const entities = entityRepository.list();
    if (entities !== displayValues) {
      displayValues = entities;
      displayById = new Map(entities.map(entity => [String(entity.id), entity]));
    }
    return displayValues;
  }
  function displayFeature(value) {
    displayEntities();
    return displayById.get(String(typeof value === 'object' ? value?.id : value)) || null;
  }
  return Object.freeze({ members, scope, displayEntities, displayFeature });
}
