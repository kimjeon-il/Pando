import { territorialSelectionStatus } from './country-display.js';

export function createTerritorialPropertyController({
  window,
  elements = {},
  getTerritorialView,
  getElement,
  territorialUnitTypes,
  territorialEntityRepository,
  territorialUnitCountryOptions,
  territorialUnitParentOptions,
  territorialParentOptions,
  refreshTerritorialCoastAvailability,
  replaceSelectOptions,
  shouldShowTerritorialParentChoice,
  syncLayerSelection = () => {},
  commitRelation = () => false,
  getPrimaryRef = () => null,
  showPropertyForm,
  resolveColor,
  defaultColor,
  syncColorPicker,
  calculateAreaKm2,
  formatArea,
  syncActions = () => {},
  syncStatus = () => {},
  commitField = () => false,
  metrics = {},
} = {}) {
  const $ = getElement;
  function presentUnitFields(view) {
    const feature = view.feature;
    if (!feature) return false;
    const properties = feature.properties || {};
    const countryId=String(territorialEntityRepository.administrativeCountry(feature.id)?.id || '');
    const subunits = properties.unitType === territorialUnitTypes.SUBUNIT;
    const region = properties.unitType === territorialUnitTypes.REGION;
    const prefix = region ? 'region' : 'subunit';
    const normalizedName = String(properties.name || '').trim().toLocaleLowerCase('ko');
    const conflict = !!normalizedName && territorialEntityRepository.list({ type: properties.unitType }).some(candidate => candidate.id !== feature.id
      && String(territorialEntityRepository.administrativeCountry(candidate.id)?.id || '') === countryId
      && String(candidate.properties?.name || '').trim().toLocaleLowerCase('ko') === normalizedName);
    $(`${prefix}NameConflict`).classList.toggle('hidden', !conflict);
    $(`${prefix}NameInput`).value = properties.name || '';
    const countrySelect = $(`${prefix}CountryInput`);
    const countryChoice = replaceSelectOptions(countrySelect, territorialUnitCountryOptions().filter(option => !subunits || option.value), countryId, {
      autoSelectSingle: true,
      preserveInvalid: true,
    });
    countrySelect.closest('.field-group')?.classList.toggle('hidden', countryChoice.single);
    const color = resolveColor(view), inheritedColor = defaultColor(view);
    $(`${prefix}ColorInput`).value = color.value;
    syncColorPicker(prefix, { value: color.value, defaultColor: inheritedColor, isDefault: color.isDefault });
    $(`${prefix}NotesInput`).value = properties.notes || '';
    const actionIds = region
      ? ['reassignRegionShapeBtn', 'mergeRegionBtn', 'transferRegionBtn']
      : ['addSubunitChildBtn', 'annexSubunitBtn', 'mergeSubunitBtn', 'reassignSubunitShapeBtn', 'editSubunitCoastBtn', 'reconcileSubunitCoastBtn', 'promoteSubunitBtn', 'removeSubunitDivisionBtn'];
    for (const actionId of actionIds) $(actionId).disabled = properties.locked === true;
    if (subunits) {
      refreshTerritorialCoastAvailability(feature);
      const parentOptions = territorialUnitParentOptions(feature);
      $('subunitParentInput').disabled = properties.locked === true || parentOptions.pending === true;
      $('subunitParentInput').setAttribute('aria-busy', String(parentOptions.pending === true));
      replaceSelectOptions($('subunitParentInput'), parentOptions, properties.parentId, { autoSelectSingle: true, preserveInvalid: false });
      $('subunitParentInput').closest('.field-group')?.classList.toggle('hidden', !shouldShowTerritorialParentChoice({
        sovereignId: countryId,
        parentId: properties.parentId,
        options: parentOptions,
      }));
    } else if (region) {
      replaceSelectOptions($('regionParentInput'), territorialParentOptions(feature), properties.parentId);
      // Region relations are explicit references, not administrative partition parents.
      $('regionParentInput').disabled = true;
      $('regionParentInput').closest('.field-group')?.classList.toggle('hidden', !properties.parentId
        || String(properties.parentId) === String(countryId));
      $('regionValidFromInput').value = properties.validFrom || '';
      $('regionValidToInput').value = properties.validTo || '';
    }
    return true;
  }
  const areaCache = new WeakMap();
  const pendingAreas = new WeakSet();
  let disposed = false;

  const scheduleArea = view => {
    const geometry = view?.feature?.geometry;
    if (!geometry || pendingAreas.has(geometry)) return;
    pendingAreas.add(geometry);
    const calculate = () => {
      const value = calculateAreaKm2(geometry);
      areaCache.set(geometry, value);
      pendingAreas.delete(geometry);
      if (disposed) return;
      const primary = getPrimaryRef();
      if (primary?.key !== view.ref.key) return;
      const current = getTerritorialView(primary);
      if (!current?.feature) return;
      if (current.feature.geometry !== geometry) {
        if (!areaCache.has(current.feature.geometry)) scheduleArea(current);
        return;
      }
      const formatted = formatArea(value);
      if (primary.type === 'country' && elements.area) elements.area.textContent = formatted;
      if (elements.selectionStatus) elements.selectionStatus.textContent = territorialSelectionStatus(current, formatted);
      syncStatus();
    };
    if (typeof window?.requestIdleCallback === 'function') window.requestIdleCallback(calculate, { timeout: 800 });
    else window?.setTimeout?.(calculate, 0);
  };

  const present = (ref, { refreshOnly = false } = {}) => {
    if (disposed) return false;
    const view = getTerritorialView(ref);
    if (!view?.feature) return false;
    const startedAt = globalThis.performance?.now?.() || Date.now();
    showPropertyForm(view.ref.type, view.displayName, { resetScroll: !refreshOnly });
    const fieldsStartedAt = globalThis.performance?.now?.() || Date.now();
    if (view.ref.type !== 'country') presentUnitFields(view);
    else {
      if (elements.name) elements.name.value = view.displayName;
      const color = resolveColor(view);
      if (elements.color) elements.color.value = color.value;
      syncColorPicker('country', { value: color.value, defaultColor: defaultColor(view), isDefault: color.isDefault });
      if (elements.notes) elements.notes.value = view.properties.notes || '';
    }
    const geometry = view.feature.geometry;
    const cached = geometry && areaCache.has(geometry);
    const area = cached ? areaCache.get(geometry) : null;
    if (view.ref.type === 'country' && elements.area) {
      elements.area.textContent = cached ? formatArea(area) : '면적 계산 중…';
      elements.area.dataset.tooltip = '구면 근사 면적이며 고정밀 GIS 측정값과 차이가 날 수 있습니다.';
    }
    if (elements.selectionStatus) elements.selectionStatus.textContent = cached
      ? territorialSelectionStatus(view, formatArea(area))
      : territorialSelectionStatus(view);
    if (!cached) scheduleArea(view);
    syncStatus();
    if (view.ref.type === 'country') syncActions(view);
    syncLayerSelection();
    metrics.propertyPanelMs = fieldsStartedAt - startedAt;
    metrics.propertyFieldsMs = (globalThis.performance?.now?.() || Date.now()) - fieldsStartedAt;
    metrics.transactionMs = (globalThis.performance?.now?.() || Date.now()) - startedAt;
    return true;
  };

  const refresh = countryRef => present(countryRef, { refreshOnly: true });

  const clear = () => {};

  const bind = () => {
    const bindField = (element, field, relation = false) => element?.addEventListener('change', event => {
      const ref = getPrimaryRef();
      if (ref?.domain !== 'territorial') return;
      const value = ['name', 'validFrom', 'validTo'].includes(field) ? event.target.value.trim() : event.target.value;
      if (relation) commitRelation(field, value);
      else commitField(ref, field, value);
    });
    bindField(elements.name, 'name'); bindField(elements.notes, 'notes');
    for (const type of ['subunit', 'region']) {
      for (const [suffix, field] of [['Name','name'],['Notes','notes'],['ValidFrom','validFrom'],['ValidTo','validTo']]) bindField($(type + suffix + 'Input'), field);
      bindField($(type + 'CountryInput'), 'associatedCountryId', true);
      bindField($(type + 'ParentInput'), 'parentId', true);
    }
    return api;
  };

  const dispose = () => {
    disposed = true;
  };

  const api = Object.freeze({ bind, present, refresh, clear, dispose });
  return api;
}
