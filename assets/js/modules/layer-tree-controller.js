import { normalizeObjectRef } from './object-selection-controller.js';
import { normalizePlaceQuery, PLACE_LIMITS } from './place-contract.js';
import { createLayerListModel, visibleLayerRows } from './layer-list-model.js';

/**
 * Object search is deliberately flat. The project still owns object grouping and
 * visibility, but the map no longer exposes that structure as a persistent tree.
 */
export function createLayerTreeController({
  window,
  document,
  elements,
  groups,
  commands,
  model,
  createEmptyState,
  createIcon,
  searchDelay = 120,
  builtinSearch = null,
  cancelBuiltinSearch = () => {},
  builtinRecordVisible = () => true,
  onSearchError = () => {},
} = {}) {
  let searchTimer = 0;
  let renderedRevision = -1;
  let renderedSearch = '';
  let renderedSearchRefs = [];
  let hydrated = false;
  let disposed = false;
  let searchGeneration = 0;
  let builtinQuery = null;
  let builtinRows = [];
  let builtinTruncated = false;

  const selection = () => model.selectionSnapshot?.().selection || { primaryKey: null, items: [] };

  function searchResultIcon(item) {
    const semanticName = item.layerGroup === 'hydro'
      ? item.typeLabel === '호수' ? 'lake' : 'river'
      : ({
        countries: 'country', subunits: 'subunit', regions: 'region', distributions: 'area',
        labels: 'place', genericFeatures: 'territory',
      })[item.layerGroup] || 'map';
    return createIcon?.(semanticName, 'ui-icon layer-search-result-icon') || null;
  }

  function searchResultVisual(item) {
    if (!item.flagUrl) return searchResultIcon(item);
    const flag = document.createElement('img');
    flag.className = 'layer-search-result-flag';
    flag.src = item.flagUrl;
    flag.alt = '';
    flag.decoding = 'async';
    flag.addEventListener('error', () => {
      const fallback = searchResultIcon(item);
      if (fallback && flag.isConnected) flag.replaceWith(fallback);
    }, { once: true });
    return flag;
  }

  function rowFor(item) {
    const current = selection();
    const selected = current.items?.some(candidate => candidate.key === item.key) || false;
    const primary = current.primaryKey === item.key;
    const row = document.createElement('div');
    row.className = 'layer-search-result ui-selectable-row';
    row.dataset.objectKey = item.key;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.classList.toggle('is-selected', selected);
    row.classList.toggle('is-primary-selected', primary);

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'ui-button layer-search-result-select';
    select.dataset.objectSearchSelect = item.layerGroup;
    select.dataset.itemId = item.id;
    select.setAttribute('aria-label', item.name);
    const name = document.createElement('strong');
    name.textContent = item.name;
    const visual = searchResultVisual(item);
    if (visual) name.prepend(visual);
    select.append(name);

    const focus = document.createElement('button');
    focus.type = 'button';
    focus.className = 'ui-button icon-btn layer-search-focus-action';
    focus.dataset.objectSearchFocus = item.layerGroup;
    focus.dataset.itemId = item.id;
    focus.dataset.tooltip = '선택 객체로 이동';
    focus.setAttribute('aria-label', `${item.name} 선택 객체로 이동`);
    const focusIcon = createIcon?.('focus', 'ui-icon');
    if (focusIcon) focus.append(focusIcon);
    row.append(select, focus);
    return row;
  }

  function rowsFor(query) {
    if (!query) return [];
    const presentation = createLayerListModel({
      items: model.items,
      groups: groups.search,
      itemRef: model.itemRef,
      compare: model.compare,
    });
    return visibleLayerRows(presentation, {}, query).filter(item => item.kind === 'object');
  }

  function commitRows(query, rows) {
    const results = elements.searchResults;
    results.replaceChildren();
    renderedSearchRefs = rows.map(item => item.ref).filter(Boolean);
    if (query && rows.length) { results.append(...rows.map(rowFor)); if (builtinTruncated) results.append(createEmptyState('검색 결과를 일부 표시했습니다.', '이름의 앞부분을 더 입력해 범위를 좁히세요.')); }
    else if (query) results.append(createEmptyState('검색 결과가 없습니다.', '내장 지명은 두 글자 이상으로 이름의 앞부분을 검색하세요.'));
    commands.syncCanonicalControls?.(results);
    syncSelection();
  }

  function combinedRows(query) {
    const rows = [...rowsFor(query).slice(0, 100), ...builtinRows.filter(row => builtinRecordVisible(row))];
    return [...new Map(rows.map(row => [row.key, row])).values()].slice(0, 150);
  }

  function requestBuiltinRows(query) {
    const normalized = normalizePlaceQuery(query);
    if (model.snapshot().searchActive === false || builtinQuery === normalized) return;
    builtinQuery = normalized;
    const generation = ++searchGeneration;
    cancelBuiltinSearch();
    builtinRows = [];
    builtinTruncated = false;
    if (!builtinSearch || [...normalized].length < 2) return;
    Promise.resolve().then(() => builtinSearch(normalized)).then(result => {
      if (disposed || generation !== searchGeneration || model.snapshot().searchActive === false || normalizePlaceQuery(model.snapshot().search) !== normalized) return;
      builtinTruncated = result.truncated === true;
      builtinRows = result.records.slice(0, PLACE_LIMITS.searchResults).map(record => {
        const ref = normalizeObjectRef({ domain: 'label', type: record.kind, id: record.id });
        return { ...record, key: ref.key, ref, layerGroup: 'labels', kind: 'object', meta: '내장 지명' };
      });
      commitRows(query, combinedRows(query));
    }).catch(error => {
      if (disposed || generation !== searchGeneration) return;
      builtinQuery = null;
      if (error.cancelled || error.name === 'AbortError') return;
      onSearchError(error);
    });
  }

  function render(force = false) {
    if (disposed) return false;
    const snapshot = model.snapshot();
    const query = String(snapshot.search || '').trim();
    if (!force && renderedRevision === snapshot.revision && renderedSearch === query) return false;
    const results = elements.searchResults;
    if (!results) return false;
    results.replaceChildren();
    results.classList.toggle('hidden', !query);
    renderedSearchRefs = [];
    requestBuiltinRows(query);
    commitRows(query, query ? combinedRows(query) : []);
    renderedRevision = snapshot.revision;
    renderedSearch = query;
    syncSelection();
    return true;
  }

  function syncSelection() {
    const current = selection();
    const keys = new Set((current.items || []).map(item => item.key));
    elements.searchResults?.querySelectorAll('[data-object-key]').forEach(row => {
      const selected = keys.has(row.dataset.objectKey);
      const primary = current.primaryKey === row.dataset.objectKey;
      row.classList.toggle('is-selected', selected);
      row.classList.toggle('is-primary-selected', primary);
      row.setAttribute('aria-selected', String(selected));
    });
  }

  function syncLocks() {
    // Lock state is shown and managed in the editor surface, not in search.
  }

  function beginHydration() {
    commands.beginHydration?.();
  }

  async function completeHydration() {
    if (hydrated) return;
    elements.section?.classList.remove('is-hydrating');
    elements.section?.setAttribute('aria-busy', 'false');
    if (elements.search) elements.search.disabled = false;
    commands.syncSearchClear?.();
    commands.layerTreeRendered?.();
    commands.layerReady?.();
    hydrated = true;
    window.dispatchEvent(new window.CustomEvent('pandolab:layer-ready'));
  }

  function selectResult(target, event) {
    const group = target.dataset.objectSearchSelect;
    const id = target.dataset.itemId;
    if (!group || !id) return;
    const additive = event.ctrlKey || event.metaKey;
    const range = event.shiftKey;
    const didSelect = commands.selectItem({
      group,
      id,
      additive,
      range,
      orderedRefs: range ? renderedSearchRefs : [],
    });
    if (didSelect && !additive && !range) commands.closeAfterSingleSelection?.();
  }

  function focusResult(target) {
    const group = target.dataset.objectSearchFocus;
    const id = target.dataset.itemId;
    if (!group || !id) return;
    commands.selectItem({ group, id, additive: false, range: false, orderedRefs: [] });
    commands.focusItem?.(group, id);
  }

  function bind() {
    const hoverRow = event => event.target.closest('[data-object-search-select]');
    elements.searchResults?.addEventListener('pointerover', event => {
      if (event.pointerType === 'touch') return;
      const row = hoverRow(event);
      if (row && !row.contains(event.relatedTarget)) commands.hoverItem?.(row.dataset.objectSearchSelect, row.dataset.itemId, true);
    });
    elements.searchResults?.addEventListener('pointerout', event => {
      const row = hoverRow(event);
      if (row && !row.contains(event.relatedTarget)) commands.hoverItem?.(row.dataset.objectSearchSelect, row.dataset.itemId, false);
    });
    elements.search?.addEventListener('input', event => {
      searchGeneration += 1;
      builtinQuery = null;
      cancelBuiltinSearch();
      commands.setSearchValue(event.currentTarget.value || '');
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        commands.commitSearch?.();
        render(true);
      }, searchDelay);
    });
    elements.searchClear?.addEventListener('click', () => {
      if (!elements.search) return;
      elements.search.value = '';
      elements.search.dispatchEvent(new window.Event('input', { bubbles: true }));
      elements.search.focus({ preventScroll: true });
    });
    elements.searchResults?.addEventListener('click', event => {
      const focus = event.target.closest('[data-object-search-focus]');
      if (focus) {
        event.preventDefault();
        focusResult(focus);
        return;
      }
      const row = event.target.closest('[data-object-search-select]');
      if (row) selectResult(row, event);
    });
  }

  function cancelSearch() {
    searchGeneration += 1;
    builtinQuery = null;
    builtinRows = [];
    builtinTruncated = false;
    window.clearTimeout(searchTimer);
    cancelBuiltinSearch();
  }

  function dispose() {
    disposed = true;
    searchGeneration += 1;
    cancelBuiltinSearch();
    builtinRows = [];
    renderedSearchRefs = [];
    window.clearTimeout(searchTimer);
  }

  return Object.freeze({ bind, render, syncSelection, syncLocks, beginHydration, completeHydration, cancelSearch, dispose });
}

