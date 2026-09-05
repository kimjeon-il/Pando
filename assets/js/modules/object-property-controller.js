const PROPERTY_TYPE_LABELS = Object.freeze({
  country: '국가', territory: '권역', administrative: '행정구역', region: '지방',
  distribution: '분포', generic: '기타 객체', label: '지명', hydro: '강·호수', multi: '다중선택',
});

export function createObjectPropertyController(runtime = {}) {
  const {
    document,
    getElement,
    state,
    territorialUnitTypes,
    distributionModes,
    distributionTypeLabels,
    colorDomains,
    defaultGenericFeatureColor,
    hydroToolConfig,
    territorialUnitById,
    territorialUnitName,
    territorialUnitCountryName,
    territorialUnitCountryOptions,
    territorialUnitParentOptions,
    territorialParentOptions,
    territorialUnitColor,
    territorialRepository,
    distributionService,
    distributionEntriesForLayer,
    genericFeatureById,
    normalizeGenericFeatureSemantics,
    genericFeatureGeometryKind,
    genericFeatureRole,
    genericFeatureRoleLabel,
    genericFeatureRoleHelp,
    genericFeatureLandBinding,
    genericFeatureName,
    genericFeatureRoleLabels,
    defaultGenericFeatureColorFor,
    labelKey,
    automaticLabelSettings,
    hydroFeatureById,
    hydroEditById,
    isHydroFeatureVisible,
    hydroCategoryKey,
    hydroCategoryLabel,
    hydroFallbackName,
    hydroEditorName,
    prepareHydroFeature,
    gpuMapRenderer,
    readDomainColor,
    syncColorPicker,
    replaceSelectOptions,
    formatArea,
    geometryAreaKm2,
    layerNameCompare,
    layerTreeController,
    syncObjectActionsMenu,
    closeObjectActionsMenu,
    setEditorShellView,
    syncStatusBar,
    createEmptyState,
    createSemanticIcon,
    onHydroLoaded,
  } = runtime;
  const $ = getElement;
  const geometryAreaDisplayCache = new WeakMap();

  function activeForm(type) {
    return type ? $({
      country: 'countryProperties', territory: 'territoryProperties', administrative: 'administrativeProperties',
      region: 'regionProperties', distribution: 'distributionProperties', generic: 'genericFeatureProperties',
      label: 'labelProperties', hydro: 'hydroProperties', multi: 'multiProperties',
    }[type]) : null;
  }

  function syncActionTab(type) {
    const form = activeForm(type);
    const sections = form ? [...form.children].filter(element => !element.hidden && !element.classList.contains('hidden')) : [];
    const hasActions = sections.some(element => element.matches?.('.editor-action-section') && !element.classList.contains('editor-relation-section'));
    const relationAvailable = sections.some(element => element.matches?.('.editor-relation-section'));
    const commonAvailable = !!type && [...document.querySelectorAll('.editor-common-actions')].some(element => !element.classList.contains('hidden'));
    const hasRelation = relationAvailable || commonAvailable;
    $('actionsTabBtn').hidden = !type;
    $('actionsTabBtn').setAttribute('aria-disabled', String(!hasActions));
    $('relationTabBtn').hidden = !type;
    $('relationTabBtn').setAttribute('aria-disabled', String(!hasRelation));
    const current = $('rightPanel')?.getAttribute('data-editor-view');
    if (current === 'relation' && !hasRelation) setEditorShellView('info');
    else if (current === 'actions' && !hasActions) setEditorShellView(hasRelation ? 'relation' : 'info');
  }

  function show(type, title = '', { resetScroll = true, typeLabel = '' } = {}) {
    if (type && resetScroll) setEditorShellView('info');
    $('emptyProperties').classList.toggle('hidden', !!type);
    $('editorObjectHeader').classList.toggle('hidden', !type);
    document.querySelector('.editor-view-tabs')?.classList.toggle('hidden', !type);
    $('editSheetTitle')?.classList.remove('hidden');
    $('rightPanel')?.setAttribute('aria-labelledby', type ? 'editSheetTitle editorObjectHeading' : 'editSheetTitle');
    for (const [kind, id] of Object.entries({
      country: 'countryProperties', territory: 'territoryProperties', administrative: 'administrativeProperties',
      region: 'regionProperties', distribution: 'distributionProperties', generic: 'genericFeatureProperties',
      label: 'labelProperties', hydro: 'hydroProperties', multi: 'multiProperties',
    })) $(id)?.classList.toggle('hidden', type !== kind);
    $('propertyTitle').textContent = type ? String(title || '') : '';
    const visibleTypeLabel = typeLabel || (type ? PROPERTY_TYPE_LABELS[type] || type : '');
    if ($('propertyTypeLabel')) $('propertyTypeLabel').textContent = visibleTypeLabel;
    if (!type && $('editorObjectStatus')) {
      $('editorObjectStatus').textContent = '';
      $('editorObjectStatus').classList.add('hidden');
    }
    if (!type) {
      $('editorCommonActions')?.classList.add('hidden');
      $('editorDeleteActions')?.classList.add('hidden');
      $('focusSelectedObjectBtn')?.classList.add('hidden');
    }
    document.querySelector('.editor-object-heading')?.setAttribute('aria-label', type ? `${String(title || '')}, ${visibleTypeLabel}` : '');
    if (type) syncObjectActionsMenu();
    else closeObjectActionsMenu();
    syncActionTab(type);
    if (resetScroll && $('editorScrollBody')) $('editorScrollBody').scrollTop = 0;
    syncStatusBar();
  }

  function areaSuffix(geometry) {
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) return '';
    let area = geometryAreaDisplayCache.get(geometry);
    if (area === undefined) {
      area = geometryAreaKm2(geometry);
      geometryAreaDisplayCache.set(geometry, area);
    }
    return ` · ${formatArea(area)}`;
  }

  function presentTerritorial(id, refreshOnly = false) {
    const feature = territorialUnitById(id);
    if (!feature) return false;
    const properties = feature.properties || {};
    const administrative = properties.unitType === territorialUnitTypes.ADMIN;
    const region = properties.unitType === territorialUnitTypes.REGION;
    const formType = administrative ? 'administrative' : region ? 'region' : 'territory';
    const displayName = territorialUnitName(feature);
    show(formType, displayName, { resetScroll: !refreshOnly });
    const prefix = administrative ? 'administrative' : region ? 'region' : 'territory';
    const normalizedName = String(properties.name || '').trim().toLocaleLowerCase('ko');
    const conflict = !!normalizedName && state.territorialUnits.some(candidate => candidate.id !== feature.id
      && candidate.properties?.unitType === properties.unitType
      && String(candidate.properties?.sovereignId || '') === String(properties.sovereignId || '')
      && String(candidate.properties?.name || '').trim().toLocaleLowerCase('ko') === normalizedName);
    $(`${prefix}NameConflict`).classList.toggle('hidden', !conflict);
    $(`${prefix}NameInput`).value = properties.name || '';
    replaceSelectOptions($(`${prefix}CountryInput`), territorialUnitCountryOptions(), properties.sovereignId);
    const inheritedColor = territorialUnitColor({ ...feature, properties: { ...properties, style: {} } });
    const color = readDomainColor(colorDomains.TERRITORIAL, { feature }, { inherited: inheritedColor, fallback: defaultGenericFeatureColor });
    $(`${prefix}ColorInput`).value = color.value;
    syncColorPicker(prefix, { value: color.value, defaultColor: inheritedColor, isDefault: color.isDefault });
    $(`${prefix}NotesInput`).value = properties.notes || '';
    const actionIds = region
      ? ['reassignRegionShapeBtn', 'mergeRegionBtn', 'transferRegionBtn']
      : administrative
        ? ['splitAdministrativeBtn', 'mergeAdministrativeBtn', 'reassignAdministrativeShapeBtn', 'reconcileAdministrativeCoastBtn', 'transferAdministrativeBtn', 'promoteAdministrativeBtn', 'changeAdministrativeTypeBtn', 'removeAdministrativeDivisionBtn']
        : ['splitTerritoryBtn', 'mergeTerritoryBtn', 'reassignTerritoryShapeBtn', 'transferTerritoryBtn', 'promoteTerritoryBtn', 'changeTerritoryTypeBtn', 'removeTerritoryDivisionBtn'];
    for (const actionId of actionIds) $(actionId).disabled = properties.locked === true;
    if (administrative) {
      replaceSelectOptions($('administrativeParentInput'), territorialUnitParentOptions(feature), properties.parentId);
      $('administrativeLevelValue').textContent = `${Number(properties.adminLevel) || 1}급`;
    } else if (region) {
      replaceSelectOptions($('regionParentInput'), territorialParentOptions(feature), properties.parentId);
      $('regionValidFromInput').value = properties.validFrom || '';
      $('regionValidToInput').value = properties.validTo || '';
    }
    $('selectionStatus').textContent = `${administrative ? `행정구역 · ${territorialUnitCountryName(feature)} · ${Number(properties.adminLevel) || 1}급` : region ? '지방' : `권역 · ${territorialUnitCountryName(feature)}`} · ${displayName}${areaSuffix(feature.geometry)}`;
    syncStatusBar();
    layerTreeController()?.syncSelection();
    return true;
  }

  function distributionEntryLabel(entry) {
    return entry.mode === distributionModes.TERRITORIAL
      ? territorialRepository.get(entry.territorialUnitId)?.properties?.name || entry.territorialUnitId
      : '자유 영역';
  }

  function renderDistributionEntries(layer) {
    const container = $('distributionEntryList');
    const entries = distributionEntriesForLayer(state.distributionEntries, layer.id);
    if (!entries.length) {
      container.replaceChildren(createEmptyState('아직 분포가 없습니다.', '기준 영역을 선택하거나 자유 영역을 그리세요.', { compact: true }));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'ui-row ui-card distribution-entry-row';
      const label = document.createElement('span');
      label.innerHTML = '<strong></strong><small></small>';
      label.querySelector('strong').textContent = distributionEntryLabel(entry);
      label.querySelector('small').textContent = `${entry.mode === distributionModes.TERRITORIAL ? '영역 참조' : '자유 형상'} · ${Math.round(entry.share)}%`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ui-button icon-btn distribution-entry-delete';
      remove.dataset.distributionEntryDelete = entry.id;
      remove.setAttribute('aria-label', `${distributionEntryLabel(entry)} 분포 삭제`);
      remove.dataset.tooltip = `${distributionEntryLabel(entry)} 분포 삭제`;
      remove.append(createSemanticIcon(document, 'delete'));
      remove.disabled = layer.locked;
      row.append(label, remove);
      fragment.appendChild(row);
    }
    container.replaceChildren(fragment);
  }

  function presentDistribution(id, refreshOnly = false) {
    const layer = distributionService.getLayer(id);
    if (!layer) return false;
    state.selectedDistributionLayerId = layer.id;
    show('distribution', layer.name, { resetScroll: !refreshOnly });
    $('distributionNameInput').value = layer.name;
    $('distributionTypeValue').textContent = distributionTypeLabels[layer.type] || layer.type;
    const color = readDomainColor(colorDomains.DISTRIBUTION, { layer }, { fallback: defaultGenericFeatureColor });
    $('distributionColorInput').value = color.value;
    syncColorPicker('distribution', { value: color.value, defaultColor: defaultGenericFeatureColor, isDefault: color.isDefault });
    const parentOptions = [{ value: '', label: '상위 분류 없음' }, ...distributionService.parentCandidates(layer.id)
      .map(candidate => ({ value: candidate.id, label: candidate.name })).sort((a, b) => layerNameCompare(a.label, b.label))];
    const unitOptions = territorialRepository.list().map(unit => ({
      value: unit.id,
      label: `${unit.properties?.name || unit.id} · ${runtime.territorialTypeLabel(unit.properties?.unitType)}`,
    })).sort((a, b) => layerNameCompare(a.label, b.label));
    replaceSelectOptions($('distributionParentInput'), parentOptions, layer.parentId);
    replaceSelectOptions($('distributionTerritorialUnitInput'), unitOptions, $('distributionTerritorialUnitInput').value);
    $('distributionLockedInput').checked = layer.locked;
    $('distributionRenderModeInput').value = state.distributionSettings.renderMode;
    for (const idValue of ['distributionNameInput', 'distributionColorTrigger', 'distributionParentInput', 'addTerritorialDistributionBtn', 'addGeometryDistributionBtn']) $(idValue).disabled = layer.locked;
    renderDistributionEntries(layer);
    $('selectionStatus').textContent = `${distributionTypeLabels[layer.type]} · ${layer.name}`;
    syncStatusBar();
    layerTreeController()?.syncSelection();
    return true;
  }

  function syncGenericSemanticEditor(feature) {
    const geometryKind = genericFeatureGeometryKind(feature);
    const role = genericFeatureRole(feature);
    const editableArea = geometryKind === 'polygon' && role === 'generic';
    const hasOwnerCountry = !!runtime.countryFeatureById(feature?.properties?.ownerId);
    $('genericFeatureLandRelationSection').classList.toggle('hidden', !editableArea);
    $('genericFeatureLandActionsSection').classList.toggle('hidden', !editableArea);
    $('genericFeatureOwnerField').classList.add('hidden');
    $('genericFeatureParentField').classList.add('hidden');
    $('genericFeatureLandBindingField').classList.toggle('hidden', !editableArea);
    $('splitGenericFeatureBtn').classList.toggle('hidden', !editableArea);
    $('mergeGenericFeatureBtn').classList.toggle('hidden', !editableArea);
    for (const id of ['syncGenericFeatureCoastBtn', 'editGenericFeatureCoastBtn', 'applyGenericFeatureToCountryBtn', 'promoteGenericFeatureToCountryBtn']) $(id).classList.toggle('hidden', !editableArea);
    for (const id of ['syncGenericFeatureCoastBtn', 'editGenericFeatureCoastBtn', 'applyGenericFeatureToCountryBtn']) {
      const button = $(id);
      button.disabled = editableArea && !hasOwnerCountry;
      if (button.disabled) button.dataset.tooltip = '소유 국가가 지정된 영역에서 사용할 수 있습니다.';
      else delete button.dataset.tooltip;
    }
    $('promoteGenericFeatureToCountryBtn').disabled = !editableArea;
    $('genericFeatureLandBindingInput').value = genericFeatureLandBinding(feature);
    $('genericFeatureRoleHelp').textContent = genericFeatureRoleHelp(feature);
    $('genericFeatureRoleValue').textContent = genericFeatureRoleLabels[role] || role;
    $('genericFeatureTopologyValue').textContent = feature.properties?.topologyGroup || '—';
    syncActionTab('generic');
  }

  function presentGeneric(id, refreshOnly = false) {
    const feature = genericFeatureById(id);
    if (!feature) return false;
    normalizeGenericFeatureSemantics(feature);
    const meta = feature.properties || (feature.properties = {});
    const typeLabel = genericFeatureRoleLabel(feature);
    const displayName = genericFeatureName(feature);
    show('generic', displayName, { resetScroll: !refreshOnly });
    $('genericFeatureNameInput').value = meta.name || '';
    $('genericFeatureIdInput').textContent = String(id);
    const defaultColor = defaultGenericFeatureColorFor(feature);
    const color = readDomainColor(colorDomains.GENERIC, { feature }, { fallback: defaultColor });
    $('genericFeatureColorInput').value = color.value;
    syncColorPicker('generic', { value: color.value, defaultColor, isDefault: color.isDefault });
    $('genericFeatureNotesInput').value = meta.notes || '';
    syncGenericSemanticEditor(feature);
    $('selectionStatus').textContent = `${typeLabel} · ${meta.name || String(id).slice(0, 8)}${areaSuffix(feature.geometry)}`;
    syncStatusBar();
    layerTreeController()?.syncSelection();
    return true;
  }

  function presentLabel(id, refreshOnly = false) {
    const label = state.labels.find(item => item.id === id);
    if (!label) return false;
    show('label', label.name, { resetScroll: !refreshOnly });
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    const settings = automaticLabelSettings(label.kind, state.labelSettings[labelKey('label', label.id)] || {});
    $('labelPositionValue').textContent = settings.pinned ? '사용자 위치에 고정됨' : '종류별 정책으로 자동 배치';
    $('selectionStatus').textContent = `지명 · ${label.name}`;
    syncStatusBar();
    layerTreeController()?.syncSelection();
    return true;
  }

  function presentHydro(id, refreshOnly = false) {
    const feature = hydroFeatureById(id);
    if (!feature || !isHydroFeatureVisible(feature)) return false;
    const properties = feature.properties || {};
    const editable = !!hydroEditById(id);
    const categoryKey = hydroCategoryKey(properties.category);
    const category = hydroCategoryLabel(categoryKey);
    const displayName = hydroEditorName(properties.name, hydroFallbackName(categoryKey));
    show('hydro', displayName, { resetScroll: !refreshOnly, typeLabel: category });
    $('hydroColorPopover').setAttribute('aria-label', `${category} 색상 팔레트`);
    $('hydroEditFields').classList.toggle('hidden', !editable);
    $('hydroBuiltinHelp').classList.toggle('hidden', editable);
    const copyActionSection = $('copyHydroBtn').closest('.editor-action-section');
    if (copyActionSection) copyActionSection.hidden = editable;
    syncActionTab('hydro');
    if (editable) {
      $('hydroNameInput').value = properties.name || '';
      $('hydroColorInput').value = properties.editorColor || hydroToolConfig[properties.category].color;
      syncColorPicker('hydro', { value: $('hydroColorInput').value, defaultColor: hydroToolConfig[properties.category].color, isDefault: false });
      $('hydroNotesInput').value = properties.notes || '';
    }
    const systemName = categoryKey === 'river' ? hydroEditorName(properties.mainstem_name_ko || properties.name, hydroFallbackName(categoryKey)) : '';
    const hydroId = String(properties.system_id || properties.pandolab_id || feature.id || '').replace(/^hydro-system:/, '');
    $('hydroCategoryValue').textContent = category;
    $('hydroIdLabel').textContent = `${category} ID`;
    $('hydroIdValue').textContent = hydroId || '—';
    $('hydroSystemValue').textContent = systemName;
    $('hydroSystemRow').classList.toggle('hidden', !systemName || systemName === displayName);
    $('hydroSystemValue').previousElementSibling.textContent = '대표 수계';
    $('hydroTributaryValue').textContent = categoryKey === 'river' ? '본류·표시 지류' : '호수';
    $('hydroSourceValue').textContent = properties.source || `판도연구소 내장 ${category}`;
    $('hydroBuiltinHelp').lastChild.textContent = ` 기반 내장 ${category}입니다. 직접 수정하려면 복사본을 만드세요.`;
    $('selectionStatus').textContent = `${category} · ${displayName}`;
    syncStatusBar();
    layerTreeController()?.syncSelection();
    if (!editable && !feature.geometry && !feature.__geometryLoading) {
      feature.__geometryLoading = true;
      gpuMapRenderer.loadHydroLogicalFeature(Number(properties.__logicalFid)).then(full => {
        if (!full) return;
        prepareHydroFeature(full);
        onHydroLoaded(full);
      }).catch(error => console.warn('강·호수 선택 형상을 불러오지 못했습니다.', error))
        .finally(() => { feature.__geometryLoading = false; });
    }
    return true;
  }

  function present(ref, { refreshOnly = false } = {}) {
    if (!ref) return false;
    if (ref.domain === 'territorial' && ref.type !== territorialUnitTypes.COUNTRY) return presentTerritorial(ref.id, refreshOnly);
    if (ref.domain === 'distribution') return presentDistribution(ref.id, refreshOnly);
    if (ref.domain === 'generic') return presentGeneric(ref.id, refreshOnly);
    if (ref.domain === 'label') return presentLabel(ref.id, refreshOnly);
    if (ref.domain === 'hydro') return presentHydro(ref.id, refreshOnly);
    return false;
  }

  return Object.freeze({ show, syncActionTab, present, presentTerritorial, distributionEntryLabel });
}
