import { defaultUserPreferences } from "./user-preferences.js";
import { setDialogReturnFocus } from "./dialog-accessibility-controller.js";

/** One settings dialog. No detached View surface, DOM reparenting or duplicate state. */
export function createPreferencesDialog({ document, window = globalThis.window, productMode,
  getPreferences, applyPreferences, mapSettings, getMapState, beforeOpen = () => {},
  returnFocus = null, onError = () => {} }) {
  if (productMode !== 'viewer') throw new TypeError('Preference dialog requires viewer product mode.');
  const get = id => document.getElementById(id);
  const modal = get('preferencesModal');
  const listeners = [];
  let trigger = null, disposed = false, pending = Promise.resolve();
  const listen = (node, event, handler) => {
    if (!node) return;
    node.addEventListener(event, handler);
    listeners.push(() => node.removeEventListener(event, handler));
  };
  const state = () => getMapState?.() || {};
  const element = (name, className, content) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  };
  function renderDistribution(stateSnapshot) {
    const settings = stateSnapshot.distributionSettings || {}, layers = stateSnapshot.distributionLayers || [],
      visibleLayers = stateSnapshot.layerVisibility?.distributions === false ? []
        : layers.filter(layer => stateSnapshot.itemVisibility?.distributions?.[layer.id] !== false);
    const mode = settings.renderMode || 'overlap';
    get('preferencesDistributionBlendInput').value = stateSnapshot.layerPresentation?.styles?.distributions?.blendMode === 'multiply'
      ? 'multiply' : 'normal';
    for (const input of modal.querySelectorAll('input[name="distributionLayerMode"]'))
      input.checked = input.value === mode;
    get('distributionBoundaryVisibleInput').checked = settings.boundaryVisible !== false;
    get('preferencesDistributionLayerRow').hidden = mode !== 'single';
    get('distributionLayerModeHint').textContent = mode === 'single'
      ? '선택한 분포 하나를 값의 농도로 표시합니다.'
      : '표시 중인 분포를 목록 순서대로 겹쳐 그립니다.';
    const select = get('distributionActiveLayerInput');
    select.replaceChildren(...visibleLayers.map(layer => {
      const option = element('option',null,layer.name);
      option.value = layer.id;
      return option;
    }));
    select.value = visibleLayers.some(layer => layer.id === settings.activeLayerId)
      ? settings.activeLayerId : visibleLayers[0]?.id || '';
    const chosen = mode === 'single' ? visibleLayers.filter(layer => layer.id === select.value) : visibleLayers;
    const legend = get('distributionLegend');
    legend.replaceChildren(...chosen.map(layer => {
      const entries = (stateSnapshot.distributionEntries || []).filter(entry => entry.layerId === layer.id);
      const range = mapSettings.distributionValueRange(layer,entries);
      const row = element('div','distribution-legend-row');
      const title = element('strong',null,layer.name);
      const bar = element('span','distribution-legend-bar');
      bar.style.background = `linear-gradient(90deg, color-mix(in srgb, ${layer.color} 12%, transparent), color-mix(in srgb, ${layer.color} 70%, transparent))`;
      const label = !range ? '데이터 없음' : range.min === range.max
        ? `${range.min}${layer.unit ? ` ${layer.unit}` : ''}`
        : `${range.min}–${range.max}${layer.unit ? ` ${layer.unit}` : ''}`;
      row.append(title,bar,element('span',null,label));
      return row;
    }));
  }
  function sync() {
    if (disposed) return;
    const preferences = getPreferences(), view = state();
    get('preferencesThemeInput').value = preferences.appearance.theme;
    for (const button of modal.querySelectorAll('[data-preference-theme]'))
      button.setAttribute('aria-pressed',String(button.dataset.preferenceTheme === preferences.appearance.theme));
    for (const radio of modal.querySelectorAll('input[name="preferencesMapStyle"]'))
      radio.checked = radio.value === preferences.appearance.mapStyle;
    get('preferencesNativeNamesInput').checked = preferences.labels.place.showNativeNames;
    get('preferencesSmoothLinesInput').checked = preferences.appearance.smoothLines;
    get('preferencesGraticuleInput').checked = view.backgroundSettings?.graticule !== false;
    for (const [id,group] of [['preferencesRiversInput','rivers'],['preferencesLakesInput','lakes'],
      ['genericFeaturesVisible','genericFeatures'],['distributionsVisible','distributions']])
      get(id).checked = view.layerVisibility?.[group] !== false;
    const hasGeneric = (view.genericFeatures || []).length > 0;
    const layerIds = new Set((view.distributionLayers || []).map(layer => layer.id));
    const hasDistribution = (view.distributionEntries || []).some(entry => layerIds.has(entry.layerId));
    get('preferencesGenericSlot').hidden = !hasGeneric;
    get('preferencesDistributionSlot').hidden = !hasDistribution;
    if (hasDistribution) renderDistribution(view);
  }
  function schedule(operation) {
    pending = pending.catch(()=>{}).then(operation).catch(error => {
      onError(error,'설정을 변경하지 못했습니다.','PL-PREFERENCES-CHANGE');
    }).then(sync);
    return pending;
  }
  // Read values synchronously. A queued operation must not observe a later
  // DOM update or the sync() of an earlier operation.
  const queueInput = (input, action) => {
    const value = input.type === 'checkbox' ? input.checked : input.value;
    return schedule(() => action(value));
  };
  function applyAppearance(patch) {
    const current = getPreferences();
    applyPreferences({...current,appearance:{...current.appearance,...patch}});
    sync();
  }
  function close() {
    modal.classList.add('hidden');
    (returnFocus?.() || trigger)?.focus?.({preventScroll:true});
    trigger = null;
  }
  listen(get('preferencesBtn'),'click',event => {
    beforeOpen();
    trigger = event.currentTarget;
    setDialogReturnFocus(modal,()=>returnFocus?.() || trigger);
    sync();
    modal.classList.remove('hidden');
    modal.querySelector('input[name="preferencesMapStyle"]:checked')?.focus({preventScroll:true});
  });
  listen(get('preferencesCloseBtn'),'click',close);
  listen(modal.querySelector('.ui-dialog-backdrop'),'click',close);
  listen(modal,'keydown',event => {
    if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close(); }
  });
  for (const button of modal.querySelectorAll('[data-preference-theme]'))
    listen(button,'click',()=>applyAppearance({theme:button.dataset.preferenceTheme}));
  listen(get('preferencesSmoothLinesInput'),'change',event=>applyAppearance({smoothLines:event.currentTarget.checked}));
  for (const input of modal.querySelectorAll('input[name="preferencesMapStyle"]'))
    listen(input,'change',event => {
      if (event.currentTarget.checked) queueInput(event.currentTarget,value=>mapSettings.applyMapStyle(value));
    });
  listen(get('preferencesNativeNamesInput'),'change',event=>
    queueInput(event.currentTarget,value=>mapSettings.setNativeNameOverlay(value)));
  for (const [id,group] of [['preferencesRiversInput','rivers'],['preferencesLakesInput','lakes'],
    ['genericFeaturesVisible','genericFeatures'],['distributionsVisible','distributions']])
    listen(get(id),'change',event=>
      queueInput(event.currentTarget,value=>mapSettings.setLayerVisibility(group,value)));
  listen(get('preferencesGraticuleInput'),'change',event=>
    queueInput(event.currentTarget,value=>mapSettings.setBackgroundSetting('graticule',value)));
  listen(get('preferencesDistributionBlendInput'),'change',event=>
    queueInput(event.currentTarget,value=>mapSettings.updateLayerPresentationStyle('distributions',{blendMode:value})));
  for (const input of modal.querySelectorAll('input[name="distributionLayerMode"]'))
    listen(input,'change',event => {
      if (event.currentTarget.checked)
        queueInput(event.currentTarget,value=>mapSettings.setDistributionControl('distributionRenderMode',value));
    });
  listen(get('distributionActiveLayerInput'),'change',event=>
    queueInput(event.currentTarget,value=>mapSettings.setDistributionControl('distributionActiveLayer',value)));
  listen(get('distributionBoundaryVisibleInput'),'change',event=>
    queueInput(event.currentTarget,value=>mapSettings.setDistributionControl('distributionBoundaryVisible',value)));
  listen(get('preferencesResetBtn'),'click',()=>schedule(async() => {
    const defaults = defaultUserPreferences(), current = getPreferences();
    applyPreferences({...current,appearance:defaults.appearance,labels:{...current.labels,place:{
      ...current.labels.place,showNativeNames:false,
    }}});
    await mapSettings.applyMapStyle(defaults.appearance.mapStyle);
    for (const group of ['rivers','lakes']) if (state().layerVisibility?.[group] === false)
      await mapSettings.setLayerVisibility(group,true);
    if (state().backgroundSettings?.graticule === false)
      await mapSettings.setBackgroundSetting('graticule',true);
    // Conditional project-owned settings are intentionally not reset.
  }));
  listen(window,'pandolab:project-changed',sync);
  return Object.freeze({sync,close,dispose(){
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of listeners.splice(0)) unsubscribe();
    trigger = null;
    modal.classList.add('hidden');
  }});
}
