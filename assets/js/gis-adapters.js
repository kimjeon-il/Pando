(function(global) {
  'use strict';

  const TERRITORIAL_TABLES = Object.freeze({
    territory: 'territories',
    admin: 'administrative_units',
    region: 'historical_regions',
  });
  const DISTRIBUTION_TABLES = Object.freeze({
    language: 'language_distribution',
    ethnicity: 'ethnicity_distribution',
    religion: 'religion_distribution',
  });
  const DISTRIBUTION_TYPES_BY_TABLE = Object.freeze(Object.fromEntries(Object.entries(DISTRIBUTION_TABLES).map(([type, table]) => [table, type])));
  const TERRITORIAL_TYPES_BY_TABLE = Object.freeze({
    ...Object.fromEntries(Object.entries(TERRITORIAL_TABLES).map(([type, table]) => [table, type])),
  });
  const clone = value => value == null ? value : structuredClone(value);
  const text = value => String(value ?? '').trim();
  const polygonGeometry = geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type) ? clone(geometry) : null;
  const parseJson = (value, fallback = {}) => {
    if (!value) return clone(fallback);
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed && typeof parsed === 'object' ? parsed : clone(fallback);
    } catch (_) {
      return clone(fallback);
    }
  };

  function countryGeometryIndex(state) {
    const index = new Map();
    for (const feature of state?.countriesData?.features || []) {
      const id = text(feature?.properties?.editor_id || feature?.properties?.iso_a3 || feature?.id);
      if (id && polygonGeometry(feature?.geometry)) index.set(id, feature.geometry);
    }
    for (const feature of state?.territorialUnits || []) {
      const id = text(feature?.id);
      if (id && polygonGeometry(feature?.geometry)) index.set(id, feature.geometry);
    }
    return index;
  }

  function territorialRows(state) {
    const rows = Object.fromEntries(Object.values(TERRITORIAL_TABLES).map(table => [table, []]));
    for (const item of state?.territorialUnits || []) {
      const properties = item?.properties || {};
      const unitType = text(properties.unitType);
      const table = TERRITORIAL_TABLES[unitType];
      const geometry = polygonGeometry(item?.geometry);
      if (!table || !geometry) continue;
      rows[table].push({
        geometry,
        id: text(item.id),
        name: text(properties.name),
        type: unitType,
        parent_id: text(properties.parentId),
        sovereign_id: text(properties.sovereignId),
        admin_level: unitType === 'admin' ? Number(properties.adminLevel ?? 1) : null,
        status: text(properties.status) || 'assigned',
        valid_from: text(properties.validFrom),
        valid_to: text(properties.validTo),
        color: text(properties.style?.color),
        style_key: text(properties.style?.key),
        source_library_id: text(properties.sourceLibraryId),
        source_geometry_version: text(properties.sourceGeometryVersion),
        metadata_json: JSON.stringify(properties.metadata || {}),
        properties_json: JSON.stringify(properties),
      });
    }
    return rows;
  }

  function distributionRows(state) {
    const rows = Object.fromEntries(Object.values(DISTRIBUTION_TABLES).map(table => [table, []]));
    const layers = new Map((state?.distributionLayers || []).map(layer => [text(layer.id), layer]));
    const geometryIndex = countryGeometryIndex(state);
    for (const entry of state?.distributionEntries || []) {
      const layer = layers.get(text(entry.layerId));
      const table = DISTRIBUTION_TABLES[layer?.type];
      const sourceMode = text(entry.mode) === 'region' ? 'region' : 'geometry';
      const geometry = sourceMode === 'region' ? polygonGeometry(geometryIndex.get(text(entry.regionId))) : polygonGeometry(entry.geometry);
      if (!table || !geometry) continue;
      rows[table].push({
        geometry,
        entry_id: text(entry.id),
        layer_id: text(layer.id),
        name: text(layer.name),
        distribution_type: text(layer.type),
        parent_layer_id: text(layer.parentId),
        color: text(layer.color),
        layer_visible: layer.visible === false ? 0 : 1,
        layer_locked: layer.locked === true ? 1 : 0,
        source_mode: sourceMode,
        region_id: sourceMode === 'region' ? text(entry.regionId) : '',
        share: Math.max(0, Math.min(100, Number(entry.share) || 0)),
        certainty: text(entry.certainty) || 'unknown',
        valid_from: text(entry.validFrom),
        valid_to: text(entry.validTo),
        layer_metadata_json: JSON.stringify(layer.metadata || {}),
        entry_metadata_json: JSON.stringify(entry.metadata || {}),
      });
    }
    return rows;
  }

  function importTerritorialFeature(feature, tableName, index = 0) {
    const properties = feature?.properties || {};
    const unitType = TERRITORIAL_TYPES_BY_TABLE[tableName];
    const geometry = polygonGeometry(feature?.geometry);
    if (!unitType || !geometry) return null;
    const currentProperties = parseJson(properties.properties_json);
    const id = text(properties.id || feature.id);
    if (!id) throw new Error(`영역 원본 ID가 비어 있습니다: ${unitType} ${index + 1}`);
    return {
      type: 'Feature',
      id,
      properties: {
        ...currentProperties,
        schemaVersion: 1,
        unitType,
        name: text(properties.name ?? currentProperties.name) || id,
        parentId: text(properties.parent_id ?? currentProperties.parentId),
        sovereignId: text(properties.sovereign_id ?? currentProperties.sovereignId),
        adminLevel: unitType === 'admin' ? Math.max(1, Number(properties.admin_level ?? currentProperties.adminLevel ?? 1)) : null,
        coverageMode: unitType === 'region' ? 'explicit' : text(currentProperties.coverageMode) || 'partition',
        status: text(properties.status ?? currentProperties.status) || 'assigned',
        validFrom: text(properties.valid_from ?? currentProperties.validFrom) || null,
        validTo: text(properties.valid_to ?? currentProperties.validTo) || null,
        style: {
          ...(currentProperties.style || {}),
          color: text(properties.color ?? currentProperties.style?.color),
          key: text(properties.style_key ?? currentProperties.style?.key),
        },
        sourceLibraryId: text(properties.source_library_id ?? currentProperties.sourceLibraryId),
        sourceGeometryVersion: text(properties.source_geometry_version ?? currentProperties.sourceGeometryVersion),
        metadata: parseJson(properties.metadata_json, currentProperties.metadata || {}),
      },
      geometry,
    };
  }

  function importDistributionFeature(feature, tableName, index = 0) {
    const properties = feature?.properties || {};
    const type = DISTRIBUTION_TYPES_BY_TABLE[tableName];
    const geometry = polygonGeometry(feature?.geometry);
    if (!type || !geometry) return null;
    const layerId = text(properties.layer_id) || `${type}:${index + 1}`;
    const entryId = text(properties.entry_id || feature.id) || `${layerId}:entry:${index + 1}`;
    const sourceMode = text(properties.source_mode) === 'region' && text(properties.region_id) ? 'region' : 'geometry';
    return {
      layer: {
        id: layerId,
        schemaVersion: 1,
        type,
        name: text(properties.name) || layerId,
        color: text(properties.color) || '#8c68d8',
        visible: Number(properties.layer_visible ?? 1) !== 0,
        locked: Number(properties.layer_locked ?? 0) === 1,
        parentId: text(properties.parent_layer_id),
        metadata: parseJson(properties.layer_metadata_json),
      },
      entry: {
        id: entryId,
        schemaVersion: 1,
        layerId,
        mode: sourceMode,
        regionId: sourceMode === 'region' ? text(properties.region_id) : '',
        geometry: sourceMode === 'geometry' ? geometry : null,
        share: Math.max(0, Math.min(100, Number(properties.share) || 0)),
        certainty: text(properties.certainty) || 'unknown',
        validFrom: text(properties.valid_from) || null,
        validTo: text(properties.valid_to) || null,
        metadata: parseJson(properties.entry_metadata_json),
      },
    };
  }

  function mergeDistributionFeatures(collections, existingLayers = []) {
    const layerMap = new Map((existingLayers || []).map(layer => [text(layer.id), clone(layer)]));
    const entries = [];
    const entryIds = new Set();
    for (const { tableName, features } of collections || []) {
      for (let index = 0; index < (features || []).length; index += 1) {
        const imported = importDistributionFeature(features[index], tableName, index);
        if (!imported) continue;
        const current = layerMap.get(imported.layer.id);
        if (current && current.type !== imported.layer.type) throw new Error(`분포 레이어 ID 충돌: ${imported.layer.id}`);
        layerMap.set(imported.layer.id, { ...(current || {}), ...imported.layer });
        if (entryIds.has(imported.entry.id)) throw new Error(`분포 엔트리 ID 충돌: ${imported.entry.id}`);
        entryIds.add(imported.entry.id);
        entries.push(imported.entry);
      }
    }
    return { layers: [...layerMap.values()], entries };
  }

  global.PandoLabGisAdapters = Object.freeze({
    TERRITORIAL_TABLES,
    TERRITORIAL_TYPES_BY_TABLE,
    DISTRIBUTION_TABLES,
    DISTRIBUTION_TYPES_BY_TABLE,
    countryGeometryIndex,
    territorialRows,
    distributionRows,
    importTerritorialFeature,
    importDistributionFeature,
    mergeDistributionFeatures,
  });
})(globalThis);
