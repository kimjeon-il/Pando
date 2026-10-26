import { sharedCalculationCore } from './temporal.js';

export const TIMELINE_RECORD_SCHEMA_VERSION = 3;

export const timelineObjectKey = ref => JSON.stringify([ref.domain,ref.id]);
export function timelineObjectCatalog(project) {
  return [...project.territorialEntities.map(row=>({objectRef:{domain:'territorial',id:row.id},entityKind:row.properties.entityKind})),
    ...(project.hydroEdits || []).map(row=>({objectRef:{domain:'hydro',id:row.id},entityKind:row.properties.category}))];
}

if (typeof sharedCalculationCore.timelineNormalizeRecords !== 'function') {
  throw Object.assign(new Error('Canonical C++ timeline validator is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}

/** Freeze the result of C++ validation; no browser-side timeline graph is built. */
function immutableRecords(records) {
  for (const name of ['lifetimes', 'geometryBindings', 'parentRelations', 'propertyBindings']) {
    for (const row of records[name]) {
      if (row.objectRef) Object.freeze(row.objectRef);
      if (row.geometryRef) Object.freeze(row.geometryRef);
      if (row.value) Object.freeze(row.value);
      if(row.rendering){for(const part of row.rendering.stroke_widths || [])Object.freeze(part);if(row.rendering.stroke_widths)Object.freeze(row.rendering.stroke_widths);Object.freeze(row.rendering);}
      Object.freeze(row);
    }
    Object.freeze(records[name]);
  }
  return Object.freeze(records);
}

/** Read-only normalization delegates graph coverage and date rules to C++. */
export function normalizeTimelineRecords(input, context) {
  return immutableRecords(sharedCalculationCore.timelineNormalizeRecords(input, context));
}
