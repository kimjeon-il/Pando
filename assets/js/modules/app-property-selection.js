/** PropertySelection: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createPropertySelection() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('property-selection already connected');
    dependencies = ports;
  }

  function setEditorShellView(view, { focus = false } = {}) {
    const requested = view === 'relation' ? 'relation' : view === 'actions' ? 'actions' : 'info';
    const tab = requested === 'relation' ? (0, dependencies.$)('relationTabBtn') : requested === 'actions' ? (0, dependencies.$)('actionsTabBtn') : (0, dependencies.$)('editorTabBtn');
    const active = requested !== 'info' && (tab?.hidden || tab?.getAttribute('aria-disabled') === 'true') ? 'info' : requested;
    (0, dependencies.$)('rightPanel')?.setAttribute('data-editor-view', active);
    dependencies.editorSurfaceTabs?.sync(active, { focus });
  }

  function replaceSelectOptions(select, options, selectedValue = '') {
    if (!select) return;
    select.replaceChildren(...options.map(option => {
      const element = document.createElement('option');
      element.value = String(option.value ?? '');
      element.textContent = String(option.label ?? option.value ?? '');
      if (option.searchText) element.dataset.searchText = String(option.searchText);
      return element;
    }));
    select.value = String(selectedValue || '');
  }

  function territorialUnitCountryOptions() {
    return [
      { value: '', label: '소속 국가 미지정' },
      ...(dependencies.state.countriesData?.features || []).map(feature => {
        const properties = feature.properties || {};
        return {
          value: String(feature.id || ''),
          label: (0, dependencies.countryName)(feature),
          searchText: [properties.name, feature.id].filter(Boolean).join(' '),
        };
      }).sort((a, b) => dependencies.layerNameCollator.compare(a.label, b.label)),
    ];
  }

  function territorialUnitParentOptions(feature) {
    const countryId = String(feature?.properties?.sovereignId || '');
    const options = (0, dependencies.subunitParentChoices)(countryId, dependencies.state.countriesData.features, dependencies.state.territorialUnits, {
      exclude: [feature.id], name: item => item.properties?.unitType ? (0, dependencies.territorialUnitName)(item) : (0, dependencies.countryName)(item),
    });
    const parentId = String(feature.properties?.parentId || '');
    if (!options.some(option => option.value === parentId)) {
      const parent = (0, dependencies.territorialUnitById)(parentId) || (0, dependencies.countryFeatureById)(parentId);
      options.push({ value: parentId, label: parent ? `${parent.properties?.name || parentId} · 기존 소속` : parentId ? `${parentId} · 기존 소속` : '상위 소속 없음' });
    }
    return options;
  }

  function territorialParentOptions(feature) {
    const excluded = new Set([String(feature?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of (0, dependencies.territorialChildren)(dependencies.state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: '', label: '상위 소속 없음' },
      ...dependencies.territorialRepository.list()
        .filter(candidate => !excluded.has(String(candidate.id)))
        .map(candidate => ({
          value: String(candidate.id),
          label: `${candidate.properties?.name || (0, dependencies.territorialUnitName)(candidate)} · ${(0, dependencies.territorialTypeLabel)(candidate.properties?.unitType)}`,
        }))
        .sort((left, right) => dependencies.layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function distributionLayerById(id) {
    return dependencies.distributionService.getLayer(id);
  }

  function distributionEntryLabel(entry) {
    if (entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL) return dependencies.territorialRepository.get(entry.territorialUnitId)?.properties?.name || entry.territorialUnitId;
    return '자유 영역';
  }

  function commitDistributionMeta(field, value) {
    if (dependencies.state.selected?.domain !== 'distribution') return false;
    const layer = distributionLayerById(dependencies.state.selected.id);
    if (!layer) return false;
    if (layer.locked && field !== 'locked') {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 분포 항목을 변경할 수 있습니다.', 'error', 3200);
      applyDistributionSelectionIntent(layer.id, true);
      return false;
    }
    const result = dependencies.distributionService.updateLayer(layer.id, field, value);
    if (!result.ok) {
      if (result.code === 'invalid') (0, dependencies.setActionStatus)('자기 자신이나 하위 분류를 상위 분류로 설정할 수 없습니다.', 'error', 3600);
      applyDistributionSelectionIntent(layer.id, true);
      return false;
    }
    if (field === 'locked') dependencies.layerTreeController?.syncLocks([{ domain: 'distribution', type: layer.type, id: layer.id }]);
    else (0, dependencies.markLayerTreeDirty)();
    applyDistributionSelectionIntent(layer.id, true);
    (0, dependencies.setActionStatus)(`${dependencies.DISTRIBUTION_TYPE_LABELS[layer.type]} 정보를 변경했습니다.`, 'success');
    return true;
  }

  function createDistributionLayerFromPrompt(type) {
    const label = dependencies.DISTRIBUTION_TYPE_LABELS[type];
    const name = prompt(`새 ${label} 항목의 이름을 입력하세요.`, `새 ${label}`);
    if (name === null) return false;
    const layer = dependencies.distributionService.createLayer({
      id: (0, dependencies.uid)(`distribution_${type}`),
      type,
      name: name.trim() || `새 ${label}`,
      color: dependencies.COLOR_PRESETS[dependencies.state.distributionLayers.length % dependencies.COLOR_PRESETS.length] || dependencies.DEFAULT_GENERIC_FEATURE_COLOR,
    });

    (0, dependencies.markLayerTreeDirty)();
    dependencies.layerTreeController?.render(true);
    applyDistributionSelectionIntent(layer.id);
    (0, dependencies.setActionStatus)(`${layer.name} ${label} 항목을 추가했습니다. 분포를 이어서 입력하세요.`, 'success', 3600);
    return true;
  }

  function addTerritorialDistributionEntry() {
    const layer = dependencies.state.selected?.domain === 'distribution' ? distributionLayerById(dependencies.state.selected.id) : null;
    const territorialUnitId = (0, dependencies.$)('distributionTerritorialUnitInput').value;
    if (!layer || layer.locked || !dependencies.territorialRepository.get(territorialUnitId)) return false;
    let entry;
    try {
      entry = (0, dependencies.createDistributionEntry)({
        id: (0, dependencies.uid)(),
        layerId: layer.id,
        mode: dependencies.DISTRIBUTION_MODES.TERRITORIAL,
        territorialUnitId,
        share: Number((0, dependencies.$)('distributionShareInput').value),
      });
    } catch (error) {
      const validationMessage = (0, dependencies.compactNotificationMessage)(error?.message || '분포 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      (0, dependencies.setActionStatus)(validationMessage, 'error', 0);
      return false;
    }
    const result = dependencies.distributionService.addEntry(entry);
    if (!result.ok) return false;
    applyDistributionSelectionIntent(layer.id, true);
    (0, dependencies.setActionStatus)(`${distributionEntryLabel(result.entry)}에 ${layer.name} 분포를 추가했습니다.`, 'success');
    return true;
  }

  function startGeometryDistributionDraft() {
    const layer = dependencies.state.selected?.domain === 'distribution' ? distributionLayerById(dependencies.state.selected.id) : null;
    if (!layer || layer.locked) return false;
    const share = Number((0, dependencies.$)('distributionShareInput').value);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      (0, dependencies.setActionStatus)('분포 비율은 0~100 범위의 숫자여야 합니다.', 'error', 0);
      return false;
    }
    dependencies.state.distributionDraft = { layerId: layer.id, share };
    dependencies.editingDomain?.setTool('polygon', { announce: false });
    (0, dependencies.setModeBanner)('분포 영역을 그리세요.');
    return true;
  }

  function removeDistributionEntry(id) {
    const entry = dependencies.state.distributionEntries.find(candidate => candidate.id === String(id));
    const layer = entry ? distributionLayerById(entry.layerId) : null;
    if (!entry || !layer || layer.locked) return false;
    const result = dependencies.distributionService.removeEntry(entry.id);
    if (!result.ok) return false;
    applyDistributionSelectionIntent(layer.id, true);
    (0, dependencies.setActionStatus)('분포 엔트리를 삭제했습니다.', 'success');
    return true;
  }

  function deleteDistributionLayer(id, { confirm = true } = {}) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    if (layer.locked) {
      (0, dependencies.setActionStatus)('잠금을 해제한 뒤 분포 항목을 삭제할 수 있습니다.', 'error', 3200);
      return false;
    }
    const performDelete = () => {
      const result = dependencies.distributionService.deleteLayer(layer.id);
      if (!result.ok) return false;
      if (dependencies.state.selectedDistributionLayerId === layer.id) dependencies.state.selectedDistributionLayerId = '';
      (0, dependencies.markLayerTreeDirty)();
      dependencies.selectionUiController.clear({ reason: 'distribution-delete-selection-clear' });
      (0, dependencies.setActionStatus)(`${layer.name} ${dependencies.DISTRIBUTION_TYPE_LABELS[layer.type]} 항목을 삭제했습니다.`, 'success');
      return true;
    };
    if (!confirm) {
      performDelete();
      return true;
    }
    (0, dependencies.openConfirmModal)({
      title: `${dependencies.DISTRIBUTION_TYPE_LABELS[layer.type]} 삭제`,
      message: `${layer.name}과 연결된 분포 ${(0, dependencies.distributionEntriesForLayer)(dependencies.state.distributionEntries, layer.id).length}개를 함께 삭제합니다.`,
      impacts: [`${dependencies.DISTRIBUTION_TYPE_LABELS[layer.type]} 항목 1개 삭제`, `연결된 분포 ${(0, dependencies.distributionEntriesForLayer)(dependencies.state.distributionEntries, layer.id).length}개 삭제`],
      confirmText: '분포 항목 삭제',
      danger: true,
      onConfirm: performDelete,
    });
    return true;
  }

  function setDistributionLayerVisible(id, visible) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    const group = dependencies.DISTRIBUTION_TYPE_GROUPS[layer.type];
    if (!dependencies.state.itemVisibility[group]) dependencies.state.itemVisibility[group] = {};
    if (visible === false) dependencies.state.itemVisibility[group][layer.id] = false;
    else delete dependencies.state.itemVisibility[group][layer.id];
    dependencies.distributionVisibilityRevision += 1;
    (0, dependencies.markLayerTreeDirty)();
    dependencies.renderingDomain?.invalidateOverlayStyle?.('distribution-layer-visibility');
    dependencies.projectDomain.queuePresentationAutosave();
    return true;
  }

  function applyTerritorialSelectionIntent(type, id, refreshOnly = false) {
    const unitType = String(type || (0, dependencies.territorialUnitById)(id)?.properties?.unitType || '');
    if (unitType === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      return dependencies.selectionUiController.applyIntent((0, dependencies.countryObjectRef)(id), { refreshOnly, openEditor: !refreshOnly });
    }
    const unit = (0, dependencies.territorialUnitById)(id);
    if (!unit || unit.properties?.unitType !== unitType) return false;
    return dependencies.selectionUiController.applyIntent((0, dependencies.normalizeObjectRef)({ domain: 'territorial', type: unitType, id }), { refreshOnly, openEditor: !refreshOnly });
  }

  function setTerritorialUnitName(type, id, name) {
    if (!applyTerritorialSelectionIntent(type, id, true)) return false;
    if (type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) (0, dependencies.commitCountryEdit)('name', name);
    else (0, dependencies.commitTerritorialUnitMeta)('name', name);
    return true;
  }

  function setTerritorialUnitColor(type, id, color) {
    if (!applyTerritorialSelectionIntent(type, id, true)) return false;
    if (type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) (0, dependencies.commitCountryEdit)('color', color);
    else (0, dependencies.commitTerritorialUnitMeta)('color', color);
    return true;
  }

  function setTerritorialUnitLocked(type, id, locked) {
    const key = String(id || '');
    const result = dependencies.territorialApplicationService.setLocked(type, key, locked, {
      history: type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
        ? { description: `${(0, dependencies.countryName)((0, dependencies.countryFeatureById)(key))} ${locked ? '잠금' : '잠금 해제'}` }
        : {},
    });
    if (!result.ok) return false;
    if (!result.changed) return true;
    dependencies.layerTreeController?.syncLocks([{ domain: 'territorial', type, id: key }]);
    if (type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && String(dependencies.state.selected.id) === key) dependencies.countryPropertyController.refresh((0, dependencies.countryObjectRef)(key));
      (0, dependencies.syncBatchActionAvailability)();
    } else dependencies.objectPropertyController.presentTerritorial(key, true);
    return true;
  }

  function hydroEditorName(value, fallback) {
    const name = String(value || '').trim();
    if (/^미명명 수계(?:\s+\d+)?$/.test(name)) return fallback;
    return name || fallback;
  }

  async function copySelectedHydroForEditing() {
    if (dependencies.state.selected?.domain !== 'hydro') return;
    let source = (0, dependencies.builtInHydroFeatureById)(dependencies.state.selected.id);
    if (!source) {
      (0, dependencies.setActionStatus)('복사할 강·호수 객체를 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
      return;
    }
    if (!source.geometry || (source.properties?.category === 'river' && Number(source.properties?.fragment_count || 1) > 1)) {
      (0, dependencies.setActionStatus)('강·호수 전체 형상을 준비하는 중입니다.', 'working', 0);
      try {
        source = await dependencies.gpuMapRenderer.loadHydroLogicalFeature(Number(source.properties.__logicalFid));
      } catch (error) {
        (0, dependencies.reportOperationError)(error, '강·호수 전체 형상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', 'PL-WATER-002', 0);
        return;
      }
      if (!source) {
        (0, dependencies.setActionStatus)('강·호수 전체 형상을 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
        return;
      }
    }
    dependencies.projectDomain.recordHistory();
    const category = source.properties?.category === 'lake' ? 'lake' : 'river';
    const copy = {
      type: 'Feature',
      id: (0, dependencies.uid)(category),
      geometry: (0, dependencies.deepClone)(source.geometry),
      properties: {
        name: source.properties?.name || '',
        category,
        editorColor: dependencies.HYDRO_TOOL_CONFIG[category].color,
        notes: `판도연구소 내장 ${(0, dependencies.hydroCategoryLabel)(category)} 편집용 복사본 · 원본 ${source.properties?.pandolab_id || source.id}`,
        source: source.properties?.source || `판도연구소 내장 ${(0, dependencies.hydroCategoryLabel)(category)}`,
        sourceFeatureId: source.properties?.pandolab_id || source.id,
      },
    };
    (0, dependencies.normalizeHydroEdit)(copy);
    dependencies.state.hydroEdits.push(copy);
    dependencies.state.physicalSettings.hiddenHydroIds[String(source.properties?.pandolab_id || source.id)] = true;
    dependencies.gpuMapRenderer.invalidateHydroVisibility();
    (0, dependencies.markLayerTreeDirty)();
    applyHydroSelectionIntent(String(copy.id));
    dependencies.renderingDomain?.invalidateHydroPatch?.('hydro-edit-copy');
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)(`${source.properties?.name || (category === 'lake' ? '호수' : '강')} 편집 복사본을 만들었습니다.`, 'success', 3600);
  }

  function applyCountrySelectionIntent(id, refreshOnly = false) {
    return dependencies.selectionUiController.applyIntent(
      (0, dependencies.countryObjectRef)(id),
      { refreshOnly, openEditor: !refreshOnly, reason: 'country-selection' },
    );
  }

  function applyTerritorialUnitSelectionIntent(id, refreshOnly = false) {
    const feature = (0, dependencies.territorialUnitById)(id);
    return feature ? dependencies.selectionUiController.applyIntent((0, dependencies.normalizeObjectRef)({
      domain: 'territorial',
      type: feature.properties?.unitType || dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT,
      id: String(id),
    }), { refreshOnly, openEditor: !refreshOnly, reason: 'territorial-selection' }) : false;
  }

  function applyDistributionSelectionIntent(id, refreshOnly = false) {
    const layer = distributionLayerById(id);
    return layer ? dependencies.selectionUiController.applyIntent((0, dependencies.normalizeObjectRef)({ domain: 'distribution', type: layer.type, id: layer.id }), {
      refreshOnly, openEditor: !refreshOnly, reason: 'distribution-selection',
    }) : false;
  }

  function applyGenericSelectionIntent(id, refreshOnly = false) {
    return dependencies.selectionUiController.applyIntent(
      (0, dependencies.normalizeObjectRef)({ domain: 'generic', type: 'feature', id: String(id) }),
      { refreshOnly, openEditor: !refreshOnly, reason: 'generic-selection' },
    );
  }

  function applyLabelSelectionIntent(id, refreshOnly = false) {
    const label = dependencies.state.labels.find(item => String(item.id) === String(id));
    return label ? dependencies.selectionUiController.applyIntent((0, dependencies.normalizeObjectRef)({ domain: 'label', type: label.kind || 'label', id: String(id) }), {
      refreshOnly, openEditor: !refreshOnly, reason: 'label-selection',
    }) : false;
  }

  function applyHydroSelectionIntent(id, refreshOnly = false) {
    const feature = (0, dependencies.hydroFeatureById)(id);
    const selectedId = String((0, dependencies.hydroEditById)(id) ? feature?.id : feature?.properties?.pandolab_id || feature?.id || id);
    return feature ? dependencies.selectionUiController.applyIntent((0, dependencies.normalizeObjectRef)({
      domain: 'hydro', type: (0, dependencies.hydroCategoryKey)(feature.properties?.category), id: selectedId,
    }), { refreshOnly, openEditor: !refreshOnly, reason: 'hydro-selection' }) : false;
  }

  function initializePropertySelection() {
    window.PANDOLAB_TERRITORIAL = Object.freeze({
      get: id => dependencies.territorialApplicationService.get(id),
      list: options => dependencies.territorialApplicationService.list(options),
      select: applyTerritorialSelectionIntent,
      setName: setTerritorialUnitName,
      setColor: setTerritorialUnitColor,
      setLocked: setTerritorialUnitLocked,
      isLocked: (type, id) => dependencies.territorialApplicationService.isLocked(type, id),
    });

    window.PANDOLAB_DISTRIBUTIONS = Object.freeze({
      getLayer: id => distributionLayerById(id),
      listLayers: type => dependencies.distributionService.listLayers(type),
      listEntries: layerId => dependencies.distributionService.listEntries(layerId),
      select: applyDistributionSelectionIntent,
      setVisible: setDistributionLayerVisible,
    });
  }

  return Object.freeze({
    connect,
    initializePropertySelection,
    get addTerritorialDistributionEntry() { return addTerritorialDistributionEntry; },
    get applyCountrySelectionIntent() { return applyCountrySelectionIntent; },
    get applyDistributionSelectionIntent() { return applyDistributionSelectionIntent; },
    get applyGenericSelectionIntent() { return applyGenericSelectionIntent; },
    get applyHydroSelectionIntent() { return applyHydroSelectionIntent; },
    get applyLabelSelectionIntent() { return applyLabelSelectionIntent; },
    get applyTerritorialUnitSelectionIntent() { return applyTerritorialUnitSelectionIntent; },
    get commitDistributionMeta() { return commitDistributionMeta; },
    get copySelectedHydroForEditing() { return copySelectedHydroForEditing; },
    get createDistributionLayerFromPrompt() { return createDistributionLayerFromPrompt; },
    get deleteDistributionLayer() { return deleteDistributionLayer; },
    get distributionLayerById() { return distributionLayerById; },
    get hydroEditorName() { return hydroEditorName; },
    get removeDistributionEntry() { return removeDistributionEntry; },
    get replaceSelectOptions() { return replaceSelectOptions; },
    get setEditorShellView() { return setEditorShellView; },
    get startGeometryDistributionDraft() { return startGeometryDistributionDraft; },
    get territorialParentOptions() { return territorialParentOptions; },
    get territorialUnitCountryOptions() { return territorialUnitCountryOptions; },
    get territorialUnitParentOptions() { return territorialUnitParentOptions; },
  });
}
