import { defaultUserPreferences } from "./user-preferences.js";
import { setDialogReturnFocus } from "./dialog-accessibility-controller.js";

/** One flat, immediately persisted settings surface; Core remains the display-state owner. */
export function createPreferencesDialog({ document, window = globalThis.window, productMode, getPreferences,
  applyPreferences, mapSettings, getMapState, beforeOpen = () => {}, returnFocus = null, onError = () => {} }) {
  if (productMode !== 'viewer') throw new TypeError('Preference dialog requires viewer product mode.');
  const get = id => document.getElementById(id);
  const modal = get('preferencesModal');
  const listeners = [];
  let trigger = null, disposed = false, queue = Promise.resolve();
  const listen = (target, type, callback) => {
    if (!target) return;
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  };
  // Move the original conditional feature controls, including all distribution
  // inputs and legend. No duplicate controls or second data/rendering model.
  const generic = document.querySelector('#mapDisplaySurface [data-map-display-group="genericFeatures"]');
  const genericPopup = generic?.querySelector('[data-view-menu-popup="genericFeatures"]');
  if (generic && genericPopup) {
    generic.querySelector('.layer-type-settings-heading')?.remove();
    const heading = document.createElement('strong');
    heading.textContent = '기타 객체';
    generic.prepend(heading);
    for (const child of [...genericPopup.children]) generic.append(child);
    genericPopup.remove();
    generic.className = 'preferences-conditional';
    generic.querySelector('[data-layer-style-panel="genericFeatures"]')?.removeAttribute('hidden');
    get('preferencesGenericSlot').append(generic);
  }
  const distribution = get('distributionMenuGroup');
  const distributionPanel = get('distributionViewSettings');
  if (distribution && distributionPanel) {
    distribution.replaceChildren(distributionPanel);
    distribution.className = 'preferences-conditional';
    distributionPanel.classList.remove('view-menu-popup');
    distributionPanel.removeAttribute('data-view-menu-popup');
    distributionPanel.hidden = false;
    get('preferencesDistributionSlot').append(distribution);
  }
  const map = () => getMapState?.() || {};
  function sync() {
    if (disposed) return;
    const prefs = getPreferences(), state = map();
    get('preferencesThemeInput').value = prefs.appearance.theme;
    for (const button of modal.querySelectorAll('[data-preference-theme]'))
      button.setAttribute('aria-pressed', String(button.dataset.preferenceTheme === prefs.appearance.theme));
    for (const option of modal.querySelectorAll('input[name="preferencesMapStyle"]'))
      option.checked = option.value === prefs.appearance.mapStyle;
    get('preferencesSmoothLinesInput').checked = prefs.appearance.smoothLines;
    get('preferencesNativeNamesInput').checked = prefs.labels.place.showNativeNames;
    get('preferencesRiversInput').checked = state.layerVisibility?.rivers !== false;
    get('preferencesLakesInput').checked = state.layerVisibility?.lakes !== false;
    get('preferencesGraticuleInput').checked = state.backgroundSettings?.graticule !== false;
    const layerIds = new Set((state.distributionLayers || []).map(layer => layer.id));
    const hasDistributions = (state.distributionEntries || []).some(entry => layerIds.has(entry.layerId));
    if (generic) generic.classList.toggle('hidden', !(state.genericFeatures || []).length);
    if (distribution) distribution.classList.toggle('hidden', !hasDistributions);
    get('preferencesGenericSlot').hidden = !generic || !(state.genericFeatures || []).length;
    get('preferencesDistributionSlot').hidden = !distribution || !hasDistributions;
    mapSettings.renderMapDisplaySettings();
  }
  function schedule(operation) {
    queue = queue.catch(() => {}).then(operation).then(sync).catch(error => {
      onError(error, '설정을 변경하지 못했습니다.', 'PL-PREFERENCES-CHANGE');
      sync();
    });
  }
  const applyAppearance = patch => {
    const current = getPreferences();
    applyPreferences({ ...current, appearance: { ...current.appearance, ...patch } });
    sync();
  };
  function close() {
    modal.classList.add('hidden');
    (returnFocus?.() || trigger)?.focus?.({ preventScroll: true });
    trigger = null;
  }
  listen(get('preferencesBtn'), 'click', event => {
    beforeOpen();
    trigger = event.currentTarget;
    setDialogReturnFocus(modal, () => returnFocus?.() || trigger);
    sync();
    modal.classList.remove('hidden');
    modal.querySelector('input[name="preferencesMapStyle"]:checked')?.focus({ preventScroll: true });
  });
  listen(get('preferencesCloseBtn'), 'click', close);
  listen(modal.querySelector('.ui-dialog-backdrop'), 'click', close);
  listen(modal, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  for (const button of modal.querySelectorAll('[data-preference-theme]'))
    listen(button, 'click', () => applyAppearance({ theme: button.dataset.preferenceTheme }));
  listen(get('preferencesSmoothLinesInput'), 'change', event => applyAppearance({ smoothLines: event.currentTarget.checked }));
  for (const option of modal.querySelectorAll('input[name="preferencesMapStyle"]'))
    listen(option, 'change', event => {
      if (event.currentTarget.checked) schedule(() => mapSettings.applyMapStyle(event.currentTarget.value));
    });
  listen(get('preferencesNativeNamesInput'), 'change', event =>
    schedule(() => mapSettings.setNativeNameOverlay(event.currentTarget.checked)));
  for (const [id, group] of [['preferencesRiversInput', 'rivers'], ['preferencesLakesInput', 'lakes']])
    listen(get(id), 'change', event => schedule(() => mapSettings.setLayerVisibility(group, event.currentTarget.checked)));
  listen(get('preferencesGraticuleInput'), 'change', event =>
    schedule(() => mapSettings.setBackgroundSetting('graticule', event.currentTarget.checked)));
  listen(get('preferencesResetBtn'), 'click', () => schedule(async () => {
    const defaults = defaultUserPreferences(), current = getPreferences();
    applyPreferences({ ...current, appearance: defaults.appearance,
      labels: { ...current.labels, place: { ...current.labels.place, showNativeNames: false } } });
    await mapSettings.applyMapStyle(defaults.appearance.mapStyle);
    for (const group of ['rivers', 'lakes']) if (map().layerVisibility?.[group] === false)
      await mapSettings.setLayerVisibility(group, true);
    if (map().backgroundSettings?.graticule === false) await mapSettings.setBackgroundSetting('graticule', true);
  }));
  listen(window, 'pandolab:project-changed', sync);
  return Object.freeze({ sync, close, dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of listeners.splice(0)) unsubscribe();
    trigger = null;
    modal.classList.add('hidden');
  } });
}
