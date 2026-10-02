import { layerStyle, resolveLayerDisplayColor } from './layer-presentation.js';
import { resolveTerritorialColor } from './color-adapter.js';

// Resolve only presentation values. Never persist inherited defaults on a child.
export function createTerritorialFillResolver({ state, entityRepository, countryColor, defaultColor, terrainAlpha = 1 }) {
  const cache = new Map();
  const presentation = state.layerPresentation;
  const countryStyle = layerStyle(presentation, 'countries');
  function resolve(unit, visiting = new Set()) {
    const id = String(unit.id);
    if (cache.has(id)) return cache.get(id);
    const properties = unit.properties || {};
    const country = entityRepository.administrativeCountry(id);
    let inherited = { color: countryStyle.colorVisible && country ? countryColor(country) : defaultColor,
      opacity: countryStyle.opacity, blendMode: countryStyle.blendMode, depth: 0 };
    const parent = entityRepository.parent(id);
    if (parent?.properties?.unitType === 'subunit' && !visiting.has(id)) {
      visiting.add(id);
      if (!visiting.has(String(parent.id))) inherited = resolve(parent, visiting);
      visiting.delete(id);
    }
    const group = properties.unitType === 'region' ? 'regions' : 'subunits';
    const groupStyle = presentation?.styles?.[group] || {};
    const explicit = presentation?.objectStyles?.[`territorial:${properties.unitType}:${id}`] || {};
    // Neutral group values preserve the parent's material opacity and blend.
    const opacity = explicit.opacity ?? (groupStyle.opacity !== undefined && groupStyle.opacity !== 1
      ? groupStyle.opacity : inherited.opacity);
    const blendMode = explicit.blendMode ?? (groupStyle.blendMode === 'multiply' ? 'multiply' : inherited.blendMode);
    const result = Object.freeze({ color: resolveLayerDisplayColor(presentation, group, {
      objectKey: `territorial:${properties.unitType}:${id}`,
      explicitColor: properties.style?.color,
      inheritedColor: resolveTerritorialColor({ ...unit, properties: { ...properties, style: {} } }, {
        entityRepository, countryColor, fallback: defaultColor,
        colorVisible: feature => layerStyle(presentation, feature.properties?.unitType === 'country' ? 'countries' : feature.properties?.unitType === 'region' ? 'regions' : 'subunits', `territorial:${feature.properties?.unitType}:${feature.id}`).colorVisible,
      }),
      fallbackColor: defaultColor,
    }),
      opacity: Math.max(0, Math.min(1, Number(opacity))), blendMode,
      fillAlpha: Math.max(0, Math.min(1, Number(opacity))) * terrainAlpha,
      depth: inherited.depth + 1, ownerId: String(properties.sovereignId || ''), parentId: String(properties.parentId || '') });
    cache.set(id, result);
    return result;
  }
  return resolve;
}
