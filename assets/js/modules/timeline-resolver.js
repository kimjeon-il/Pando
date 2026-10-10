import { normalizeTimelineRecords } from './timeline-records.js';
import { compareTemporal, normalizeTemporalInterval, parseTemporal, temporalMonthEnd } from './temporal.js';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function initialTimelineMonth(records, currentMonth) {
  const fallback = parseTemporal(currentMonth, { nullable: false });
  if (fallback.precision !== 'month') throw Object.assign(new Error('Timeline cursor requires month precision.'), { code: 'INVALID_TIMELINE_CURSOR' });
  let latest = null;
  for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) for (const row of records[name]) {
    if (row.validFrom == null) continue;
    const value = parseTemporal(row.validFrom, { nullable: false });
    if (!latest || compareTemporal(value, latest) > 0) latest = value;
  }
  return !latest ? fallback.canonical : latest.precision === 'year' ? `${latest.canonical}-01`
    : latest.precision === 'date' ? latest.canonical.slice(0, -3) : latest.canonical;
}

export function hasDatedTimelineRecords(records) {
  return ['lifetimes', 'geometryBindings', 'parentRelations']
    .some(name => records[name].some(row => row.validFrom !== null || row.validTo !== null));
}

function active(row, point) {
  const interval = normalizeTemporalInterval(row.validFrom, row.validTo);
  return (!interval.start || compareTemporal(interval.start, point, { rightBoundary: 'end' }) <= 0)
    && (!interval.end || compareTemporal(interval.end, point, { leftBoundary: 'end', rightBoundary: 'end' }) >= 0);
}

/** Read-only territorial view at the last day of a calendar month. */
export function resolveWorld(identities, records, geometries, month) {
  const cursor = parseTemporal(month, { nullable: false });
  if (cursor.precision !== 'month') throw Object.assign(new Error('Timeline cursor requires month precision.'), { code: 'INVALID_TIMELINE_CURSOR' });
  const point = temporalMonthEnd(cursor);
  const normalized = normalizeTimelineRecords(records, { entities: identities.map(identity => ({
    id: identity.id, entityKind: identity.properties.entityKind })), geometryExists: ref => geometries.get(ref) != null });
  const rowFor = (name, id) => normalized[name].find(row => row.entityId === id && active(row, point));
  const rows = [];
  const byId = new Map();
  for (const identity of identities) {
    const lifetime = rowFor('lifetimes', identity.id);
    if (!lifetime) continue;
    const binding = rowFor('geometryBindings', identity.id);
    const parent = rowFor('parentRelations', identity.id);
    const row = { id: identity.id, identity: freeze(structuredClone(identity)), geometryRef: binding.geometryRef,
      geometry: geometries.get(binding.geometryRef), parentId: parent.parentId,
      coverageMode: parent.coverageMode, validFrom: lifetime.validFrom, validTo: lifetime.validTo };
    rows.push(row);
    byId.set(row.id, row);
  }
  for (const row of rows) {
    const ancestors = [];
    for (let parentId = row.parentId; parentId; parentId = byId.get(parentId).parentId) ancestors.push(parentId);
    row.ancestors = Object.freeze(ancestors);
    row.rootId = ancestors.at(-1) ?? row.id;
    Object.freeze(row);
  }
  return Object.freeze({ month: point.canonical, entities: Object.freeze(rows),
    byId: Object.freeze({ get: id => byId.get(id) }) });
}

export function resolvedTimelineViews(identities, records, geometries, month) {
  return Object.freeze(resolveWorld(identities, records, geometries, month).entities.map(row => {
    const properties = Object.freeze({ ...row.identity.properties, parentId: row.parentId,
      coverageMode: row.coverageMode, validFrom: row.validFrom, validTo: row.validTo });
    return Object.freeze({ ...row.identity, properties, geometry: row.geometry });
  }));
}
