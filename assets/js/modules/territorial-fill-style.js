import { layerStyle, resolveLayerDisplayColor } from './layer-presentation.js';
import { resolveTerritorialColor } from './color-adapter.js';

// Resolve only presentation values. Never persist inherited defaults on a child.
export function createTerritorialFillResolver({ state, entityRepository, terrainAlpha = 1, mapSubstrate = null }) {
  const cache = new Map();
  const presentation = state.layerPresentation;
  const countryStyle = layerStyle(presentation, 'countries');
  function resolve(unit, visiting = new Set()) {
    const id = String(unit.id);
    if (cache.has(id)) return cache.get(id);
    const properties = (entityRepository.get(unit.id) || unit).properties || {};
    if (!properties.unitType || properties.unitType === 'country') {
      const color = countryStyle.colorVisible ? resolveLayerDisplayColor(presentation, 'countries', {
        objectKey: `territorial:country:${id}`, explicitColor: properties.style?.color, fallbackColor: '',
      }) : '';
      const style = layerStyle(presentation, 'countries', `territorial:country:${id}`);
      // Pending country patches can supply the no-terrain map substrate while
      // the replacement base mesh is being prepared. It is never saved as paint.
      const result = Object.freeze({ color: color || mapSubstrate?.color || '', opacity: style.opacity, blendMode: style.blendMode,
        fillAlpha: color ? style.opacity * terrainAlpha : mapSubstrate?.fillAlpha || 0, depth: 0, ownerId: id, parentId: '' });
      cache.set(id, result);
      return result;
    }
    const country = entityRepository.administrativeCountry(id);
    let inherited = { color: countryStyle.colorVisible && country ? country.properties.style?.color || '' : '',
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
    const color = resolveLayerDisplayColor(presentation, group, {
      objectKey: `territorial:${properties.unitType}:${id}`,
      explicitColor: properties.style?.color,
      inheritedColor: resolveTerritorialColor({ ...unit, properties: { ...properties, style: {} } }, {
        entityRepository, countryColor: feature => feature.properties?.style?.color || '', fallback: '',
        colorVisible: feature => (!feature.properties?.unitType || feature.properties.unitType === 'country'
          ? countryStyle.colorVisible : true) && layerStyle(presentation, feature.properties?.unitType === 'country' ? 'countries' : feature.properties?.unitType === 'region' ? 'regions' : 'subunits', `territorial:${feature.properties?.unitType}:${feature.id}`).colorVisible,
      }),
      fallbackColor: '',
    });
    const result = Object.freeze({ color,
      opacity: Math.max(0, Math.min(1, Number(opacity))), blendMode,
      fillAlpha: color ? Math.max(0, Math.min(1, Number(opacity))) * terrainAlpha : 0,
      depth: inherited.depth + 1, ownerId: String(country?.id || ''), parentId: String(properties.parentId || '') });
    cache.set(id, result);
    return result;
  }
  return resolve;
}
