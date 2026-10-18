import { createTerritorialFillResolver } from './territorial-fill-style.js';
import { layerStyle, overlayVisualOrder, territorialSymbolGroup } from './layer-presentation.js';
import { COLOR_DOMAINS, readDomainColor } from './color-adapter.js';
import { resolveMapStrokeStyle, resolveMapInteractionStyle } from './map-interaction-style.js';
import { DISTRIBUTION_MODES, DISTRIBUTION_RENDER_MODES, distributionValueRange, distributionValueAlpha } from './distribution-model.js';
import { automaticLabelSettings, labelKey, placeLabelDimensions } from './label-layout.js';
import { temporalContains, temporalMonthEnd } from './temporal.js';

/** Read-only presentation of an already admitted, month-resolved C++ document.
 * Root countries stay with the base renderer. points/labels carry geographic
 * coordinates; their owner projects them and applies label zoom/collision rules.
 */
export function buildViewerSceneItems({ documentModel, state, entityRepository, theme, selected, month }) {
  const project = documentModel.snapshot();
  const view = { ...project, ...state,
    layerVisibility: { ...project.layerVisibility, ...state.layerVisibility },
    itemVisibility: state.itemVisibility ?? project.itemVisibility };
  const presentation = view.layerPresentation;
  const result = { polygons: [], strokes: [], points: [], labels: [], searchItems: [], visibleRootIds: [] };
  const visible = (group, id, itemGroup = group) => view.layerVisibility[group] !== false
    && view.itemVisibility?.[itemGroup]?.[String(id)] !== false;
  const at = temporalMonthEnd(month);
  const active = value => temporalContains(value, at);
  const search = (feature, objectKey, group) => result.searchItems.push({ ...feature, objectKey, group });
  const order = (group, detail, objectKey) => overlayVisualOrder(presentation, group, detail, objectKey);

  function geometryItems({ feature, objectKey, keyPrefix = objectKey, group, color, fillAlpha, style, role = 'generic', boundaryVisible = style.boundaryVisible }) {
    const geometry = feature.geometry;
    const base = { objectKey, geometry, blendMode: style.blendMode };
    const stroke = resolveMapStrokeStyle({ color, layerStyle: style, theme: {
      ...theme, riverOpacity: style.opacity, lakeOpacity: style.opacity,
    } }, role);
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      result.polygons.push({ ...base, key: `${keyPrefix}:fill`, order: order(group, 'fill', objectKey),
        style: { color, fillAlpha, blendMode: style.blendMode } });
      if (boundaryVisible) result.strokes.push({ ...base, key: `${keyPrefix}:boundary`, order: order(group, 'boundary', objectKey), style: stroke });
    } else if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      if (boundaryVisible) result.strokes.push({ ...base, key: `${keyPrefix}:line`, order: order(group, 'line', objectKey), style: stroke });
    } else if (boundaryVisible && (geometry.type === 'Point' || geometry.type === 'MultiPoint')) {
      const coordinates = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
      coordinates.forEach((coordinate, index) => result.points.push({ key: `${keyPrefix}:point:${index}`,
        objectKey, id: feature.id, source: feature, group, coordinate, radius: 5,
        order: order(group, 'line', objectKey), style: { ...stroke, fillAlpha: 0 } }));
    }
  }

  const fill = createTerritorialFillResolver({ state: view, entityRepository, terrainAlpha: theme.countryColorAlpha,
    mapSubstrate: { color: theme.defaultLand, fillAlpha: theme.baseLandAlpha } });
  for (const feature of documentModel.territorialViews()) {
    const group = territorialSymbolGroup(feature), objectKey = `territorial:entity:${feature.id}`;
    if (!visible(group, feature.id)) continue;
    search(feature, objectKey, group);
    if (group === 'countries') { result.visibleRootIds.push(String(feature.id)); continue; }
    const material = fill(feature);
    result.polygons.push({ key: `${objectKey}:fill`, objectKey, geometry: feature.geometry,
      role: group === 'regions' ? 'regional-overlay' : 'territorial-fill', ownerId: material.ownerId,
      parentId: material.parentId, territoryDepth: material.depth, order: order(group, 'fill', objectKey),
      blendMode: material.blendMode, style: { color: material.color, fillAlpha: material.fillAlpha, blendMode: material.blendMode } });
    const style = layerStyle(presentation, group, objectKey);
    if (style.boundaryVisible) result.strokes.push({ key: `${objectKey}:boundary`, objectKey, geometry: feature.geometry,
      order: order(group, 'boundary', objectKey), style: resolveMapStrokeStyle({ color: theme.border, layerStyle: style }, group === 'regions' ? 'region' : 'subunit') });
  }

  for (const feature of project.genericFeatures) {
    if (!visible('genericFeatures', feature.id)) continue;
    const objectKey = `generic:feature:${feature.id}`, style = layerStyle(presentation, 'genericFeatures', objectKey);
    const color = readDomainColor(COLOR_DOMAINS.GENERIC, { feature }).value;
    search(feature, objectKey, 'genericFeatures');
    geometryItems({ feature, objectKey, group: 'genericFeatures', color,
      fillAlpha: style.colorVisible ? 0.34 * style.opacity : 0, style });
  }
  for (const feature of project.hydroEdits) {
    const lake = feature.properties.category === 'lake', group = lake ? 'lakes' : 'rivers';
    if (!visible(group, feature.id, 'hydro')) continue;
    const objectKey = `hydro:${feature.properties.category}:${feature.id}`, style = layerStyle(presentation, group, objectKey);
    search(feature, objectKey, 'hydro');
    geometryItems({ feature, objectKey, group, color: feature.properties.editorColor || theme.ocean,
      fillAlpha: style.colorVisible ? style.opacity : 0, style, role: lake ? 'hydro-boundary' : 'river' });
  }
  for (const label of project.labels) {
    const objectKey = `label:${label.kind}:${label.id}`, style = layerStyle(presentation, 'labels', objectKey);
    if (!visible('labels', label.id) || !style.labelsVisible) continue;
    const settings = automaticLabelSettings(label.kind, project.labelSettings[labelKey('label', label.id)]);
    const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
    const rows = [{ language: 'ko', text: label.name }];
    result.labels.push({ key: labelKey('label', label.id), objectKey, id: label.id, source: label,
      coordinate, text: label.name, rows, ...placeLabelDimensions(rows), ...settings,
      minZoom: Math.max(settings.minZoom, Number(label.minZoom || 0)), style });
    search({ type: 'Feature', id: label.id, geometry: { type: 'Point', coordinates: coordinate },
      properties: { name: label.name, notes: label.notes } }, objectKey, 'labels');
  }

  const layers = project.distributionLayers.filter(layer => visible('distributions', layer.id) && active(layer));
  const settings = view.distributionSettings;
  const activeId = layers.some(layer => layer.id === settings.activeLayerId) ? settings.activeLayerId : layers[0]?.id;
  for (const layer of layers) {
    if (settings.renderMode === DISTRIBUTION_RENDER_MODES.SINGLE && layer.id !== activeId) continue;
    const entries = project.distributionEntries.filter(entry => entry.layerId === layer.id && active(entry));
    const range = distributionValueRange(layer, entries), objectKey = `distribution:distribution:${layer.id}`;
    const style = layerStyle(presentation, 'distributions', objectKey);
    const color = readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }).value;
    for (const entry of entries) {
      const geometry = entry.mode === DISTRIBUTION_MODES.TERRITORIAL ? entityRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
      if (!geometry) continue; // Referenced territory may not exist at the current month.
      const feature = { type: 'Feature', id: entry.id, geometry,
        properties: { name: layer.name, notes: layer.unit, value: entry.value, unit: layer.unit, layerId: layer.id } };
      search(feature, objectKey, 'distributions');
      geometryItems({ feature, objectKey, keyPrefix: `distribution-entry:${entry.id}`, group: 'distributions', color,
        fillAlpha: style.colorVisible ? distributionValueAlpha(entry.value, range, style.opacity) : 0,
        style, role: 'distribution', boundaryVisible: settings.boundaryVisible && style.boundaryVisible });
    }
  }
  const selectedKey = selected?.objectKey || (selected?.properties?.entityKind ? `territorial:entity:${selected.id}` : '');
  const selectedFeature = selected && (result.searchItems.find(feature => feature.objectKey === selectedKey && feature.id === selected.id)
    || (selected.selectionRef && ['placeBuiltin','hydroBuiltin'].includes(selected.selectionRef.domain) ? selected : null));
  if (selectedFeature?.geometry) {
    const style = resolveMapStrokeStyle(resolveMapInteractionStyle(), 'primary');
    const geometry = selectedFeature.geometry;
    if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
      const coordinates = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
      coordinates.forEach((coordinate, index) => result.points.push({ key: `viewer-selection:${index}`, objectKey: selectedKey,
        id: selectedFeature.id, source: selectedFeature, coordinate, radius: 5, style }));
    }
    else result.strokes.push({ key: 'viewer-selection', objectKey: selectedKey, geometry, order: 10000, style });
  }
  return result;
}
