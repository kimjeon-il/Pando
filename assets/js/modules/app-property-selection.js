/** PropertySelection: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
import { resolveSelectChoice } from './select-option-policy.js';

export function createPropertySelection() {
  let dependencies;
  const parentPreparations = new Map();
  const parentGeometryTokens = new WeakMap();
  let parentGeometrySequence = 0;
  const parentGeometryToken = geometry => {
    if (!geometry) return 0;
    if (!parentGeometryTokens.has(geometry)) parentGeometryTokens.set(geometry, ++parentGeometrySequence);
    return parentGeometryTokens.get(geometry);
  };

  function connect(ports) {
    if (dependencies) throw new Error('property-selection already connected');
    dependencies = ports;
  }

  function setEditorShellView(view, { focus = false } = {}) {
    const requested = view === 'relation' ? 'relation' : view === 'actions' ? 'actions' : 'info';
    const tabs = {
      info: (0, dependencies.platform.$)('editorTabBtn'),
      actions: (0, dependencies.platform.$)('actionsTabBtn'),
      relation: (0, dependencies.platform.$)('relationTabBtn'),
    };
    const available = key => !!tabs[key] && !tabs[key].hidden && tabs[key].getAttribute('aria-disabled') !== 'true';
    const active = available(requested) ? requested : ['info', 'actions', 'relation'].find(available) || requested;
    (0, dependencies.platform.$)('editorSurface')?.setAttribute('data-editor-view', active);
    dependencies.workspaceUiA.editorSurfaceTabs?.sync(active, { focus });
  }

  function replaceSelectOptions(select, options, selectedValue = '', { autoSelectSingle = false, preserveInvalid = false } = {}) {
    if (!select) return Object.freeze({ candidateCount: 0, invalid: false, single: false, value: '' });
    const normalized = [...(options || [])];
    const requestedValue = String(selectedValue ?? '');
    let state = resolveSelectChoice(normalized, requestedValue, { autoSelectSingle, preserveInvalid });
    if (preserveInvalid && state.invalid) {
      normalized.push({ value: requestedValue, label: `${requestedValue} · 기존 값`, disabled: true, invalid: true });
      const unresolved = resolveSelectChoice(normalized, requestedValue, { autoSelectSingle, preserveInvalid: true });
      state = Object.freeze({ ...unresolved, invalid: true, single: false, value: requestedValue });
    }
    select.replaceChildren(...normalized.map(option => {
      const element = document.createElement('option');
      element.value = String(option.value ?? '');
      element.textContent = String(option.label ?? option.value ?? '');
      if (option.searchText) element.dataset.searchText = String(option.searchText);
      if (option.tooltip) element.dataset.tooltip = String(option.tooltip);
      if (option.placeholder === true) {
        element.dataset.placeholder = 'true';
        element.disabled = true;
        element.hidden = true;
      } else {
        element.disabled = option.disabled === true;
        element.hidden = option.hidden === true;
      }
      if (option.invalid === true) element.dataset.invalid = 'true';
      return element;
    }));
    select.value = state.value;
    return Object.freeze({ ...state, value: select.value });
  }

  function territorialUnitCountryOptions() {
    return [
      { value: '', label: '소속 국가 미지정' },
      ...(dependencies.projectState.state.countriesData?.features || []).map(feature => {
        const properties = feature.properties || {};
        return {
          value: String(feature.id || ''),
          label: (0, dependencies.presentation.countryName)(feature),
          searchText: [properties.name, feature.id].filter(Boolean).join(' '),
        };
      }).sort((a, b) => dependencies.objectModelA.layerNameCollator.compare(a.label, b.label)),
    ];
  }

  function territorialUnitParentOptions(feature) {
    const countryId = String(feature?.properties?.sovereignId || '');
    const options = (0, dependencies.territorialServicesA.subunitParentChoices)(countryId, dependencies.projectState.state.countriesData.features, dependencies.projectState.state.territorialUnits, {
      exclude: [feature.id], name: item => item.properties?.unitType ? (0, dependencies.objectPresentation.territorialUnitName)(item) : (0, dependencies.presentation.countryName)(item),
    });
    const signature = JSON.stringify([parentGeometryToken(feature.geometry), feature.properties.parentId, countryId,
      options.map(option => {
        const parent = (0, dependencies.objectPresentation.territorialUnitById)(option.value) || (0, dependencies.countries.countryFeatureById)(option.value);
        return [option.value, parentGeometryToken(parent?.geometry), parent?.properties?.parentId, parent?.properties?.locked];
      })]);
    let entry = parentPreparations.get(String(feature.id));
    if (entry?.signature !== signature) {
      entry = { signature, ids: null };
      parentPreparations.set(String(feature.id), entry);
      while (parentPreparations.size > 16) parentPreparations.delete(parentPreparations.keys().next().value);
      dependencies.spatialQuery.mapEditClient.execute('territorial-parents', { payload: { targetId: String(feature.id), candidateIds: options.map(option => option.value) } },
        { jobKey: 'territorial-parents' }).then(response => {
        if (parentPreparations.get(String(feature.id)) !== entry) return;
        entry.ids = new Set(response.result.ids);
        if (String(dependencies.projectState.state.selected?.id) === String(feature.id)) dependencies.domainControllers.objectPropertyController.present(dependencies.projectState.state.selected, { refreshOnly: true });
      }).catch(() => { if (parentPreparations.get(String(feature.id)) === entry) parentPreparations.delete(String(feature.id)); });
    }
    const prepared = options.filter(option => entry.ids ? entry.ids.has(option.value) : String(option.value) === String(feature.properties.parentId));
    prepared.pending = !entry.ids;
    return prepared;
  }

  function territorialParentOptions(feature) {
    const excluded = new Set([String(feature?.id || '')]);
    const queue = [...excluded];
    while (queue.length) {
      const current = queue.shift();
      for (const child of (0, dependencies.territorialServicesA.territorialChildren)(dependencies.projectState.state.territorialUnits, current)) {
        if (excluded.has(String(child.id))) continue;
        excluded.add(String(child.id));
        queue.push(String(child.id));
      }
    }
    return [
      { value: '', label: '상위 단위 없음' },
      ...dependencies.presentation.territorialRepository.list()
        .filter(candidate => !excluded.has(String(candidate.id)))
        .map(candidate => ({
          value: String(candidate.id),
          label: `${candidate.properties?.name || (0, dependencies.objectPresentation.territorialUnitName)(candidate)} · ${(0, dependencies.territorialServicesB.territorialTypeLabel)(candidate.properties?.unitType)}`,
        }))
        .sort((left, right) => dependencies.objectModelA.layerNameCollator.compare(left.label, right.label)),
    ];
  }

  function distributionLayerById(id) {
    return dependencies.objectModelA.distributionService.getLayer(id);
  }

  function distributionEntryLabel(entry) {
    if (entry.mode === dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL) return dependencies.presentation.territorialRepository.get(entry.territorialUnitId)?.properties?.name || entry.territorialUnitId;
    return '자유 영역';
  }

  function commitDistributionMeta(field, value) {
    if (dependencies.projectState.state.selected?.domain !== 'distribution') return false;
    const layer = distributionLayerById(dependencies.projectState.state.selected.id);
    if (!layer) return false;
    if (layer.locked && field !== 'locked') {
      (0, dependencies.feedback.setActionStatus)('잠금을 해제한 뒤 분포 항목을 변경할 수 있습니다.', 'error', 3200);
      applyDistributionSelectionIntent(layer.id, true);
      return false;
    }
    const result = dependencies.objectModelA.distributionService.updateLayer(layer.id, field, value);
    if (!result.ok) {
      if (result.code === 'invalid') (0, dependencies.feedback.setActionStatus)('자기 자신이나 하위 분류를 상위 분류로 설정할 수 없습니다.', 'error', 3600);
      applyDistributionSelectionIntent(layer.id, true);
      return false;
    }
    if (field === 'locked') dependencies.domains.layerTreeController?.syncLocks([{ domain: 'distribution', type: layer.type, id: layer.id }]);
    else (0, dependencies.layers.markLayerTreeDirty)();
    applyDistributionSelectionIntent(layer.id, true);
    (0, dependencies.feedback.setActionStatus)(`${dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS[layer.type]} 정보를 변경했습니다.`, 'success');
    return true;
  }

  function createDistributionLayerFromPrompt(type, { beforeCreate } = {}) {
    const label = dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS[type];
    const name = prompt(`새 ${label} 항목의 이름을 입력하세요.`, `새 ${label}`);
    if (name === null) return false;
    beforeCreate?.();
    const layer = dependencies.objectModelA.distributionService.createLayer({
      id: (0, dependencies.surfaces.uid)(`distribution_${type}`),
      type,
      name: name.trim() || `새 ${label}`,
      color: dependencies.platformConfigurationA.COLOR_PRESETS[dependencies.projectState.state.distributionLayers.length % dependencies.platformConfigurationA.COLOR_PRESETS.length] || dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
    });

    (0, dependencies.layers.markLayerTreeDirty)();
    dependencies.domains.layerTreeController?.render(true);
    applyDistributionSelectionIntent(layer.id);
    (0, dependencies.feedback.setActionStatus)(`${layer.name} ${label} 항목을 추가했습니다. 분포를 이어서 입력하세요.`, 'success', 3600);
    return true;
  }

  function addTerritorialDistributionEntry() {
    const layer = dependencies.projectState.state.selected?.domain === 'distribution' ? distributionLayerById(dependencies.projectState.state.selected.id) : null;
    const territorialUnitId = (0, dependencies.platform.$)('distributionTerritorialUnitInput').value;
    if (!layer || layer.locked || !dependencies.presentation.territorialRepository.get(territorialUnitId)) return false;
    let entry;
    try {
      entry = (0, dependencies.distributionServices.createDistributionEntry)({
        id: (0, dependencies.surfaces.uid)(),
        layerId: layer.id,
        mode: dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL,
        territorialUnitId,
        share: Number((0, dependencies.platform.$)('distributionShareInput').value),
      });
    } catch (error) {
      const validationMessage = (0, dependencies.readiness.compactNotificationMessage)(error?.message || '분포 정보를 검증하지 못했습니다.', { tone: 'error', maxLength: 52 });
      (0, dependencies.feedback.setActionStatus)(validationMessage, 'error', 0);
      return false;
    }
    const result = dependencies.objectModelA.distributionService.addEntry(entry);
    if (!result.ok) return false;
    applyDistributionSelectionIntent(layer.id, true);
    (0, dependencies.feedback.setActionStatus)(`${distributionEntryLabel(result.entry)}에 ${layer.name} 분포를 추가했습니다.`, 'success');
    return true;
  }

  function startGeometryDistributionDraft() {
    const layer = dependencies.projectState.state.selected?.domain === 'distribution' ? distributionLayerById(dependencies.projectState.state.selected.id) : null;
    if (!layer || layer.locked) return false;
    const share = Number((0, dependencies.platform.$)('distributionShareInput').value);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      (0, dependencies.feedback.setActionStatus)('분포 비율은 0~100 범위의 숫자여야 합니다.', 'error', 0);
      return false;
    }
    dependencies.projectState.state.distributionDraft = { layerId: layer.id, share };
    dependencies.domains.editingDomain?.setTool('polygon', { announce: false });
    (0, dependencies.taskUi.setModeBanner)('분포 영역을 그리세요.');
    return true;
  }

  function removeDistributionEntry(id) {
    const entry = dependencies.projectState.state.distributionEntries.find(candidate => candidate.id === String(id));
    const layer = entry ? distributionLayerById(entry.layerId) : null;
    if (!entry || !layer || layer.locked) return false;
    const result = dependencies.objectModelA.distributionService.removeEntry(entry.id);
    if (!result.ok) return false;
    applyDistributionSelectionIntent(layer.id, true);
    (0, dependencies.feedback.setActionStatus)('분포 엔트리를 삭제했습니다.', 'success');
    return true;
  }

  function deleteDistributionLayer(id, { confirm = true } = {}) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    if (layer.locked) {
      (0, dependencies.feedback.setActionStatus)('잠금을 해제한 뒤 분포 항목을 삭제할 수 있습니다.', 'error', 3200);
      return false;
    }
    const performDelete = () => {
      const result = dependencies.objectModelA.distributionService.deleteLayer(layer.id);
      if (!result.ok) return false;
      if (dependencies.projectState.state.selectedDistributionLayerId === layer.id) dependencies.projectState.state.selectedDistributionLayerId = '';
      (0, dependencies.layers.markLayerTreeDirty)();
      dependencies.domains.selectionUiController.clear({ reason: 'distribution-delete-selection-clear' });
      (0, dependencies.feedback.setActionStatus)(`${layer.name} ${dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS[layer.type]} 항목을 삭제했습니다.`, 'success');
      return true;
    };
    if (!confirm) {
      performDelete();
      return true;
    }
    (0, dependencies.projectRestore.openConfirmModal)({
      title: `${dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS[layer.type]} 삭제`,
      message: `${layer.name}과 연결된 분포 ${(0, dependencies.distributionServices.distributionEntriesForLayer)(dependencies.projectState.state.distributionEntries, layer.id).length}개를 함께 삭제합니다.`,
      impacts: [`${dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS[layer.type]} 항목 1개 삭제`, `연결된 분포 ${(0, dependencies.distributionServices.distributionEntriesForLayer)(dependencies.projectState.state.distributionEntries, layer.id).length}개 삭제`],
      confirmText: '분포 항목 삭제',
      danger: true,
      onConfirm: performDelete,
    });
    return true;
  }

  function setDistributionLayerVisible(id, visible) {
    const layer = distributionLayerById(id);
    if (!layer) return false;
    const group = dependencies.distributionPresentation.DISTRIBUTION_TYPE_GROUPS[layer.type];
    if (!dependencies.projectState.state.itemVisibility[group]) dependencies.projectState.state.itemVisibility[group] = {};
    if (visible === false) dependencies.projectState.state.itemVisibility[group][layer.id] = false;
    else delete dependencies.projectState.state.itemVisibility[group][layer.id];
    dependencies.distributionPresentation.bumpVisibilityRevision();
    (0, dependencies.layers.markLayerTreeDirty)();
    dependencies.domains.renderingDomain?.invalidateOverlayStyle?.('distribution-layer-visibility');
    dependencies.domains.projectDomain.queuePresentationAutosave();
    return true;
  }

  function applyTerritorialSelectionIntent(type, id, refreshOnly = false) {
    const unitType = String(type || (0, dependencies.objectPresentation.territorialUnitById)(id)?.properties?.unitType || '');
    if (unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      return dependencies.domains.selectionUiController.applyIntent((0, dependencies.objectOperationsA.countryObjectRef)(id), { refreshOnly, openEditor: false });
    }
    const unit = (0, dependencies.objectPresentation.territorialUnitById)(id);
    if (!unit || unit.properties?.unitType !== unitType) return false;
    return dependencies.domains.selectionUiController.applyIntent((0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'territorial', type: unitType, id }), { refreshOnly, openEditor: false });
  }

  function setTerritorialUnitName(type, id, name) {
    if (!applyTerritorialSelectionIntent(type, id, true)) return false;
    if (type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) (0, dependencies.objectMetadata.commitCountryEdit)('name', name);
    else (0, dependencies.objectMetadata.commitTerritorialUnitMeta)('name', name);
    return true;
  }

  function setTerritorialUnitColor(type, id, color) {
    if (!applyTerritorialSelectionIntent(type, id, true)) return false;
    if (type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) (0, dependencies.objectMetadata.commitCountryEdit)('color', color);
    else (0, dependencies.objectMetadata.commitTerritorialUnitMeta)('color', color);
    return true;
  }

  function setTerritorialUnitLocked(type, id, locked) {
    const key = String(id || '');
    const result = dependencies.objectModelB.territorialApplicationService.setLocked(type, key, locked, {
      history: type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY
        ? { description: `${(0, dependencies.presentation.countryName)((0, dependencies.countries.countryFeatureById)(key))} ${locked ? '잠금' : '잠금 해제'}` }
        : {},
    });
    if (!result.ok) return false;
    if (!result.changed) return true;
    dependencies.domains.layerTreeController?.syncLocks([{ domain: 'territorial', type, id: key }]);
    if (type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
      if ((dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) && String(dependencies.projectState.state.selected.id) === key) dependencies.domainControllers.countryPropertyController.refresh((0, dependencies.objectOperationsA.countryObjectRef)(key));
      (0, dependencies.objectOperationsB.syncBatchActionAvailability)();
    } else if (dependencies.projectState.state.selected?.domain === 'territorial' && String(dependencies.projectState.state.selected.id) === key) {
      dependencies.domains.selectionUiController.presentPrimary({ refreshOnly: true });
    }
    (0, dependencies.objectOperationsB.syncBatchActionAvailability)();
    return true;
  }

  function hydroEditorName(value, fallback) {
    const name = String(value || '').trim();
    if (/^미명명 수계(?:\s+\d+)?$/.test(name)) return fallback;
    return name || fallback;
  }

  async function copySelectedHydroForEditing() {
    if (dependencies.projectState.state.selected?.domain !== 'hydro') return;
    let source = (0, dependencies.hydroModel.builtInHydroFeatureById)(dependencies.projectState.state.selected.id);
    if (!source) {
      (0, dependencies.feedback.setActionStatus)('복사할 강·호수 객체를 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
      return;
    }
    if (!source.geometry || (source.properties?.category === 'river' && Number(source.properties?.fragment_count || 1) > 1)) {
      (0, dependencies.feedback.setActionStatus)('강·호수 전체 형상을 준비하는 중입니다.', 'working', 0);
      try {
        source = await dependencies.rendering.gpuMapRenderer.loadHydroLogicalFeature(Number(source.properties.__logicalFid));
      } catch (error) {
        (0, dependencies.feedback.reportOperationError)(error, '강·호수 전체 형상을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', 'PL-WATER-002', 0);
        return;
      }
      if (!source) {
        (0, dependencies.feedback.setActionStatus)('강·호수 전체 형상을 찾을 수 없습니다. 다시 선택하세요.', 'error', 3200);
        return;
      }
    }
    dependencies.domains.projectDomain.recordHistory();
    const category = source.properties?.category === 'lake' ? 'lake' : 'river';
    const copy = {
      type: 'Feature',
      id: (0, dependencies.surfaces.uid)(category),
      geometry: (0, dependencies.platform.deepClone)(source.geometry),
      properties: {
        name: source.properties?.name || '',
        category,
        editorColor: dependencies.hydroPresentation.HYDRO_TOOL_CONFIG[category].color,
        notes: `판도연구소 내장 ${(0, dependencies.hydroPresentation.hydroCategoryLabel)(category)} 편집용 복사본 · 원본 ${source.properties?.pandolab_id || source.id}`,
        source: source.properties?.source || `판도연구소 내장 ${(0, dependencies.hydroPresentation.hydroCategoryLabel)(category)}`,
        sourceFeatureId: source.properties?.pandolab_id || source.id,
      },
    };
    (0, dependencies.hydroModel.normalizeHydroEdit)(copy);
    dependencies.projectState.state.hydroEdits.push(copy);
    dependencies.projectState.state.physicalSettings.hiddenHydroIds[String(source.properties?.pandolab_id || source.id)] = true;
    dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    (0, dependencies.layers.markLayerTreeDirty)();
    applyHydroSelectionIntent(String(copy.id));
    dependencies.domains.renderingDomain?.invalidateHydroPatch?.('hydro-edit-copy');
    dependencies.domains.projectDomain.queueAutosave();
    (0, dependencies.feedback.setActionStatus)(`${source.properties?.name || (category === 'lake' ? '호수' : '강')} 편집 복사본을 만들었습니다.`, 'success', 3600);
  }

  function applyCountrySelectionIntent(id, refreshOnly = false) {
    return dependencies.domains.selectionUiController.applyIntent(
      (0, dependencies.objectOperationsA.countryObjectRef)(id),
      { refreshOnly, openEditor: false, reason: 'country-selection' },
    );
  }

  function applyTerritorialUnitSelectionIntent(id, refreshOnly = false) {
    const feature = (0, dependencies.objectPresentation.territorialUnitById)(id);
    return feature ? dependencies.domains.selectionUiController.applyIntent((0, dependencies.selectionServices.normalizeObjectRef)({
      domain: 'territorial',
      type: feature.properties?.unitType || dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT,
      id: String(id),
    }), { refreshOnly, openEditor: false, reason: 'territorial-selection' }) : false;
  }

  function applyDistributionSelectionIntent(id, refreshOnly = false) {
    const layer = distributionLayerById(id);
    return layer ? dependencies.domains.selectionUiController.applyIntent((0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'distribution', type: layer.type, id: layer.id }), {
      refreshOnly, openEditor: !refreshOnly, reason: 'distribution-selection',
    }) : false;
  }

  function applyGenericSelectionIntent(id, refreshOnly = false) {
    return dependencies.domains.selectionUiController.applyIntent(
      (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'generic', type: 'feature', id: String(id) }),
      { refreshOnly, openEditor: !refreshOnly, reason: 'generic-selection' },
    );
  }

  function applyLabelSelectionIntent(id, refreshOnly = false) {
    const label = dependencies.projectState.state.labels.find(item => String(item.id) === String(id));
    return label ? dependencies.domains.selectionUiController.applyIntent((0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'label', type: label.kind || 'label', id: String(id) }), {
      refreshOnly, openEditor: !refreshOnly, reason: 'label-selection',
    }) : false;
  }

  function applyHydroSelectionIntent(id, refreshOnly = false) {
    const feature = (0, dependencies.hydroModel.hydroFeatureById)(id);
    const selectedId = String((0, dependencies.hydroPresentation.hydroEditById)(id) ? feature?.id : feature?.properties?.pandolab_id || feature?.id || id);
    return feature ? dependencies.domains.selectionUiController.applyIntent((0, dependencies.selectionServices.normalizeObjectRef)({
      domain: 'hydro', type: (0, dependencies.hydroPresentation.hydroCategoryKey)(feature.properties?.category), id: selectedId,
    }), { refreshOnly, openEditor: !refreshOnly, reason: 'hydro-selection' }) : false;
  }

  function initializePropertySelection() {
    window.PANDOLAB_TERRITORIAL = Object.freeze({
      get: id => dependencies.objectModelB.territorialApplicationService.get(id),
      list: options => dependencies.objectModelB.territorialApplicationService.list(options),
      select: applyTerritorialSelectionIntent,
      setName: setTerritorialUnitName,
      setColor: setTerritorialUnitColor,
      setLocked: setTerritorialUnitLocked,
      isLocked: (type, id) => dependencies.objectModelB.territorialApplicationService.isLocked(type, id),
    });

    window.PANDOLAB_DISTRIBUTIONS = Object.freeze({
      getLayer: id => distributionLayerById(id),
      listLayers: type => dependencies.objectModelA.distributionService.listLayers(type),
      listEntries: layerId => dependencies.objectModelA.distributionService.listEntries(layerId),
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
