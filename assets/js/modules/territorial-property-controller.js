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
  commitFlag = () => false,
  openFlagLibrary = () => false,
  closeColorPickers = () => {},
  isMutationBlocked = ref => !!getTerritorialView(ref)?.feature?.properties.locked,
  getProjectGeneration = () => 0,
  reportFlagError = () => {},
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
  const entityRef = id => normalizeObjectRef({ domain: 'territorial', type: 'entity', id: String(id) });
  function presentRelations(view) {
    const parent = entityRepository.parent(view.ref.id);
    const children = entityRepository.children(view.ref.id);
    const general = view.feature.properties.entityKind === 'general';
    const blocked = isMutationBlocked(view.ref);
    const rowFor = (feature, child = false) => {
      const related = getTerritorialView(entityRef(feature.id));
      const row = document.createElement('div');
      row.className = 'editor-relation-row';
      const flag = document.createElement('span');
      flag.className = 'editor-relation-flag';
      if (related.flagUrl) {
        const image = document.createElement('img');
        image.src = related.flagUrl; image.alt = '';
        flag.append(image);
      }
      const name = document.createElement('span');
      name.className = 'editor-relation-name';
      name.textContent = related.displayName;
      const actions = document.createElement('span');
      actions.className = 'editor-relation-actions';
      const focus = document.createElement('button');
      focus.type = 'button';
      focus.className = 'ui-button icon-btn editor-relation-focus';
      focus.dataset.relationFocus = String(feature.id);
      focus.dataset.tooltip = '객체로 이동';
      focus.setAttribute('aria-label', `${related.displayName}으로 이동`);
      focus.append(createIcon('focus', 'ui-icon'));
      actions.append(focus);
      if (child) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ui-button icon-btn editor-relation-remove';
        remove.dataset.relationRemove = String(feature.id);
        remove.dataset.tooltip = '산하에서 제외';
        remove.setAttribute('aria-label', `${related.displayName} 산하에서 제외`);
        remove.disabled = blocked || isMutationBlocked(related.ref);
        remove.append(createIcon('remove', 'ui-icon'));
        actions.append(remove);
      }
      row.append(flag, name, actions);
      return row;
    };
    const empty = text => { const node = document.createElement('p'); node.className = 'editor-help'; node.textContent = text; return node; };
    $('entityParentRows').replaceChildren(...(parent ? [rowFor(parent)] : [empty('소속 없음')]));
    $('entityChildRows').replaceChildren(...(children.length ? children.map(feature => rowFor(feature, true)) : [empty('산하 객체 없음')]));
    $('entityRelations').hidden = !general;
    const excluded = new Set([view.ref.id, ...entityRepository.ancestors(view.ref.id).map(feature => String(feature.id))]);
    const candidates = general ? entityRepository.list().filter(candidate => candidate.properties.entityKind === 'general'
      && !candidate.properties.locked && candidate.properties.parentId !== view.ref.id && !excluded.has(String(candidate.id))) : [];
    replaceSelectOptions($('entityChildInput'), [
      { value: '', label: '산하 객체 선택', placeholder: true },
      ...candidates.map(feature => ({ value: String(feature.id), label: getTerritorialView(entityRef(feature.id)).displayName })),
    ], '');
    $('entityChildInput').disabled = blocked || !candidates.length;
    $('entityAddChildBtn').disabled = blocked || !candidates.length;
  }
  function presentFields(view) {
    const properties = view.feature.properties;
    const general = properties.entityKind === 'general', nested = general && !!properties.parentId;
    elements.name.value = view.displayName;
    elements.notes.value = properties.notes;
    $('entityPeriodInput').value = formatTerritorialPeriodInput(properties);
    clearPeriodError();
    syncIdentity(view);
    presentRelations(view);
    const color = resolveColor(view);
    elements.color.value = color.value;
    syncColorPicker('entity', { value: color.value, defaultColor: defaultColor(view), isDefault: color.isDefault });
    $('entityParentRow').classList.toggle('hidden', !general);
    $('entityRegionalStatus').classList.toggle('hidden', general);
    replaceSelectOptions($('entityParentInput'), general ? territorialParentOptions(view.feature) : [], properties.parentId);
    for (const control of [elements.name, elements.notes, $('entityParentInput'), $('entityPeriodInput')]) control.disabled = isMutationBlocked(view.ref);
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
  let disposed = false, bound = false;

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

  let activeRef = null, flagReadRevision = 0, pendingUpload = null;
  const closeFlag = ({ restoreFocus = false } = {}) => {
    const menu = $('flagMenu');
    if (!menu?.matches(':popover-open')) return false;
    menu.hidePopover();
    if (restoreFocus && !$('flagMenuBtn')?.disabled) $('flagMenuBtn')?.focus({ preventScroll: true });
    return true;
  };
  const closeTransient = ({ restoreFocus = false } = {}) => {
    const colorTrigger = $('editorSurface')?.querySelector('[data-color-picker].is-open .ui-color-trigger');
    const flagClosed = closeFlag({ restoreFocus: restoreFocus && !colorTrigger });
    closeColorPickers();
    if (restoreFocus && colorTrigger) colorTrigger.focus({ preventScroll: true });
    return flagClosed || !!colorTrigger;
  };
  function renderFlag(view) {
    const preview = $('flagPreview');
    preview.replaceChildren();
    if (!view.flagUrl) { preview.append(createIcon('entity', 'ui-icon')); return; }
    const image = document.createElement('img');
    image.src = view.flagUrl; image.alt = `${view.displayName} 깃발`;
    image.addEventListener('error', () => {
      if (activeRef?.key === view.ref.key && preview.contains(image)) renderFlag({ ...view, flagUrl: null });
    }, { once: true });
    preview.append(image);
  }
  function syncIdentity(view) {
    if (activeRef?.key !== view.ref.key) { flagReadRevision += 1; pendingUpload = null; closeTransient(); }
    activeRef = view.ref;
    renderFlag(view);
    $('flagDefaultBtn').disabled = !view.hasFlagOverride;
    $('flagRemoveBtn').disabled = !view.flagUrl;
    syncInteraction();
  }
  function syncInteraction() {
    if (!activeRef) return;
    const blocked = isMutationBlocked(activeRef);
    $('flagMenuBtn').disabled = blocked;
    $('entityColorTrigger').disabled = blocked;
    if (blocked) closeTransient();
  }
  function positionFlagMenu() {
    const menu = $('flagMenu'), trigger = $('flagMenuBtn');
    if (!menu.matches(':popover-open')) return;
    const style = window.getComputedStyle(document.documentElement);
    const edge = Number.parseFloat(style.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const gap = Number.parseFloat(style.getPropertyValue('--ui-menu-trigger-gap')) || 6;
    const rect = trigger.getBoundingClientRect(), menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.round(Math.max(edge, Math.min(rect.left, window.innerWidth - menuRect.width - edge)))}px`;
    menu.style.top = `${Math.round(rect.bottom + gap + menuRect.height <= window.innerHeight - edge ? rect.bottom + gap : Math.max(edge, rect.top - menuRect.height - gap))}px`;
  }
  const beginFlagChange = () => ({ ref: activeRef, generation: getProjectGeneration(), revision: ++flagReadRevision });
  const validFlagTarget = target => !disposed && target?.ref && target.revision === flagReadRevision
    && target.generation === getProjectGeneration() && getPrimaryRef()?.key === target.ref.key && !isMutationBlocked(target.ref);
  const commitFlagTarget = (target, value) => {
    if (!validFlagTarget(target)) return;
    try { commitFlag(target.ref, value); } catch (error) { reportFlagError(error); }
  };
  const clear = () => { flagReadRevision += 1; pendingUpload = null; closeTransient(); activeRef = null; };

  const bind = () => {
    if (bound || disposed) return api;
    bound = true;
    const bindField = (element, field, relation = false) => listen(element, 'change', event => {
      const ref = getPrimaryRef();
      if (ref?.domain !== 'territorial' || isMutationBlocked(ref)) return;
      const value = field === 'name' ? event.target.value.trim() : event.target.value;
      if (relation) commitRelation(ref, field, value);
      else commitField(ref, field, value);
    });
    bindField(elements.name, 'name'); bindField(elements.notes, 'notes');
    listen($('entityPeriodInput'), 'input', clearPeriodError);
    listen($('entityPeriodInput'), 'change', event => {
      const ref = getPrimaryRef();
      if (ref?.domain !== 'territorial' || isMutationBlocked(ref)) return;
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
    listen($('entityAddChildBtn'), 'click', () => {
      const ref = getPrimaryRef(), childId = $('entityChildInput').value;
      if (ref?.domain !== 'territorial' || !childId || isMutationBlocked(ref)) return;
      commitRelation(entityRef(childId), 'parentId', ref.id);
    });
    listen($('entityRelations'), 'click', event => {
      const focus = event.target.closest('[data-relation-focus]');
      if (focus) { focusObject(entityRef(focus.dataset.relationFocus)); return; }
      const remove = event.target.closest('[data-relation-remove]');
      const ref = getPrimaryRef();
      if (remove && ref?.domain === 'territorial' && !isMutationBlocked(ref)) {
        commitRelation(entityRef(remove.dataset.relationRemove), 'parentId', '');
      }
    });
    listen($('flagMenuBtn'), 'click', () => {
      const menu = $('flagMenu');
      if ($('flagMenuBtn').disabled) return;
      closeColorPickers();
      if (menu.matches(':popover-open')) { closeFlag(); return; }
      menu.showPopover();
      window.requestAnimationFrame(() => {
        if (disposed || !menu.matches(':popover-open')) return;
        positionFlagMenu(); menu.querySelector('button:not(:disabled):not(.hidden)')?.focus({ preventScroll: true });
      });
    });
    listen($('flagMenu'), 'toggle', () => {
      const menu = $('flagMenu'), open = menu.matches(':popover-open');
      $('flagMenuBtn').setAttribute('aria-expanded', String(open));
      if (!open) { menu.style.removeProperty('left'); menu.style.removeProperty('top'); }
    });
    listen($('flagMenu'), 'keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('button:not(:disabled):not(.hidden)')], index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFlag({ restoreFocus: true }); }
      else if (event.key === 'Tab') closeFlag();
    });
    listen($('flagUploadBtn'), 'click', () => { pendingUpload = beginFlagChange(); closeFlag({ restoreFocus: true }); $('flagFileInput').click(); });
    listen($('flagLibraryBtn'), 'click', async () => {
      const target = beginFlagChange(); closeFlag();
      if (!validFlagTarget(target)) return;
      try { await openFlagLibrary({ onPickFlag: value => { commitFlagTarget(target, value); }, restoreFocus: $('flagMenuBtn') }); }
      catch (error) { reportFlagError(error); }
    });
    for (const [id, value] of [['flagDefaultBtn', undefined], ['flagRemoveBtn', null]]) listen($(id), 'click', () => {
      const target = beginFlagChange(); closeFlag({ restoreFocus: true });
      commitFlagTarget(target, value);
    });
    listen($('flagFileInput'), 'change', event => {
      const file = event.target.files?.[0], target = pendingUpload;
      pendingUpload = null; event.target.value = '';
      if (!file || !validFlagTarget(target)) return;
      const reader = new window.FileReader();
      reader.addEventListener('load', () => { commitFlagTarget(target, reader.result); }, { once: true });
      reader.addEventListener('error', () => { if (validFlagTarget(target)) reportFlagError(reader.error); }, { once: true });
      try { reader.readAsDataURL(file); } catch (error) { reportFlagError(error); }
    });
    listen(document, 'pointerdown', event => { if (event.target.closest('.ui-color-trigger')) closeFlag(); });
    listen(window, 'resize', positionFlagMenu);
    return api;
  };

  const dispose = () => {
    disposed = true;
    clear();
    for (const remove of listeners.splice(0)) remove();
  };

  const api = Object.freeze({ bind, present, refresh, clear, closeTransient, syncInteraction, dispose });
  return api;
}
