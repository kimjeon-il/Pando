import { territorialSelectionStatus } from './country-display.js';
import { normalizeObjectRef } from './object-selection-controller.js';
import { normalizeTemporalInterval } from './temporal.js';

export function formatTerritorialPeriodInput({ validFrom, validTo }) {
  return validFrom || validTo ? `${validFrom || ''} ~ ${validTo || ''}`.trim() : '';
}

export function parseTerritorialPeriodInput(value) {
  const input = value.trim();
  const parts = input ? input.split('~') : ['', ''];
  if (parts.length !== 2) throw Object.assign(new Error('존속기간의 시작과 끝을 ~ 하나로 구분하세요.'), { code: 'PL-EDITOR-PERIOD' });
  const { validFrom, validTo } = normalizeTemporalInterval(parts[0], parts[1]);
  return { validFrom, validTo };
}

export function createTerritorialPropertyController({
  window,
  document,
  elements = {},
  entityRepository,
  focusObject,
  createIcon,
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
  const listeners = [];
  const listen = (element, type, handler) => {
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  };
  const clearPeriodError = () => {
    $('entityPeriodInput').setCustomValidity('');
    $('entityPeriodInput').removeAttribute('aria-invalid');
  };
  function presentRelations(view) {
    const parent = entityRepository.parent(view.ref.id);
    const children = entityRepository.children(view.ref.id);
    const rowFor = feature => {
      const related = getTerritorialView(normalizeObjectRef({ domain: 'territorial', type: 'entity', id: String(feature.id) }));
      const row = document.createElement('div');
      row.className = 'editor-info-relation-row';
      const flag = document.createElement('span');
      flag.className = 'editor-info-relation-flag';
      if (related.flagUrl) {
        const image = document.createElement('img');
        image.src = related.flagUrl; image.alt = '';
        flag.append(image);
      }
      const name = document.createElement('span');
      name.className = 'editor-info-relation-name';
      name.textContent = related.displayName;
      const focus = document.createElement('button');
      focus.type = 'button';
      focus.className = 'ui-button icon-btn editor-info-relation-focus';
      focus.dataset.infoRelationFocus = String(feature.id);
      focus.dataset.tooltip = '선택 객체로 이동';
      focus.setAttribute('aria-label', `${related.displayName}으로 이동`);
      focus.append(createIcon('focus', 'ui-icon'));
      row.append(flag, name, focus);
      return row;
    };
    $('entityInfoParentRows').replaceChildren(...(parent ? [rowFor(parent)] : []));
    $('entityInfoChildRows').replaceChildren(...children.map(rowFor));
    $('entityInfoParent').hidden = !parent;
    $('entityInfoChildren').hidden = !children.length;
    $('entityInfoRelations').hidden = !parent && !children.length;
  }
  function presentFields(view) {
    const properties = view.feature.properties;
    const general = properties.entityKind === 'general', nested = general && !!properties.parentId;
    elements.name.value = view.displayName;
    elements.notes.value = properties.notes;
    $('entityPeriodInput').value = formatTerritorialPeriodInput(properties);
    clearPeriodError();
    presentRelations(view);
    const color = resolveColor(view);
    elements.color.value = color.value;
    syncColorPicker('entity', { value: color.value, defaultColor: defaultColor(view), isDefault: color.isDefault });
    $('entityParentRow').classList.toggle('hidden', !general);
    $('entityRegionalStatus').classList.toggle('hidden', general);
    replaceSelectOptions($('entityParentInput'), general ? territorialParentOptions(view.feature) : [], properties.parentId);
    for (const control of [elements.name, elements.notes, $('entityParentInput'), $('entityPeriodInput')]) control.disabled = properties.locked;
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
    const bindField = (element, field, relation = false) => listen(element, 'change', event => {
      const ref = getPrimaryRef();
      if (ref?.domain !== 'territorial') return;
      const value = field === 'name' ? event.target.value.trim() : event.target.value;
      if (relation) commitRelation(field, value);
      else commitField(ref, field, value);
    });
    bindField(elements.name, 'name'); bindField(elements.notes, 'notes');
    listen($('entityPeriodInput'), 'input', clearPeriodError);
    listen($('entityPeriodInput'), 'change', event => {
      const ref = getPrimaryRef();
      if (ref?.domain !== 'territorial') return;
      const input = event.target;
      const showError = message => {
        input.setCustomValidity(message);
        input.setAttribute('aria-invalid', 'true');
        input.reportValidity();
      };
      let interval;
      try { interval = parseTerritorialPeriodInput(input.value); }
      catch (error) { showError(error.message); return; }
      clearPeriodError();
      const result = commitField(ref, 'validity', interval);
      if (!result.ok) showError(result.issues?.[0] || '존속기간을 변경할 수 없습니다.');
      else input.value = formatTerritorialPeriodInput(interval);
    });
    bindField($('entityParentInput'), 'parentId', true);
    listen($('entityInfoRelations'), 'click', event => {
      const button = event.target.closest('[data-info-relation-focus]');
      if (button) focusObject(normalizeObjectRef({ domain: 'territorial', type: 'entity', id: button.dataset.infoRelationFocus }));
    });
    return api;
  };

  const dispose = () => {
    disposed = true;
    for (const remove of listeners.splice(0)) remove();
  };

  const api = Object.freeze({ bind, present, refresh, clear, dispose });
  return api;
}
