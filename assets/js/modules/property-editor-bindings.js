export function createPropertyEditorBindings({
  getElement: $,
  document,
  getPrimary,  bindColorPickers,
  commitHydroEdit,
  commitDistributionMeta,
  commitLabelEdit,
  removeDistributionEntry,
  updateDistributionEntryValue,
  addTerritorialDistributionEntry,
  requestDraftDiscard,
  completeToolStart,
  startGeometryDistributionDraft,
  enterTerritorialCreateWorkflow,
  runEntityEditAction,
  runModePrimaryAction,
  copySelectedEntityToRegion,
  entityRepository,
  reconcileAdminCountryCoast,
  focusObjectRef,
  convertSelectedGenericFeature,
  copySelectedHydroForEditing,
  copySelectedPlaceForEditing,
  undo,
  redo,
  closeObjectActionsMenu,
  enterTerritorialBorderEditFromSelection,
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
    listen($('copyPlaceBtn'), 'click', () => copySelectedPlaceForEditing());
    bindColorPickers();
    bindChangeFields([
      { id: 'hydroNameInput', field: 'name', commit: commitHydroEdit, transform: value => value.trim() },
      { id: 'hydroNotesInput', field: 'notes', commit: commitHydroEdit },
      { id: 'distributionNameInput', field: 'name', commit: commitDistributionMeta, transform: value => value.trim() },
      { id: 'distributionUnitInput', field: 'unit', commit: commitDistributionMeta, transform: value => value.trim() },
      { id: 'distributionParentInput', field: 'parentId', commit: commitDistributionMeta },
      { id: 'labelNameInput', field: 'name', commit: commitLabelEdit, transform: value => value.trim() },
      { id: 'labelKindInput', field: 'kind', commit: commitLabelEdit },
      { id: 'labelNotesInput', field: 'notes', commit: commitLabelEdit },
    ]);
    const commitScale = event => {
      const mode = $('distributionValueScaleInput').value;
      if (mode === 'auto') return commitDistributionMeta('valueScale', { mode: 'auto' });
      if (event.target.id === 'distributionValueScaleInput'
        && $('distributionValueMinInput').value === '' && $('distributionValueMaxInput').value === '') {
        const values = [...$('distributionEntryList').querySelectorAll('[data-distribution-entry-value]')]
          .map(input => Number(input.value)).filter(Number.isFinite);
        let min = 0, max = 1;
        if (values.length) {
          min = Infinity;
          max = -Infinity;
          for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
        }
        $('distributionValueMinInput').value = String(min);
        $('distributionValueMaxInput').value = String(max > min ? max : min + 1);
      }
      return commitDistributionMeta('valueScale', {
        mode: 'manual', min: $('distributionValueMinInput').value, max: $('distributionValueMaxInput').value,
      });
    };
    for (const id of ['distributionValueScaleInput', 'distributionValueMinInput', 'distributionValueMaxInput']) {
      listen($(id), 'change', commitScale);
    }
    listen($('distributionEntryList'), 'change', event => {
      const input = event.target.closest('[data-distribution-entry-value]');
      if (input) updateDistributionEntryValue(input.dataset.distributionEntryValue, input.value);
    });
    listen($('distributionEntryList'), 'click', event => {
      const button = event.target.closest('[data-distribution-entry-delete]');
      if (button) removeDistributionEntry(button.dataset.distributionEntryDelete);
    });
    listen($('distributionTerritorialUnitInput'), 'change', event => {
      $('addTerritorialDistributionBtn').disabled = getPrimary()?.domain !== 'distribution'
        || $('addGeometryDistributionBtn').disabled || !event.target.value;
    });
    listen($('addTerritorialDistributionBtn'), 'click', addTerritorialDistributionEntry);
    listen($('addGeometryDistributionBtn'), 'click', () => requestDraftDiscard(() => completeToolStart(startGeometryDistributionDraft())));
    listen($('addEntityChildBtn'), 'click', () => {
      const feature = entityRepository.get(getPrimary()?.id);
      if (feature?.properties.entityKind !== 'general' || feature.properties.locked) return;
      requestDraftDiscard(() => completeToolStart(enterTerritorialCreateWorkflow({ parentId: feature.id })));
    });
    for (const [id, action] of [['annexEntityBtn', 'annex'], ['mergeEntityBtn', 'merge'], ['editEntityBorderBtn', 'boundary'], ['editEntityCoastBtn', 'coast'], ['redrawEntityBtn', 'redraw']]) {
      listen($(id), 'click', () => requestDraftDiscard(() => runModePrimaryAction(async () =>
        completeToolStart(await runEntityEditAction(action, getPrimary()?.id)))));
    }
    listen($('reconcileEntityCoastBtn'), 'click', () => {
      const feature = entityRepository.get(getPrimary()?.id);
      if (feature?.properties.entityKind !== 'general' || !feature.properties.parentId || feature.properties.locked) return;
      runModePrimaryAction(() => reconcileAdminCountryCoast(feature.id));
    });
    listen($('copyEntityRegionBtn'), 'click', copySelectedEntityToRegion);

    const syncGenericFeatureConversionFields = () => {
      const target = $('genericFeatureConvertType').value;
      const countryField = $('genericFeatureConvertParentField');
      const distributionField = $('genericFeatureConvertDistributionField');
      const distributionValueField = $('genericFeatureConvertDistributionValueField');
      countryField?.classList.toggle('hidden', target !== 'general');
      distributionField?.classList.toggle('hidden', target !== 'distribution' || distributionField.dataset.singleChoice === 'true');
      distributionValueField?.classList.toggle('hidden', target !== 'distribution');
      const countryRequired = target === 'general';
      const distributionRequired = target === 'distribution';
      $('convertGenericFeatureBtn').disabled = (countryRequired
        && countryField.dataset.invalidChoice === 'true')
        || (distributionRequired && (!$('genericFeatureConvertDistributionInput').value
          || $('genericFeatureConvertDistributionValueInput').value === ''
          || !Number.isFinite(Number($('genericFeatureConvertDistributionValueInput').value))));
    };
    listen($('genericFeatureConvertType'), 'change', syncGenericFeatureConversionFields);
    listen($('genericFeatureConvertParentInput'), 'change', syncGenericFeatureConversionFields);
    listen($('genericFeatureConvertDistributionInput'), 'change', syncGenericFeatureConversionFields);
    listen($('genericFeatureConvertDistributionValueInput'), 'input', syncGenericFeatureConversionFields);
    listen($('convertGenericFeatureBtn'), 'click', () => {
      const primary = getPrimary();
      if (primary?.domain !== 'generic') return;
      void convertSelectedGenericFeature?.({
        target: $('genericFeatureConvertType')?.value,
        parentId: $('genericFeatureConvertType').value === 'general' ? $('genericFeatureConvertParentInput').value : '',
        distributionLayerId: $('genericFeatureConvertDistributionInput')?.value,
        distributionValue: $('genericFeatureConvertDistributionValueInput')?.value,
      });
    });

    listen($('copyHydroBtn'), 'click', copySelectedHydroForEditing);

    listen($('undoBtn'), 'click', undo);
    listen($('redoBtn'), 'click', redo);
    listen($('mobileUndoBtn'), 'click', undo);
    listen($('mobileRedoBtn'), 'click', redo);

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
    listen($('multiSubunitMergeBtn'), 'click', () => requestDraftDiscard(() => completeToolStart(enterTerritorialBorderEditFromSelection('merge'))));
    listen($('multiBorderEditBtn'), 'click', () => requestDraftDiscard(() => completeToolStart(enterTerritorialBorderEditFromSelection())));
  }

  return Object.freeze({
    bind: bindEditorFields,
    dispose,
  });
}
