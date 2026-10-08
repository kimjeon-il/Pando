import { compareTemporal, normalizeTemporalInterval, parseTemporal } from './temporal.js';

const collectionFields = Object.freeze({ geometryBindings: ['geometryRef'], parentRelations: ['parentId', 'coverageMode'] });
function priorMonth(value) {
  let year = value.year, month = value.month - 1;
  if (!month) { month = 12; year = year === 1 ? -1 : year - 1; }
  return `${year < 0 ? '-' : year > 9999 ? '+' : ''}${String(Math.abs(year)).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}
export function timelinePriorMonth(cursor) {
  const value = parseTemporal(cursor, { nullable: false });
  if (value.precision !== 'month') throw Object.assign(new Error('Timeline cursor requires month precision.'), { code: 'INVALID_TIMELINE_CURSOR' });
  return priorMonth(value);
}
function active(row, month) {
  const interval = normalizeTemporalInterval(row.validFrom, row.validTo);
  return (!interval.start || compareTemporal(interval.start, month, { rightBoundary: 'end' }) <= 0)
    && (!interval.end || compareTemporal(interval.end, month, { leftBoundary: 'end', rightBoundary: 'end' }) >= 0);
}

/** Replace one effective record without rewriting later, independently dated records. */
export function replaceTimelineRecordAtMonth(records, collection, entityId, cursor, patch) {
  const fields = collectionFields[collection];
  if (!fields || Object.keys(patch).some(key => !fields.includes(key))) throw new TypeError('Invalid timeline record patch.');
  const month = parseTemporal(cursor, { nullable: false });
  if (month.precision !== 'month') throw Object.assign(new Error('Timeline cursor requires month precision.'), { code: 'INVALID_TIMELINE_CURSOR' });
  const rows = records[collection];
  const index = rows.findIndex(row => row.entityId === entityId && active(row, month));
  if (index < 0) throw Object.assign(new Error(`Entity ${entityId} is inactive at ${cursor}.`), { code: 'TIMELINE_INACTIVE' });
  const original = rows[index];
  if (fields.every(key => !Object.hasOwn(patch, key) || JSON.stringify(original[key]) === JSON.stringify(patch[key]))) return records;
  const from = original.validFrom == null ? null : parseTemporal(original.validFrom, { nullable: false });
  const split = !from || compareTemporal(from, month) < 0;
  const copy = { ...records, [collection]: [...rows] };
  if (!split) copy[collection][index] = { ...original, ...structuredClone(patch) };
  else {
    const ids = new Set(['lifetimes', 'geometryBindings', 'parentRelations'].flatMap(name => records[name].map(row => row.id)));
    const base = `${original.id}:${month.canonical}`;
    let id = base, suffix = 0;
    while (ids.has(id)) id = `${base}:${++suffix}`;
    copy[collection].splice(index, 1, { ...original, validTo: priorMonth(month) },
      { ...original, ...structuredClone(patch), id, validFrom: month.canonical });
  }
  return copy;
}

/** End the entity at the month boundary, leaving earlier records untouched. */
export function truncateTimelineEntityAtMonth(records, entityId, cursor) {
  const month = parseTemporal(cursor, { nullable: false });
  if (month.precision !== 'month') throw Object.assign(new Error('Timeline cursor requires month precision.'), { code: 'INVALID_TIMELINE_CURSOR' });
  const lastMonth = priorMonth(month);
  const result = { ...records };
  for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) {
    result[name] = records[name].flatMap(row => {
      if (row.entityId !== entityId) return [row];
      const interval = normalizeTemporalInterval(row.validFrom, row.validTo);
      if (interval.end && compareTemporal(interval.end, month, { leftBoundary: 'end', rightBoundary: 'start' }) < 0) return [row];
      if (interval.start && compareTemporal(interval.start, month, { leftBoundary: 'start', rightBoundary: 'start' }) >= 0) return [];
      return [{ ...row, validTo: lastMonth }];
    });
  }
  return result;
}
