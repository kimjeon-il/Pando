/** Flat user-facing map themes. Screen light/dark mode is a separate setting.
 * These are visual policies, not additions to any document or project schema.
 */
export const MAP_STYLE_PRESETS = Object.freeze({
  standard: Object.freeze({ label: '표준', terrain: 'physical', flags: true, cityMarker: 'filled', borderScale: 1 }),
  minimal: Object.freeze({ label: '간결', terrain: 'none', flags: false, cityMarker: 'compact', borderScale: 0.7 }),
  classic: Object.freeze({ label: '고전', terrain: 'political', flags: false, cityMarker: 'outline', borderScale: 0.85 }),
});
export const DEFAULT_MAP_STYLE = 'standard';
export const mapStylePreset = id => MAP_STYLE_PRESETS[id] || MAP_STYLE_PRESETS[DEFAULT_MAP_STYLE];
export const normalizeMapStyle = id => Object.hasOwn(MAP_STYLE_PRESETS, id) ? id : DEFAULT_MAP_STYLE;
