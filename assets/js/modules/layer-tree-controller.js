import { createLayerListModel, visibleLayerRows } from './layer-list-model.js';

const ROW_HEIGHT_DESKTOP = 30;
const ROW_HEIGHT_MOBILE = 38;
const OVERSCAN = 5;

export function createLayerTreeController({
  window,
  document,
  elements,
  groups,
  commands,
  model,
  createIcon,
  createEmptyState,
  searchDelay = 120,
} = {}) {
  let searchTimer = 0;
  let renderedRevision = -1;
  let renderedSearch = '';
  let searchScrollTop = 0;
  let hydrated = false;
  let logicalRows = [];
  let presentation = null;
  let listScrollTop = 0;
  const rowBuildTokens = new WeakMap();
  const rowBuilds = new Set();
  let disposed = false;
  let resizeFrame = 0;
  const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(() => {
    if (disposed || resizeFrame || !presentation) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      const container = renderedSearch ? elements.searchResults : elements.list;
      if (container.clientHeight) renderRows(container, logicalRows, container.scrollTop);
    });
  }) : null;
  const buildRows = (container, factories, before = [], after = [], onCommit = () => {}) => {
    const token = {}, fragment = document.createDocumentFragment();
    rowBuildTokens.set(container, token);
    const focus = container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focus?.closest('[data-object-key]')?.dataset.objectKey;
    const focusTag = focus?.tagName;
    fragment.append(...before);
    let index = 0, finish;
    const pending = new Promise(resolve => { finish = resolve; }); rowBuilds.add(pending);
    const complete = () => { rowBuilds.delete(pending); finish(); };
    const step = () => {
      if (disposed || rowBuildTokens.get(container) !== token) { complete(); return; }
      if (document.hidden || window.navigator?.scheduling?.isInputPending?.()) { window.setTimeout(step, 50); return; }
      const started = performance.now();
      while (index < factories.length && performance.now() - started < 4) fragment.append(factories[index++]());
      if (index < factories.length) { window.setTimeout(step, 0); return; }
      fragment.append(...after);
      const previous = new Map([...container.children].filter(node => node.dataset.objectKey).map(node => [node.dataset.objectKey, node]));
      let cursor = container.firstChild;
      for (const candidate of [...fragment.children]) {
        const retained = previous.get(candidate.dataset.objectKey);
        const node = retained?.isEqualNode(candidate) ? retained : candidate;
        if (node === retained) {
          const input = node.querySelector('input');
          const nextInput = candidate.querySelector('input');
          if (input && nextInput) { input.checked = nextInput.checked; input.indeterminate = nextInput.indeterminate; }
        }
        if (node === cursor) cursor = cursor.nextSibling;
        else container.insertBefore(node, cursor);
      }
      while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
      onCommit();
      commands.syncCanonicalControls?.(container); syncSelection();
      if (focusKey && !focus?.isConnected) {
        const row = [...container.querySelectorAll('[data-object-key]')].find(node => node.dataset.objectKey === focusKey);
        row?.querySelector(focusTag.toLowerCase())?.focus?.({ preventScroll: true });
      }
      complete();
    };
    step();
  };

  const rowHeight = container => {
    const rendered = container?.querySelector?.('.layer-child, .layer-bundle-row');
    const measured = rendered?.getBoundingClientRect?.().height;
    if (Number.isFinite(measured) && measured > 0) return measured;
    const value = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--ui-tree-row-height'));
    if (Number.isFinite(value) && value > 0) return value;
    return window.matchMedia?.('(max-width: 799px)').matches ? ROW_HEIGHT_MOBILE : ROW_HEIGHT_DESKTOP;
  };

  const selection = () => model.selectionSnapshot?.().selection || { primaryKey: null, items: [] };
  const selected = (group, id) => {
    const ref = model.itemRef(group, id);
    return !!ref && model.selectionHas(ref);
  };

  const createVisibilityControl = ({ group, itemId, label, checked, ariaLabel }) => {
    const control = document.createElement('label');
    control.className = 'layer-visibility-control';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'layer-visibility-toggle';
    input.checked = checked;
    input.dataset.layerItemVisibility = group;
    input.dataset.itemId = itemId;
    input.dataset.visibilityLabel = label;
    input.setAttribute('aria-label', ariaLabel || `${label} 표시`);
    control.append(input, createIcon('eye', 'ui-icon layer-visibility-icon layer-visibility-eye'), createIcon('eyeOff', 'ui-icon layer-visibility-icon layer-visibility-eye-off'));
    return control;
  };

  const createLockIndicator = () => {
    const indicator = document.createElement('span');
    indicator.className = 'layer-lock-indicator';
    indicator.dataset.tooltip = '잠김';
    indicator.append(createIcon('lock', 'ui-icon layer-lock-icon'));
    return indicator;
  };

  const createItemRow = (group, item, { searchResult = false } = {}) => {
    const itemGroup = item.layerGroup || group;
    const row = document.createElement('div');
    const currentSelection = selection();
    const isSelected = selected(itemGroup, item.id);
    const ref = model.itemRef(itemGroup, item.id);
    const primary = !!ref && currentSelection.primaryKey === ref.key;
    const hasMenu = itemGroup !== 'countryLabels' && !!ref;
    const multi = (currentSelection.items?.length || 0) > 1;
    row.className = `ui-row ui-selectable-row ${searchResult ? 'layer-child layer-search-result' : 'layer-child'}${!searchResult && !hasMenu ? ' has-no-menu' : ''}${isSelected ? ' is-selected' : ''}${isSelected && multi ? ' is-multi-selected' : ''}${primary && multi ? ' is-primary-selected' : ''}`;
    row.dataset.layerGroup = itemGroup;
    row.dataset.itemId = item.id;
    row.dataset.objectKey = item.key;
    if (item.bundleId) row.dataset.bundleMember = item.bundleId;
    const swatch = document.createElement('span');
    swatch.className = 'layer-color-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    if (item.color) swatch.style.backgroundColor = item.color;
    else {
      swatch.classList.add('is-type-icon');
      swatch.append(createIcon(item.icon || 'map'));
    }
    const visibility = createVisibilityControl({ group: itemGroup, itemId: item.id, label: item.name, checked: model.isVisible(itemGroup, item.id) });
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'ui-button layer-child-name';
    name.dataset.layerItemSelect = itemGroup;
    name.dataset.itemId = item.id;
    const label = document.createElement('span');
    label.className = 'layer-child-name-label';
    label.textContent = item.name;
    const type = document.createElement('span');
    type.className = 'layer-item-type';
    type.textContent = item.typeLabel;
    if (item.isBuiltin && itemGroup === 'hydro') {
      const status = model.snapshot().hydroState;
      type.textContent += status === 'error' ? ' · 재시도' : ['idle', 'loading'].includes(status) ? ' · 로딩' : '';
    }
    name.append(swatch, label, type);
    name.dataset.tooltip = item.title || `${item.name} 선택`;
    if (hasMenu && model.isLocked(ref)) {
      name.classList.add('has-lock-indicator');
      name.setAttribute('aria-label', `${item.name}, 잠김, 선택`);
      name.append(createLockIndicator());
    }
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'ui-button layer-child-menu';
    menu.dataset.layerItemMenu = itemGroup;
    menu.dataset.itemId = item.id;
    menu.setAttribute('aria-label', `${item.name} 메뉴`);
    menu.setAttribute('aria-haspopup', 'menu');
    menu.setAttribute('aria-controls', 'objectActionsMenu');
    menu.setAttribute('aria-expanded', 'false');
    menu.dataset.tooltip = `${item.name} 메뉴`;
    menu.append(createIcon('more'));
    row.append(visibility, name);
    if (hasMenu) row.append(menu);
    return row;
  };


  const createBundleRow = bundle => {
    const expanded = !!model.snapshot().folders[bundle.id];
    const row = document.createElement('div');
    row.className = 'ui-row layer-bundle-row';
    row.dataset.bundleKey = bundle.id;
    row.dataset.objectKey = bundle.key;
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'ui-button layer-bundle-toggle';
    toggle.dataset.layerFolderToggle = bundle.id;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', bundle.name + (expanded ? ' 접기' : ' 펼치기'));
    toggle.append(createIcon('chevronDown', 'ui-icon disclosure-icon'));
    const checked = bundle.items.every(item => model.isVisible(item.layerGroup, item.id));
    const visibility = createVisibilityControl({ group: 'bundle', itemId: bundle.id, label: bundle.name, checked });
    visibility.querySelector('input').indeterminate = !checked && bundle.items.some(item => model.isVisible(item.layerGroup, item.id));
    const name = document.createElement('button');
    name.type = 'button'; name.className = 'ui-button layer-child-name';
    name.dataset.layerFolderToggle = bundle.id;
    name.setAttribute('aria-expanded', String(expanded));
    const icon = document.createElement('span');
    icon.className = 'layer-color-swatch is-type-icon'; icon.append(createIcon(bundle.icon));
    const label = document.createElement('span'); label.className = 'layer-child-name-label'; label.textContent = bundle.name;
    const type = document.createElement('span'); type.className = 'layer-item-type'; type.textContent = bundle.typeLabel;
    name.append(icon, label, type); row.append(toggle, visibility, name);
    if (bundle.id !== 'countries') row.dataset.loadState = model.snapshot().hydroState;
    return row;
  };

  const renderRows = (container, rows, scrollTop = container.scrollTop) => {
    const height = rowHeight(container);
    const viewport = Math.max(144, container.clientHeight || 420);
    const virtual = rows.length > 80;
    const desired = Math.min(Math.max(0, scrollTop), Math.max(0, rows.length * height - viewport));
    const start = virtual ? Math.max(0, Math.floor(desired / height) - OVERSCAN) : 0;
    const end = virtual ? Math.min(rows.length, start + Math.ceil(viewport / height) + OVERSCAN * 2) : rows.length;
    const spacer = count => {
      const node = document.createElement('div'); node.className = 'layer-virtual-spacer';
      node.style.height = `${count * height}px`; return node;
    };
    const search = container === elements.searchResults;
    const factories = rows.slice(start, end).map(item => () => item.kind === 'bundle'
      ? createBundleRow(item) : createItemRow(item.layerGroup, item, { searchResult: search }));
    if (!rows.length) factories.push(() => {
      const empty = createEmptyState(search ? '검색 결과가 없습니다.' : '아직 레이어가 없습니다.', search ? '다른 이름이나 유형으로 검색해 보세요.' : '아래 추가 버튼에서 시작하세요.');
      empty.classList.add('layer-empty'); return empty;
    });
    buildRows(container, factories, virtual ? [spacer(start)] : [], virtual ? [spacer(rows.length - end)] : [], () => {
      container.dataset.virtualized = String(virtual); container.scrollTop = desired;
    });
  };

  const syncSelection = (current = selection()) => {
    const keys = new Set((current.items || []).map(item => item.key));
    const multi = keys.size > 1;
    elements.section?.querySelectorAll('[data-layer-group][data-item-id]').forEach(row => {
      const ref = model.itemRef(row.dataset.layerGroup, row.dataset.itemId);
      const isSelected = !!ref && keys.has(ref.key);
      const isPrimary = !!ref && current.primaryKey === ref.key;
      row.classList.toggle('is-selected', isSelected);
      row.classList.toggle('is-multi-selected', isSelected && multi);
      row.classList.toggle('is-primary-selected', isPrimary && multi);
      if (row.matches('.layer-search-result')) row.setAttribute('aria-selected', String(isSelected));
    });
  };

  const syncLock = value => {
    const ref = model.normalizeRef(value);
    if (!ref) return;
    const locked = model.isLocked(ref);
    elements.section?.querySelectorAll('.layer-child[data-layer-group][data-item-id]').forEach(row => {
      if (row.classList.contains('has-no-menu')) return;
      const rowRef = model.itemRef(row.dataset.layerGroup, row.dataset.itemId);
      if (!rowRef || rowRef.key !== ref.key) return;
      const name = row.querySelector('.layer-child-name');
      const label = name?.querySelector('.layer-child-name-label');
      if (!name || !label) return;
      const indicator = name.querySelector('.layer-lock-indicator');
      if (locked) {
        name.classList.add('has-lock-indicator');
        name.setAttribute('aria-label', `${label.textContent}, 잠김, 선택`);
        if (!indicator) name.append(createLockIndicator());
      } else {
        indicator?.remove();
        name.classList.remove('has-lock-indicator');
        name.removeAttribute('aria-label');
      }
    });
  };

  const syncLocks = (refs = []) => {
    const unique = new Map();
    for (const value of refs) {
      const ref = model.normalizeRef(value);
      if (ref) unique.set(ref.key, ref);
    }
    unique.forEach(syncLock);
  };


  const render = (force = false) => {
    const snapshot = model.snapshot();
    if (!force && renderedRevision === snapshot.revision) return false;
    commands.prune?.();
    const search = String(snapshot.search || '').trim().toLocaleLowerCase('ko');
    const searchChanged = search !== renderedSearch;
    if (!elements.list.classList.contains('hidden')) listScrollTop = elements.list.scrollTop;
    if (!elements.searchResults.classList.contains('hidden')) searchScrollTop = elements.searchResults.scrollTop;
    presentation = createLayerListModel({
      items: model.items, groups: groups.search, builtinCountryIds: model.builtinCountryIds(),
      builtinSession: model.builtinSession(), itemRef: model.itemRef, compare: model.compare,
    });
    logicalRows = visibleLayerRows(presentation, snapshot.folders, search);
    elements.searchResults.classList.toggle('hidden', !search);
    elements.list.classList.toggle('hidden', !!search);
    const container = search ? elements.searchResults : elements.list;
    const inactive = search ? elements.list : elements.searchResults;
    rowBuildTokens.set(inactive, {}); inactive.replaceChildren();
    renderRows(container, logicalRows, search ? (searchChanged ? 0 : searchScrollTop) : listScrollTop);
    renderedRevision = snapshot.revision; renderedSearch = search;
    return true;
  };

  const beginHydration = () => commands.beginHydration?.();
  const completeHydration = async () => {
    if (hydrated) return;
    while (rowBuilds.size) await Promise.all([...rowBuilds]);
    commands.layerTreeRendered?.();
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    elements.section?.classList.remove('is-hydrating');
    elements.section?.setAttribute('aria-busy', 'false');
    if (elements.search) elements.search.disabled = false;
    commands.syncSearchClear?.();
    hydrated = true;
    commands.layerReady?.();
    window.dispatchEvent(new window.CustomEvent('pandolab:layer-ready'));
  };


  const handleScroll = event => {
    const container = event.target;
    if (container !== elements.list && container !== elements.searchResults) return;
    commands.closeMenu?.();
    if (container === elements.list) listScrollTop = container.scrollTop;
    else searchScrollTop = container.scrollTop;
    if (container.dataset.virtualized === 'true') renderRows(container, logicalRows, container.scrollTop);
  };

  const bind = () => {
    resizeObserver?.observe(elements.list);
    resizeObserver?.observe(elements.searchResults);
    for (const [group, input] of Object.entries(elements.visibilityInputs || {})) input?.addEventListener('change', event => {
      commands.setLayerVisibility(group, event.target.checked);
      render();
    });
    elements.terrainVisible?.addEventListener('change', event => commands.setTerrainVisible(event.target.checked));
    for (const input of elements.terrainStyleInputs || []) input?.addEventListener('change', event => event.target.checked && commands.setTerrainStyle(event.target.value));
    elements.terrainStrength?.addEventListener('input', event => commands.previewTerrainStrength(event.target.value));
    elements.terrainStrength?.addEventListener('change', commands.commitTerrainStrength);
    for (const input of elements.distributionModeInputs || []) input?.addEventListener('change', event => commands.setDistributionRenderMode?.(event.target.value));
    elements.distributionBoundaryVisible?.addEventListener('change', event => commands.setDistributionBoundaryVisible?.(event.target.checked));
    elements.search?.addEventListener('input', event => {
      commands.setSearchValue(event.target.value || '');
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => { commands.commitSearch?.(); render(); }, searchDelay);
    });
    elements.searchClear?.addEventListener('click', () => {
      elements.search.value = '';
      elements.search.dispatchEvent(new window.Event('input', { bubbles: true }));
      elements.search.focus({ preventScroll: true });
    });
    elements.section?.addEventListener('click', event => {
      if (event.target.closest('.layer-visibility-control')) return;
      if (event.target.closest('#objectLockBtn')) { commands.lockSelection?.(); return; }
      if (event.target.closest('#objectDeleteBtn')) { commands.deleteSelection?.(); return; }
      const menu = event.target.closest('[data-layer-item-menu]');
      if (menu) { event.stopPropagation(); commands.openItemMenu(menu.dataset.layerItemMenu, menu.dataset.itemId, menu); return; }
      const folder = event.target.closest('[data-layer-folder-toggle]');
      if (folder) { commands.toggleFolder(folder.dataset.layerFolderToggle); render(); return; }
      const item = event.target.closest('[data-layer-item-select]');
      if (item) commands.selectItem({ group: item.dataset.layerItemSelect, id: item.dataset.itemId, additive: event.ctrlKey || event.metaKey, range: event.shiftKey, orderedRefs: logicalRows.flatMap(row => row.ref ? [row.ref] : []) });
    });
    elements.section?.addEventListener('scroll', handleScroll, true);
    elements.section?.addEventListener('change', event => {
      commands.syncVisibilityToggle?.(event.target);
      const checkbox = event.target.closest('[data-layer-item-visibility]');
      if (checkbox) {
        if (checkbox.dataset.layerItemVisibility === 'bundle') {
          const bundle = presentation?.bundles.find(entry => entry.id === checkbox.dataset.itemId);
          if (bundle) commands.setBundleVisibility(bundle.items, checkbox.checked);
        } else commands.setItemVisibility(checkbox.dataset.layerItemVisibility, checkbox.dataset.itemId, checkbox.checked);
        render();
      }
    });
    const bindStyleEvents = surface => {
    surface?.addEventListener('click', event => {
      const toggle = event.target.closest('[data-layer-style-toggle]');
      if (toggle) commands.toggleLayerStyle?.(toggle.dataset.layerStyleToggle);
    });
    surface?.addEventListener('change', event => {
      const boundary = event.target.closest('[data-layer-style-boundary]');
      if (boundary) commands.updateLayerStyle?.(boundary.dataset.layerStyleBoundary, { boundaryVisible: boundary.checked });
      const blend = event.target.closest('[data-layer-style-blend-mode]');
      if (blend) commands.updateLayerStyle?.(blend.dataset.layerStyleBlendMode, { blendMode: blend.value });
    });
    surface?.addEventListener('input', event => {
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) commands.updateLayerStyle?.(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 });
    });
    };
    bindStyleEvents(elements.styleSection);
    return api;
  };

  const dispose = () => {
    disposed = true; window.clearTimeout(searchTimer);
    resizeObserver?.disconnect();
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
  };
  const api = Object.freeze({ bind, render, syncSelection, syncLock, syncLocks, beginHydration, completeHydration, dispose });
  return api;
}

