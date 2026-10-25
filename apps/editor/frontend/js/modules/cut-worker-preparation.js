import { sharedCalculationCore } from "../../../../../shared/frontend/js/modules/temporal.js";
import { geometryRevision } from "../../../../../shared/frontend/js/modules/geometry-versions.js";

// Bounded worker-owned native handles. Identity + revision is the source key;
// view/draft changes never rebuild boundary indexes.
const preparedSources = new Map();
export function clearPreparedCutSources() {
  for (const entry of preparedSources.values()) entry.prepared.delete();
  preparedSources.clear();
}
export function prepareCutInWorker({ source, coords, view, buildPreview }) {
  let entry = preparedSources.get(source);
  const revision = geometryRevision(source);
  if (!entry || entry.revision !== revision) {
    const prepared = new sharedCalculationCore.PreparedCutGeometry(JSON.stringify(source));
    if (entry) entry.prepared.delete();
    entry = { revision, prepared };
    preparedSources.set(source, entry);
    while (preparedSources.size > 8) {
      const key = preparedSources.keys().next().value;
      preparedSources.get(key).prepared.delete();
      preparedSources.delete(key);
    }
  }
  return JSON.parse(entry.prepared.prepare(JSON.stringify({ coords, view, buildPreview })));
}
