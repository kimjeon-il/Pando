import { BUILTIN_SUBUNIT_REVISION } from './builtin-subunits.js';
export { BUILTIN_SUBUNIT_REVISION } from './builtin-subunits.js';

export const PROJECT_PREVIEW_ALGORITHM_REVISION = 'project-topology-4';
export const PROJECT_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;

function sourceEntities(source) {
  if (!source || !source.project || typeof source.project !== 'object' || Array.isArray(source.project)
    || !Array.isArray(source.territorialViews)) {
    throw Object.assign(new TypeError('Project preview requires the raw stored project and explicit Core territorial views.'),
      { code: 'PL-PREVIEW-SOURCE' });
  }
  if (source.project.format !== 'pandolab-autosave-delta') return source.territorialViews;
  const delta = source.project.entityDelta;
  if (!Array.isArray(delta?.changed) || !Array.isArray(delta.removedIds)) {
    throw Object.assign(new TypeError('Delta preview requires the original stored changed rows and removed IDs.'),
      { code: 'PL-PREVIEW-SOURCE' });
  }
  const changed = new Set(delta.changed.map(row => row.id));
  return source.territorialViews.filter(row => changed.has(row.id));
}

export function projectPreviewGeometryRows(source) {
  const entities = sourceEntities(source);
  const countries = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
  const removed = source.project.format === 'pandolab-autosave-delta' ? source.project.entityDelta.removedIds : [];
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
export function matchesDefaultPreview(source, baseline) {
  const entities = sourceEntities(source);
  const project = source.project;
  if (!baseline?.sourceSha256 || !baseline?.defaultClassification) return false;
  const expected = baseline.defaultClassification;
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

export function previewSourceForProject(source, baseline, cache) {
  if (matchesDefaultPreview(source, baseline)) return { kind: 'default' };
  if (cache?.algorithmRevision === PROJECT_PREVIEW_ALGORITHM_REVISION
    && cache?.baseSourceSha256 === baseline?.sourceSha256
    && cache?.geometryKey && Array.isArray(cache?.countries?.features)
    && Array.isArray(cache?.territorialUnits) && cache?.mesh?.positions) return { kind: 'project', cache };
  return { kind: 'restore' };
}
