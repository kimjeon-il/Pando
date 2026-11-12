import { layerStyle } from "./layer-presentation.js";
import { mapStylePreset } from "./map-style-presets.js";
import { resolveMapStrokeStyle } from "../map/map-interaction-style.js";
import { TERRAIN_OCEAN_REPRESENTATIVE } from "../data/physical-source-configuration.js";
export function resolveMapTheme({ state, theme, mapStyle = 'standard' }) {
    const preset = mapStylePreset(mapStyle);
    const terrainVisible = state?.physicalSettings?.terrainVisible !== false;
    const terrainStyle = state?.physicalSettings?.terrainStyle || 'political';
    const terrainFillAlpha = terrainVisible
      ? (terrainStyle === 'physical' ? 0.22 : 0.68)
      : null;
    const countryStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'objects') : { boundaryVisible: true, boundaryWidth: 1 };
    const riverStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'rivers') : { boundaryVisible: true, boundaryWidth: 1 };
    const lakeStyle = state?.layerPresentation ? layerStyle(state.layerPresentation, 'lakes') : { boundaryVisible: true, boundaryWidth: 1 };
    const base = theme === 'light'
      ? { defaultLand: '#cccccc', countryColorAlpha: terrainFillAlpha ?? 1, border: '#ffffff', borderGpu: [1, 1, 1], borderAlpha: 1, ocean: '#ffffff', oceanGpu: [1, 1, 1] }
      : { defaultLand: '#63758a', countryColorAlpha: terrainFillAlpha ?? 0.74, border: '#323c46', borderGpu: [0.196, 0.235, 0.275], borderAlpha: 0.92, ocean: '#0d2837', oceanGpu: [0.051, 0.157, 0.216] };
    base.terrainColorAlpha = terrainFillAlpha ?? 1;
    if (terrainVisible && terrainStyle === 'physical') {
      const value = state.terrainManifest?.displayColors?.oceanRepresentative;
      const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : TERRAIN_OCEAN_REPRESENTATIVE;
      const packed = Number.parseInt(hex.slice(1), 16);
      const rgb = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
        .map((component, index) => component * (theme === 'dark' ? [0.808, 0.8464, 0.8848][index] : 1));
      base.ocean = `#${rgb.map(component => Math.round(component).toString(16).padStart(2, '0')).join('')}`;
      base.oceanGpu = rgb.map(component => component / 255);
    }
    // A map theme may tint the base without modifying historical territorial colors.
    if (mapStyle === 'classic') {
      base.defaultLand = theme === 'light' ? '#dbd3bf' : '#82796b';
      if (!terrainVisible || terrainStyle !== 'physical') {
        base.ocean = theme === 'light' ? '#e4ddcb' : '#34362f';
        base.oceanGpu = theme === 'light' ? [228 / 255, 221 / 255, 203 / 255] : [52 / 255, 54 / 255, 47 / 255];
      }
    }
    base.baseLandAlpha = terrainVisible ? 1 : base.countryColorAlpha;
    base.mapStyle = mapStyle;
    base.labelFlags = preset.flags;
    const countryInkAlpha = base.borderAlpha;
    base.borderAlpha = countryStyle.boundaryVisible ? countryInkAlpha : 0;
    base.borderWidth = countryStyle.boundaryWidth * preset.borderScale;
    base.riverWidth = riverStyle.boundaryWidth;
    base.lakeBoundaryVisible = lakeStyle.boundaryVisible;
    base.lakeBoundaryWidth = lakeStyle.boundaryWidth;
    base.strokes = Object.freeze(Object.fromEntries(['country', 'country-internal', 'river', 'hydro-boundary']
      .map(role => [role, resolveMapStrokeStyle({ theme: { ...base, borderAlpha: countryStyle.boundaryVisible ? countryInkAlpha : 0 } }, role)])));
    delete base.borderWidth;
    delete base.riverWidth;
    delete base.lakeBoundaryWidth;
    return base;
  }
