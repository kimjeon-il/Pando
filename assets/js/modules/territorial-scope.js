import { normalizePolygonGeometry } from './map-edit-geometry.js';
import { builtinSubunitSourceId } from './builtin-subunits.js';
import { geometryRevision } from './geometry-versions.js';

const polygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const featureFor = (coordinates, entity) => coordinates?.length
  ? { ...entity, geometry: normalizePolygonGeometry({ type: 'MultiPolygon', coordinates }) } : null;

/** Read model only. Its geometry never replaces canonical entity geometry.
 * parentId here is strictly the administrative/spatial hierarchy. Political
 * dependency relations must not participate in scope geometry.
 */
export function createTerritorialScopeResolver({ entityRepository, clipper, getState = () => ({}) }) {
  if (!entityRepository?.list || !entityRepository?.get) {
    throw new TypeError('영역 범위 계산에는 TerritorialEntityRepository가 필요합니다.');
  }
  let sourceEntities = null;
  let scopes = new Map();
  let displaySources = [], displayValues = [], displayById = new Map();
  function refresh() {
    const entities = entityRepository.list();
    if (sourceEntities === entities) return;
    sourceEntities = entities;
    scopes = new Map();
  }
  function members(entityId) {
    return entityRepository.descendants(entityId, { kind: 'general' });
  }

  function scope(entityId) {
    refresh();
    const id = String(entityId);
    if (scopes.has(id)) return scopes.get(id);
    const entity = entityRepository.get(id);
    const descendants = entity?.properties.entityKind === 'general' ? members(id) : [];
    const base = polygons(entity?.geometry);
    let extent = entity, extra = null;
    if (descendants.length && base.length) {
      const engine = clipper();
      if (!engine?.union || !engine?.difference) throw new Error('객체 표시 범위 계산에 polygonClipping이 필요합니다.');
      const combined = engine.union(base, ...descendants.map(unit => polygons(unit.geometry)).filter(value => value.length));
      extent = featureFor(combined, entity) || entity;
      extra = featureFor(engine.difference(combined, base), entity);
    }
    const result = Object.freeze({ entity, members: descendants, extent, extra });
    scopes.set(id, result);
    return result;
  }

  // One read projection for paint, labels and emphasis. Preview
  // coordinates never enter the editable Store or hierarchy indexes.
  function displayEntities() {
    const state = getState();
    const entities = entityRepository.list();
    const preview = state.countryVisualPhase === 'preview';
    const sources = [entities, preview, state.auditPreviewCountries, state.auditPreviewTerritorialUnits, state.auditPreviewGeometryReferences];
    if (state.auditPreviewGeometryReferences) sources.push(entities.map(entity => geometryRevision(entity.geometry)).join(','));
    if (sources.every((source, index) => source === displaySources[index])) return displayValues;
    displaySources = sources;
    const previews = new Map(preview ? [
      ...(state.auditPreviewCountries?.features || []), ...(state.auditPreviewTerritorialUnits || []),
    ].map(feature => [String(feature.id), feature.geometry]) : []);
    displayValues = preview ? entities.map(entity => {
      // Only the shape used to derive this preview may reuse its coordinates.
      // Metadata changes retain preview; edits/undo/imports use exact geometry.
      const reference = state.auditPreviewGeometryReferences?.get(String(entity.id));
      if (state.auditPreviewGeometryReferences
        && (reference?.geometry !== entity.geometry || reference.revision !== geometryRevision(entity.geometry))) return entity;
      // The source ID belongs to the built-in asset, not the editable object.
      const geometry = previews.get(String(entity.id)) || previews.get(builtinSubunitSourceId(entity));
      return geometry && geometry !== entity.geometry ? { ...entity, geometry } : entity;
    }) : entities;
    displayById = new Map(displayValues.map(entity => [String(entity.id), entity]));
    return displayValues;
  }
  function displayFeature(value) {
    displayEntities();
    return displayById.get(String(typeof value === 'object' ? value?.id : value)) || null;
  }
  return Object.freeze({ members, scope, displayEntities, displayFeature });
}
