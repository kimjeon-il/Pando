export function createPropertyEditorBindings({
  getElement: $,
  document,
  getPrimary,
  getGenericFeature,
  TERRITORIAL_UNIT_TYPES,
  bindColorPickers,
  commitGenericFeatureMeta,
  commitHydroEdit,
  commitTerritorialUnitMeta,
  commitDistributionMeta,
  commitLabelEdit,
  removeDistributionEntry,
  addTerritorialDistributionEntry,
  requestDraftDiscard,
  returnToMapAfterMobileAction,
  startGeometryDistributionDraft,
  requestTerritorialUnitDivisionRemoval,
  enterTerritorialUnitSplitMode,
  enterTerritorialUnitMergeMode,
  enterTerritorialUnitRedrawMode,
  territorialUnitById,
  reconcileAdminCountryCoast,
  requestTerritorialUnitPromotion,
  openTerritorialTypeModal,
  syncTerritorialTypeModal,
  closeTerritorialTypeModal,
  confirmTerritorialTypeConversion,
  setEditorShellView,
  setActionStatus,
  focusObjectRef,
  enterGenericFeatureSplitMode,
  enterGenericFeatureMergeMode,
  alignSelectedGenericFeatureToOwnerLand,
  countryFeatureById,
  enterCountryCoastEdit,
  openConfirmModal,
  applySelectedGenericFeatureToOwnerCountry,
  promoteSelectedGenericFeatureToCountry,
  copySelectedHydroForEditing,
  undo,
  redo,
  closeObjectActionsMenu,
  batchSetVisibility,
  enterCountryBorderEditFromSelection,
} = {}) {

  let bound = false;
  const listeners = [];
  function listen(element, type, handler) {
    if (!element) return;
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  }
  function dispose() {
    for (const remove of listeners.splice(0)) remove();
    bound = false;
  }

  function bindChangeFields(definitions) {
    for (const { id, field, commit, transform = value => value } of definitions) {
      listen($(id), 'change', event => commit(field, transform(event.target.value)));
    }
  }

  function bindEditorFields() {
    if (bound) return;
    bound = true;
    bindColorPickers();
    bindChangeFields([
      { id: 'genericFeatureNameInput', field: 'name', commit: commitGenericFeatureMeta, transform: value => value.trim() },
      { id: 'genericFeatureOwnerInput', field: 'ownerId', commit: commitGenericFeatureMeta },
      { id: 'genericFeatureParentInput', field: 'parentId', commit: commitGenericFeatureMeta },
      { id: 'genericFeatureLandBindingInput', field: 'landBinding', commit: commitGenericFeatureMeta },
      { id: 'genericFeatureNotesInput', field: 'notes', commit: commitGenericFeatureMeta },
      { id: 'hydroNameInput', field: 'name', commit: commitHydroEdit, transform: value => value.trim() },
      { id: 'hydroNotesInput', field: 'notes', commit: commitHydroEdit },
      { id: 'subunitNameInput', field: 'name', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'subunitCountryInput', field: 'sovereignId', commit: commitTerritorialUnitMeta },
      { id: 'subunitParentInput', field: 'parentId', commit: commitTerritorialUnitMeta },
      { id: 'subunitLevelInput', field: 'level', commit: commitTerritorialUnitMeta, transform: value => Number(value) > 0 ? Math.floor(Number(value)) : null },
      { id: 'subunitNotesInput', field: 'notes', commit: commitTerritorialUnitMeta },
      { id: 'regionNameInput', field: 'name', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'regionCountryInput', field: 'sovereignId', commit: commitTerritorialUnitMeta },
      { id: 'regionParentInput', field: 'parentId', commit: commitTerritorialUnitMeta },
      { id: 'regionValidFromInput', field: 'validFrom', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'regionValidToInput', field: 'validTo', commit: commitTerritorialUnitMeta, transform: value => value.trim() },
      { id: 'regionNotesInput', field: 'notes', commit: commitTerritorialUnitMeta },
      { id: 'distributionNameInput', field: 'name', commit: commitDistributionMeta, transform: value => value.trim() },
      { id: 'distributionParentInput', field: 'parentId', commit: commitDistributionMeta },
      { id: 'labelNameInput', field: 'name', commit: commitLabelEdit, transform: value => value.trim() },
      { id: 'labelKindInput', field: 'kind', commit: commitLabelEdit },
      { id: 'labelNotesInput', field: 'notes', commit: commitLabelEdit },
    ]);
    listen($('distributionEntryList'), 'click', event => {
      const button = event.target.closest('[data-distribution-entry-delete]');
      if (button) removeDistributionEntry(button.dataset.distributionEntryDelete);
    });
    listen($('addTerritorialDistributionBtn'), 'click', addTerritorialDistributionEntry);
    listen($('addGeometryDistributionBtn'), 'click', () => requestDraftDiscard(() => returnToMapAfterMobileAction(startGeometryDistributionDraft())));
    listen($('removeSubunitDivisionBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestTerritorialUnitDivisionRemoval(getPrimary().id));
    listen($('splitSubunitBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitSplitMode(getPrimary().id))));
    listen($('mergeSubunitBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitMergeMode(getPrimary().id))));
    listen($('mergeRegionBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitMergeMode(getPrimary().id))));
    listen($('reassignSubunitShapeBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitRedrawMode(getPrimary().id))));
    listen($('reconcileSubunitCoastBtn'), 'click', () => {
      if (!(getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      const feature = territorialUnitById(getPrimary().id);
      if (feature?.properties?.unitType !== TERRITORIAL_UNIT_TYPES.SUBUNIT || feature.properties?.locked === true) return;
      reconcileAdminCountryCoast(getPrimary().id);
    });
    listen($('reassignRegionShapeBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestDraftDiscard(() => returnToMapAfterMobileAction(enterTerritorialUnitRedrawMode(getPrimary().id))));
    listen($('promoteSubunitBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY) && requestTerritorialUnitPromotion(getPrimary().id));
    listen($('changeCountryTypeBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type === TERRITORIAL_UNIT_TYPES.COUNTRY)
      && openTerritorialTypeModal(TERRITORIAL_UNIT_TYPES.COUNTRY, getPrimary().id));
    listen($('changeSubunitTypeBtn'), 'click', () => (getPrimary()?.domain === 'territorial' && getPrimary().type !== TERRITORIAL_UNIT_TYPES.COUNTRY)
      && openTerritorialTypeModal(TERRITORIAL_UNIT_TYPES.SUBUNIT, getPrimary().id));
    listen($('territorialTypeInput'), 'change', syncTerritorialTypeModal);
    listen($('territorialTypeSovereignInput'), 'change', syncTerritorialTypeModal);
    listen($('territorialTypeParentInput'), 'change', syncTerritorialTypeModal);
    listen($('territorialTypeCancelBtn'), 'click', closeTerritorialTypeModal);
    listen($('territorialTypeModal').querySelector('.confirm-modal-dim'), 'click', closeTerritorialTypeModal);
    listen($('territorialTypeConfirmBtn'), 'click', confirmTerritorialTypeConversion);
    listen($('transferSubunitBtn'), 'click', () => {
      setEditorShellView('info');
      $('subunitCountryInput').focus();
      setActionStatus('소속 국가 목록에서 이전할 국가를 선택하세요. 실제 국경 변경 전에 확인합니다.', 'success', 3400);
    });
    listen($('transferRegionBtn'), 'click', () => {
      setEditorShellView('info');
      $('regionCountryInput').focus();
      setActionStatus('주권 국가와 상위 영역을 확인한 뒤 변경하세요.', 'success', 3400);
    });

    listen($('editGenericFeatureBoundaryBtn'), 'click', () => {
      if (getPrimary()?.domain !== 'generic') return;
      const primary = getPrimary();
      if (primary) focusObjectRef(primary);
      returnToMapAfterMobileAction(true);
      setActionStatus('지도 위 꼭짓점을 드래그해 경계를 수정하세요.', 'success', 3400);
    });

    listen($('splitGenericFeatureBtn'), 'click', () => {
      if (getPrimary()?.domain === 'generic') requestDraftDiscard(() => returnToMapAfterMobileAction(enterGenericFeatureSplitMode(getPrimary().id)));
    });
    listen($('mergeGenericFeatureBtn'), 'click', () => {
      if (getPrimary()?.domain === 'generic') requestDraftDiscard(() => returnToMapAfterMobileAction(enterGenericFeatureMergeMode(getPrimary().id)));
    });
    listen($('syncGenericFeatureCoastBtn'), 'click', alignSelectedGenericFeatureToOwnerLand);
    listen($('editGenericFeatureCoastBtn'), 'click', () => {
      if (getPrimary()?.domain !== 'generic') return;
      const feature = getGenericFeature(getPrimary().id);
      const ownerId = String(feature?.properties?.ownerId || '');
      if (!countryFeatureById(ownerId)) return;
      requestDraftDiscard(() => returnToMapAfterMobileAction(enterCountryCoastEdit(ownerId, { scopeGenericFeatureId: feature.id, returnSelection: { type: 'generic', id: String(feature.id) } })));
    });
    listen($('applyGenericFeatureToCountryBtn'), 'click', () => openConfirmModal({
      title: '국가 영토에 반영',
      message: '선택한 영역과 겹치는 다른 국가의 영토를 소유 국가로 이전합니다. 한 번의 실행취소로 복구할 수 있습니다.',
      impacts: ['소유 국가와 겹치는 국가들의 실제 국경 변경', '선택 지형지물은 유지'],
      confirmText: '영토 반영',
      onConfirm: applySelectedGenericFeatureToOwnerCountry,
    }));
    listen($('promoteGenericFeatureToCountryBtn'), 'click', () => openConfirmModal({
      title: '국가로 전환',
      message: '선택한 영역을 기존 국가들에서 분리해 새 국가로 전환합니다. 객체 이름을 새 국명으로 사용합니다.',
      impacts: ['새 국가 1개 생성', '겹치는 기존 국가들의 실제 국경 변경', '선택 지형지물 제거'],
      confirmText: '국가로 전환',
      onConfirm: promoteSelectedGenericFeatureToCountry,
    }));

    listen($('copyHydroBtn'), 'click', copySelectedHydroForEditing);

    listen($('undoBtn'), 'click', undo);
    listen($('redoBtn'), 'click', redo);

    listen($('focusSelectedObjectBtn'), 'click', () => getPrimary() && focusObjectRef(getPrimary()));
    listen($('objectFocusMenuBtn'), 'click', () => { closeObjectActionsMenu(); if (getPrimary()) focusObjectRef(getPrimary()); });
    listen($('objectActionsMenu'), 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeObjectActionsMenu({ restoreFocus: true }); return; }
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(.hidden):not(:disabled)')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!delta || !items.length) return;
      event.preventDefault();
      items[(current + delta + items.length) % items.length]?.focus();
    });
    listen($('multiPropertiesVisibilityInput'), 'change', event => batchSetVisibility(event.target.checked));
    listen($('multiBorderEditBtn'), 'click', () => requestDraftDiscard(() => returnToMapAfterMobileAction(enterCountryBorderEditFromSelection())));
  }

  return Object.freeze({
    bind: bindEditorFields,
    dispose,
  });
}
