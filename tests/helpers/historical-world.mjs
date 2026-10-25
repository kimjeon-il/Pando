import { staticAutosaveProject } from './timeline-project.mjs';
import { normalizeCountryCollection } from "../../shared/frontend/js/modules/country-feature.js";
export function smallHistoricalWorld({ currentId = 'RUS', currentGeometry = null } = {}) {
  const geometry = { type: 'Polygon', coordinates: [[[33, 44], [35, 44], [35, 46], [33, 46], [33, 44]]] };
  const project = structuredClone(staticAutosaveProject({}, normalizeCountryCollection({ features: [
    { id: 'state:ukraine', geometry }, { id: currentId, geometry: currentGeometry || geometry },
  ] }).features));
  project.format = 'pandolab-project-state';
  for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) for (const row of project.timelineRecords[name]) {
    row.validFrom = row.entityId === currentId ? '2026-10-01' : '1991-08-24';
    row.validTo = row.entityId === currentId ? '2026-10-31' : '2014-03-17';
  }
  return project;
}
