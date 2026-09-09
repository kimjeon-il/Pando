/** LayerList: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLayerList() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('layer-list already connected');
    dependencies = ports;
  }

  function normalizeLayerItemState(value) {
    const output = {};
    for (const group of dependencies.LAYER_GROUP_KEYS) {
      const source = value?.[group];
      output[group] = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    }
    return output;
  }

  function normalizeLayerFolderState(value) {
    return Object.fromEntries((0, dependencies.activeLayerFolderKeys)().map(key => [key, !!value?.[key]]));
  }

  function markLayerTreeDirty() {
    dependencies.state.layerTreeRevision += 1;
  }

  function isLayerItemVisible(group, id) {
    if (group === 'hydro' && dependencies.HYDRO_LAYER_META[String(id)]) {
      return dependencies.state.physicalSettings.hydroLayers?.[String(id)] !== false;
    }
    return dependencies.state.itemVisibility?.[group]?.[String(id)] !== false;
  }

  function isCountryVisibleById(id) {
    return !!dependencies.state.layerVisibility.countries && isLayerItemVisible('countries', id);
  }

  function setLayerItemsVisibility(items, visible) {
    const byGroup = new Map();
    for (const item of items) {
      if (!dependencies.LAYER_GROUP_KEYS.includes(item.layerGroup)) continue;
      const ids = byGroup.get(item.layerGroup) || [];
      ids.push(String(item.id)); byGroup.set(item.layerGroup, ids);
    }
    for (const [group, ids] of byGroup) {
      if (group === 'hydro') {
        // Preserve the effective visibility of *both* built-in sources and user edits
        // before lifting a legacy river/lake master switch.
        for (const category of ['river', 'lake']) {
          const categoryItems = layerTreeItems('hydro').filter(item => item.hydroCategory === category);
          const targets = categoryItems.filter(item => ids.includes(item.id));
          if (!targets.length) continue;
          const master = category === 'river' ? 'rivers' : 'lakes';
          if (dependencies.state.layerVisibility[master] === false) {
            dependencies.state.itemVisibility.hydro ||= {};
            for (const item of categoryItems) {
              if (item.isBuiltin) dependencies.state.physicalSettings.hydroLayers[item.id] = false;
              else dependencies.state.itemVisibility.hydro[item.id] = false;
            }
            dependencies.state.layerVisibility[master] = true;
          }
          for (const item of targets) {
            if (item.isBuiltin) dependencies.state.physicalSettings.hydroLayers[item.id] = !!visible;
            else {
              dependencies.state.itemVisibility.hydro ||= {};
              if (visible) delete dependencies.state.itemVisibility.hydro[item.id];
              else dependencies.state.itemVisibility.hydro[item.id] = false;
            }
          }
        }
        dependencies.gpuMapRenderer.invalidateHydroVisibility();
      } else {
        (0, dependencies.setScopedItemVisibility)({
          layerVisibility: dependencies.state.layerVisibility, itemVisibility: dependencies.state.itemVisibility,
          group, allIds: layerTreeItems(group).map(item => item.id), ids, visible,
        });
        if (dependencies.DISTRIBUTION_GROUP_TYPES[group]) dependencies.distributionVisibilityRevision += 1;
        if (group === 'countries') dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-item-visibility');
      }
    }
    if (!byGroup.size) return;
    // Existing presentation fields are saved once for the whole bundle operation.
    for (const [group] of byGroup) {
      const masters = group === 'hydro' ? ['rivers', 'lakes'] : [group];
      for (const master of masters) { const input = (0, dependencies.$)(master + 'Visible'); if (input) input.checked = dependencies.state.layerVisibility[master] !== false; }
    }
    markLayerTreeDirty();
    dependencies.renderingDomain?.invalidateOverlayStyle?.('layer-item-visibility');
    dependencies.projectDomain.queuePresentationAutosave();
  }

  function setLayerItemVisibility(group, id, visible) {
    setLayerItemsVisibility([{ layerGroup: group, id }], visible);
  }

  function isLayerListItemVisible(group, id) {
    const master = group === 'hydro'
      ? ((0, dependencies.hydroCategoryKey)(dependencies.HYDRO_LAYER_META[id]?.category || (0, dependencies.hydroEditById)(id)?.properties?.category) === 'lake' ? 'lakes' : 'rivers')
      : group;
    return dependencies.state.layerVisibility[master] !== false && isLayerItemVisible(group, id);
  }

  function layerTreeItems(group) {
    if (group === 'countries' || group === 'countryLabels') {
      return (dependencies.state.countriesData?.features || []).map(feature => {
        const id = String(feature.id || '');
        return {
          id,
          name: (0, dependencies.countryName)(feature),
          color: (0, dependencies.countryColor)(feature),
          searchText: id,
          meta: group === 'countryLabels' && dependencies.pendingCountryLabelAnchors.has(id) ? '계산 중' : '',
          selected: (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && dependencies.state.selected.id === id,
        };
      });
    }
    if (group === 'subunits' || group === 'regions') {
      const kind = group === 'subunits'
        ? dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
        : dependencies.TERRITORIAL_UNIT_TYPES.REGION;
      return dependencies.state.territorialUnits.filter(feature => feature.properties?.unitType === kind).map(feature => {
        const countryLabel = (0, dependencies.territorialUnitCountryName)(feature);
        const levelLabel = kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT && Number(feature.properties?.adminLevel) > 0 ? `${Number(feature.properties.adminLevel)}급` : '';
        return {
          id: String(feature.id),
          name: (0, dependencies.territorialUnitName)(feature),
          color: (0, dependencies.territorialUnitColor)(feature),
          meta: levelLabel,
          searchText: `${countryLabel} ${levelLabel}`,
          folderName: kind === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
            ? `하위단위 · ${countryLabel} · ${levelLabel}`
            : kind === dependencies.TERRITORIAL_UNIT_TYPES.REGION
            ? `지방${feature.properties?.sovereignId ? ` · ${countryLabel}` : ''}`
            : `하위단위 · ${countryLabel}`,
          countryId: String(feature.properties?.sovereignId || ''),
          parentId: String(feature.properties?.parentId || ''),
          level: Number(feature.properties?.adminLevel) || null,
          selected: (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && dependencies.state.selected.id === String(feature.id),
        };
      });
    }
    if (dependencies.DISTRIBUTION_GROUP_TYPES[group]) {
      const type = dependencies.DISTRIBUTION_GROUP_TYPES[group];
      return dependencies.state.distributionLayers.filter(layer => layer.type === type).map(layer => ({
        id: layer.id,
        name: layer.name,
        color: (0, dependencies.distributionColor)(layer),
        folderName: dependencies.layerGroupNames[group],
        selected: dependencies.state.selected?.domain === 'distribution' && dependencies.state.selected.id === layer.id,
      }));
    }
    if (group === 'hydro') {
      const builtIns = Object.entries(dependencies.HYDRO_LAYER_META).map(([id, meta]) => ({
          id,
          name: meta.sourceLabel,
          searchText: `${meta.label} ${meta.sourceLabel}`,
          title: `${meta.sourceLabel} 상태 보기`,
          color: (0, dependencies.hydroDisplayColor)(meta.category),
          folderName: meta.label,
          hydroCategory: (0, dependencies.hydroCategoryKey)(meta.category),
          layerGroup: 'hydro',
          isBuiltin: true,
          selected: false,
        }));
      const userItems = dependencies.state.hydroEdits.map(feature => ({
        id: String(feature.id),
        name: (0, dependencies.hydroEditorName)(feature.properties?.name, (0, dependencies.hydroFallbackName)(feature.properties?.category)),
        color: feature.properties?.editorColor || dependencies.HYDRO_TOOL_CONFIG[feature.properties?.category || 'river'].color,
        meta: `${(0, dependencies.hydroCategoryLabel)(feature.properties?.category)} · 사용자`,
        folderName: (0, dependencies.hydroCategoryLabel)(feature.properties?.category),
        hydroCategory: (0, dependencies.hydroCategoryKey)(feature.properties?.category),
        layerGroup: 'hydro',
        isBuiltin: false,
        selected: dependencies.state.selected?.domain === 'hydro' && dependencies.state.selected.id === String(feature.id),
      }));
      return [...builtIns, ...userItems];
    }
    if (group === 'genericFeatures') {
      return dependencies.state.genericFeatures.map(feature => ({
        id: String(feature.id),
        name: (0, dependencies.genericFeatureName)(feature),
        color: (0, dependencies.genericFeatureColor)(feature),
        meta: `${(0, dependencies.genericFeatureRoleLabel)(feature)} · 사용자`,
        layerGroup: 'genericFeatures',
        selected: dependencies.state.selected?.domain === 'generic' && dependencies.state.selected.id === String(feature.id),
      }));
    }
    return dependencies.state.labels.map(label => ({
      id: String(label.id),
      name: label.name || '이름 없는 지명',
      icon: 'place',
      meta: label.kind || '지명',
      selected: dependencies.state.selected?.domain === 'label' && dependencies.state.selected.id === String(label.id),
    }));
  }

  function pruneLayerItemVisibility() {
    const valid = {
      countries: new Set((dependencies.state.countriesData?.features || []).map(feature => String(feature.id || ''))),
      countryLabels: new Set((0, dependencies.builtinRenderCountries)().labelById.keys()),
      subunits: new Set(dependencies.state.territorialUnits.filter(feature => feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT).map(feature => String(feature.id))),
      regions: new Set(dependencies.state.territorialUnits.filter(feature => feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION).map(feature => String(feature.id))),
      languages: new Set(dependencies.state.distributionLayers.filter(layer => layer.type === dependencies.DISTRIBUTION_TYPES.LANGUAGE).map(layer => layer.id)),
      ethnicities: new Set(dependencies.state.distributionLayers.filter(layer => layer.type === dependencies.DISTRIBUTION_TYPES.ETHNICITY).map(layer => layer.id)),
      religions: new Set(dependencies.state.distributionLayers.filter(layer => layer.type === dependencies.DISTRIBUTION_TYPES.RELIGION).map(layer => layer.id)),
      hydro: new Set([...Object.keys(dependencies.HYDRO_LAYER_META), ...dependencies.state.hydroEdits.map(feature => String(feature.id))]),
      genericFeatures: new Set(dependencies.state.genericFeatures.map(feature => String(feature.id))),
      labels: new Set(dependencies.state.labels.map(label => String(label.id))),
    };
    for (const group of dependencies.LAYER_GROUP_KEYS) {
      dependencies.state.itemVisibility[group] ||= {};
      for (const id of Object.keys(dependencies.state.itemVisibility[group])) if (!valid[group].has(id)) delete dependencies.state.itemVisibility[group][id];
    }

    dependencies.selectionDomain?.prune?.(null, { reason: 'prune-invalid-selection' });
  }



  return Object.freeze({
    connect,

    get isCountryVisibleById() { return isCountryVisibleById; },
    get isLayerItemVisible() { return isLayerItemVisible; },
    get isLayerListItemVisible() { return isLayerListItemVisible; },
    get layerTreeItems() { return layerTreeItems; },
    get markLayerTreeDirty() { return markLayerTreeDirty; },
    get normalizeLayerFolderState() { return normalizeLayerFolderState; },
    get normalizeLayerItemState() { return normalizeLayerItemState; },
    get pruneLayerItemVisibility() { return pruneLayerItemVisibility; },
    get setLayerItemVisibility() { return setLayerItemVisibility; },
    get setLayerItemsVisibility() { return setLayerItemsVisibility; },
  });
}
