import { layerStyle } from './layer-presentation.js';
import { resolveMapStrokeStyle } from './map-interaction-style.js';
export function resolveMapTheme({ state, theme }) {
    const terrainVisible = state?.physicalSettings?.terrainVisible !== false;
    const terrainStyle = state?.physicalSettings?.terrainStyle || 'political';
    const terrainFillAlpha = terrainVisible
      ? (terrainStyle === 'physical' ? 0.22 : 0.68)
      : null;
    const countryStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'objects') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const riverStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'rivers') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const lakeStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'lakes') : { opacity: 1, boundaryVisible: true, boundaryWidth: 1 };
    const base = theme === 'light'
      ? { defaultLand: '#cccccc', countryColorAlpha: terrainFillAlpha ?? 1, border: '#ffffff', borderGpu: [1, 1, 1], borderAlpha: 1, ocean: '#ffffff', oceanGpu: [1, 1, 1] }
      : { defaultLand: '#63758a', countryColorAlpha: terrainFillAlpha ?? 0.74, border: '#323c46', borderGpu: [0.196, 0.235, 0.275], borderAlpha: 0.92, ocean: '#0d2837', oceanGpu: [0.051, 0.157, 0.216] };
    base.terrainColorAlpha = terrainFillAlpha ?? 1;
    base.baseLandAlpha = terrainVisible ? 1 : base.countryColorAlpha;
    const countryInkAlpha = base.borderAlpha;
    base.borderAlpha = countryStyle.boundaryVisible ? countryInkAlpha * countryStyle.opacity : 0;
    base.borderWidth = countryStyle.boundaryWidth;
    base.riverOpacity = riverStyle.opacity;
    base.riverWidth = riverStyle.boundaryWidth;
    base.lakeOpacity = lakeStyle.opacity;
    base.lakeBoundaryVisible = lakeStyle.boundaryVisible;
    base.lakeBoundaryWidth = lakeStyle.boundaryWidth;
    base.strokes = Object.freeze(Object.fromEntries(['country', 'country-internal', 'river', 'hydro-boundary']
      .map(role => [role, resolveMapStrokeStyle({ theme: { ...base, borderAlpha: countryStyle.boundaryVisible ? countryInkAlpha : 0 } }, role)])));
    // Shared batches apply the effective per-owner opacity once. Native borders
    // use borderAlpha, whose country layer opacity is already resolved.
    delete base.borderWidth;
    delete base.riverWidth;
    delete base.lakeBoundaryWidth;
    return base;
  }
