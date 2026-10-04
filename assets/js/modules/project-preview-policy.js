import { BUILTIN_SUBUNIT_REVISION } from './builtin-subunits.js';
import { staticTimelineViews } from './timeline-static-view.js';
export { BUILTIN_SUBUNIT_REVISION } from './builtin-subunits.js';

export const PROJECT_PREVIEW_ALGORITHM_REVISION = 'project-topology-3';
export const PROJECT_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;

function previewEntities(project) {
  const archive = new Map(project.geometries.map(entry => [JSON.stringify([entry.id, entry.version]), entry.geojson]));
  const identities = (project.territorialEntities || project.entityDelta.changed).map(entity => ({ ...entity,
    properties: { ...entity.properties, style: structuredClone(entity.properties.style), metadata: structuredClone(entity.properties.metadata) } }));
  return staticTimelineViews(identities, project.timelineRecords, { get: ref => archive.get(JSON.stringify([ref.id, ref.version])) });
}

export function projectPreviewGeometryRows(project) {
  const entities = previewEntities(project);
  const countries = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
  const removed = project?.entityDelta?.removedIds || [];
  return {
    countries: countries.map(feature => [String(feature.id), feature.geometry]).sort((a, b) => a[0].localeCompare(b[0])),
    removed: removed.map(String).sort(),
    units: entities.filter(feature => !(feature.properties?.entityKind === 'general' && !feature.properties?.parentId)).map(unit => [String(unit.id), unit.properties?.entityKind || '',
      String(unit.properties?.parentId || ''), unit.geometry])
      .sort((a, b) => a[0].localeCompare(b[0])),
  };
}

// The build and startup paths intentionally hash the same JSON representation.
// This is an identity check for derived display data, not a security boundary.
export function geometryFingerprint(geometry) {
  const source = JSON.stringify(geometry ?? null);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

/** Reuse display geometry while always showing the current saved properties. */
export function previewCountriesWithProjectProperties(countries, project) {
  const saved = previewEntities(project).filter(entity => (entity.properties?.entityKind === 'general' && !entity.properties?.parentId));
  if (!saved.length) return countries;
  const properties = new Map(saved.map(feature => [String(feature.id), feature.properties || {}]));
  return { ...countries, features: countries.features.map(feature => properties.has(String(feature.id))
    ? { ...feature, properties: properties.get(String(feature.id)) } : feature) };
}

function unitsMatchDefault(units, expected) {
  if (!Array.isArray(units) || units.length !== Object.keys(expected).length) return false;
  const seen = new Set();
  for (const unit of units) {
    const id = String(unit?.id || '');
    const row = expected[id];
    if (!row || seen.has(id) || !(unit?.properties?.entityKind === 'general' && !!unit?.properties?.parentId)
      || String(unit?.properties?.parentId || '') !== row.parentId
      || unit?.properties?.metadata?.builtinSubunit?.revision !== BUILTIN_SUBUNIT_REVISION
      || geometryFingerprint(unit.geometry) !== row.geometry) return false;
    seen.add(id);
  }
  return true;
}

/** Only an exact canonical default-classification match may use the shipped preview. */
export function matchesDefaultPreview(project, baseline) {
  if (!project) return true;
  if (!baseline?.sourceSha256 || !baseline?.defaultClassification) return false;
  const expected = baseline.defaultClassification;
  const entities = previewEntities(project);
  if (!unitsMatchDefault(entities.filter(feature => !(feature.properties?.entityKind === 'general' && !feature.properties?.parentId)), expected.units || {})) return false;
  const expectedCountries = expected.countries || {};
  if (project.format === 'pandolab-autosave-delta') {
    const changed = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
    const removed = project.entityDelta?.removedIds || [];
    if (changed.length < Object.keys(expected.changed || {}).length
      || removed.length !== (expected.removedIds || []).length) return false;
    const removedSet = new Set(removed.map(String));
    if (removedSet.size !== removed.length || (expected.removedIds || []).some(id => !removedSet.has(id))) return false;
    const seen = new Set();
    for (const feature of changed) {
      const id = String(feature?.id || '');
      if (seen.has(id) || geometryFingerprint(feature.geometry) !== expectedCountries[id]) return false;
      seen.add(id);
    }
    return Object.keys(expected.changed || {}).every(id => seen.has(id));
  }
  const features = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
  if (!features || features.length !== Object.keys(expectedCountries).length) return false;
  const seen = new Set();
  for (const feature of features) {
    const id = String(feature?.id || '');
    if (seen.has(id) || geometryFingerprint(feature.geometry) !== expectedCountries[id]) return false;
    seen.add(id);
  }
  return true;
}

export function previewSourceForProject(project, baseline, cache) {
  if (!project || matchesDefaultPreview(project, baseline)) return { kind: 'default' };
  if (cache?.algorithmRevision === PROJECT_PREVIEW_ALGORITHM_REVISION
    && cache?.baseSourceSha256 === baseline?.sourceSha256
    && cache?.geometryKey && Array.isArray(cache?.countries?.features)
    && Array.isArray(cache?.territorialUnits) && cache?.mesh?.positions) return { kind: 'project', cache };
  return { kind: 'restore' };
}
