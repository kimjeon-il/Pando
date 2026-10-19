import { createHash } from 'node:crypto';
import { normalizeTemporalInterval, parseTemporal } from '../assets/js/modules/temporal.js';
import { normalizeCountryCollection } from '../assets/js/modules/country-feature.js';
import { classifyBuiltinCountries, builtinSubunitSourceId } from '../assets/js/modules/builtin-subunits.js';
import { BUILTIN_TERRITORY_MERGES } from '../assets/js/modules/builtin-territory-policy.js';
import { createTerritorialFeature, normalizeTerritorialIdentities, TERRITORIAL_IDENTITY_FIELDS } from '../assets/js/modules/territorial-units.js';
import { createGeometryVersionStore } from '../assets/js/modules/geometry-version-store.js';
import { normalizeTimelineRecords } from '../assets/js/modules/timeline-records.js';
import { createProjectSerializer } from '../assets/js/modules/project-serializer.js';
import { DISTRIBUTION_MODES } from '../assets/js/modules/distribution-model.js';
import { adjustHistoricalTerritories, historicalWorldClipper } from './historical-world-territories.mjs';

const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};
const date = ([year, month, day]) => `${year < 0 ? '-' : year > 9999 ? '+' : ''}${String(Math.abs(year)).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function shiftDay(key, direction) {
  let [year, month, day] = key;
  if (direction > 0) {
    const end = parseTemporal(date([year, month, 1]).slice(0, -3)).endKey[2];
    if (++day > end) { day = 1; if (++month > 12) { month = 1; year = year === -1 ? 1 : year + 1; } }
  } else if (--day < 1) {
    if (--month < 1) { month = 12; year = year === 1 ? -1 : year - 1; }
    day = parseTemporal(date([year, month, 1]).slice(0, -3)).endKey[2];
  }
  return [year, month, day];
}
function bounds(interval) {
  const value = normalizeTemporalInterval(interval.validFrom, interval.validTo);
  return { start: value.start?.startKey ?? null, end: value.end?.endKey ?? null };
}
function intersection(a, b) {
  const start = !a.start ? b.start : !b.start ? a.start : compare(a.start, b.start) > 0 ? a.start : b.start;
  const end = !a.end ? b.end : !b.end ? a.end : compare(a.end, b.end) < 0 ? a.end : b.end;
  return start && end && compare(start, end) > 0 ? null : { start, end };
}
function covers(interval, start) {
  if (start === null) return interval.start === null;
  return (!interval.start || compare(interval.start, start) <= 0) && (!interval.end || compare(interval.end, start) >= 0);
}
function append(rows, row, sameValue) {
  const previous = rows.at(-1);
  if (previous && previous.entityId === row.entityId && previous.validTo !== null && row.validFrom !== null
      && date(shiftDay(parseTemporal(previous.validTo).endKey, 1)) === row.validFrom && sameValue(previous, row)) {
    previous.validTo = row.validTo;
  } else rows.push(row);
}
const identity = feature => ({ type: 'Feature', id: feature.id, geometry: null,
  properties: Object.fromEntries(TERRITORIAL_IDENTITY_FIELDS.map(key => [key, structuredClone(feature.properties[key])])) });
const withoutGeometry = ({ geometry, ...value }) => structuredClone(value);

/** Build an ordinary editable project; library inputs and raw intervals stay immutable. */
export function compileHistoricalWorldTimeline({ entities, currentSnapshot, currentWorld, policy, clipper = historicalWorldClipper }) {
  if (currentSnapshot?.schemaVersion !== 1 || !Array.isArray(currentSnapshot.entityRefs)
      || new Set(currentSnapshot.entityRefs).size !== currentSnapshot.entityRefs.length) throw new Error('Invalid current snapshot');
  if (!policy || policy.schemaVersion !== 1) throw new Error('Missing historical world policy');
  const reference = parseTemporal(currentSnapshot.referenceDate, { nullable: false });
  const sourceMonth = reference.precision === 'date' ? reference.canonical.slice(0, -3) : reference.canonical;
  const monthBounds = bounds({ validFrom: sourceMonth, validTo: sourceMonth });
  const bySource = new Map(entities.map(entity => [entity.entityId, entity]));
  if (bySource.size !== entities.length) throw new Error('Duplicate source entity');
  const currentIds = new Set(currentSnapshot.entityRefs);
  for (const id of currentIds) if (!bySource.has(id)) throw new Error(`Missing current source: ${id}`);
  const classified = classifyBuiltinCountries(normalizeCountryCollection(currentWorld));
  const definitions = new Map(), sourceToProject = new Map(), sourceIdentities = [];
  for (const feature of [...classified.countries.features, ...classified.subunits]) {
    const sourceFeature = builtinSubunitSourceId(feature) || feature.id;
    const sourceFeatureIds = [sourceFeature, ...BUILTIN_TERRITORY_MERGES.filter(row => row.controller === sourceFeature).map(row => row.sourceId)].sort();
    const sources = entities.filter(entity => currentIds.has(entity.entityId) && sourceFeatureIds.includes(entity.sourceInfo?.featureId));
    if (!sources.length) throw new Error(`Missing current identity: ${feature.id}`);
    for (const source of sources) sourceToProject.set(source.entityId, feature.id);
    const info = { projectEntityId: feature.id, sourceEntityIds: sources.map(source => source.entityId).sort(), sourceFeatureIds, currentGeometryRef: null };
    sourceIdentities.push(info);
    const primary = sources.find(source => source.sourceInfo.featureId === sourceFeature);
    const lifetime = bounds(primary.lifetime);
    // The snapshot uses its exact reference DATE for version selection, even
    // when a historical version is valid earlier within that same month.
    const currentReference = bounds({ validFrom: currentSnapshot.referenceDate, validTo: currentSnapshot.referenceDate });
    const version = primary.geometryVersions.find(row => intersection(bounds(row), currentReference));
    const interval = version && intersection(intersection(lifetime, monthBounds), bounds(version));
    if (!version || !interval) throw new Error(`Missing current geometry/lifetime: ${feature.id}`);
    const normalized = identity(feature);
    normalized.properties.metadata.historicalTimeline = { entityId: primary.entityId, sourceEntityIds: info.sourceEntityIds,
      lifetime: structuredClone(primary.lifetime), geometryVersions: primary.geometryVersions.map(withoutGeometry), geometryBindings: [] };
    const historicalWindows = primary.geometryVersions.filter(row => row.versionId !== version.versionId).map(row => {
      const historicalInterval = intersection(lifetime, bounds(row));
      return historicalInterval && { ...historicalInterval, versionId: row.versionId, geometry: row.geometry,
        parentId: feature.properties.parentId, coverageMode: feature.properties.coverageMode, currentSnapshot: false };
    }).filter(Boolean);
    definitions.set(feature.id, { identity: normalized, currentSnapshot: true, info, windows: [
      ...historicalWindows, { ...interval, versionId: version.versionId, geometry: feature.geometry,
        parentId: feature.properties.parentId, coverageMode: feature.properties.coverageMode, currentSnapshot: true }
    ] });
  }
  for (const entity of entities) {
    const lifetime = bounds(entity.lifetime);
    // Validate all input windows/geometry, including sources outside the snapshot.
    for (const version of entity.geometryVersions) {
      bounds(version);
      if (!version.geometry) throw new Error(`Missing source geometry: ${version.versionId}`);
    }
    if (currentIds.has(entity.entityId)) continue;
    const first = entity.geometryVersions[0];
    if (!first) throw new Error(`Missing source geometry: ${entity.entityId}`);
    const feature = createTerritorialFeature({ id: entity.entityId, entityKind: entity.entityKind,
      name: entity.names.ko || entity.names.en || Object.values(entity.names)[0], geometry: first.geometry,
      color: entity.metadata?.defaultColor || '',
      notes: entity.metadata?.notes || '', metadata: { ...structuredClone(entity.metadata),
        ...(entity.entityKind === 'general' && !entity.parentEntityId && entity.metadata?.defaultFlagDataUrl
          ? { flagDataUrl: entity.metadata.defaultFlagDataUrl } : {}),
        historicalTimeline: { entityId: entity.entityId, lifetime: structuredClone(entity.lifetime),
          sourceInfo: structuredClone(entity.sourceInfo), geometryVersions: entity.geometryVersions.map(withoutGeometry), geometryBindings: [] } },
      sourceEntityId: entity.entityId });
    const windows = entity.geometryVersions.map(version => {
      const available = version.datePrecision === 'current' ? intersection(bounds(version), monthBounds) : bounds(version);
      const interval = available && intersection(lifetime, available);
      return interval && { ...interval, geometry: version.geometry, versionId: version.versionId,
        parentId: sourceToProject.get(entity.parentEntityId) || entity.parentEntityId,
        coverageMode: entity.instantiation.coverageMode || 'explicit' };
    }).filter(Boolean);
    definitions.set(entity.entityId, { identity: identity(feature), currentSnapshot: false, windows });
    sourceIdentities.push({ projectEntityId: entity.entityId, sourceEntityIds: [entity.entityId], sourceFeatureIds: [], currentGeometryRef: null });
  }
  const events = new Map();
  for (const definition of definitions.values()) for (const window of definition.windows) {
    if (window.start) events.set(date(window.start), window.start);
    if (window.end) { const next = shiftDay(window.end, 1); events.set(date(next), next); }
  }
  for (const rule of policy.replacements) {
    const window = bounds(rule);
    if (window.start) events.set(date(window.start), window.start);
    if (window.end) { const next = shiftDay(window.end, 1); events.set(date(next), next); }
  }
  const cuts = [...events.values()].sort(compare);
  const archive = createGeometryVersionStore(), byGeometry = new Map();
  const rowsByEntity = new Map(), adjustments = [];
  const geometryRef = geometry => {
    const bytes = JSON.stringify(geometry), hash = createHash('sha256').update(bytes).digest('hex');
    if (!byGeometry.has(hash)) { const ref = { id: `historical-world:${hash}`, version: 1 }; archive.insert(ref, geometry); byGeometry.set(hash, ref); }
    return byGeometry.get(hash);
  };
  const ordered = [...definitions].sort(([a], [b]) => a.localeCompare(b, 'en'));
  for (let index = 0; index <= cuts.length; index++) {
    const start = index === 0 ? null : cuts[index - 1], end = index === cuts.length ? null : shiftDay(cuts[index], -1);
    let candidates = [];
    for (const [id, definition] of ordered) {
      const active = definition.windows.filter(window => covers(window, start));
      if (active.length > 1) throw new Error(`Overlapping geometry intervals: ${id}`);
      if (active.length) candidates.push({ ...active[0], entityId: id, currentSnapshot: active[0].currentSnapshot ?? definition.currentSnapshot,
        validFrom: start && date(start), validTo: end && date(end) });
    }
    // A parent gap hides descendants transitively; cycles are a source error.
    const all = new Map(candidates.map(row => [row.entityId, row]));
    const activeParent = (row, seen = new Set()) => {
      if (seen.has(row.entityId)) throw new Error(`Cyclic parent: ${row.entityId}`);
      if (!row.parentId) return true;
      seen.add(row.entityId);
      const parent = all.get(row.parentId);
      return !!parent && activeParent(parent, seen);
    };
    candidates = candidates.filter(row => activeParent(row));
    const mappedPolicy = { ...policy, replacements: policy.replacements.map(rule => ({ ...rule,
      targetEntityId: sourceToProject.get(rule.targetEntityId) || rule.targetEntityId,
      priorityEntityId: sourceToProject.get(rule.priorityEntityId) || rule.priorityEntityId,
    })) };
    const adjusted = adjustHistoricalTerritories(candidates, mappedPolicy, clipper);
    candidates = adjusted.candidates;
    adjustments.push(...adjusted.adjustments.map(row => ({ ...row, validFrom: start && date(start), validTo: end && date(end) })));
    for (const candidate of candidates) {
      const definition = definitions.get(candidate.entityId), ref = geometryRef(candidate.geometry);
      if (definition.currentSnapshot) definition.info.currentGeometryRef = ref;
      let rows = rowsByEntity.get(candidate.entityId);
      if (!rows) rowsByEntity.set(candidate.entityId, rows = { lifetimes: [], geometryBindings: [], parentRelations: [] });
      const base = { entityId: candidate.entityId, validFrom: start && date(start), validTo: end && date(end) };
      append(rows.lifetimes, { ...base }, () => true);
      append(rows.geometryBindings, { ...base, geometryRef: ref }, (a, b) => a.geometryRef.id === b.geometryRef.id);
      append(rows.parentRelations, { ...base, parentId: candidate.parentId, coverageMode: candidate.coverageMode }, (a, b) => a.parentId === b.parentId && a.coverageMode === b.coverageMode);
      append(definition.identity.properties.metadata.historicalTimeline.geometryBindings,
        { ...base, geometryRef: ref, sourceVersionId: candidate.versionId }, (a, b) => a.geometryRef.id === b.geometryRef.id && a.sourceVersionId === b.sourceVersionId);
    }
  }
  const identities = normalizeTerritorialIdentities(ordered.filter(([id]) => rowsByEntity.has(id)).map(([, value]) => value.identity));
  const records = { schemaVersion: 2, lifetimes: [], geometryBindings: [], parentRelations: [], propertyBindings: [] };
  for (const [id] of ordered) {
    const rows = rowsByEntity.get(id); if (!rows) continue;
    for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) rows[name].forEach((row, i) => records[name].push({ id: `historical-world:${name}:${id}:${i}`, ...row }));
  }
  const normalized = normalizeTimelineRecords(records, { entities: identities.map(row => ({ id: row.id, entityKind: row.properties.entityKind })), geometryExists: ref => archive.get(ref) !== null });
  const snapshot = { documentId:'6dcead54-3bc5-4ca2-a4f5-455305bba911',physicalSourceInfo:{},territorialEntities: identities, fullAutosave: true, projectFields: {
    timelineRecords: normalized, geometries: archive.snapshot(), sourceInfo: null, labels: [], genericFeatures: [], hydroEdits: [],
    distributionLayers: [], distributionEntries: [], labelSettings: {}, distributionSettings:{renderMode:'overlap',activeLayerId:'',boundaryVisible:true}, projectSetup:{initialMonth:sourceMonth,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'},
    layerPresentation: { schemaVersion: 5, styles: {}, objectStyles: {}, objectOrder: [] },
  } };
  const project = createProjectSerializer({ appVersion: 'historical-world-v1', distributionModes: Object.values(DISTRIBUTION_MODES),
    now: () => new Date(`${currentSnapshot.referenceDate}T00:00:00.000Z`),
    readSnapshot: () => snapshot }).buildProject();
  return { project, sourceIdentities: sourceIdentities.filter(row => rowsByEntity.has(row.projectEntityId)).sort((a, b) => a.projectEntityId.localeCompare(b.projectEntityId, 'en')),
    coverageReport: { schemaVersion: 1, sourceMonth, entities: ordered.map(([id]) => ({ entityId: id,
      intervals: rowsByEntity.get(id)?.lifetimes ?? [], excludedReason: rowsByEntity.has(id) ? null : 'no-supported-geometry-and-parent-interval' })), adjustments } };
}
