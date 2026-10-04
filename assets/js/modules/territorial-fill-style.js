import { layerStyle, resolveLayerDisplayColor, territorialSymbolGroup } from './layer-presentation.js';
import { resolveTerritorialColor } from './color-adapter.js';

// One material contract for all objects. Independent regions never claim land
// ownership or inherit the general hierarchy's paint.
export function createTerritorialFillResolver({ state, entityRepository, terrainAlpha = 1, mapSubstrate = null }) {
  const cache = new Map();
  const presentation = state.layerPresentation;
  const colorVisible = feature => layerStyle(presentation, territorialSymbolGroup(feature)).colorVisible
    && layerStyle(presentation, territorialSymbolGroup(feature), `territorial:entity:${feature.id}`).colorVisible;
  function resolve(feature, visiting = new Set()) {
    const entity = entityRepository.get(feature.id) || feature;
    const id = String(entity.id), properties = entity.properties;
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) throw new Error(`객체 표시 관계가 순환합니다: ${id}`);
    visiting.add(id);
    const group = territorialSymbolGroup(entity);
    const independent = properties.entityKind === 'regional';
    const parent = independent ? null : entityRepository.parent(id);
    const inherited = parent ? resolve(parent, visiting) : null;
    const style = layerStyle(presentation, group, `territorial:entity:${id}`);
    const explicit = presentation?.objectStyles?.[`territorial:entity:${id}`] || {};
    const groupStyle = presentation?.styles?.[group] || {};
    const opacity = inherited ? explicit.opacity ?? (groupStyle.opacity !== undefined && groupStyle.opacity !== 1
      ? style.opacity : inherited.opacity) : style.opacity;
    const blendMode = inherited ? explicit.blendMode ?? (groupStyle.blendMode === 'multiply' ? 'multiply' : inherited.blendMode) : style.blendMode;
    const color = colorVisible(entity) ? resolveLayerDisplayColor(presentation, group, {
      objectKey: `territorial:entity:${id}`, explicitColor: properties.style?.color,
      inheritedColor: resolveTerritorialColor(entity, { entityRepository, colorVisible, fallback: '' }), fallbackColor: '',
    }) : '';
    const substrate = !independent && !parent && !color ? mapSubstrate : null;
    const result = Object.freeze({ color: color || substrate?.color || '', opacity, blendMode,
      fillAlpha: color ? opacity * terrainAlpha : substrate?.fillAlpha || 0,
      depth: inherited ? inherited.depth + 1 : 0,
      ownerId: independent ? '' : inherited?.ownerId || id, parentId: String(properties.parentId || '') });
    visiting.delete(id);
    cache.set(id, result);
    return result;
  }
  return resolve;
}
