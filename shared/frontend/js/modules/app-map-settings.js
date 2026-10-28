import { TERRITORIAL_SYMBOL_KEYS } from './layer-presentation.js';
import { MAP_DISPLAY_TARGETS } from './map-display-catalog.js';
import { PLACE_LANGUAGES, togglePlaceLanguage } from './place-contract.js';
import { distributionValueRange } from './distribution-model.js';
import { clearMenuPosition, createMenuPositionScheduler, exitMenuOnTab, positionRootMenu, positionSubmenu } from './menu-presentation.js';

const SYMBOL_VISIBILITY_KEYS = new Set(Object.values(TERRITORIAL_SYMBOL_KEYS));

/** MapSettings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createMapSettings({ capabilities,viewPresentation = null,authoredStyles=false } = {}) {
  if (!capabilities || ['builtinHydro', 'builtinPlaces', 'terrain'].some(key => typeof capabilities[key] !== 'boolean')) {
    throw new TypeError('Map settings require resource capabilities.');
  }
  let dependencies;
  let LAYER_STYLE_TARGETS;
  let desktopViewMenuPath = [];
  let desktopViewMenuOpenTimer = null;
  let desktopViewMenuCloseTimer = null;
  let displayMenuLayout = null;
  let displayMenuGesture = null;
  let pendingDisplayMenuLayout = false;
  let focusedMenuControl = null;
  let desktopViewMenuPositioner;
  const displayMenuPresentation = new Map();
  function connect(ports) {
    if (dependencies) throw new Error('map-settings already connected');
    if (typeof ports?.feedback?.reportOperationError !== 'function') throw new TypeError('Map settings require their operation error reporter.');
    for (const method of ['loadHydroData','preparePlaces']) {
      if(typeof ports.layerResources?.[method] !== 'function') throw new TypeError('Map settings require layerResources.'+method);
    }
    dependencies = ports;
  }

  function requireProjectOwner() {
    const project = dependencies.domains.projectDomain;
    if (typeof project?.executeCommand !== 'function' || typeof project.getGeneration !== 'function') {
      throw new TypeError('Map settings require the Core project command owner.');
    }
    return project;
  }

  async function executePresentation(payload) {
    if (viewPresentation && (!authoredStyles || !['groupStyle','objectStyle','labelSettings','layerOrder'].includes(payload.action))) {
      const result=viewPresentation.applyPresentation(payload);
      if(authoredStyles)dependencies.domains.projectDomain.queueViewAutosave();
      return result;
    }
    const project = requireProjectOwner();
    const generation = project.getGeneration();
    const result = await project.executeCommand({ commandId: 'presentation.apply', targets: [], payload: structuredClone(payload) });
    if (typeof result?.ok !== 'boolean' || typeof result.changed !== 'boolean') throw Object.assign(new Error('A complete presentation acknowledgement is required.'), { code: 'PL-CORE-RESPONSE' });
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return project.getGeneration() === generation ? result : null;
  }

  async function runViewAction(operation) {
    try { await operation(); }
    catch (error) {
      dependencies.feedback.reportOperationError(error, '지도 표시 설정을 변경하지 못했습니다.', 'PL-VIEW-COMMAND-001', 4200);
      renderMapDisplaySettings();
    }
  }

  async function setLayerVisibility(key, visible) {
    if (!await executePresentation({ action: 'visibility', key, visible })) return false;
    if (!isDesktopViewMenu() && !SYMBOL_VISIBILITY_KEYS.has(key) && key !== 'labels') {
      if (visible) dependencies.objectModelA.expandedMapDisplayGroups.add(key);
      else dependencies.objectModelA.expandedMapDisplayGroups.delete(key);
    }
    syncMapDisplayDisclosures();
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    dependencies.domains.objectSearchController?.render();
    if (key === 'distributions') dependencies.distributionPresentation.bumpVisibilityRevision();
    if (key === 'objects') dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-layer-visibility');
    if (key === 'rivers' || key === 'lakes') dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
    if (key === 'labels' || SYMBOL_VISIBILITY_KEYS.has(key)) dependencies.domains.renderingDomain?.invalidateLabels?.('label-visibility');
    else {
      dependencies.domains.renderingDomain?.invalidateBaseScene?.('layer-visibility');
      if (key === 'objects') dependencies.domains.renderingDomain.invalidateLabels('layer-visibility');
    }
    if (visible && (key === 'rivers' || key === 'lakes')) await dependencies.layerResources.loadHydroData(true);
    if (visible && key === 'labels') await dependencies.layerResources.preparePlaces({force:true});
  }

  function syncPlaceLanguageChecks() {
    const languages = dependencies.preferences.userPreferences.labels.place.languages;
    for (const input of document.querySelectorAll('[data-place-language]')) {
      input.checked = languages[input.dataset.placeLanguage] === true;
      input.disabled = input.checked && PLACE_LANGUAGES.filter(language => languages[language] === true).length === 1;
    }
  }

  function setPlaceLanguage(language, enabled) {
    const current = dependencies.preferences.userPreferences;
    const next = togglePlaceLanguage(current.labels.place.languages, language, enabled);
    if (!next) return false;
    const preferences = dependencies.preferences.saveUserPreferences({
      ...current, labels: { ...current.labels, place: { ...current.labels.place, languages: next } },
    });
    dependencies.preferences.setUserPreferences(preferences);
    syncPlaceLanguageChecks();
    dependencies.domains.renderingDomain.invalidateLabels('place-language-visibility');
    return true;
  }

  async function updateLayerPresentationStyle(group, patch) {
    const target = LAYER_STYLE_TARGETS[group];
    if (!target) return false;
    if (!await executePresentation({ action: 'groupStyle', group: target.presentationGroup, patch })) return false;
    syncMapDisplayDisclosures();
    if (target.presentationGroup === 'objects') {
      dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-presentation');
    }
    if (target.presentationGroup === 'rivers' || target.presentationGroup === 'lakes') {
      dependencies.rendering.gpuMapRenderer.invalidatePhysicalStyle('hydro-presentation');
    }
    dependencies.domains.renderingDomain?.invalidateOverlayStyle?.('layer-presentation-style');
    return true;
  }

  async function setTerrainMode(mode) {
    const physicalSettings = dependencies.hydroModel.terrainModeSettings(mode);
    if (!await executePresentation({ action: 'terrainMode', mode, physicalSettings })) return false;
    const current=dependencies.preferences.userPreferences,viewer={...current.backgrounds.viewer,terrainVisible:physicalSettings.terrainVisible,terrainStyle:physicalSettings.terrainStyle};
    dependencies.preferences.setUserPreferences(dependencies.preferences.saveUserPreferences({...current,backgrounds:{...current.backgrounds,viewer}}));
    dependencies.rendering.gpuMapRenderer.invalidatePhysicalStyle('terrain-mode');
    (0, dependencies.hydroModel.syncPhysicalControls)();
    syncMapDisplayDisclosures();
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    dependencies.domains.renderingDomain.invalidateBaseScene('terrain-mode');
    return true;
  }

  async function setDistributionControl(action, value, reason) {
    if (!await executePresentation({ action, value })) return false;
    if (action === 'distributionActiveLayer') dependencies.distributionPresentation.bumpVisibilityRevision();
    syncDistributionPresentationControls();
    dependencies.domains.renderingDomain.invalidateOverlayStyle(reason);
    return true;
  }

  function createLayerInlineStylePanel(group) {
    const panel = document.querySelector(`[data-layer-style-panel="${group}"]`);
    const target = LAYER_STYLE_TARGETS[group];
    if (!panel || panel.dataset.initialized === 'true') return panel;
    panel.dataset.initialized = 'true';
    if (!target) return panel;
    if (target.color) {
      const choice = document.createElement('label');
      choice.className = 'ui-choice-row ui-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.layerStyleColor = group;
      checkbox.setAttribute('aria-label', `${target.label} 고유 색상 사용`);
      const text = document.createElement('span');
      text.textContent = '고유 색상';
      choice.append(checkbox, text);
      panel.prepend(choice);
    }
    if (target.opacity) {
      const field = document.createElement('label');
      field.className = 'ui-field field-group layer-inline-style-field';
      const title = document.createElement('span');
      title.textContent = target.opacityLabel || '투명도';
      const output = document.createElement('output');
      output.dataset.layerStyleOpacityValue = group;
      title.append(' ', output);
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'ui-range-progress';
      input.min = '0'; input.max = '100'; input.value = '100';
      input.dataset.layerStyleOpacity = group;
      input.setAttribute('aria-label', `${target.label} ${target.opacityLabel || '투명도'}`);
      field.append(title, input);
      panel.append(field);
    }
    if (target.blendMode) {
      const field = document.createElement('label');
      field.className = 'ui-field field-group layer-inline-style-field';
      const title = document.createElement('span');
      title.textContent = '겹침 방식';
      const select = document.createElement('select');
      select.dataset.layerStyleBlendMode = group;
      select.setAttribute('aria-label', `${target.label} 겹침 방식`);
      select.innerHTML = '<option value="normal">일반</option><option value="multiply">곱하기</option>';
      field.append(title, select);
      panel.append(field);
    }
    if (target.boundary) {
      const choice = document.createElement('label');
      choice.className = 'ui-choice-row ui-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.layerStyleBoundary = group;
      checkbox.setAttribute('aria-label', `${target.label} ${target.boundaryLabel || '경계 표시'}`);
      const text = document.createElement('span');
      text.textContent = target.boundaryLabel || '경계 표시';
      choice.append(checkbox, text);
      panel.append(choice);
    }
    return panel;
  }

  function mapDisplayPanel(group) {
    if (group === 'terrain') return (0, dependencies.platform.$)('terrainDisplayOptions');
    return document.querySelector(`[data-layer-style-panel="${group}"]`);
  }

  function mapDisplayVisible(group) {
    return group === 'terrain'
      ? true
      : dependencies.projectState.state.layerVisibility[group] !== false;
  }

  function mapDisplayLabel(group) {
    if(group==='advanced')return '고급 보기';
    return group === 'terrain'
      ? '지형 표시'
      : LAYER_STYLE_TARGETS[group]?.label ? `${LAYER_STYLE_TARGETS[group].label} 표시` : '표시';
  }

  function isDesktopViewMenu() {
    const layout = (0, dependencies.platform.$)('app')?.dataset.layout;
    return layout === 'wide' || layout === 'compact';
  }

  function displayGroupForTrigger(trigger) {
    if (!trigger) return null;
    if (trigger.id === 'distributionMenuTrigger') return 'distribution';
    return trigger.dataset.mapDisplayRow || null;
  }

  function displayPanelForDesktopGroup(group) {
    return document.querySelector(`[data-view-menu-popup="${group}"]`);
  }

  function desktopMenuTrigger(group) {
    if (group === 'distribution') return (0, dependencies.platform.$)('distributionMenuTrigger');
    return document.querySelector(`[data-map-display-row="${group}"]`);
  }

  function desktopMenuOpen() {
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    return isDesktopViewMenu() && (surface?.classList.contains('surface-open') || surface?.classList.contains('mobile-open'));
  }

  function cancelDesktopMenuTimers() {
    clearTimeout(desktopViewMenuOpenTimer);
    clearTimeout(desktopViewMenuCloseTimer);
    desktopViewMenuOpenTimer = null;
    desktopViewMenuCloseTimer = null;
  }

  function setMenuPresentation(element, desktop, classes) {
    if (!element) return;
    let original = displayMenuPresentation.get(element);
    if (!original) {
      original = {
        classes: ['ui-toggle', 'ui-radio-toggle', 'ui-segment-option', 'ui-segmented',
          'terrain-mode-option', 'map-view-settings', 'layer-inline-style-panel',
          'terrain-display-options', 'distribution-view-settings', 'map-display-details']
          .filter(name => element.classList.contains(name)),
        role: element.getAttribute('role'),
        tabIndex: element.getAttribute('tabindex'),
      };
      displayMenuPresentation.set(element, original);
    }
    for (const name of original.classes) element.classList.toggle(name, !desktop);
    for (const name of classes) element.classList.toggle(name, desktop);
    if (!desktop) {
      for (const [attribute, value] of [['role', original.role], ['tabindex', original.tabIndex]]) {
        if (value === null) element.removeAttribute(attribute);
        else element.setAttribute(attribute, value);
      }
      element.removeAttribute('aria-checked');
      delete element.dataset.menuChoice;
    }
  }

  function syncMenuChoices(surface, desktop) {
    for (const row of surface.querySelectorAll('.view-menu-parent, .ui-choice-row, .ui-menu-item')) {
      setMenuPresentation(row, desktop, ['ui-menu-item']);
      const input = row.querySelector(':scope > input[type="checkbox"], :scope > input[type="radio"]');
      const action = input || row;
      setMenuPresentation(action, desktop, []);
      if (desktop) {
        action.setAttribute('role', input ? `menuitem${input.type}` : 'menuitem');
        if (input) {
          row.dataset.menuChoice = input.type;
          action.setAttribute('aria-checked', String(input.checked));
          if (!row.querySelector(':scope > .ui-menu-mark')) {
            const mark = document.createElement('span');
            mark.className = 'ui-menu-mark';
            mark.setAttribute('aria-hidden', 'true');
            row.append(mark);
          }
        }
      }
    }
  }

  function syncDesktopMenuLayout(desktop) {
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    if (!surface) return false;
    if (displayMenuLayout === desktop) return true;
    if (displayMenuGesture !== null || surface.classList.contains('is-sheet-dragging')) {
      pendingDisplayMenuLayout = true;
      return false;
    }
    cancelDesktopMenuTimers();
    const focusedControl = surface.contains(document.activeElement) ? document.activeElement : null;
    const root = surface.querySelector('.view-menu-root');

    // Keep authored submenu parents stable across desktop and mobile layouts.
    for (const popup of surface.querySelectorAll('[data-view-menu-popup]')) {
      setMenuPresentation(popup, desktop, ['ui-menu-surface', 'ui-menu-list', 'ui-command-menu']);
      if (desktop) {
        popup.setAttribute('role', 'menu');
        popup.dataset.menuLevel = desktopMenuTrigger(popup.dataset.viewMenuPopup)?.dataset.mapDisplayParent ? '2' : '1';
      } else {
        popup.removeAttribute('role');
        delete popup.dataset.menuLevel;
        popup.hidden = false;
        popup.inert = false;
        clearMenuPosition(popup);
      }
    }
    setMenuPresentation(root, desktop, ['ui-menu-list']);
    if (desktop) root.setAttribute('role', 'menu');
    else root.removeAttribute('role');
    surface.classList.toggle('view-menu-desktop', desktop);
    surface.classList.toggle('ui-menu-surface', desktop);
    surface.classList.toggle('ui-command-menu', desktop);
    if (!desktop) clearMenuPosition(surface);
    for (const element of surface.querySelectorAll('.terrain-mode-options, [role="radiogroup"], [data-menu-group]')) {
      element.dataset.menuGroup = '';
      setMenuPresentation(element, desktop, ['ui-menu-group']);
      if (desktop) element.setAttribute('role', 'group');
    }
    for (const panel of surface.querySelectorAll('[data-layer-style-panel]')) panel.classList.toggle('ui-menu-group', desktop);
    for (const field of surface.querySelectorAll('.layer-inline-style-field')) field.classList.toggle('ui-menu-control', desktop);
    for (const leading of surface.querySelectorAll('.view-menu-leading')) leading.classList.toggle('ui-menu-leading', desktop);
    for (const chevron of surface.querySelectorAll('.view-menu-chevron')) chevron.classList.toggle('ui-menu-chevron', desktop);
    syncMenuChoices(surface, desktop);
    if (!desktop) desktopViewMenuPath = [];
    displayMenuLayout = desktop;
    pendingDisplayMenuLayout = false;
    if (focusedControl?.getClientRects().length) focusedControl.focus({ preventScroll: true });
    return true;
  }

  function syncDesktopMenuChecks() {
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    if (!surface?.classList.contains('view-menu-desktop')) return;
    for (const input of surface.querySelectorAll('.ui-menu-item > input')) {
      input.setAttribute('aria-checked', String(input.checked));
    }
  }

  function positionDesktopViewMenus() {
    if (!desktopMenuOpen()) return;
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    positionRootMenu({ menu: surface, trigger: (0, dependencies.platform.$)('mapDisplayBtn') });
    for (const group of desktopViewMenuPath) positionDesktopViewMenuGroup(group);
  }

  function positionDesktopViewMenuGroup(group) {
    if (!desktopMenuOpen()) return;
    const panel = displayPanelForDesktopGroup(group);
    const trigger = desktopMenuTrigger(group);
    if (!panel || !trigger || panel.hidden) return;
    positionSubmenu({ menu: panel, trigger, parentMenu: trigger.closest('[role="menu"]') });
  }

  function setDesktopViewMenuGroup(group, { toggle = false } = {}) {
    if (!desktopMenuOpen() || !group || !mapDisplayAvailability()[group]) return false;
    cancelDesktopMenuTimers();
    const index = desktopViewMenuPath.indexOf(group);
    const parent = desktopMenuTrigger(group)?.dataset.mapDisplayParent;
    desktopViewMenuPath = toggle && index !== -1 ? desktopViewMenuPath.slice(0, index)
      : parent ? [parent, group] : [group];
    syncMapDisplayDisclosures();
    desktopViewMenuPositioner.schedule();
    return true;
  }

  function closeDesktopViewMenuGroup({ focusParent = false } = {}) {
    cancelDesktopMenuTimers();
    if (!desktopViewMenuPath.length) return false;
    const parent = desktopMenuTrigger(desktopViewMenuPath[0]);
    desktopViewMenuPath = [];
    syncMapDisplayDisclosures();
    if (focusParent) parent?.focus({ preventScroll: true });
    return true;
  }

  function collapseDesktopViewMenuLevel({ focusParent = false } = {}) {
    if (!isDesktopViewMenu()) return false;
    cancelDesktopMenuTimers();
    if (desktopViewMenuPath.length) {
      const trigger = desktopMenuTrigger(desktopViewMenuPath.pop());
      syncMapDisplayDisclosures();
      if (focusParent) trigger?.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  function scheduleDesktopViewMenuGroup(group) {
    cancelDesktopMenuTimers();
    if (desktopViewMenuPath.includes(group)) return;
    desktopViewMenuOpenTimer = setTimeout(() => {
      desktopViewMenuOpenTimer = null;
      if (desktopMenuOpen()) setDesktopViewMenuGroup(group);
    }, 150);
  }

  function scheduleDesktopViewMenuClose() {
    cancelDesktopMenuTimers();
    desktopViewMenuCloseTimer = setTimeout(() => closeDesktopViewMenuGroup(), 200);
  }

  function syncMapDisplayDisclosures() {
    const requestedDesktop = isDesktopViewMenu();
    const desktop = displayMenuLayout ?? requestedDesktop;
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    document.querySelectorAll('[data-layer-style-panel]').forEach(panel => {
      const group = panel.dataset.layerStylePanel;
      createLayerInlineStylePanel(group);
      const target = LAYER_STYLE_TARGETS[group];
      if (!target) return;
      const style = (0, dependencies.applicationServicesB.layerStyle)(dependencies.projectState.state.layerPresentation, target.presentationGroup);
      const color = panel.querySelector('[data-layer-style-color]');
      if (color) color.checked = style.colorVisible;
      const input = panel.querySelector('[data-layer-style-opacity]');
      if (input) { input.value = String(Math.round(style.opacity * 100)); (0, dependencies.hydroModel.syncRangeProgress)(input); }
      const output = panel.querySelector('[data-layer-style-opacity-value]');
      if (output) output.textContent = `${Math.round(style.opacity * 100)}%`;
      const boundary = panel.querySelector('[data-layer-style-boundary]');
      if (boundary) boundary.checked = style.boundaryVisible;
      const blendMode = panel.querySelector('[data-layer-style-blend-mode]');
      if (blendMode) blendMode.value = style.blendMode;
    });

    syncPlaceLanguageChecks();
    const layoutReady = syncDesktopMenuLayout(requestedDesktop);
    const menuDesktop = layoutReady ? requestedDesktop : desktop;
    document.querySelectorAll('[data-map-display-row]').forEach(trigger => {
      const group = trigger.dataset.mapDisplayRow;
      const row = trigger.closest('.map-display-row');
      const visible = mapDisplayVisible(group);
      if (!menuDesktop && !visible) dependencies.objectModelA.expandedMapDisplayGroups.delete(group);
      const expanded = menuDesktop
        ? desktopViewMenuPath.includes(group)
        : visible && dependencies.objectModelA.expandedMapDisplayGroups.has(group);
      const panel = mapDisplayPanel(group);
      const popup = displayPanelForDesktopGroup(group);
      if (popup && popup !== panel) popup.hidden = menuDesktop && !expanded;
      if (panel) {
        panel.hidden = !expanded;
        panel.inert = menuDesktop && !visible;
      }
      row?.classList.toggle('is-disabled', !menuDesktop && !visible);
      trigger.disabled = !menuDesktop && !visible;
      trigger.setAttribute('aria-expanded', String(expanded));
      const label = `${mapDisplayLabel(group)} 설정 ${expanded ? '접기' : '펼치기'}`;
      trigger.setAttribute('aria-label', label);
      const visibilityLabel = group === 'terrain' ? null : (0, dependencies.platform.$)(`${group}Visible`)?.nextElementSibling;
      if (visibilityLabel?.matches('span')) {
        visibilityLabel.textContent = menuDesktop
          ? '표시'
          : group === 'terrain'
            ? '지형'
            : LAYER_STYLE_TARGETS[group]?.label || '표시';
      }
    });
    const distributionSettings = (0, dependencies.platform.$)('distributionViewSettings');
    const distributionExpanded = menuDesktop && desktopViewMenuPath.includes('distribution');
    if (distributionSettings) distributionSettings.hidden = menuDesktop && !distributionExpanded;
    (0, dependencies.platform.$)('distributionMenuTrigger')?.setAttribute('aria-expanded', String(distributionExpanded));
    surface?.classList.toggle('view-menu-desktop', menuDesktop);
    syncDesktopMenuChecks();
    if (menuDesktop) desktopViewMenuPositioner.schedule();
  }

  function toggleMapDisplayDisclosure(group) {
    if (isDesktopViewMenu()) return setDesktopViewMenuGroup(group, { toggle: true });
    if (!mapDisplayVisible(group)) return false;
    const panel = group === 'terrain' ? mapDisplayPanel(group) : createLayerInlineStylePanel(group);
    if (!panel) return false;
    if (dependencies.objectModelA.expandedMapDisplayGroups.has(group)) dependencies.objectModelA.expandedMapDisplayGroups.delete(group);
    else {
      dependencies.objectModelA.expandedMapDisplayGroups.clear();
      const parent = desktopMenuTrigger(group)?.dataset.mapDisplayParent;
      if (parent) dependencies.objectModelA.expandedMapDisplayGroups.add(parent);
      dependencies.objectModelA.expandedMapDisplayGroups.add(group);
    }
    syncMapDisplayDisclosures();
    return true;
  }

  function mapDisplayAvailability() {
    const state = dependencies.projectState.state;
    const layerIds = new Set(state.distributionLayers.map(layer => layer.id));
    return {
      objects: state.territorialEntities.length > 0,
      distribution: state.distributionEntries.some(entry => layerIds.has(entry.layerId)),
      rivers: capabilities.builtinHydro || state.hydroEdits.some(feature => feature.properties.category === 'river'),
      lakes: capabilities.builtinHydro || state.hydroEdits.some(feature => feature.properties.category === 'lake'),
      labels: capabilities.builtinPlaces || state.labels.length > 0,
      genericFeatures: state.genericFeatures.length > 0,
      terrain: capabilities.terrain,
    };
  }

  function renderMapDisplaySettings() {
    for (const input of document.querySelectorAll('#mapDisplaySurface input[data-layer-visibility]')) {
      input.checked = dependencies.projectState.state.layerVisibility[input.dataset.layerVisibility] !== false;
    }
    for (const input of document.querySelectorAll('[data-territorial-symbol]')) {
      input.checked = dependencies.projectState.state.layerVisibility[input.dataset.territorialSymbol] !== false;
    }
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    // Core pending guards can blur a disabled menu input before this refresh.
    const focusedControl = document.activeElement === document.body
      && (surface?.classList.contains('surface-open') || surface?.classList.contains('mobile-open'))
      ? focusedMenuControl : document.activeElement;
    let closeGroup = false, restoreFocus = false;
    for (const [group, available] of Object.entries(mapDisplayAvailability())) {
      const container = group === 'distribution' ? (0, dependencies.platform.$)('distributionMenuGroup')
        : document.querySelector(`[data-map-display-group="${group}"]`);
      if (!available) {
        if (container && !container.classList.contains('hidden')) cancelDesktopMenuTimers();
        restoreFocus ||= !!container?.contains(focusedControl);
        closeGroup ||= desktopViewMenuPath.includes(group);
        dependencies.objectModelA.expandedMapDisplayGroups.delete(group);
      }
      container?.classList.toggle('hidden', !available);
    }
    if (closeGroup) closeDesktopViewMenuGroup();
    else syncMapDisplayDisclosures();
    if (restoreFocus) dependencies.workspaceUiB.focusSurfaceTrigger('display');
    syncDistributionPresentationControls();
    (0, dependencies.hydroModel.syncPhysicalControls)();
    syncDesktopMenuChecks();
  }

  function bindMapDisplayUI() {
    if(!viewPresentation)requireProjectOwner();
    const surface = (0, dependencies.platform.$)('mapDisplaySurface');
    if (!surface) return;
    surface.addEventListener('focusin', event => { focusedMenuControl = event.target; });
    document.addEventListener('focusin', event => { if (!surface.contains(event.target)) focusedMenuControl = null; });
    window.addEventListener('pandolab:project-changed', renderMapDisplaySettings);
    const state=dependencies.projectState.state;
    for(const input of surface.querySelectorAll('[data-map-background]')) {
      const key=input.dataset.mapBackground;
      input.checked=state.backgroundSettings[key];
      input.addEventListener('change',()=>runViewAction(async()=>{
        state.backgroundSettings[key]=input.checked;
        const current=dependencies.preferences.userPreferences;
        const mode=authoredStyles?'editor':'viewer';
        dependencies.preferences.setUserPreferences(dependencies.preferences.saveUserPreferences({...current,backgrounds:{...current.backgrounds,[mode]:{...current.backgrounds[mode],[key]:input.checked}}}));
        dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();
        dependencies.domains.renderingDomain.invalidateBaseScene('background-preference');
        dependencies.domains.renderingDomain.invalidateLabels('background-preference');
        dependencies.domains.objectSearchController.render();
      }));
    }
    const visibilityInputs = [
      ['objects', 'objectsVisible'],
      ['distributions', 'distributionsVisible'],
      ['rivers', 'riversVisible'], ['lakes', 'lakesVisible'], ['genericFeatures', 'genericFeaturesVisible'],
      ['labels', 'labelsVisible'],
    ];
    for (const [group, id] of visibilityInputs) {
      (0, dependencies.platform.$)(id)?.addEventListener('change', event => runViewAction(() => setLayerVisibility(group, event.currentTarget.checked)));
    }
    for (const input of surface.querySelectorAll('[data-place-language]')) {
      input.addEventListener('change', event => setPlaceLanguage(event.currentTarget.dataset.placeLanguage, event.currentTarget.checked));
    }
    for (const input of surface.querySelectorAll('[data-territorial-symbol]')) {
      input.addEventListener('change', event => runViewAction(() => setLayerVisibility(event.currentTarget.dataset.territorialSymbol, event.currentTarget.checked)));
    }
    surface.addEventListener('change', event => {
      const input = event.target.closest?.('[data-layer-style-color]');
      if (input) return runViewAction(() => updateLayerPresentationStyle(input.dataset.layerStyleColor, { colorVisible: input.checked }));
    });
    for (const id of ['terrainNoneRadio', 'terrainPoliticalRadio', 'terrainPhysicalRadio']) {
      (0, dependencies.platform.$)(id)?.addEventListener('change', event => {
        if (!event.currentTarget.checked) return;
        return runViewAction(() => setTerrainMode(event.currentTarget.value));
      });
    }
    surface.addEventListener('click', event => {
      const parent = event.target.closest('.view-menu-parent');
      if (parent && isDesktopViewMenu()) {
        event.preventDefault();
        event.stopPropagation();
        setDesktopViewMenuGroup(displayGroupForTrigger(parent), { toggle: true });
        return;
      }
      const row = event.target.closest('[data-map-display-row]');
      if (!row || isDesktopViewMenu()) return;
      toggleMapDisplayDisclosure(row.dataset.mapDisplayRow);
    });
    surface.addEventListener('pointerdown', event => {
      if (event.target.closest('input[type="range"], .sheet-drag-handle, .surface-header')) {
        displayMenuGesture = event.pointerId;
        cancelDesktopMenuTimers();
      }
    }, true);
    const finishMenuGesture = event => {
      if (displayMenuGesture !== event.pointerId) return;
      displayMenuGesture = null;
      requestAnimationFrame(() => {
        if (pendingDisplayMenuLayout) syncMapDisplayDisclosures();
      });
    };
    document.addEventListener('pointerup', finishMenuGesture);
    document.addEventListener('pointercancel', finishMenuGesture);
    surface.addEventListener('lostpointercapture', finishMenuGesture);
    surface.addEventListener('pointerover', event => {
      if (!desktopMenuOpen() || event.pointerType !== 'mouse' || displayMenuGesture !== null) return;
      const row = event.target.closest('.ui-menu-item');
      const previousRow = event.relatedTarget instanceof globalThis.Element ? event.relatedTarget.closest('.ui-menu-item') : null;
      if (row === previousRow && row) return;
      clearTimeout(desktopViewMenuCloseTimer);
      if (!row) {
        clearTimeout(desktopViewMenuOpenTimer);
        return;
      }
      const group = displayGroupForTrigger(row);
      if (group) {
        // Returning across the open parent must not collapse its child.
        if (desktopViewMenuPath.includes(group)) cancelDesktopMenuTimers();
        else scheduleDesktopViewMenuGroup(group);
        return;
      }
      cancelDesktopMenuTimers();
      const menu = row.closest('[role="menu"]');
      if (menu?.classList.contains('view-menu-root')) closeDesktopViewMenuGroup();
    });
    surface.addEventListener('pointerout', event => {
      if (!desktopMenuOpen() || event.pointerType !== 'mouse' || displayMenuGesture !== null) return;
      if (event.relatedTarget instanceof globalThis.Node && surface.contains(event.relatedTarget)) return;
      scheduleDesktopViewMenuClose();
    });
    surface.addEventListener('pointerenter', () => clearTimeout(desktopViewMenuCloseTimer));
    const menuActions = menu => [...(menu?.querySelectorAll('.ui-menu-item, input[type="range"], select') || [])]
      .filter(item => item.closest('[role="menu"]') === menu && !item.closest('[hidden], .hidden, [inert]') && item.getClientRects().length)
      .map(item => item.matches('button, input, select') ? item : item.querySelector('input, button'))
      .filter(item => item && !item.disabled);
    surface.addEventListener('keydown', event => {
      if (!desktopMenuOpen()) return;
      event.stopPropagation();
      cancelDesktopMenuTimers();
      const active = document.activeElement;
      const menu = active?.closest('[role="menu"]');
      if (event.key === 'Escape') {
        event.preventDefault();
        if (collapseDesktopViewMenuLevel({ focusParent: true })) return;
        (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: true });
        return;
      }
      if (event.key === 'Tab') {
        exitMenuOnTab(event, {
          menus: surface,
          trigger: (0, dependencies.platform.$)('mapDisplayBtn'),
          close: () => {
            cancelDesktopMenuTimers();
            closeDesktopViewMenuGroup();
            (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: false });
          },
        });
        return;
      }
      if (active?.matches('input[type="range"], select')) return;
      if (event.key === 'ArrowLeft') {
        if (!menu || menu.classList.contains('view-menu-root')) return;
        event.preventDefault();
        if (menu === (0, dependencies.platform.$)('distributionViewSettings')) {
          closeDesktopViewMenuGroup({ focusParent: true });
        } else {
          collapseDesktopViewMenuLevel({ focusParent: true });
        }
        return;
      }
      if (['ArrowRight', 'Enter', ' '].includes(event.key)) {
        const parent = active?.closest('.view-menu-parent');
        if (parent) {
          event.preventDefault();
          const group = displayGroupForTrigger(parent);
          setDesktopViewMenuGroup(group);
          const panel = displayPanelForDesktopGroup(group);
          requestAnimationFrame(() => {
            if (desktopMenuOpen() && !panel?.hidden) menuActions(panel)[0]?.focus({ preventScroll: true });
          });
        } else if (event.key === 'Enter' && active?.matches('input[type="checkbox"], input[type="radio"]')) {
          event.preventDefault();
          active.click();
        }
        return;
      }
      const items = menuActions(menu);
      if (!items.length) return;
      const index = items.indexOf(active);
      let nextIndex;
      if (event.key === 'ArrowDown') nextIndex = index + 1;
      else if (event.key === 'ArrowUp') nextIndex = index - 1;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      else return;
      event.preventDefault();
      items[(nextIndex + items.length) % items.length]?.focus({ preventScroll: true });
    });
    surface.addEventListener('keyup', event => {
      if (desktopMenuOpen()) event.stopPropagation();
    });
    const app = (0, dependencies.platform.$)('app');
    new MutationObserver(() => {
      cancelDesktopMenuTimers();
      syncMapDisplayDisclosures();
      if (!surface.classList.contains('surface-open') && !surface.classList.contains('mobile-open')) closeDesktopViewMenuGroup();
    }).observe(app, { attributes: true, attributeFilter: ['data-layout'] });
    new MutationObserver(() => {
      if (!surface.classList.contains('surface-open') && !surface.classList.contains('mobile-open')) closeDesktopViewMenuGroup();
      else desktopViewMenuPositioner.schedule();
    }).observe(surface, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => desktopViewMenuPositioner.schedule());
    window.visualViewport?.addEventListener?.('resize', () => desktopViewMenuPositioner.schedule());
    window.visualViewport?.addEventListener?.('scroll', () => desktopViewMenuPositioner.schedule());
    surface.addEventListener('scroll', () => {
      if (desktopMenuOpen()) desktopViewMenuPositioner.schedule();
    }, true);
    surface.addEventListener('change', event => runViewAction(async () => {
      syncDesktopMenuChecks();
      const boundary = event.target.closest('[data-layer-style-boundary]');
      if (boundary) await updateLayerPresentationStyle(boundary.dataset.layerStyleBoundary, { boundaryVisible: boundary.checked });
      const blend = event.target.closest('[data-layer-style-blend-mode]');
      if (blend) await updateLayerPresentationStyle(blend.dataset.layerStyleBlendMode, { blendMode: blend.value });
      if (event.target.matches('input[name="distributionLayerMode"]') && event.target.checked) {
        await setDistributionControl('distributionRenderMode', event.target.value, 'distribution-render-mode');
      }
      if (event.target.id === 'distributionActiveLayerInput') {
        await setDistributionControl('distributionActiveLayer', event.target.value, 'distribution-active-layer');
      }
      if (event.target.id === 'distributionBoundaryVisibleInput') {
        await setDistributionControl('distributionBoundaryVisible', event.target.checked, 'distribution-boundary-visibility');
      }
    }));
    surface.addEventListener('input', event => {
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) return runViewAction(() => updateLayerPresentationStyle(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 }));
    });
    renderMapDisplaySettings();
  }

  function syncDistributionPresentationControls() {
    const mode = dependencies.projectState.state.distributionSettings?.renderMode || dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.OVERLAP;
    for (const id of ['distributionLayerModeInput', 'distributionRenderModeInput']) {
      const input = (0, dependencies.platform.$)(id);
      if (input) input.value = mode;
    }
    const boundary = (0, dependencies.platform.$)('distributionBoundaryVisibleInput');
    for (const input of document.querySelectorAll('input[name="distributionLayerMode"]')) {
      input.checked = input.value === mode;
    }
    if (boundary) boundary.checked = dependencies.projectState.state.distributionSettings?.boundaryVisible !== false;
    syncDesktopMenuChecks();
    const hint = (0, dependencies.platform.$)('distributionLayerModeHint');
    if (!hint) return;
    hint.textContent = mode === dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.SINGLE
      ? '선택한 분포 하나를 값의 농도로 표시합니다.'
      : '표시 중인 분포를 목록 순서대로 겹쳐 그립니다.';
    const state = dependencies.projectState.state;
    const visibleLayers = state.layerVisibility.distributions === false ? [] :
      state.distributionLayers.filter(layer => state.itemVisibility.distributions?.[layer.id] !== false);
    const active = (0, dependencies.platform.$)('distributionActiveLayerInput');
    if (active) {
      active.replaceChildren(...visibleLayers.map(layer => {
        const option = document.createElement('option');
        option.value = layer.id;
        option.textContent = layer.name;
        return option;
      }));
      active.value = visibleLayers.some(layer => layer.id === state.distributionSettings.activeLayerId)
        ? state.distributionSettings.activeLayerId : visibleLayers[0]?.id || '';
      active.closest('label')?.classList.toggle('hidden', mode !== dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.SINGLE);
    }
    const legend = (0, dependencies.platform.$)('distributionLegend');
    if (legend) {
      const layers = mode === dependencies.applicationConstantsA.DISTRIBUTION_RENDER_MODES.SINGLE
        ? visibleLayers.filter(layer => layer.id === active?.value) : visibleLayers;
      legend.replaceChildren(...layers.map(layer => {
        const row = document.createElement('div');
        row.className = 'distribution-legend-row';
        const range = distributionValueRange(layer, state.distributionEntries.filter(entry => entry.layerId === layer.id));
        const title = document.createElement('strong');
        title.textContent = layer.name;
        const value = document.createElement('span');
        const count = state.distributionEntries.filter(entry => entry.layerId === layer.id).length;
        value.textContent = !count ? '데이터 없음'
          : range.min === range.max ? `${range.min}${layer.unit ? ` ${layer.unit}` : ''}`
            : `${range.min}–${range.max}${layer.unit ? ` ${layer.unit}` : ''}`;
        const bar = document.createElement('span');
        bar.className = 'distribution-legend-bar';
        bar.style.background = `linear-gradient(90deg, color-mix(in srgb, ${layer.color} 12%, transparent), color-mix(in srgb, ${layer.color} 70%, transparent))`;
        bar.style.opacity = String((0, dependencies.applicationServicesB.layerStyle)(state.layerPresentation, 'distributions').opacity);
        row.append(title, bar, value);
        return row;
      }));
    }
  }

  function initializeLAYER_STYLE_TARGETS() {
    (LAYER_STYLE_TARGETS = MAP_DISPLAY_TARGETS);

    (desktopViewMenuPositioner = createMenuPositionScheduler(positionDesktopViewMenus));
  }

  return Object.freeze({
    connect,
    get bindMapDisplayUI() { return bindMapDisplayUI; },
    get closeDesktopViewMenuGroup() { return closeDesktopViewMenuGroup; },
    initializeLAYER_STYLE_TARGETS,
    get renderMapDisplaySettings() { return renderMapDisplaySettings; },
    get setLayerVisibility() { return setLayerVisibility; },
    get setTerrainMode() { return setTerrainMode; },
    get setPlaceLanguage() { return setPlaceLanguage; },
    get syncMapDisplayDisclosures() { return syncMapDisplayDisclosures; },
    get syncDistributionPresentationControls() { return syncDistributionPresentationControls; },
    get toggleMapDisplayDisclosure() { return toggleMapDisplayDisclosure; },
    get updateLayerPresentationStyle() { return updateLayerPresentationStyle; },
  });
}
