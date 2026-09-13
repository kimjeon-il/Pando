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
  let distributionTypePlacement = null;
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
    if (!isDesktopViewMenu()) {
      if (visible) dependencies.expandedMapDisplayGroups.add(key);
      else dependencies.expandedMapDisplayGroups.delete(key);
    }
    syncMapDisplayDisclosures();
    (0, dependencies.markLayerTreeDirty)();
    dependencies.layerTreeController?.render();
    if (dependencies.DISTRIBUTION_GROUP_TYPES[key]) dependencies.distributionVisibilityRevision += 1;
    if (key === 'countries') dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-layer-visibility');
    if (key === 'rivers' || key === 'lakes') dependencies.gpuMapRenderer.invalidateHydroVisibility();
    if (['labels', 'basemapLabels', 'countryFlags'].includes(key)) dependencies.renderingDomain?.invalidateLabels?.('label-visibility');
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

  function displayScopeForDesktopGroup(group) {
    if (group === 'projection') return (0, dependencies.$)('mapProjectionMenuTrigger')?.closest('.map-projection-settings');
    if (group === 'distribution') return (0, dependencies.$)('distributionMenuGroup');
    return document.querySelector(`[data-map-display-group="${group}"]`);
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
    if (!isDesktopViewMenu()) return;
    const panel = displayPanelForDesktopGroup(group);
    const scope = displayScopeForDesktopGroup(group);
    const trigger = group === 'projection'
      ? (0, dependencies.$)('mapProjectionMenuTrigger')
      : group === 'distribution'
        ? (0, dependencies.$)('distributionMenuTrigger')
        : document.querySelector(`[data-map-display-row="${group}"]`);
    if (!panel || !scope || !trigger || panel.hidden) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const edge = 8;
    const gap = 6;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(220, panel.getBoundingClientRect().width || 260);
    const height = Math.min(panel.scrollHeight || 0, Math.max(180, viewportHeight - edge * 2));
    const viewportRight = viewportLeft + viewportWidth;
    const opensLeft = rect.right + gap + width > viewportRight - edge && rect.left - gap - width >= viewportLeft + edge;
    const left = opensLeft ? rect.left - gap - width : rect.right + gap;
    const top = Math.max(viewportTop + edge, Math.min(rect.top, viewportTop + viewportHeight - edge - height));
    scope.style.setProperty('--view-menu-child-left', `${Math.round(left)}px`);
    scope.style.setProperty('--view-menu-child-top', `${Math.round(top)}px`);
    scope.style.setProperty('--view-menu-child-width', `${Math.round(width)}px`);
    scope.style.setProperty('--view-menu-child-max-height', `${Math.round(Math.max(180, viewportTop + viewportHeight - edge - top))}px`);
    scope.classList.toggle('view-menu-opens-left', opensLeft);
  }

  function syncDistributionTypePlacement() {
    const slot = (0, dependencies.$)('distributionTypeSlot');
    const anchor = (0, dependencies.$)('distributionMobileItemAnchor');
    if (!slot || !anchor) return;
    const placement = isDesktopViewMenu() ? 'desktop' : 'mobile';
    if (distributionTypePlacement === placement) return;
    const focusedRange = document.activeElement?.matches?.('[data-layer-style-opacity]');
    if (focusedRange) {
      document.addEventListener('pointerup', () => syncDistributionTypePlacement(), { once: true });
      return;
    }
    const sections = [...document.querySelectorAll('[data-map-display-group="languages"], [data-map-display-group="ethnicities"], [data-map-display-group="religions"]')];
    if (placement === 'desktop') slot.append(...sections);
    else anchor.after(...sections);
    distributionTypePlacement = placement;
  }

  function setDesktopViewMenuGroup(group, { toggle = false } = {}) {
    if (!isDesktopViewMenu()) return false;
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
    requestAnimationFrame(() => {
      if (desktopViewMenuRoot) positionDesktopViewMenuGroup(desktopViewMenuRoot);
      if (desktopDistributionDetail) positionDesktopViewMenuGroup(desktopDistributionDetail);
    });
    return true;
  }

  function closeDesktopViewMenuGroup({ focusParent = false } = {}) {
    if (!desktopViewMenuRoot && !desktopDistributionDetail) return false;
    const parent = desktopDistributionDetail ? (0, dependencies.$)('distributionMenuTrigger') : null;
    desktopViewMenuRoot = null;
    desktopDistributionDetail = null;
    syncMapDisplayDisclosures();
    if (focusParent) parent?.focus({ preventScroll: true });
    return true;
  }

  function collapseDesktopViewMenuLevel({ focusParent = false } = {}) {
    if (!isDesktopViewMenu()) return false;
    if (desktopDistributionDetail) {
      const parent = (0, dependencies.$)('distributionMenuTrigger');
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

  function scheduleDesktopViewMenuGroup(group, delay = 150) {
    clearTimeout(desktopViewMenuOpenTimer);
    clearTimeout(desktopViewMenuCloseTimer);
    desktopViewMenuOpenTimer = setTimeout(() => setDesktopViewMenuGroup(group), delay);
  }

  function scheduleDesktopViewMenuClose() {
    clearTimeout(desktopViewMenuOpenTimer);
    clearTimeout(desktopViewMenuCloseTimer);
    desktopViewMenuCloseTimer = setTimeout(() => closeDesktopViewMenuGroup(), 200);
  }

  function syncMapDisplayDisclosures() {
    syncDistributionTypePlacement();
    const desktop = isDesktopViewMenu();
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

    document.querySelectorAll('[data-map-display-row]').forEach(trigger => {
      const group = trigger.dataset.mapDisplayRow;
      const row = trigger.closest('.map-display-row');
      const visible = mapDisplayVisible(group);
      if (!desktop && !visible) dependencies.expandedMapDisplayGroups.delete(group);
      const expanded = desktop
        ? desktopViewMenuRoot === group || desktopDistributionDetail === group
        : visible && dependencies.expandedMapDisplayGroups.has(group);
      const panel = mapDisplayPanel(group);
      if (panel) {
        panel.hidden = !expanded;
        panel.inert = desktop && expanded && !visible;
      }
      row?.classList.toggle('is-disabled', !desktop && !visible);
      trigger.disabled = !desktop && !visible;
      trigger.setAttribute('aria-expanded', String(expanded));
      const label = `${mapDisplayLabel(group)} 설정 ${expanded ? '접기' : '펼치기'}`;
      trigger.setAttribute('aria-label', label);
      const visibilityLabel = (0, dependencies.$)(group === 'terrain' ? 'terrainVisible' : `${group}Visible`)?.nextElementSibling;
      if (visibilityLabel?.matches('span')) {
        visibilityLabel.textContent = desktop
          ? '표시'
          : group === 'terrain'
            ? '지형'
            : LAYER_STYLE_TARGETS[group]?.label || '표시';
      }
    });
    const projectionSlot = (0, dependencies.$)('mapViewProjectionSlot');
    const projectionExpanded = desktop && desktopViewMenuRoot === 'projection';
    if (projectionSlot) projectionSlot.hidden = desktop && !projectionExpanded;
    (0, dependencies.$)('mapProjectionMenuTrigger')?.setAttribute('aria-expanded', String(projectionExpanded));
    const distributionSettings = (0, dependencies.$)('distributionViewSettings');
    const distributionExpanded = desktop && desktopViewMenuRoot === 'distribution';
    if (distributionSettings) distributionSettings.hidden = desktop && !distributionExpanded;
    (0, dependencies.$)('distributionMenuTrigger')?.setAttribute('aria-expanded', String(distributionExpanded));
    surface?.classList.toggle('view-menu-desktop', desktop);
    if (desktop) requestAnimationFrame(positionDesktopViewMenuSurface);
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
    const units = dependencies.state.territorialUnits || [];
    const distributionGroups = new Set((dependencies.state.distributionLayers || [])
      .map(layer => Object.entries(dependencies.DISTRIBUTION_GROUP_TYPES).find(([, type]) => type === layer.type)?.[0])
      .filter(Boolean));
    const available = {
      subunitsVisible: units.some(unit => unit.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT),
      regionsVisible: units.some(unit => unit.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION),
      genericFeaturesVisible: dependencies.state.genericFeatures.length > 0,
      languagesVisible: distributionGroups.has('languages'),
      ethnicitiesVisible: distributionGroups.has('ethnicities'),
      religionsVisible: distributionGroups.has('religions'),
    };
    for (const [id, visible] of Object.entries(available)) {
      (0, dependencies.$)(id)?.closest('.layer-type-settings')?.classList.toggle('hidden', !visible);
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
  }

  function bindMapDisplayUI() {
    const surface = (0, dependencies.$)('mapDisplaySurface');
    if (!surface) return;
    const visibilityInputs = [
      ['countries', 'countriesVisible'], ['subunits', 'subunitsVisible'], ['regions', 'regionsVisible'],
      ['languages', 'languagesVisible'], ['ethnicities', 'ethnicitiesVisible'], ['religions', 'religionsVisible'],
      ['rivers', 'riversVisible'], ['lakes', 'lakesVisible'], ['genericFeatures', 'genericFeaturesVisible'],
      ['labels', 'labelsVisible'], ['basemapLabels', 'basemapLabelsVisible'], ['countryFlags', 'countryFlagsVisible'],
    ];
    for (const [group, id] of visibilityInputs) {
      (0, dependencies.$)(id)?.addEventListener('change', event => setLayerVisibility(group, event.currentTarget.checked));
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
    surface.addEventListener('pointerover', event => {
      if (!isDesktopViewMenu()) return;
      const parent = event.target.closest('.view-menu-parent');
      const group = displayGroupForTrigger(parent);
      if (!group) return;
      clearTimeout(desktopViewMenuCloseTimer);
      scheduleDesktopViewMenuGroup(group);
    });
    surface.addEventListener('pointerout', event => {
      if (!isDesktopViewMenu() || event.relatedTarget?.closest('#mapDisplaySurface')) return;
      scheduleDesktopViewMenuClose();
    });
    surface.addEventListener('pointerenter', () => clearTimeout(desktopViewMenuCloseTimer));
    surface.addEventListener('keydown', event => {
      if (!isDesktopViewMenu()) return;
      const menuItems = [...surface.querySelectorAll('.view-menu-parent:not([hidden]):not(:disabled)')]
        .filter(item => item.getClientRects().length > 0);
      const currentIndex = menuItems.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (collapseDesktopViewMenuLevel({ focusParent: true })) return;
        (0, dependencies.closeSurface)('display', { restoreFocus: true });
        return;
      }
      if (event.key === 'Tab') {
        closeDesktopViewMenuGroup();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
        const parent = document.activeElement?.closest('.view-menu-parent');
        if (!parent) return;
        event.preventDefault();
        event.stopPropagation();
        setDesktopViewMenuGroup(displayGroupForTrigger(parent));
        const panel = displayPanelForDesktopGroup(displayGroupForTrigger(parent));
        requestAnimationFrame(() => panel?.querySelector('button, input, select')?.focus({ preventScroll: true }));
        return;
      }
      if (event.key === 'ArrowLeft') {
        if (!document.activeElement?.closest('.view-menu-parent')) return;
        event.preventDefault();
        event.stopPropagation();
        collapseDesktopViewMenuLevel({ focusParent: true });
        return;
      }
      if (currentIndex < 0) return;
      let nextIndex;
      if (event.key === 'ArrowDown') nextIndex = currentIndex + 1;
      else if (event.key === 'ArrowUp') nextIndex = currentIndex - 1;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = menuItems.length - 1;
      else return;
      if (!menuItems.length) return;
      event.preventDefault();
      event.stopPropagation();
      menuItems[(nextIndex + menuItems.length) % menuItems.length]?.focus({ preventScroll: true });
    });
    const app = (0, dependencies.$)('app');
    new MutationObserver(() => {
      syncMapDisplayDisclosures();
      if (!surface.classList.contains('surface-open') && !surface.classList.contains('mobile-open')) closeDesktopViewMenuGroup();
    }).observe(app, { attributes: true, attributeFilter: ['data-layout'] });
    new MutationObserver(() => {
      if (!surface.classList.contains('surface-open') && !surface.classList.contains('mobile-open')) closeDesktopViewMenuGroup();
    }).observe(surface, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => {
      if (!isDesktopViewMenu()) return;
      requestAnimationFrame(() => {
        positionDesktopViewMenuSurface();
        if (desktopViewMenuRoot) positionDesktopViewMenuGroup(desktopViewMenuRoot);
        if (desktopDistributionDetail) positionDesktopViewMenuGroup(desktopDistributionDetail);
      });
    });
    surface.addEventListener('change', event => {
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
    const hint = (0, dependencies.$)('distributionLayerModeHint');
    if (!hint) return;
    hint.textContent = mode === dependencies.DISTRIBUTION_RENDER_MODES.INTENSITY
      ? '선택한 분포가 많을수록 색이 진해집니다.'
      : '각 지역에서 가장 많은 분포 하나만 표시합니다.';
  }

  function initializeLAYER_STYLE_TARGETS() {
    (LAYER_STYLE_TARGETS = Object.freeze({
      countries: { presentationGroup: 'countries', label: '국가', opacity: true, boundary: true, boundaryLabel: '국경 표시' },
      subunits: { presentationGroup: 'subunits', label: '하위단위', opacity: true, boundary: true },
      regions: { presentationGroup: 'regions', label: '지방', opacity: true, boundary: true },
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
