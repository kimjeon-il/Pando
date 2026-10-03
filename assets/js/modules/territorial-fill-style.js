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
    if (!properties.entityKind || (properties.entityKind === 'general' && !properties.parentId)) {
      const color = countryStyle.colorVisible ? resolveLayerDisplayColor(presentation, 'countries', {
        objectKey: `territorial:entity:${id}`, explicitColor: properties.style?.color, fallbackColor: '',
      }) : '';
      const style = layerStyle(presentation, 'countries', `territorial:entity:${id}`);
      // Pending country patches can supply the no-terrain map substrate while
      // the replacement base mesh is being prepared. It is never saved as paint.
      const result = Object.freeze({ color: color || mapSubstrate?.color || '', opacity: style.opacity, blendMode: style.blendMode,
        fillAlpha: color ? style.opacity * terrainAlpha : mapSubstrate?.fillAlpha || 0, depth: 0, ownerId: id, parentId: '' });
      cache.set(id, result);
      return result;
    }
    const country = entityRepository.root(id);
    let inherited = { color: countryStyle.colorVisible && country ? country.properties.style?.color || '' : '',
      opacity: countryStyle.opacity, blendMode: countryStyle.blendMode, depth: 0 };
    const parent = entityRepository.parent(id);
    if ((parent?.properties?.entityKind === 'general' && !!parent?.properties?.parentId) && !visiting.has(id)) {
      visiting.add(id);
      if (!visiting.has(String(parent.id))) inherited = resolve(parent, visiting);
      visiting.delete(id);
    }
    const group = (properties.entityKind === 'regional') ? 'regions' : 'subunits';
    const groupStyle = presentation?.styles?.[group] || {};
    const explicit = presentation?.objectStyles?.[`territorial:entity:${id}`] || {};
    // Neutral group values preserve the parent's material opacity and blend.
    const opacity = explicit.opacity ?? (groupStyle.opacity !== undefined && groupStyle.opacity !== 1
      ? groupStyle.opacity : inherited.opacity);
    const blendMode = explicit.blendMode ?? (groupStyle.blendMode === 'multiply' ? 'multiply' : inherited.blendMode);
    const color = resolveLayerDisplayColor(presentation, group, {
      objectKey: `territorial:entity:${id}`,
      explicitColor: properties.style?.color,
      inheritedColor: resolveTerritorialColor({ ...unit, properties: { ...properties, style: {} } }, {
        entityRepository, countryColor: feature => feature.properties?.style?.color || '', fallback: '',
        colorVisible: feature => (!feature.properties?.entityKind || (feature.properties.entityKind === 'general' && !feature.properties.parentId)
          ? countryStyle.colorVisible : true) && layerStyle(presentation, (feature.properties?.entityKind === 'general' && !feature.properties?.parentId) ? 'countries' : (feature.properties?.entityKind === 'regional') ? 'regions' : 'subunits', `territorial:entity:${feature.id}`).colorVisible,
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
