import { territorialSelectionStatus } from './country-display.js';

export function createTerritorialPropertyController({
  window,
  elements = {},
  getTerritorialView,
  getElement,
  territorialParentOptions,
  refreshTerritorialCoastAvailability,
  replaceSelectOptions,
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
  function presentFields(view) {
    const properties = view.feature.properties;
    const general = properties.entityKind === 'general', nested = general && !!properties.parentId;
    elements.name.value = view.displayName;
    elements.notes.value = properties.notes;
    $('entityValidFromInput').value = properties.validFrom || '';
    $('entityValidToInput').value = properties.validTo || '';
    const color = resolveColor(view);
    elements.color.value = color.value;
    syncColorPicker('entity', { value: color.value, defaultColor: defaultColor(view), isDefault: color.isDefault });
    $('entityParentRow').classList.toggle('hidden', !general);
    $('entityRegionalStatus').classList.toggle('hidden', general);
    replaceSelectOptions($('entityParentInput'), general ? territorialParentOptions(view.feature) : [], properties.parentId);
    for (const control of [elements.name, elements.notes, $('entityParentInput'), $('entityValidFromInput'), $('entityValidToInput')]) control.disabled = properties.locked;
    const actions = {
      addEntityChildBtn: general, annexEntityBtn: general, mergeEntityBtn: true,
      editEntityBorderBtn: general, redrawEntityBtn: !general, editEntityCoastBtn: general,
      reconcileEntityCoastBtn: nested, copyEntityRegionBtn: general,
    };
    for (const [id, visible] of Object.entries(actions)) {
      $(id).classList.toggle('hidden', !visible);
      $(id).disabled = id !== 'copyEntityRegionBtn' && properties.locked;
    }
    // Copy reads the source; a locked source can still be copied.
    if (nested && !properties.locked) refreshTerritorialCoastAvailability(view.feature);
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
      if (elements.area) elements.area.textContent = formatted;
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
    showPropertyForm('entity', view.displayName, { resetScroll: !refreshOnly });
    const fieldsStartedAt = globalThis.performance?.now?.() || Date.now();
    presentFields(view);
    const geometry = view.feature.geometry;
    const cached = geometry && areaCache.has(geometry);
    const area = cached ? areaCache.get(geometry) : null;
    if (elements.area) {
      elements.area.textContent = cached ? formatArea(area) : '면적 계산 중…';
      elements.area.dataset.tooltip = '구면 근사 면적이며 고정밀 GIS 측정값과 차이가 날 수 있습니다.';
    }
    if (elements.selectionStatus) elements.selectionStatus.textContent = cached
      ? territorialSelectionStatus(view, formatArea(area))
      : territorialSelectionStatus(view);
    if (!cached) scheduleArea(view);
    syncStatus();
    syncActions(view);
    syncLayerSelection();
    metrics.propertyPanelMs = fieldsStartedAt - startedAt;
    metrics.propertyFieldsMs = (globalThis.performance?.now?.() || Date.now()) - fieldsStartedAt;
    metrics.transactionMs = (globalThis.performance?.now?.() || Date.now()) - startedAt;
    return true;
  };

  const refresh = entityRef => present(entityRef, { refreshOnly: true });

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
    bindField($('entityValidFromInput'), 'validFrom');
    bindField($('entityValidToInput'), 'validTo');
    bindField($('entityParentInput'), 'parentId', true);
    return api;
  };

  const dispose = () => {
    disposed = true;
  };

  const api = Object.freeze({ bind, present, refresh, clear, dispose });
  return api;
}
