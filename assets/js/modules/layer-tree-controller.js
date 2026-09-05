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
  let searchMatches = [];
  const groupScrollTop = new Map();
  const virtualItems = new Map();
  const rowBuildTokens = new WeakMap();
  const rowBuilds = new Set();
  let disposed = false;
  const buildRows = (container, factories, before = [], after = [], onCommit = () => {}) => {
    const token = {}, fragment = document.createDocumentFragment();
    rowBuildTokens.set(container, token);
    const focus = container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focus?.closest('[data-item-id]')?.dataset.itemId;
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
      fragment.append(...after); container.replaceChildren(fragment); onCommit();
      commands.syncCanonicalControls?.(container); syncSelection();
      if (focusKey) {
        const row = [...container.querySelectorAll('[data-item-id]')].find(node => node.dataset.itemId === focusKey && node.tagName === focusTag);
        row?.focus?.({ preventScroll: true });
      }
      complete();
    };
    step();
  };

  const rowHeight = container => {
    const rendered = container?.querySelector?.('.layer-child, .layer-subfolder-row, .layer-child-skeleton, .layer-folder-row');
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
    if (item.groupHeader && !searchResult) {
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'ui-button ui-selectable-row layer-subfolder-row';
      header.dataset.territorialUnitFolderToggle = item.folderKey;
      header.setAttribute('aria-expanded', String(item.expanded));
      header.setAttribute('aria-label', `${item.name} 하위 폴더 ${item.expanded ? '접기' : '펼치기'}`);
      header.dataset.tooltip = `${item.name} 하위 폴더 ${item.expanded ? '접기' : '펼치기'}`;
      header.append(createIcon('chevronDown', 'ui-icon disclosure-icon'), document.createElement('strong'));
      header.querySelector('strong').textContent = item.name;
      return header;
    }
    const row = document.createElement(searchResult ? 'button' : 'div');
    const currentSelection = selection();
    const isSelected = selected(itemGroup, item.id);
    const ref = model.itemRef(itemGroup, item.id);
    const primary = !!ref && currentSelection.primaryKey === ref.key;
    const hasMenu = itemGroup !== 'countryLabels' && !!ref;
    const multi = (currentSelection.items?.length || 0) > 1;
    row.className = `ui-row ui-selectable-row ${searchResult ? 'layer-search-result' : 'layer-child'}${!searchResult && !hasMenu ? ' has-no-menu' : ''}${isSelected ? ' is-selected' : ''}${isSelected && multi ? ' is-multi-selected' : ''}${primary && multi ? ' is-primary-selected' : ''}`;
    row.dataset.layerGroup = itemGroup;
    row.dataset.itemId = item.id;
    if (searchResult) {
      row.type = 'button';
      row.dataset.layerItemSelect = itemGroup;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(isSelected));
      row.append(document.createElement('span'), document.createElement('strong'));
      row.querySelector('span').textContent = item.folderName || groups.names[itemGroup] || '지형 음영';
      row.querySelector('strong').textContent = item.name;
      return row;
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
    name.append(label);
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

  const renderVirtual = (group, container, items, { scrollTop = container.scrollTop, folderKey = group, search = false } = {}) => {
    if (search) searchMatches = items;
    else virtualItems.set(folderKey, items);
    const height = rowHeight(container);
    const desired = Math.max(0, Number(scrollTop) || 0);
    const viewport = Math.max(144, container.clientHeight || (search ? 420 : 235));
    const start = Math.max(0, Math.floor(desired / height) - OVERSCAN);
    const end = Math.min(items.length, start + Math.ceil(viewport / height) + OVERSCAN * 2);
    const top = document.createElement('div');
    top.className = 'layer-virtual-spacer';
    top.style.height = `${start * height}px`;
    const bottom = document.createElement('div');
    bottom.className = 'layer-virtual-spacer';
    bottom.style.height = `${Math.max(0, items.length - end) * height}px`;
    buildRows(container, items.slice(start, end).map(entry => () => createItemRow(search ? entry.group : group, search ? entry.item : entry, { searchResult: search })), [top], [bottom], () => {
      container.dataset.virtualized = 'true';
      container.scrollTop = Math.min(desired, Math.max(0, container.scrollHeight - container.clientHeight));
      if (!search) groupScrollTop.set(folderKey, container.scrollTop);
    });
  };

  const renderFolder = ({ group, folderKey, name, folder, container, items, search }) => {
    const snapshot = model.snapshot();
    const expanded = !search && !!snapshot.folders[folderKey];
    rowBuildTokens.set(container, {});
    if (!container.hidden) groupScrollTop.set(folderKey, container.scrollTop);
    const saved = groupScrollTop.get(folderKey) ?? 0;
    folder.classList.toggle('is-expanded', expanded);
    folder.querySelectorAll('[data-layer-folder-toggle]').forEach(button => {
      button.setAttribute('aria-expanded', String(expanded));
      const label = `${name} 폴더 ${expanded ? '접기' : '펼치기'}`;
      button.setAttribute('aria-label', label);
      button.dataset.tooltip = label;
    });
    container.hidden = !expanded;
    if (!expanded) {
      container.removeAttribute('aria-busy');
      container.replaceChildren();
      return;
    }
    if ((group === 'rivers' || group === 'lakes') && ['idle', 'loading'].includes(snapshot.hydroState)) {
      container.setAttribute('aria-busy', 'true');
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 4; index += 1) {
        const row = document.createElement('div');
        row.className = 'layer-child-skeleton';
        row.setAttribute('aria-hidden', 'true');
        row.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
        fragment.append(row);
      }
      container.replaceChildren(fragment);
      return;
    }
    container.removeAttribute('aria-busy');
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = (group === 'rivers' || group === 'lakes') && snapshot.hydroState === 'error' ? `${name} 목록을 불러오지 못했습니다.` : '항목 없음';
      container.replaceChildren(empty);
      return;
    }
    const displayItems = model.groupItems?.(group, items, snapshot) || items;
    if (displayItems.length > 80) renderVirtual(group, container, displayItems, { scrollTop: saved, folderKey });
    else {
      virtualItems.delete(folderKey);
      container.removeAttribute('data-virtualized');
      buildRows(container, displayItems.map(item => () => createItemRow(group, item)), [], [], () => {
        container.scrollTop = Math.min(saved, Math.max(0, container.scrollHeight - container.clientHeight));
        groupScrollTop.set(folderKey, container.scrollTop);
      });
    }
  };

  const syncSelection = (current = selection()) => {
    const keys = new Set((current.items || []).map(item => item.key));
    const multi = keys.size > 1;
    const primary = (current.items || []).find(item => item.key === current.primaryKey) || null;
    const primaryGroup = model.folderGroup(primary);
    elements.section?.querySelectorAll('[data-layer-group][data-item-id]').forEach(row => {
      const ref = model.itemRef(row.dataset.layerGroup, row.dataset.itemId);
      const isSelected = !!ref && keys.has(ref.key);
      const isPrimary = !!ref && current.primaryKey === ref.key;
      row.classList.toggle('is-selected', isSelected);
      row.classList.toggle('is-multi-selected', isSelected && multi);
      row.classList.toggle('is-primary-selected', isPrimary && multi);
      if (row.matches('.layer-search-result')) row.setAttribute('aria-selected', String(isSelected));
    });
    elements.section?.querySelectorAll('.layer-folder[data-layer-group] > .layer-folder-row').forEach(row => {
      const group = row.closest('.layer-folder')?.dataset.layerGroup || '';
      row.classList.toggle('is-active', !!primaryGroup && group === primaryGroup);
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
    commands.syncCategoryLabels?.();
    if (!force && renderedRevision === snapshot.revision) return false;
    commands.prune?.();
    const search = String(snapshot.search || '').trim().toLocaleLowerCase('ko');
    const searchChanged = search !== renderedSearch;
    elements.searchResults?.classList.toggle('hidden', !search);
    elements.list?.classList.toggle('hidden', !!search);
    if (search) {
      if (!searchChanged && elements.searchResults) searchScrollTop = elements.searchResults.scrollTop;
      const matches = [];
      for (const group of groups.search) {
        for (const item of model.items(group)) {
          if (group === 'hydro' && item.isBuiltin && snapshot.hydroState !== 'ready') continue;
          const haystack = `${item.name} ${item.searchText || ''} ${item.id} ${item.meta || ''}`.toLocaleLowerCase('ko');
          if (haystack.includes(search)) matches.push({ group, item });
        }
      }
      matches.sort((left, right) => model.compare(left.item, right.item));
      if (matches.length > 80 && elements.searchResults) renderVirtual('', elements.searchResults, matches, { scrollTop: searchChanged ? 0 : searchScrollTop, search: true });
      else {
        searchMatches = [];
        elements.searchResults?.removeAttribute('data-virtualized');
        const fragment = document.createDocumentFragment();
        for (const { group, item } of matches) fragment.append(createItemRow(group, item, { searchResult: true }));
        if (!matches.length) {
          const empty = createEmptyState('검색 결과가 없습니다.', '이름, 유형 또는 상위 국가를 다른 검색어로 입력해 보세요.');
          empty.classList.add('layer-empty');
          fragment.append(empty);
        }
        elements.searchResults?.replaceChildren(fragment);
      }
      if (elements.searchResults) {
        elements.searchResults.scrollTop = searchChanged ? 0 : Math.min(searchScrollTop, Math.max(0, elements.searchResults.scrollHeight - elements.searchResults.clientHeight));
        searchScrollTop = elements.searchResults.scrollTop;
      }
    } else {
      elements.searchResults?.replaceChildren();
      elements.searchResults?.removeAttribute('data-virtualized');
      searchMatches = [];
      searchScrollTop = 0;
    }
    for (const group of groups.tree) {
      const folder = elements.section?.querySelector(`.layer-folder[data-layer-group="${group}"]`);
      const container = elements.targets[group];
      if (!folder || !container) continue;
      const sourceGroup = group === 'rivers' || group === 'lakes' ? 'hydro' : group;
      const category = group === 'rivers' ? 'river' : group === 'lakes' ? 'lake' : '';
      const items = model.items(sourceGroup)
        .filter(item => !category || model.hydroCategory(item.hydroCategory) === category)
        .filter(item => sourceGroup !== 'hydro' || !item.isBuiltin || snapshot.hydroState !== 'error')
        .sort(model.compare);
      if (group === 'genericFeatures') {
        folder.hidden = !items.length;
        if (!items.length) {
          container.replaceChildren();
          commands.collapseEmptyGroup?.(group);
        }
      }
      renderFolder({ group, folderKey: group, name: groups.names[group], folder, container, items, search });
    }
    renderedRevision = snapshot.revision;
    renderedSearch = search;
    commands.syncStylePanels?.();
    commands.syncCanonicalControls?.(elements.section);
    syncSelection();
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
    commands.closeMenu?.();
    if (event.target === elements.searchResults) {
      searchScrollTop = event.target.scrollTop;
      if (event.target.dataset.virtualized === 'true' && searchMatches.length) renderVirtual('', event.target, searchMatches, { scrollTop: searchScrollTop, search: true });
      return;
    }
    const container = event.target.closest?.('.layer-children');
    if (!container) return;
    const folder = container.closest('.layer-folder');
    const group = folder?.dataset.layerGroup;
    const folderKey = folder?.dataset.layerFolderKey || group;
    if (!group || !folderKey) return;
    groupScrollTop.set(folderKey, container.scrollTop);
    const items = virtualItems.get(folderKey);
    if (items && container.dataset.virtualized === 'true') renderVirtual(group, container, items, { scrollTop: container.scrollTop, folderKey });
  };

  const bind = () => {
    for (const [group, input] of Object.entries(elements.visibilityInputs || {})) input?.addEventListener('change', event => {
      commands.syncVisibilityToggle?.(event.target);
      commands.setLayerVisibility(group, event.target.checked);
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
      const style = event.target.closest('[data-layer-style-toggle]');
      if (style) { event.preventDefault(); event.stopPropagation(); commands.toggleLayerStyle?.(style.dataset.layerStyleToggle); return; }
      const menu = event.target.closest('[data-layer-item-menu]');
      if (menu) { event.stopPropagation(); commands.openItemMenu(menu.dataset.layerItemMenu, menu.dataset.itemId, menu); return; }
      const territorial = event.target.closest('[data-territorial-unit-folder-toggle]');
      if (territorial) { commands.toggleTerritorialUnitFolder(territorial.dataset.territorialUnitFolderToggle); render(); return; }
      const folder = event.target.closest('[data-layer-folder-toggle]');
      if (folder) { commands.toggleFolder(folder.dataset.layerFolderToggle); render(); return; }
      const item = event.target.closest('[data-layer-item-select]');
      if (item) commands.selectItem({ group: item.dataset.layerItemSelect, id: item.dataset.itemId, additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
    });
    elements.section?.addEventListener('scroll', handleScroll, true);
    elements.section?.addEventListener('change', event => {
      commands.syncVisibilityToggle?.(event.target);
      const checkbox = event.target.closest('[data-layer-item-visibility]');
      if (checkbox) commands.setItemVisibility(checkbox.dataset.layerItemVisibility, checkbox.dataset.itemId, checkbox.checked);
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) commands.updateLayerStyle?.(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 });
      const boundary = event.target.closest('[data-layer-style-boundary]');
      if (boundary) commands.updateLayerStyle?.(boundary.dataset.layerStyleBoundary, { boundaryVisible: boundary.checked });
      const blend = event.target.closest('[data-layer-style-blend-mode]');
      if (blend) commands.updateLayerStyle?.(blend.dataset.layerStyleBlendMode, { blendMode: blend.value });
    });
    elements.section?.addEventListener('input', event => {
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) commands.updateLayerStyle?.(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 });
    });
    return api;
  };

  const dispose = () => { disposed = true; window.clearTimeout(searchTimer); };
  const api = Object.freeze({ bind, render, syncSelection, syncLock, syncLocks, beginHydration, completeHydration, dispose });
  return api;
}

