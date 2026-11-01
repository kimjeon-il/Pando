import { presentObjectHeading, builtinHydroSourceNotes, genericConversionButtonLabel } from './object-property-presentation.js';
import { isBuiltinPlaceId } from "../../../../../shared/frontend/js/modules/place-contract.js";
import { resolvePlaceLabelRows } from "../../../../../shared/frontend/js/modules/place-name-display.js";
import { temporalMonthEnd } from "../../../../../shared/frontend/js/modules/temporal.js";



export function createObjectPropertyController(runtime = {}) {
  const {
    document,
    getElement,
    state,
    replaceSelectOptions,
    distributionModes,
    colorDomains,
    defaultGenericFeatureColor,
    hydroToolConfig,
    territorialEntityRepository,
    distributionService,
    distributionEntriesForLayer,
    genericFeatureById,
    genericFeatureGeometryKind,
    genericFeatureName,
    labelById,
    labelKey,
    automaticLabelSettings,
    hydroFeatureById,
    hydroEditById,
    hydroCategoryKey,
    hydroCategoryLabel,
    hydroFallbackName,
    hydroEditorName,
    prepareHydroFeature,
    gpuMapRenderer,
    readDomainColor,
    syncColorPicker,
    formatArea,
    geometryAreaKm2,
    layerNameCompare,
    objectSearchController,
    syncObjectActionsMenu,
    closeObjectActionsMenu,
    setEditorShellView,
    syncStatusBar,
    createEmptyState,
    createSemanticIcon,
    onHydroLoaded,
    reportOperationError,
  } = runtime;
  if(typeof reportOperationError!=='function')throw new TypeError('Object property hydration requires its operation error reporter.');
  const $ = getElement;
  const geometryAreaDisplayCache = new WeakMap();

  function activeForm(type) {
    return type ? $({
      entity: 'entityProperties', distribution: 'distributionProperties', generic: 'genericFeatureProperties',
      label: 'labelProperties', hydro: 'hydroProperties', multi: 'multiProperties',
    }[type]) : null;
  }

  function syncActionTab(type) {
    const form = activeForm(type);
    const sections = form ? [...form.children].filter(element => !element.hidden && !element.classList.contains('hidden')) : [];
    const infoAvailable = sections.some(element => element.matches?.('.editor-info-section'));
    const hasActions = sections.some(element => element.matches?.('.editor-action-section') && !element.classList.contains('editor-relation-section'));
    const relationSections = sections.filter(element => element.matches?.('.editor-relation-section'));
    const relationAvailable = relationSections.length > 0;
    const commonAvailable = !!type && [...document.querySelectorAll('.editor-common-actions')].some(element => !element.classList.contains('hidden'));
    const hasRelation = relationAvailable || commonAvailable;
    const relationControlCount = relationSections.reduce((count, section) => count + [...section.querySelectorAll('button, input, select, textarea')]
      .filter(control => !control.disabled && !control.hidden && !control.classList.contains('hidden') && !control.closest('.hidden, [hidden]')).length, 0);
    const forceRelationTab = type === 'entity';
    const inlineRelation = !forceRelationTab && relationAvailable && !commonAvailable && relationControlCount <= 1;
    const relationTabVisible = hasRelation && !inlineRelation;
    const editorSurface = $('editorSurface');
    if (editorSurface) {
      if (inlineRelation) editorSurface.setAttribute('data-editor-inline-relation', 'true');
      else editorSurface.removeAttribute('data-editor-inline-relation');
    }
    $('editorTabBtn').hidden = !type || !infoAvailable;
    $('editorTabBtn').setAttribute('aria-disabled', String(!infoAvailable));
    $('actionsTabBtn').hidden = !type || !hasActions;
    $('actionsTabBtn').setAttribute('aria-disabled', String(!hasActions));
    $('relationTabBtn').hidden = !type || !relationTabVisible;
    $('relationTabBtn').setAttribute('aria-disabled', String(!relationTabVisible));
    const availableViews = [infoAvailable && 'info', hasActions && 'actions', relationTabVisible && 'relation'].filter(Boolean);
    document.querySelector('.editor-view-tabs')?.classList.toggle('hidden', !type || availableViews.length <= 1);
    const current = editorSurface?.getAttribute('data-editor-view');
    if (current && !availableViews.includes(current)) setEditorShellView(availableViews[0] || 'info');
  }

  function show(type, title = '', { resetScroll = true, typeLabel = '' } = {}) {
    if (type && resetScroll) setEditorShellView('info');
    $('emptyProperties').classList.toggle('hidden', !!type);
    const objectHeader = $('editorObjectHeader');
    objectHeader.classList.toggle('hidden', !type);
    $('editSheetTitle')?.classList.remove('hidden');
    $('editorSurface')?.setAttribute('aria-labelledby', type ? 'editSheetTitle editorObjectHeading' : 'editSheetTitle');
    for (const [kind, id] of Object.entries({
      entity: 'entityProperties', distribution: 'distributionProperties', generic: 'genericFeatureProperties',
      label: 'labelProperties', hydro: 'hydroProperties', multi: 'multiProperties',
    })) $(id)?.classList.toggle('hidden', type !== kind);
    $('flagMenuBtn')?.classList.toggle('hidden', type !== 'entity');
    presentObjectHeading({document,getElement:$,type,title,typeLabel});
    if (!type && $('editorObjectStatus')) {
      $('editorObjectStatus').textContent = '';
      $('editorObjectStatus').classList.add('hidden');
    }
    if (!type) {
      $('focusSelectedObjectBtn')?.classList.add('hidden');
    }
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

  function distributionEntryLabel(entry) {
    return entry.mode === distributionModes.TERRITORIAL
      ? territorialEntityRepository.get(entry.territorialUnitId)?.properties?.name || entry.territorialUnitId
      : '자유 영역';
  }

  function renderDistributionEntries(layer) {
    const container = $('distributionEntryList');
    const entries = distributionEntriesForLayer(state.distributionEntries, layer.id);
    if (!entries.length) {
      // The two add actions already explain how to create an entry.
      container.replaceChildren(createEmptyState('분포 없음', '', { compact: true }));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'ui-row ui-card distribution-entry-row';
      const label = document.createElement('span');
      label.innerHTML = '<strong></strong><small></small>';
      label.querySelector('strong').textContent = distributionEntryLabel(entry);
      label.querySelector('small').textContent = entry.mode === distributionModes.TERRITORIAL ? '영역 참조' : '자유 형상';
      const valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.step = 'any';
      valueInput.value = String(entry.value);
      valueInput.dataset.distributionEntryValue = entry.id;
      valueInput.setAttribute('aria-label', `${distributionEntryLabel(entry)} 값${layer.unit ? ` (${layer.unit})` : ''}`);
      valueInput.disabled = layer.locked;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ui-button icon-btn distribution-entry-delete';
      remove.dataset.distributionEntryDelete = entry.id;
      remove.setAttribute('aria-label', `${distributionEntryLabel(entry)} 분포 삭제`);
      remove.dataset.tooltip = `${distributionEntryLabel(entry)} 분포 삭제`;
      remove.append(createSemanticIcon(document, 'delete'));
      remove.disabled = layer.locked;
      row.append(label, valueInput, remove);
      fragment.appendChild(row);
    }
    container.replaceChildren(fragment);
  }

  function presentDistribution(id, refreshOnly = false) {
    const layer = distributionService.getLayer(id);
    if (!layer) return false;
    show('distribution', layer.name, { resetScroll: !refreshOnly });
    $('distributionNameInput').value = layer.name;
    $('distributionUnitInput').value = layer.unit;
    $('distributionValueUnit').textContent = layer.unit ? `(${layer.unit})` : '';
    $('distributionValueScaleInput').value = layer.valueScale.mode;
    $('distributionValueMinInput').value = layer.valueScale.mode === 'manual' ? String(layer.valueScale.min) : '';
    $('distributionValueMaxInput').value = layer.valueScale.mode === 'manual' ? String(layer.valueScale.max) : '';
    $('distributionManualScaleFields').classList.toggle('hidden', layer.valueScale.mode !== 'manual');
    const color = readDomainColor(colorDomains.DISTRIBUTION, { layer }, { fallback: defaultGenericFeatureColor });
    $('distributionColorInput').value = color.value;
    syncColorPicker('distribution', { value: color.value, defaultColor: defaultGenericFeatureColor, isDefault: color.isDefault });
    const parentOptions = [{ value: '', label: '상위 분류 없음' }, ...distributionService.parentCandidates(layer.id)
      .map(candidate => ({ value: candidate.id, label: candidate.name })).sort((a, b) => layerNameCompare(a.label, b.label))];
    const unitOptions = territorialEntityRepository.list().map(unit => ({
      value: unit.id,
      label: `${unit.properties?.name || unit.id}`,
    })).sort((a, b) => layerNameCompare(a.label, b.label));
    const distributionParent = $('distributionParentInput');
    const parentChoice = replaceSelectOptions(distributionParent, parentOptions, layer.parentId, { autoSelectSingle: true, preserveInvalid: true });
    const parentField = distributionParent.closest('.field-group');
    parentField?.classList.toggle('hidden', parentChoice.single);
    parentField?.closest('details')?.classList.toggle('hidden', parentChoice.single);
    const territorialInput = $('distributionTerritorialUnitInput');
    replaceSelectOptions(territorialInput, unitOptions.length
      ? unitOptions
      : [{ value: '', label: '선택 가능한 기준 영역 없음', placeholder: true }], territorialInput.value, { autoSelectSingle: true });
    // The applied target stays visible even when it was automatically selected.
    territorialInput.closest('.field-group')?.classList.remove('hidden');
    $('distributionRenderModeInput').value = state.distributionSettings.renderMode;
    for (const idValue of ['distributionNameInput', 'distributionUnitInput', 'distributionValueScaleInput', 'distributionValueMinInput', 'distributionValueMaxInput', 'distributionColorTrigger', 'distributionParentInput', 'addGeometryDistributionBtn']) $(idValue).disabled = layer.locked;
    $('addTerritorialDistributionBtn').disabled = layer.locked || !territorialInput.value;
    renderDistributionEntries(layer);
    $('selectionStatus').textContent = layer.name;
    syncStatusBar();
    objectSearchController()?.syncSelection();
    return true;
  }

  function syncGenericSemanticEditor(feature) {
    const geometryKind = genericFeatureGeometryKind(feature);
    const options = geometryKind === 'point'
      ? [{ value: 'label', label: '지명' }]
      : geometryKind === 'line'
        ? [{ value: 'river', label: '강' }]
        : geometryKind === 'polygon'
          ? [
            { value: 'general', label: '객체' }, { value: 'regional', label: '객체 · 독립 권역' }, { value: 'lake', label: '호수' }, { value: 'distribution', label: '분포' },
          ]
          : [];
    const convertSection = $('genericFeatureConversionSection');
    convertSection.classList.toggle('hidden', !options.length);
    const typeInput = $('genericFeatureConvertType');
    const typeChoice = replaceSelectOptions(typeInput, options, typeInput.value || options[0]?.value, { autoSelectSingle: true });
    typeInput.closest('.field-group')?.classList.toggle('hidden', typeChoice.single);
    const target = $('genericFeatureConvertType').value;
    $('convertGenericFeatureBtn').textContent = genericConversionButtonLabel(target);
    const countryField = $('genericFeatureConvertParentField');
    const countryOptions = [{ value: '', label: '상위 객체 없음' }, ...territorialEntityRepository.list({ kind: 'general' }).map(country => ({
      value: String(country.id), label: String(country.properties?.name || country.id),
    })).sort((left, right) => layerNameCompare(left.label, right.label))];
    const countryChoice = replaceSelectOptions($('genericFeatureConvertParentInput'), countryOptions, $('genericFeatureConvertParentInput').value, {
      autoSelectSingle: false,
      preserveInvalid: true,
    });
    countryField.dataset.singleChoice = String(countryChoice.single);
    countryField.dataset.invalidChoice = String(countryChoice.invalid);
    countryField.classList.toggle('hidden', target !== 'general');
    const distributionField = $('genericFeatureConvertDistributionField');
    const distributionChoice = replaceSelectOptions($('genericFeatureConvertDistributionInput'), [
      { value: '', label: '분포 레이어 선택', placeholder: true },
      ...distributionService.listLayers().map(layer => ({ value: layer.id, label: layer.name })),
    ], '', { autoSelectSingle: true });
    distributionField.dataset.singleChoice = String(distributionChoice.single);
    distributionField.classList.toggle('hidden', target !== 'distribution' || distributionChoice.single);
    const distributionValueInput = $('genericFeatureConvertDistributionValueInput');
    if (distributionValueInput.dataset.featureId !== String(feature.id)) {
      distributionValueInput.value = '';
      distributionValueInput.dataset.featureId = String(feature.id);
    }
    $('genericFeatureConvertDistributionValueField').classList.toggle('hidden', target !== 'distribution');
    const targetRequiresCountry = target === 'general';
    const targetRequiresDistribution = target === 'distribution';
    $('convertGenericFeatureBtn').disabled = !options.length
      || (targetRequiresCountry && countryChoice.invalid)
      || (targetRequiresDistribution && (!$('genericFeatureConvertDistributionInput').value
        || distributionValueInput.value === '' || !Number.isFinite(Number(distributionValueInput.value))));
    syncActionTab('generic');
  }

  function presentGeneric(id, refreshOnly = false) {
    const feature = genericFeatureById(id);
    if (!feature) return false;
    const displayName = genericFeatureName(feature);
    show('generic', displayName, { resetScroll: !refreshOnly });
    $('genericFeatureIdInput').textContent = String(id);
    syncGenericSemanticEditor(feature);
    $('selectionStatus').textContent = `${feature.properties?.name || String(id).slice(0, 8)}${areaSuffix(feature.geometry)}`;
    syncStatusBar();
    objectSearchController()?.syncSelection();
    return true;
  }

  function presentLabel(id, refreshOnly = false) {
    const label = labelById(id);
    if (!label) return false;
    show('label', label.name, { resetScroll: !refreshOnly });
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    const builtin = isBuiltinPlaceId(label.id);
    $('labelNameInput').readOnly = builtin;
    $('labelKindInput').disabled = builtin;
    $('labelNotesInput').readOnly = builtin;
    const builtinInfo = $('labelBuiltinInfo');
    builtinInfo.hidden = !builtin;
    const sourceDetails = builtinInfo.querySelector('details');
    if (sourceDetails) {
      // Keep expanded provenance during refresh; reset after changing the selected label.
      if (sourceDetails.dataset.labelId !== String(label.id)) sourceDetails.open = false;
      sourceDetails.dataset.labelId = String(label.id);
    }
    let uncertainHistoricalName = false;
    if (builtin && /^\d{4}-\d{2}$/u.test(state.timelineCursor || '')) {
      const rows = resolvePlaceLabelRows(label, { ko: true, en: true, native: true }, temporalMonthEnd(state.timelineCursor).canonical);
      uncertainHistoricalName = rows.some(row => row.modernName);
    }
    const notice = builtinInfo.querySelector('.ui-help-text');
    if (notice) notice.textContent = uncertainHistoricalName
      ? '내장 지명 · 원본 수정 불가 · (현)은 현대 명칭입니다. 해당 시점의 명칭은 미확인입니다.'
      : '내장 지명 · 원본 수정 불가';
    $('labelBuiltinSource').textContent = builtin ? label.source : '';
    $('labelBuiltinId').textContent = builtin ? label.sourceId : '';
    $('copyPlaceSection').hidden = !builtin;
    const settings = automaticLabelSettings(label.kind, state.labelSettings[labelKey('label', label.id)] || {});
    $('labelPositionValue').textContent = settings.pinned ? '사용자 지정 위치' : '자동 배치';
    $('selectionStatus').textContent = label.name;
    syncActionTab('label');
    syncStatusBar();
    objectSearchController()?.syncSelection();
    return true;
  }

  function presentHydro(id, refreshOnly = false) {
    const feature = hydroFeatureById(id);
    if (!feature) return false;
    const properties = feature.properties || {};
    const editable = !!hydroEditById(id);
    const categoryKey = hydroCategoryKey(properties.category);
    const category = hydroCategoryLabel(categoryKey);
    const displayName = hydroEditorName(properties.name, hydroFallbackName(categoryKey));
    show('hydro', displayName, { resetScroll: !refreshOnly, typeLabel: category });
    $('hydroColorPopover').setAttribute('aria-label', `${category} 색상 팔레트`);
    $('hydroEditFields').classList.toggle('hidden', !editable);
    $('hydroBuiltinHelp').classList.toggle('hidden', editable);
    const builtinNotes = editable ? '' : builtinHydroSourceNotes(properties);
    $('hydroBuiltinNotes').hidden = editable || !builtinNotes;
    $('hydroBuiltinNotes').classList.toggle('hidden', editable || !builtinNotes);
    $('hydroBuiltinNotesInput').value = builtinNotes;
    const copyActionSection = $('copyHydroBtn').closest('.editor-action-section');
    if (copyActionSection) copyActionSection.hidden = editable;
    const verticesSection = $('hydroVerticesBtn').closest('.editor-action-section');
    if (verticesSection) verticesSection.hidden = !editable;
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
    // The source remains visible. The edit tab owns the copy action.
    $('hydroBuiltinHelp').lastChild.textContent = ` · 내장 ${category} · 복사본에서 편집`;
    $('selectionStatus').textContent = displayName;
    syncStatusBar();
    objectSearchController()?.syncSelection();
    if (!editable && !feature.geometry && !feature.__geometryLoading) {
      feature.__geometryLoading = true;
      gpuMapRenderer.loadHydroLogicalFeature(Number(properties.__logicalFid)).then(async full => {
        if (!full) return;
        prepareHydroFeature(full);
        await onHydroLoaded(full);
      }).catch(error => reportOperationError(error,'강·호수 선택 형상을 불러오지 못했습니다.','PL-HYDRO-PROPERTY-001',4200))
        .finally(() => { feature.__geometryLoading = false; });
    }
    return true;
  }

  function present(ref, { refreshOnly = false } = {}) {
    if (!ref) return false;
    if (ref.domain === 'distribution') return presentDistribution(ref.id, refreshOnly);
    if (ref.domain === 'generic') return presentGeneric(ref.id, refreshOnly);
    if (ref.domain === 'label') return presentLabel(ref.id, refreshOnly);
    if (ref.domain === 'hydro') return presentHydro(ref.id, refreshOnly);
    return false;
  }

  return Object.freeze({ show, syncActionTab, present, distributionEntryLabel });
}