export function createAppLayerTreeController(runtime = {}) {
  const {
    window, document, getElement: $, state,
    layerSearchGroupKeys, layerGroupNames, createIcon, createEmptyState, layerTreeItems,
    layerItemObjectRef, normalizeObjectRef, selectionDomain, isLayerItemVisible,
    objectRefLocked, compareItems,
    builtinCountryIds, builtinSession, setBundleVisibility,
    pruneLayerItemVisibility,
    syncCanonicalControls, syncSearchClearButton, setLayerVisibility,
    toggleLayerStylePanel, updateLayerPresentationStyle, distributionService,
    syncDistributionPresentationControls, renderingDomain, queuePresentationAutosave,
    gpuMapRenderer, syncPhysicalControls, markLayerTreeDirty, clamp, syncRangeProgress,
    setActionStatus, selectLayerTreeItem, openObjectActionsMenu, isMobile,
    returnToMapAfterMobileAction, closeObjectActionsMenu, syncLayerVisibilityToggle,
    setLayerItemVisibility, batchToggleLocked, deleteSelectedFromObjectMenu,
  } = runtime;
  return createLayerTreeController({
    window,
    document,
    elements: {
      visibilityInputs: Object.fromEntries([
        ['countries', 'countriesVisible'], ['territories', 'territoriesVisible'], ['administrative', 'administrativeVisible'],
        ['regions', 'regionsVisible'], ['languages', 'languagesVisible'], ['ethnicities', 'ethnicitiesVisible'],
        ['religions', 'religionsVisible'], ['rivers', 'riversVisible'], ['lakes', 'lakesVisible'], ['genericFeatures', 'genericFeaturesVisible'],
        ['labels', 'labelsVisible'], ['basemapLabels', 'basemapLabelsVisible'],
      ].map(([group, id]) => [group, $(id)])),
      terrainVisible: $('terrainVisible'),
      terrainStyleInputs: [$('terrainPoliticalRadio'), $('terrainPhysicalRadio')],
      terrainStrength: $('terrainStrengthInput'),
      distributionModeInputs: [$('distributionLayerModeInput'), $('distributionRenderModeInput')],
      distributionBoundaryVisible: $('distributionBoundaryVisibleInput'),
      search: $('layerSearchInput'),
      searchClear: $('layerSearchClearBtn'),
      searchResults: $('layerSearchResults'),
      section: $('layerSection'),
      list: document.querySelector('.layer-list'),
      styleSection: $('mapViewSection'),
    },
    groups: { search: layerSearchGroupKeys, names: layerGroupNames },
    createIcon,
    createEmptyState,
    model: {
      snapshot: () => ({ revision: state.layerTreeRevision, search: state.layerSearch, folders: state.layerFolders, hydroState: state.physicalLoadState.hydro }),
      items: layerTreeItems, builtinCountryIds, builtinSession,
      itemRef: layerItemObjectRef,
      normalizeRef: normalizeObjectRef,
      selectionSnapshot: () => selectionDomain.snapshot(),
      selectionHas: ref => selectionDomain.has(ref),
      isVisible: isLayerItemVisible,
      isLocked: objectRefLocked,
      compare: compareItems,
    },
    commands: {
      lockSelection: batchToggleLocked,
      deleteSelection: deleteSelectedFromObjectMenu,
      prune: pruneLayerItemVisibility,
      syncCanonicalControls,
      syncSearchClear: () => syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn')),
      beginHydration: () => {
        const metrics = window.__PANDOLAB_STARTUP_METRICS__;
        if (metrics && metrics.layerHydrationStartedMs == null) metrics.layerHydrationStartedMs = performance.now() - metrics.startedAt;
      },
      layerTreeRendered: () => {
        const metrics = window.__PANDOLAB_STARTUP_METRICS__;
        if (metrics) metrics.layerTreeRenderedMs = performance.now() - metrics.startedAt;
      },
      layerReady: () => {
        const metrics = window.__PANDOLAB_STARTUP_METRICS__;
        if (metrics) metrics.layerReadyMs = performance.now() - metrics.startedAt;
      },
      setLayerVisibility,
      toggleLayerStyle: toggleLayerStylePanel,
      updateLayerStyle: updateLayerPresentationStyle,
      setDistributionRenderMode: mode => {
        distributionService.setRenderMode(mode);
        syncDistributionPresentationControls();
        renderingDomain()?.renderDistributions?.();
        queuePresentationAutosave();
      },
      setDistributionBoundaryVisible: visible => {
        distributionService.setBoundaryVisible(visible);
        syncDistributionPresentationControls();
        renderingDomain()?.renderDistributions?.();
        queuePresentationAutosave();
      },
      setTerrainVisible: visible => {
        state.physicalSettings.terrainVisible = !!visible;
        gpuMapRenderer.invalidatePhysicalStyle('terrain-visibility');
        syncPhysicalControls();
        markLayerTreeDirty();
        renderingDomain()?.invalidateBaseScene?.('terrain-visibility');
        queuePresentationAutosave();
      },
      setTerrainStyle: value => {
        state.physicalSettings.terrainStyle = value === 'physical' ? 'physical' : 'political';
        gpuMapRenderer.invalidatePhysicalStyle('terrain-style');
        syncPhysicalControls();
        markLayerTreeDirty();
        renderingDomain()?.invalidateBaseScene?.('terrain-style');
        queuePresentationAutosave();
        setActionStatus(`${state.physicalSettings.terrainStyle === 'physical' ? '지형색 강조' : '국가색 + 음영'} 모드로 전환했습니다.`, 'success', 2200);
      },
      previewTerrainStrength: value => {
        state.physicalSettings.terrainStrength = clamp(Number(value) / 100, 0, 1);
        gpuMapRenderer.invalidatePhysicalStyle('terrain-strength');
        $('terrainStrengthValue').textContent = `${Math.round(state.physicalSettings.terrainStrength * 100)}%`;
        syncRangeProgress($('terrainStrengthInput'));
        renderingDomain()?.invalidateOverlayStyle?.('terrain-strength');
      },
      commitTerrainStrength: queuePresentationAutosave,
      setSearchValue: value => {
        state.layerSearch = value;
        syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn'));
      },
      commitSearch: markLayerTreeDirty,
      openItemMenu: (group, id, trigger) => {
        selectLayerTreeItem(group, id, { mode: 'replace' });
        openObjectActionsMenu(trigger);
      },
      toggleFolder: group => {
        if (!['countries', 'rivers', 'lakes'].includes(group)) return;
        state.layerFolders[group] = !state.layerFolders[group]; markLayerTreeDirty();
      },
      selectItem: ({ group, id, additive, range, orderedRefs }) => {
        const mode = additive || (isMobile() && state.addSelectionMode) ? 'toggle' : 'replace';
        const didSelect = selectLayerTreeItem(group, id, { mode, range, orderedRefs });
        if (didSelect && isMobile() && mode === 'replace' && !range) returnToMapAfterMobileAction(true);
      },
      closeMenu: closeObjectActionsMenu,
      syncVisibilityToggle: syncLayerVisibilityToggle,
      setBundleVisibility,
      setItemVisibility: setLayerItemVisibility,
    },
  });
}