export function createAppLayerTreeController(runtime = {}) {
  const {
    window, document, getElement: $, state, layerGroupTargetIds, layerTreeGroupKeys,
    layerSearchGroupKeys, layerGroupNames, createIcon, createEmptyState, layerTreeItems,
    layerItemObjectRef, normalizeObjectRef, selectionDomain, isLayerItemVisible,
    objectRefLocked, layerFolderGroupForObjectRef, hydroCategoryKey, compareItems,
    territorialUnitCountryName, territorialUnitById, territorialUnitFolderStateKey,
    territorialUnitFolderStatePrefix, activeLayerFolderKeys, expandedLayerStyleGroups,
    pruneLayerItemVisibility, syncMapObjectCategoryLabels, syncLayerStylePanels,
    syncCanonicalControls, syncSearchClearButton, setLayerVisibility,
    toggleLayerStylePanel, updateLayerPresentationStyle, distributionService,
    syncDistributionPresentationControls, renderingDomain, queuePresentationAutosave,
    gpuMapRenderer, syncPhysicalControls, markLayerTreeDirty, clamp, syncRangeProgress,
    setActionStatus, selectLayerTreeItem, openObjectActionsMenu, isMobile,
    returnToMapAfterMobileAction, closeObjectActionsMenu, syncLayerVisibilityToggle,
    setLayerItemVisibility,
  } = runtime;
  const targets = Object.fromEntries(Object.entries(layerGroupTargetIds).map(([group, id]) => [group, $(id)]));
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
      targets,
    },
    groups: { tree: layerTreeGroupKeys, search: layerSearchGroupKeys, names: layerGroupNames },
    createIcon,
    createEmptyState,
    model: {
      snapshot: () => ({ revision: state.layerTreeRevision, search: state.layerSearch, folders: state.layerFolders, hydroState: state.physicalLoadState.hydro }),
      items: layerTreeItems,
      itemRef: layerItemObjectRef,
      normalizeRef: normalizeObjectRef,
      selectionSnapshot: () => selectionDomain.snapshot(),
      selectionHas: ref => selectionDomain.has(ref),
      isVisible: isLayerItemVisible,
      isLocked: objectRefLocked,
      folderGroup: layerFolderGroupForObjectRef,
      hydroCategory: hydroCategoryKey,
      compare: compareItems,
      groupItems: (group, items) => {
        if (group !== 'territories' && group !== 'administrative') return items;
        const displayItems = [];
        let previousCountry = null;
        for (const item of items.sort((left, right) => {
          const orphanOrder = Number(!left.countryId) - Number(!right.countryId);
          if (orphanOrder) return orphanOrder;
          const countryOrder = compareItems(
            { name: territorialUnitCountryName(territorialUnitById(left.id)), id: left.id },
            { name: territorialUnitCountryName(territorialUnitById(right.id)), id: right.id },
          );
          return countryOrder || Number(left.level || 0) - Number(right.level || 0) || compareItems(left, right);
        })) {
          const countryKey = String(item.countryId || 'unassigned');
          if (countryKey !== previousCountry) {
            const folderKey = territorialUnitFolderStateKey(group, item.countryId);
            displayItems.push({
              groupHeader: true,
              id: `header:${group}:${countryKey}`,
              name: territorialUnitCountryName(territorialUnitById(item.id)),
              folderKey,
              expanded: state.layerFolders[folderKey] !== false,
            });
            previousCountry = countryKey;
          }
          if (state.layerFolders[territorialUnitFolderStateKey(group, item.countryId)] !== false) displayItems.push(item);
        }
        return displayItems;
      },
    },
    commands: {
      prune: pruneLayerItemVisibility,
      syncCategoryLabels: syncMapObjectCategoryLabels,
      syncStylePanels: syncLayerStylePanels,
      syncCanonicalControls,
      syncSearchClear: () => syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn')),
      collapseEmptyGroup: group => {
        expandedLayerStyleGroups.delete(group);
        state.layerFolders[group] = false;
      },
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
      toggleTerritorialUnitFolder: folderKey => {
        if (!folderKey.startsWith(territorialUnitFolderStatePrefix)) return;
        state.layerFolders[folderKey] = state.layerFolders[folderKey] === false;
        markLayerTreeDirty();
      },
      toggleFolder: group => {
        const folderKeys = activeLayerFolderKeys();
        if (!folderKeys.includes(group)) return;
        const willExpand = !state.layerFolders[group];
        for (const key of folderKeys) if (!key.startsWith(territorialUnitFolderStatePrefix)) state.layerFolders[key] = false;
        state.layerFolders[group] = willExpand;
        markLayerTreeDirty();
      },
      selectItem: ({ group, id, additive, range }) => {
        const mode = additive || (isMobile() && state.addSelectionMode) ? 'toggle' : 'replace';
        const didSelect = selectLayerTreeItem(group, id, { mode, range });
        if (didSelect && isMobile() && mode === 'replace' && !range) returnToMapAfterMobileAction(true);
      },
      closeMenu: closeObjectActionsMenu,
      syncVisibilityToggle: syncLayerVisibilityToggle,
      setItemVisibility: setLayerItemVisibility,
    },
  });
}
