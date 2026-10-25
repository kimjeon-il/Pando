import { sharedCalculationCore } from "../../../../../shared/frontend/js/modules/temporal.js";

const collectionFields = Object.freeze({
  geometryBindings: ['geometryRef'],
  parentRelations: ['parentId', 'coverageMode'],
});
for (const name of ['timelineEditRecord', 'timelineTruncateEntity']) {
  if (typeof sharedCalculationCore[name] !== 'function')
    throw Object.assign(new Error('Canonical C++ timeline editing capability is unavailable: ' + name),
      { code: 'PL-CORE-WASM-CAPABILITY' });
}

/** A typed edit intent; effective-slot selection, splitting and IDs are C++ owned. */
export function replaceTimelineRecordAtMonth(records, collection, entityId, cursor, patch) {
  const fields = collectionFields[collection];
  if (!fields || Object.keys(patch).some(key => !fields.includes(key)))
    throw new TypeError('Invalid timeline record patch.');
  const result = sharedCalculationCore.timelineEditRecord(records, collection, entityId, cursor, patch);
  return result.changed ? result.records : records;
}

/** End an entity at a month boundary without changing the stored source records. */
export function truncateTimelineEntityAtMonth(records, entityId, cursor) {
  return sharedCalculationCore.timelineTruncateEntity(records, entityId, cursor);
}
