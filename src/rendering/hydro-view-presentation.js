// Hydro visibility is a rendering presentation policy, not resource ownership.
// Hydro v0.13.4 preserves its published 6.0/6.7/7.0/7.5 stage metadata.
// Gate those existing stages by actual map zoom; no geometry, names, or basin
// selection data need to be rewritten.
const HYDRO_DISPLAY_ZOOM_GATES = Object.freeze([
  Object.freeze({ mapZoom: 3.5, sourceMinZoom: 6.0 }),
  Object.freeze({ mapZoom: 7, sourceMinZoom: 6.7 }),
  Object.freeze({ mapZoom: 14, sourceMinZoom: 7.0 }),
  Object.freeze({ mapZoom: 28, sourceMinZoom: 7.5 }),
]);

export function hydroVisibilityThresholdForMapZoom(mapZoom) {
  const zoom = Number(mapZoom);
  if (!Number.isFinite(zoom)) return Number.NEGATIVE_INFINITY;
  for (let index = HYDRO_DISPLAY_ZOOM_GATES.length - 1; index >= 0; index -= 1) {
    const gate = HYDRO_DISPLAY_ZOOM_GATES[index];
    if (zoom >= gate.mapZoom) return gate.sourceMinZoom;
  }
  return Number.NEGATIVE_INFINITY;
}

/** PhysicalResources: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