export function createAppLayerTreeController(runtime = {}) {
  const {
    window, document, getElement: $, state,
    layerSearchGroupKeys, layerTreeItems, layerItemObjectRef, selectionDomain,
    compareItems, syncSearchClearButton, markLayerTreeDirty, selectLayerTreeItem, closeSearchAfterSingleSelection, focusObjectRef, createIcon,
  } = runtime;
  return createLayerTreeController({
    window,
    document,
    elements: {
      search: $('layerSearchInput'),
      searchClear: $('layerSearchClearBtn'),
      searchResults: $('layerSearchResults'),
      section: $('objectSearchSection'),
    },
    groups: { search: layerSearchGroupKeys },
    createEmptyState: runtime.createEmptyState,
    createIcon,
    builtinSearch: runtime.builtinSearch,
    cancelBuiltinSearch: runtime.cancelBuiltinSearch,
    builtinRecordVisible: record => !(state.labels || []).some(label => String(label.sourcePlaceId || '') === String(record.id)),
    onSearchError: runtime.onSearchError,
    model: {
      snapshot: () => ({ revision: state.layerTreeRevision, search: state.layerSearch, searchActive: runtime.isSearchOpen() }),
      items: layerTreeItems,
      itemRef: layerItemObjectRef,
      selectionSnapshot: () => selectionDomain.snapshot(),
      compare: compareItems,
    },
    commands: {
      hoverItem: (group, id, entered) => {
        if (state.tool !== 'select' || state.mapMoving) return;
        const ref = layerItemObjectRef(group, id);
        selectionDomain.setHover(entered ? ref : null, { source: 'list', expectedKey: entered ? '' : ref?.key });
      },
      syncCanonicalControls: runtime.syncCanonicalControls,
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
      setSearchValue: value => {
        state.layerSearch = value;
        syncSearchClearButton($('layerSearchInput'), $('layerSearchClearBtn'));
      },
      commitSearch: markLayerTreeDirty,
      selectItem: ({ group, id, additive, range, orderedRefs }) => {
        const didSelect = selectLayerTreeItem(group, id, {
          mode: additive ? 'toggle' : 'replace',
          range,
          orderedRefs,
        });
        return didSelect;
      },
      focusItem: (group, id) => focusObjectRef?.(layerItemObjectRef(group, id)),
      closeAfterSingleSelection: closeSearchAfterSingleSelection,
    },
  });
}
