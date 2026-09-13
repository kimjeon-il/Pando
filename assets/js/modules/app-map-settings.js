import { TERRITORIAL_SYMBOL_KEYS } from './layer-presentation.js';

const SYMBOL_VISIBILITY_KEYS = new Set(Object.values(TERRITORIAL_SYMBOL_KEYS).flatMap(keys => Object.values(keys)));

/** MapSettings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createMapSettings() {
  let dependencies;
  let LAYER_STYLE_TARGETS;
  let projectSerializer;
  let desktopViewMenuRoot = null;
  let desktopDistributionDetail = null;
  let desktopViewMenuOpenTimer = null;
  let desktopViewMenuCloseTimer = null;
  let displayMenuLayout = null;
  let displayMenuGesture = null;
  let pendingDisplayMenuLayout = false;
  const displayMenuPanels = new Map();
  const displayMenuPresentation = new Map();
  const DISTRIBUTION_STYLE_GROUPS = new Set(['languages', 'ethnicities', 'religions']);
  function connect(ports) {
    if (dependencies) throw new Error('map-settings already connected');
    dependencies = ports;
  }

  function syncProjectionButtons() {
    for (const [id, projection] of [['globeBtn', 'globe'], ['flatBtn', 'flat']]) {
      const button = (0, dependencies.$)(id);
      if (!button) continue;
      const active = dependencies.state.projection === projection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      if (button.classList.contains('ui-menu-item')) button.setAttribute('aria-checked', String(active));
    }
    (0, dependencies.syncStatusBar)();
  }

  function setProjection(type) {
    const targetProjection = type === 'globe' ? 'globe' : 'flat';
    if (targetProjection === dependencies.state.projection) return false;
    (0, dependencies.updateProjection)();
    const currentProjection = (0, dependencies.activeProjection)();
    const currentCenter = (0, dependencies.screenToGeo)(currentProjection.translate()) || (dependencies.state.projection === 'globe'
      ? [-dependencies.state.view.globeRotation[0], -dependencies.state.view.globeRotation[1]]
      : dependencies.state.view.flatCenter.slice());
    const currentScale = Number(currentProjection.scale()) || 1;
    const layout = (0, dependencies.projectionLayoutMetrics)();
    const nextView = (0, dependencies.deepClone)(dependencies.state.view);
    if (targetProjection === 'globe') {
      nextView.globeRotation = [
        -(0, dependencies.wrappedLongitudeDelta)(currentCenter[0]),
        -(0, dependencies.clamp)(Number(currentCenter[1]), -89, 89),
        0,
      ];
      nextView.globeZoom = (0, dependencies.clamp)(currentScale / layout.globeBaseScale, dependencies.ZOOM_LIMITS.globe.min, dependencies.ZOOM_LIMITS.globe.max);
    } else {
      nextView.flatCenter = [
        (0, dependencies.wrappedLongitudeDelta)(currentCenter[0]),
        (0, dependencies.clamp)(Number(currentCenter[1]), -dependencies.FLAT_LATITUDE_LIMIT, dependencies.FLAT_LATITUDE_LIMIT),
      ];
      nextView.flatZoom = (0, dependencies.clamp)(currentScale / layout.flatBaseScale, dependencies.ZOOM_LIMITS.flat.min, dependencies.ZOOM_LIMITS.flat.max);
    }
    const token = dependencies.atomicMapStateController.begin({ kind: 'projection', type: targetProjection });
    if (!dependencies.atomicMapStateController.commit(token, { projection: targetProjection, view: nextView })) return false;
    (0, dependencies.invalidateEditInteraction)();
    (0, dependencies.syncMapHostFromState)();
    syncProjectionButtons();
    dependencies.renderingDomain?.invalidateProjection?.('projection-change');
    dependencies.projectDomain.queueViewAutosave();
    return true;
  }

  function setLayerVisibility(key, visible) {
    dependencies.state.layerVisibility[key] = visible;
    if (!isDesktopViewMenu() && !SYMBOL_VISIBILITY_KEYS.has(key) && key !== 'labels') {
      if (visible) dependencies.expandedMapDisplayGroups.add(key);
      else dependencies.expandedMapDisplayGroups.delete(key);
    }
    syncMapDisplayDisclosures();
    (0, dependencies.markLayerTreeDirty)();
    dependencies.layerTreeController?.render();
    if (dependencies.DISTRIBUTION_GROUP_TYPES[key]) dependencies.distributionVisibilityRevision += 1;
    if (key === 'countries') dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-layer-visibility');
    if (key === 'rivers' || key === 'lakes') dependencies.gpuMapRenderer.invalidateHydroVisibility();
    if (key === 'labels' || SYMBOL_VISIBILITY_KEYS.has(key)) dependencies.renderingDomain?.invalidateLabels?.('label-visibility');
    else dependencies.renderingDomain?.invalidateBaseScene?.('layer-visibility');
    dependencies.projectDomain.queuePresentationAutosave();
  }

  function updateLayerPresentationStyle(group, patch) {
    const target = LAYER_STYLE_TARGETS[group];
    if (!target) return false;
    const currentStyle = (0, dependencies.layerStyle)(dependencies.state.layerPresentation, target.presentationGroup);
    const objectStyles = { ...dependencies.state.layerPresentation.objectStyles };
    if (group === 'subunits') {
      for (const key of Object.keys(objectStyles)) {
        if (key.startsWith('territorial:subunit:')) objectStyles[key] = { ...objectStyles[key], ...patch };
      }
    }
    dependencies.state.layerPresentation = (0, dependencies.normalizeLayerPresentation)({
      ...dependencies.state.layerPresentation,
      objectStyles,
      styles: {
        ...dependencies.state.layerPresentation.styles,
        [target.presentationGroup]: {
          ...currentStyle,
          ...patch,
          boundaryWidth: 1,
          labelsVisible: currentStyle.labelsVisible,
        },
      },
    });
    syncMapDisplayDisclosures();
    if (target.presentationGroup === 'countries') {
      dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-presentation');
    }
    if (target.presentationGroup === 'rivers' || target.presentationGroup === 'lakes') {
      dependencies.gpuMapRenderer.invalidatePhysicalStyle('hydro-presentation');
    }
    dependencies.renderingDomain?.invalidateOverlayStyle?.('layer-presentation-style');
    dependencies.projectDomain.queuePresentationAutosave();
    return true;
  }

  function createLayerInlineStylePanel(group) {
    const panel = document.querySelector(`[data-layer-style-panel="${group}"]`);
    const target = LAYER_STYLE_TARGETS[group];
    if (!panel || panel.dataset.initialized === 'true') return panel;
    panel.dataset.initialized = 'true';
    if (!target) return panel;
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
      choice.className = 'ui-choice-row';
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
    if (group === 'terrain') return (0, dependencies.$)('terrainDisplayOptions');
    return document.querySelector(`[data-layer-style-panel="${group}"]`);
  }

  function mapDisplayVisible(group) {
    return group === 'terrain'
      ? dependencies.state.physicalSettings.terrainVisible !== false
      : dependencies.state.layerVisibility[group] !== false;
  }

  function mapDisplayLabel(group) {
    return group === 'terrain'
      ? '지형 표시'
      : LAYER_STYLE_TARGETS[group]?.label ? `${LAYER_STYLE_TARGETS[group].label} 표시` : '표시';
  }

  function isDesktopViewMenu() {
    const layout = (0, dependencies.$)('app')?.dataset.layout;
    return layout === 'wide' || layout === 'compact';
  }

  function displayGroupForTrigger(trigger) {
    if (!trigger) return null;
    if (trigger.id === 'mapProjectionMenuTrigger') return 'projection';
    if (trigger.id === 'distributionMenuTrigger') return 'distribution';
    return trigger.dataset.mapDisplayRow || null;
  }

  function displayPanelForDesktopGroup(group) {
    if (group === 'projection') return (0, dependencies.$)('mapViewProjectionSlot');
    if (group === 'distribution') return (0, dependencies.$)('distributionViewSettings');
    return mapDisplayPanel(group);
  }

  function desktopMenuTrigger(group) {
    if (group === 'projection') return (0, dependencies.$)('mapProjectionMenuTrigger');
    if (group === 'distribution') return (0, dependencies.$)('distributionMenuTrigger');
    return document.querySelector(`[data-map-display-row="${group}"]`);
  }

  function desktopMenuOpen() {
    const surface = (0, dependencies.$)('mapDisplaySurface');
    return isDesktopViewMenu() && (surface?.classList.contains('surface-open') || surface?.classList.contains('mobile-open'));
  }

  function cancelDesktopMenuTimers() {
    clearTimeout(desktopViewMenuOpenTimer);
    clearTimeout(desktopViewMenuCloseTimer);
    desktopViewMenuOpenTimer = null;
    desktopViewMenuCloseTimer = null;
  }

  function createMenuSeparator() {
    const separator = document.createElement('span');
    separator.className = 'ui-menu-separator view-menu-separator';
    separator.setAttribute('role', 'separator');
    return separator;
  }

  function setMenuPresentation(element, desktop, classes) {
    if (!element) return;
    let original = displayMenuPresentation.get(element);
    if (!original) {
      original = {
        classes: ['ui-toggle', 'ui-radio-toggle', 'ui-segment-option', 'ui-segmented', 'projection-control',
          'projection-btn', 'terrain-mode-option', 'map-view-settings', 'layer-inline-style-panel',
          'terrain-display-options', 'distribution-view-settings', 'map-view-projection-slot']
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
    for (const row of surface.querySelectorAll('.view-menu-parent, .ui-choice-row, .ui-menu-item, .projection-btn')) {
      setMenuPresentation(row, desktop, ['ui-menu-item']);
      const input = row.querySelector(':scope > input[type="checkbox"], :scope > input[type="radio"]');
      const projection = row.id === 'globeBtn' || row.id === 'flatBtn';
      const action = input || row;
      setMenuPresentation(action, desktop, []);
      if (desktop) {
        action.setAttribute('role', input ? `menuitem${input.type}` : projection ? 'menuitemradio' : 'menuitem');
        if (input || projection) {
          row.dataset.menuChoice = input?.type || 'radio';
          action.setAttribute('aria-checked', String(input ? input.checked : row.getAttribute('aria-pressed') === 'true'));
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
    const surface = (0, dependencies.$)('mapDisplaySurface');
    if (!surface) return false;
    if (displayMenuLayout === desktop) return true;
    if (displayMenuGesture !== null || surface.classList.contains('is-sheet-dragging')) {
      pendingDisplayMenuLayout = true;
      return false;
    }
    cancelDesktopMenuTimers();
    const focusedControl = surface.contains(document.activeElement) ? document.activeElement : null;
    const root = surface.querySelector('.view-menu-root');
    let popups = surface.querySelector('.view-menu-popups');
    if (!popups) {
      popups = document.createElement('div');
      popups.className = 'view-menu-popups';
      surface.append(popups);
    }
    const groups = ['projection', ...Object.keys(LAYER_STYLE_TARGETS), 'terrain', 'distribution'];
    for (const group of groups) {
      const panel = displayPanelForDesktopGroup(group);
      if (!panel || displayMenuPanels.has(group)) continue;
      const anchor = document.createComment(`view-menu-${group}`);
      panel.before(anchor);
      const visibility = desktopMenuTrigger(group)?.parentElement.querySelector(':scope > label');
      const visibilityAnchor = visibility ? document.createComment(`view-menu-${group}-visibility`) : null;
      if (visibility) visibility.before(visibilityAnchor);
      const body = visibility ? document.createElement('div') : null;
      if (body) body.className = 'view-menu-panel-content ui-menu-group';
      displayMenuPanels.set(group, {
        panel, anchor, visibility, visibilityAnchor, body,
        contentNodes: [...panel.childNodes],
        separator: visibility ? createMenuSeparator() : null,
      });
    }
    for (const [group, entry] of displayMenuPanels) {
      const { panel, anchor, visibility, visibilityAnchor, body, contentNodes, separator } = entry;
      setMenuPresentation(panel, desktop, ['ui-menu-surface', 'ui-menu-list']);
      panel.dataset.menuLevel = DISTRIBUTION_STYLE_GROUPS.has(group) ? '2' : '1';
      if (desktop) {
        if (body) {
          body.append(...contentNodes);
          const symbols = [...body.querySelectorAll(':scope > [data-territorial-symbol-row]')];
          const boundary = body.querySelector('[data-layer-style-boundary]')?.closest('label');
          body.prepend(...symbols, ...(boundary ? [boundary] : []));
          const lastRow = boundary || symbols.at(-1);
          if (lastRow) lastRow.after(separator);
          else body.prepend(separator);
          panel.append(visibility, body);
        }
        popups.append(panel);
        panel.setAttribute('role', 'menu');
      } else {
        if (visibility) visibilityAnchor.after(visibility);
        if (body) {
          panel.append(...contentNodes);
          body.remove();
          separator.remove();
        }
        anchor.after(panel);
        panel.inert = false;
        delete panel.dataset.menuLevel;
        for (const property of ['left', 'top', 'width', 'max-height']) panel.style.removeProperty(`--view-menu-child-${property}`);
      }
    }
    const distributionSlot = (0, dependencies.$)('distributionTypeSlot');
    const distributionAnchor = (0, dependencies.$)('distributionMobileItemAnchor');
    const sections = [...document.querySelectorAll('[data-map-display-group]')].filter(section => DISTRIBUTION_STYLE_GROUPS.has(section.dataset.mapDisplayGroup));
    if (desktop) distributionSlot?.append(...sections);
    else distributionAnchor?.after(...sections);
    setMenuPresentation(root, desktop, ['ui-menu-list']);
    if (desktop) root.setAttribute('role', 'menu');
    surface.classList.toggle('view-menu-desktop', desktop);
    surface.classList.toggle('ui-menu-surface', desktop);
    for (const element of surface.querySelectorAll('.projection-control, .terrain-mode-options, .distribution-type-slot, [role="radiogroup"], [data-menu-group]')) {
      element.dataset.menuGroup = '';
      setMenuPresentation(element, desktop, ['ui-menu-group']);
      if (desktop) element.setAttribute('role', 'group');
    }
    for (const field of surface.querySelectorAll('.layer-inline-style-field')) field.classList.toggle('ui-menu-control', desktop);
    for (const leading of surface.querySelectorAll('.view-menu-leading')) leading.classList.toggle('ui-menu-leading', desktop);
    for (const chevron of surface.querySelectorAll('.view-menu-chevron')) chevron.classList.toggle('ui-menu-chevron', desktop);
    syncMenuChoices(surface, desktop);
    if (!desktop) {
      desktopViewMenuRoot = null;
      desktopDistributionDetail = null;
    }
    displayMenuLayout = desktop;
    pendingDisplayMenuLayout = false;
    if (focusedControl?.getClientRects().length) focusedControl.focus({ preventScroll: true });
    return true;
  }

  function syncDesktopMenuChecks() {
    const surface = (0, dependencies.$)('mapDisplaySurface');
    if (!surface?.classList.contains('view-menu-desktop')) return;
    for (const input of surface.querySelectorAll('.ui-menu-item > input')) {
      input.setAttribute('aria-checked', String(input.checked));
    }
  }

  function positionDesktopViewMenus() {
    if (!desktopMenuOpen()) return;
    positionDesktopViewMenuSurface();
    if (desktopViewMenuRoot) positionDesktopViewMenuGroup(desktopViewMenuRoot);
    if (desktopDistributionDetail) positionDesktopViewMenuGroup(desktopDistributionDetail);
  }

  function positionDesktopViewMenuSurface() {
    if (!isDesktopViewMenu()) return;
    const surface = (0, dependencies.$)('mapDisplaySurface');
    const trigger = (0, dependencies.$)('mapDisplayBtn');
    if (!surface || !trigger) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const edge = 8;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(240, Math.max(180, viewportWidth - edge * 2));
    const left = Math.max(viewportLeft + edge, Math.min(rect.left, viewportLeft + viewportWidth - edge - width));
    const top = Math.min(rect.bottom + 6, viewportTop + viewportHeight - edge - 120);
    surface.style.setProperty('--view-menu-root-left', `${Math.round(left)}px`);
    surface.style.setProperty('--view-menu-root-top', `${Math.round(top)}px`);
    surface.style.setProperty('--view-menu-root-max-height', `${Math.round(Math.max(120, viewportTop + viewportHeight - edge - top))}px`);
  }

  function positionDesktopViewMenuGroup(group) {
    if (!desktopMenuOpen()) return;
    const panel = displayPanelForDesktopGroup(group);
    const trigger = desktopMenuTrigger(group);
    if (!panel || !trigger || panel.hidden) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const edge = 8;
    const gap = 6;
    const rect = trigger.getBoundingClientRect();
    const menuRect = trigger.closest('[role="menu"]')?.getBoundingClientRect() || rect;
    const width = Math.min(260, viewportWidth - edge * 2);
    const availableHeight = Math.max(0, viewportHeight - edge * 2);
    panel.style.setProperty('--view-menu-child-width', `${width}px`);
    panel.style.setProperty('--view-menu-child-max-height', `${availableHeight}px`);
    const height = Math.min(panel.scrollHeight + panel.offsetHeight - panel.clientHeight, availableHeight);
    const right = viewportLeft + viewportWidth - edge;
    const opensLeft = menuRect.right + gap + width > right && menuRect.left - gap - width >= viewportLeft + edge;
    const left = Math.max(viewportLeft + edge, Math.min(opensLeft ? menuRect.left - gap - width : menuRect.right + gap, right - width));
    const top = Math.max(viewportTop + edge, Math.min(rect.top, viewportTop + viewportHeight - edge - height));
    panel.style.setProperty('--view-menu-child-left', `${Math.round(left)}px`);
    panel.style.setProperty('--view-menu-child-top', `${Math.round(top)}px`);
  }

  function setDesktopViewMenuGroup(group, { toggle = false } = {}) {
    if (!desktopMenuOpen() || !group) return false;
    cancelDesktopMenuTimers();
    if (DISTRIBUTION_STYLE_GROUPS.has(group)) {
      const unchanged = desktopViewMenuRoot === 'distribution' && desktopDistributionDetail === group;
      desktopViewMenuRoot = 'distribution';
      desktopDistributionDetail = toggle && unchanged ? null : group;
    } else {
      const unchanged = desktopViewMenuRoot === group;
      desktopViewMenuRoot = toggle && unchanged ? null : group;
      desktopDistributionDetail = null;
    }
    syncMapDisplayDisclosures();
    requestAnimationFrame(positionDesktopViewMenus);
    return true;
  }

  function closeDesktopViewMenuGroup({ focusParent = false } = {}) {
    cancelDesktopMenuTimers();
    if (!desktopViewMenuRoot && !desktopDistributionDetail) return false;
    const parent = desktopMenuTrigger(desktopViewMenuRoot);
    desktopViewMenuRoot = null;
    desktopDistributionDetail = null;
    syncMapDisplayDisclosures();
    if (focusParent) parent?.focus({ preventScroll: true });
    return true;
  }

  function collapseDesktopViewMenuLevel({ focusParent = false } = {}) {
    if (!isDesktopViewMenu()) return false;
    cancelDesktopMenuTimers();
    if (desktopDistributionDetail) {
      const parent = desktopMenuTrigger(desktopDistributionDetail);
      cancelDesktopMenuTimers();
      desktopDistributionDetail = null;
      syncMapDisplayDisclosures();
      if (focusParent) parent?.focus({ preventScroll: true });
      return true;
    }
    if (desktopViewMenuRoot) {
      const trigger = desktopViewMenuRoot === 'projection'
        ? (0, dependencies.$)('mapProjectionMenuTrigger')
        : desktopViewMenuRoot === 'distribution'
          ? (0, dependencies.$)('distributionMenuTrigger')
          : document.querySelector(`[data-map-display-row="${desktopViewMenuRoot}"]`);
      desktopViewMenuRoot = null;
      syncMapDisplayDisclosures();
      if (focusParent) trigger?.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  function scheduleDesktopViewMenuGroup(group) {
    cancelDesktopMenuTimers();
    if (desktopDistributionDetail === group || (desktopViewMenuRoot === group && !desktopDistributionDetail)) return;
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
    const surface = (0, dependencies.$)('mapDisplaySurface');
    dependencies.state.layerPresentation = (0, dependencies.normalizeLayerPresentation)(dependencies.state.layerPresentation);
    document.querySelectorAll('[data-layer-style-panel]').forEach(panel => {
      const group = panel.dataset.layerStylePanel;
      createLayerInlineStylePanel(group);
      const target = LAYER_STYLE_TARGETS[group];
      if (!target) return;
      const style = (0, dependencies.layerStyle)(dependencies.state.layerPresentation, target.presentationGroup);
      const input = panel.querySelector('[data-layer-style-opacity]');
      if (input) { input.value = String(Math.round(style.opacity * 100)); (0, dependencies.syncRangeProgress)(input); }
      const output = panel.querySelector('[data-layer-style-opacity-value]');
      if (output) output.textContent = `${Math.round(style.opacity * 100)}%`;
      const boundary = panel.querySelector('[data-layer-style-boundary]');
      if (boundary) boundary.checked = style.boundaryVisible;
      const blendMode = panel.querySelector('[data-layer-style-blend-mode]');
      if (blendMode) blendMode.value = style.blendMode;
    });

    const layoutReady = syncDesktopMenuLayout(requestedDesktop);
    const menuDesktop = layoutReady ? requestedDesktop : desktop;
    document.querySelectorAll('[data-map-display-row]').forEach(trigger => {
      const group = trigger.dataset.mapDisplayRow;
      const row = trigger.closest('.map-display-row');
      const visible = mapDisplayVisible(group);
      if (!menuDesktop && !visible) dependencies.expandedMapDisplayGroups.delete(group);
      const expanded = menuDesktop
        ? desktopViewMenuRoot === group || desktopDistributionDetail === group
        : visible && dependencies.expandedMapDisplayGroups.has(group);
      const panel = mapDisplayPanel(group);
      if (panel) {
        panel.hidden = !expanded;
        panel.inert = false;
        const body = displayMenuPanels.get(group)?.body;
        if (body) body.inert = menuDesktop && !visible;
      }
      row?.classList.toggle('is-disabled', !menuDesktop && !visible);
      trigger.disabled = !menuDesktop && !visible;
      trigger.setAttribute('aria-expanded', String(expanded));
      const label = `${mapDisplayLabel(group)} 설정 ${expanded ? '접기' : '펼치기'}`;
      trigger.setAttribute('aria-label', label);
      const visibilityLabel = (0, dependencies.$)(group === 'terrain' ? 'terrainVisible' : `${group}Visible`)?.nextElementSibling;
      if (visibilityLabel?.matches('span')) {
        visibilityLabel.textContent = menuDesktop
          ? '표시'
          : group === 'terrain'
            ? '지형'
            : LAYER_STYLE_TARGETS[group]?.label || '표시';
      }
    });
    const projectionSlot = (0, dependencies.$)('mapViewProjectionSlot');
    const projectionExpanded = menuDesktop && desktopViewMenuRoot === 'projection';
    if (projectionSlot) projectionSlot.hidden = menuDesktop && !projectionExpanded;
    (0, dependencies.$)('mapProjectionMenuTrigger')?.setAttribute('aria-expanded', String(projectionExpanded));
    const distributionSettings = (0, dependencies.$)('distributionViewSettings');
    const distributionExpanded = menuDesktop && desktopViewMenuRoot === 'distribution';
    if (distributionSettings) distributionSettings.hidden = menuDesktop && !distributionExpanded;
    (0, dependencies.$)('distributionMenuTrigger')?.setAttribute('aria-expanded', String(distributionExpanded));
    surface?.classList.toggle('view-menu-desktop', menuDesktop);
    syncDesktopMenuChecks();
    if (menuDesktop) requestAnimationFrame(positionDesktopViewMenus);
  }

  function toggleMapDisplayDisclosure(group) {
    if (isDesktopViewMenu()) return setDesktopViewMenuGroup(group, { toggle: true });
    if (!mapDisplayVisible(group)) return false;
    const panel = group === 'terrain' ? mapDisplayPanel(group) : createLayerInlineStylePanel(group);
    if (!panel) return false;
    if (dependencies.expandedMapDisplayGroups.has(group)) dependencies.expandedMapDisplayGroups.delete(group);
    else {
      dependencies.expandedMapDisplayGroups.clear();
      dependencies.expandedMapDisplayGroups.add(group);
    }
    syncMapDisplayDisclosures();
    return true;
  }

  function renderMapDisplaySettings() {
    dependencies.state.layerPresentation = (0, dependencies.normalizeLayerPresentation)(dependencies.state.layerPresentation);
    for (const input of document.querySelectorAll('#mapDisplaySurface input[data-layer-visibility]')) {
      input.checked = dependencies.state.layerVisibility[input.dataset.layerVisibility] !== false;
    }
    for (const input of document.querySelectorAll('[data-territorial-symbol]')) {
      input.checked = dependencies.state.layerVisibility[input.dataset.territorialSymbol] !== false;
    }
    const units = dependencies.state.territorialUnits || [];
    const distributionGroups = new Set((dependencies.state.distributionLayers || [])
      .map(layer => Object.entries(dependencies.DISTRIBUTION_GROUP_TYPES).find(([, type]) => type === layer.type)?.[0])
      .filter(Boolean));
    const available = {
      subunitsVisible: units.some(unit => unit.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT),
      genericFeaturesVisible: dependencies.state.genericFeatures.length > 0,
      languagesVisible: distributionGroups.has('languages'),
      ethnicitiesVisible: distributionGroups.has('ethnicities'),
      religionsVisible: distributionGroups.has('religions'),
    };
    for (const [id, visible] of Object.entries(available)) {
      document.querySelector(`[data-map-display-group="${id.replace(/Visible$/, '')}"]`)?.classList.toggle('hidden', !visible);
      if (!visible && desktopDistributionDetail === id.replace(/Visible$/, '')) desktopDistributionDetail = null;
      if (!visible && desktopViewMenuRoot === id.replace(/Visible$/, '')) desktopViewMenuRoot = null;
      if (!visible) dependencies.expandedMapDisplayGroups.delete(id.replace(/Visible$/, ''));
    }
    const hasDistribution = distributionGroups.size > 0;
    (0, dependencies.$)('distributionMenuGroup')?.classList.toggle('hidden', !hasDistribution);
    if (!hasDistribution && desktopViewMenuRoot === 'distribution') {
      desktopViewMenuRoot = null;
      desktopDistributionDetail = null;
    }
    syncMapDisplayDisclosures();
    syncDistributionPresentationControls();
    (0, dependencies.syncPhysicalControls)();
    syncDesktopMenuChecks();
  }

  function bindMapDisplayUI() {
    const surface = (0, dependencies.$)('mapDisplaySurface');
    if (!surface) return;
    let tabNavigation = false;
    const visibilityInputs = [
      ['countries', 'countriesVisible'], ['subunits', 'subunitsVisible'], ['regions', 'regionsVisible'],
      ['languages', 'languagesVisible'], ['ethnicities', 'ethnicitiesVisible'], ['religions', 'religionsVisible'],
      ['rivers', 'riversVisible'], ['lakes', 'lakesVisible'], ['genericFeatures', 'genericFeaturesVisible'],
      ['labels', 'labelsVisible'],
    ];
    for (const [group, id] of visibilityInputs) {
      (0, dependencies.$)(id)?.addEventListener('change', event => setLayerVisibility(group, event.currentTarget.checked));
    }
    for (const input of surface.querySelectorAll('[data-territorial-symbol]')) {
      input.addEventListener('change', event => setLayerVisibility(event.currentTarget.dataset.territorialSymbol, event.currentTarget.checked));
    }
    (0, dependencies.$)('terrainVisible')?.addEventListener('change', event => {
      dependencies.state.physicalSettings.terrainVisible = !!event.currentTarget.checked;
      if (!isDesktopViewMenu()) {
        if (event.currentTarget.checked) dependencies.expandedMapDisplayGroups.add('terrain');
        else dependencies.expandedMapDisplayGroups.delete('terrain');
      }
      dependencies.gpuMapRenderer.invalidatePhysicalStyle('terrain-visibility');
      (0, dependencies.syncPhysicalControls)();
      syncMapDisplayDisclosures();
      (0, dependencies.markLayerTreeDirty)();
      dependencies.renderingDomain?.invalidateBaseScene?.('terrain-visibility');
      dependencies.projectDomain.queuePresentationAutosave();
    });
    for (const id of ['terrainPoliticalRadio', 'terrainPhysicalRadio']) {
      (0, dependencies.$)(id)?.addEventListener('change', event => {
        if (!event.currentTarget.checked) return;
        dependencies.state.physicalSettings.terrainStyle = event.currentTarget.value === 'physical' ? 'physical' : 'political';
        dependencies.gpuMapRenderer.invalidatePhysicalStyle('terrain-style');
        (0, dependencies.syncPhysicalControls)();
        (0, dependencies.markLayerTreeDirty)();
        dependencies.renderingDomain?.invalidateBaseScene?.('terrain-style');
        dependencies.projectDomain.queuePresentationAutosave();
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
      const previousRow = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.ui-menu-item') : null;
      if (row === previousRow && row) return;
      clearTimeout(desktopViewMenuCloseTimer);
      if (!row) {
        clearTimeout(desktopViewMenuOpenTimer);
        return;
      }
      const group = displayGroupForTrigger(row);
      if (group) {
        // Returning across the open parent must not collapse its child.
        if (group === 'distribution' && desktopViewMenuRoot === group) cancelDesktopMenuTimers();
        else scheduleDesktopViewMenuGroup(group);
        return;
      }
      cancelDesktopMenuTimers();
      const menu = row.closest('[role="menu"]');
      if (menu?.classList.contains('view-menu-root')) closeDesktopViewMenuGroup();
      else if (menu === (0, dependencies.$)('distributionViewSettings') && desktopDistributionDetail) {
        desktopDistributionDetail = null;
        syncMapDisplayDisclosures();
      }
    });
    surface.addEventListener('pointerout', event => {
      if (!desktopMenuOpen() || event.pointerType !== 'mouse' || displayMenuGesture !== null) return;
      if (event.relatedTarget instanceof Node && surface.contains(event.relatedTarget)) return;
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
        (0, dependencies.closeSurface)('display', { restoreFocus: true });
        return;
      }
      tabNavigation = event.key === 'Tab';
      if (tabNavigation) return;
      if (active?.matches('input[type="range"], select')) return;
      if (event.key === 'ArrowLeft') {
        if (!menu || menu.classList.contains('view-menu-root')) return;
        event.preventDefault();
        if (menu === (0, dependencies.$)('distributionViewSettings')) {
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
    surface.addEventListener('focusout', () => {
      queueMicrotask(() => {
        if (tabNavigation && desktopMenuOpen() && !surface.contains(document.activeElement)) {
          closeDesktopViewMenuGroup();
          (0, dependencies.closeSurface)('display', { restoreFocus: false });
        }
        tabNavigation = false;
      });
    });
    const app = (0, dependencies.$)('app');
    new MutationObserver(() => {
      cancelDesktopMenuTimers();
      syncMapDisplayDisclosures();
      if (!surface.classList.contains('surface-open') && !surface.classList.contains('mobile-open')) closeDesktopViewMenuGroup();
    }).observe(app, { attributes: true, attributeFilter: ['data-layout'] });
    new MutationObserver(() => {
      if (!surface.classList.contains('surface-open') && !surface.classList.contains('mobile-open')) closeDesktopViewMenuGroup();
      else requestAnimationFrame(positionDesktopViewMenus);
    }).observe(surface, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => requestAnimationFrame(positionDesktopViewMenus));
    surface.addEventListener('scroll', () => {
      if (desktopMenuOpen()) requestAnimationFrame(positionDesktopViewMenus);
    }, true);
    surface.addEventListener('change', event => {
      syncDesktopMenuChecks();
      const boundary = event.target.closest('[data-layer-style-boundary]');
      if (boundary) updateLayerPresentationStyle(boundary.dataset.layerStyleBoundary, { boundaryVisible: boundary.checked });
      const blend = event.target.closest('[data-layer-style-blend-mode]');
      if (blend) updateLayerPresentationStyle(blend.dataset.layerStyleBlendMode, { blendMode: blend.value });
      if (event.target.matches('input[name="distributionLayerMode"]') && event.target.checked) {
        dependencies.distributionService.setRenderMode(event.target.value);
        syncDistributionPresentationControls();
        dependencies.renderingDomain?.renderDistributions?.();
        dependencies.projectDomain.queuePresentationAutosave();
      }
      if (event.target.id === 'distributionBoundaryVisibleInput') {
        dependencies.distributionService.setBoundaryVisible(event.target.checked);
        syncDistributionPresentationControls();
        dependencies.renderingDomain?.renderDistributions?.();
        dependencies.projectDomain.queuePresentationAutosave();
      }
    });
    surface.addEventListener('input', event => {
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) updateLayerPresentationStyle(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 });
    });
    renderMapDisplaySettings();
  }

  function syncDistributionPresentationControls() {
    const mode = dependencies.state.distributionSettings?.renderMode || dependencies.DISTRIBUTION_RENDER_MODES.DOMINANT;
    for (const id of ['distributionLayerModeInput', 'distributionRenderModeInput']) {
      const input = (0, dependencies.$)(id);
      if (input) input.value = mode;
    }
    const boundary = (0, dependencies.$)('distributionBoundaryVisibleInput');
    for (const input of document.querySelectorAll('input[name="distributionLayerMode"]')) {
      input.checked = input.value === mode;
    }
    if (boundary) boundary.checked = dependencies.state.distributionSettings?.boundaryVisible !== false;
    syncDesktopMenuChecks();
    const hint = (0, dependencies.$)('distributionLayerModeHint');
    if (!hint) return;
    hint.textContent = mode === dependencies.DISTRIBUTION_RENDER_MODES.INTENSITY
      ? '선택한 분포가 많을수록 색이 진해집니다.'
      : '각 지역에서 가장 많은 분포 하나만 표시합니다.';
  }

  function initializeLAYER_STYLE_TARGETS() {
    (LAYER_STYLE_TARGETS = Object.freeze({
      countries: { presentationGroup: 'countries', label: '국가', opacity: true, boundary: true, boundaryLabel: '국경' },
      subunits: { presentationGroup: 'subunits', label: '하위단위', opacity: true, boundary: true, boundaryLabel: '경계' },
      regions: { presentationGroup: 'regions', label: '지방', opacity: true, boundary: true, boundaryLabel: '경계' },
      languages: { presentationGroup: 'languages', label: '언어', opacity: true, blendMode: true },
      ethnicities: { presentationGroup: 'ethnicities', label: '민족', opacity: true, blendMode: true },
      religions: { presentationGroup: 'religions', label: '종교', opacity: true, blendMode: true },
      rivers: { presentationGroup: 'rivers', label: '강', opacity: true },
      lakes: { presentationGroup: 'lakes', label: '호수', opacity: true },
      genericFeatures: { presentationGroup: 'genericFeatures', label: '기타 객체', opacity: true, opacityLabel: '전체 투명도' },
    }));

    (projectSerializer = (0, dependencies.createProjectSerializer)({
      schemaVersion: dependencies.PROJECT_SCHEMA_VERSION,
      appVersion: dependencies.APP_VERSION,
      baseDataset: dependencies.BASE_DATASET,
      genericFeatureSchemaVersion: dependencies.GENERIC_FEATURE_SCHEMA_VERSION,
      distributionSchemaVersion: dependencies.DISTRIBUTION_SCHEMA_VERSION,
      distributionTypes: Object.values(dependencies.DISTRIBUTION_TYPES),
      distributionModes: Object.values(dependencies.DISTRIBUTION_MODES),
      terrainDataset: dependencies.TERRAIN_DATASET,
      hydroDataset: dependencies.HYDRO_DATASET,
      readSnapshot: () => ({
        countriesData: dependencies.state.countriesData,
        projectFields: (0, dependencies.pickProjectFields)(dependencies.state, { clone: value => value }),
        countryDelta: (0, dependencies.buildCountryDelta)(),
        fullAutosave: !!dependencies.state.sessionBaseCountriesJson,
        terrainManifest: dependencies.state.terrainManifest,
        hydroManifest: dependencies.state.hydroManifest,
      }),
    }));
  }

  return Object.freeze({
    connect,
    get bindMapDisplayUI() { return bindMapDisplayUI; },
    get closeDesktopViewMenuGroup() { return closeDesktopViewMenuGroup; },
    initializeLAYER_STYLE_TARGETS,
    get projectSerializer() { return projectSerializer; },
    get renderMapDisplaySettings() { return renderMapDisplaySettings; },
    get setLayerVisibility() { return setLayerVisibility; },
    get setProjection() { return setProjection; },
    get syncMapDisplayDisclosures() { return syncMapDisplayDisclosures; },
    get syncDistributionPresentationControls() { return syncDistributionPresentationControls; },
    get syncProjectionButtons() { return syncProjectionButtons; },
    get toggleMapDisplayDisclosure() { return toggleMapDisplayDisclosure; },
    get updateLayerPresentationStyle() { return updateLayerPresentationStyle; },
  });
}
