import { normalizeObjectRef } from './object-selection-controller.js';
import { normalizePlaceQuery, PLACE_LIMITS } from './place-contract.js';
import { createObjectSearchModel, visibleObjectSearchRows } from './object-search-model.js';
import { resourceKey, resourceUpdate } from './resource-update-policy.js';

/**
 * Object search is deliberately flat. The project still owns object grouping and
 * visibility, but the map no longer exposes that structure as a persistent tree.
 */
export function createObjectSearchController({
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
  let renderedDependencies = null;
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
        objects: 'territory', distributions: 'distribution',
        labels: 'place', genericFeatures: 'territory',
      })[item.layerGroup] || 'map';
    return createIcon?.(semanticName, 'ui-icon object-search-result-icon') || null;
  }

  function searchResultVisual(item) {
    if (!item.flagUrl) return searchResultIcon(item);
    const flag = document.createElement('img');
    flag.className = 'object-search-result-flag';
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
    row.className = 'object-search-result ui-selectable-row';
    row.dataset.objectKey = item.key;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.classList.toggle('is-selected', selected);
    row.classList.toggle('is-primary-selected', primary);

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'ui-button object-search-result-select';
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
    focus.className = 'ui-button icon-btn object-search-focus-action';
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
    const presentation = createObjectSearchModel({
      items: model.items,
      groups: groups.search,
      itemRef: model.itemRef,
      compare: model.compare,
    });
    return visibleObjectSearchRows(presentation, query);
  }

  function commitRows(query, rows) {
    const next = { source: 'object-search', content: resourceKey(rows.map(item =>
      [item.key, item.id, item.layerGroup, item.name || '', item.typeLabel || '', item.flagUrl || ''])),
      preparation: 'search-rows-v1', context: null, presentation: resourceKey([query, builtinTruncated]) };
    if (!resourceUpdate(renderedDependencies, next).present) { syncSelection(); return false; }
    const results = elements.searchResults;
    results.replaceChildren();
    renderedSearchRefs = rows.map(item => item.ref).filter(Boolean);
    if (query && rows.length) { results.append(...rows.map(rowFor)); if (builtinTruncated) results.append(createEmptyState('검색 결과를 일부 표시했습니다.', '이름의 앞부분을 더 입력해 범위를 좁히세요.')); }
    else if (query) results.append(createEmptyState('검색 결과가 없습니다.', '내장 지명은 두 글자 이상으로 이름의 앞부분을 검색하세요.'));
    commands.syncCanonicalControls?.(results);
    syncSelection();
    renderedDependencies = next;
    return true;
  }

  function combinedRows(query) {
    const rows = [...rowsFor(query).slice(0, 100), ...builtinRows.filter(row => builtinRecordVisible(row))];
    return [...new Map(rows.map(row => [row.key, row])).values()].slice(0, 150);
  }

  function requestBuiltinRows(query) {
    const normalized = normalizePlaceQuery(query);
    const next = { source: 'builtin-search', content: resourceKey([normalized, model.snapshot().builtinContext ?? null]),
      preparation: 'search-v1', context: null, presentation: 'results' };
    if (model.snapshot().searchActive === false || !resourceUpdate(builtinQuery, next).prepare) return;
    builtinQuery = next;
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

  function render() {
    if (disposed) return false;
    const snapshot = model.snapshot();
    const query = String(snapshot.search || '').trim();
    const results = elements.searchResults;
    if (!results) return false;
    results.classList.toggle('hidden', !query);
    requestBuiltinRows(query);
    return commitRows(query, query ? combinedRows(query) : []);
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
    commands.objectSearchRendered?.();
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
        render();
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
    // Surface closure may detach the hovered row before pointerout is delivered.
    // Request cancellation while search is open must retain its current preview.
    if (model.snapshot().searchSurfaceOpen === false) commands.clearSearchHover();
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

const searchNameCollator=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});
const compareSearchItems=(left,right)=>searchNameCollator.compare(left.name,right.name)||searchNameCollator.compare(left.id,right.id);
export function syncSearchClearButton(input,button) {
  button?.classList.toggle('hidden',!String(input?.value||'').length);
}

export function createAppObjectSearchController(runtime = {}) {
  const {
    window, document, getElement: $, state,
    objectSearchGroupKeys, listObjectSearchItems, layerItemObjectRef, selectionDomain,
    invalidateObjectPresentation, selectObjectSearchItem, closeSearchAfterSingleSelection, focusObjectRef, createIcon,
  } = runtime;
  const handleHoverError=error=>{if(!error.cancelled&&error.name!=='AbortError')runtime.onSearchError(error);};
  return createObjectSearchController({
    window,
    document,
    elements: {
      search: $('objectSearchInput'),
      searchClear: $('objectSearchClearBtn'),
      searchResults: $('objectSearchResults'),
      section: $('objectSearchSection'),
    },
    groups: { search: objectSearchGroupKeys },
    createEmptyState: runtime.createEmptyState,
    createIcon,
    builtinSearch: runtime.builtinSearch ? async query => {
      if(state.resourceCapabilities?.builtinPlaces===false||state.layerVisibility?.labels===false)return {records:[],truncated:false};
      const result=await runtime.builtinSearch(query);
      return {...result,records:result.records.map(record=>{
        const name=result.displayNames?.[record.id];
        if(typeof name!=='string'||!name)throw new TypeError('Place search requires its accepted period display name.');
        return {...record,name};
      })};
    } : null,
    cancelBuiltinSearch: runtime.cancelBuiltinSearch,
    builtinRecordVisible: record => state.resourceCapabilities?.builtinPlaces!==false&&state.layerVisibility?.labels!==false&&state.itemVisibility?.labels?.[record.id]!==false&&!(state.labels || []).some(label => String(label.sourcePlaceId || '') === String(record.id)),
    onSearchError: runtime.onSearchError,
    model: {
      snapshot: () => ({ builtinContext:JSON.stringify([state.timelineCursor,state.layerVisibility?.labels,state.itemVisibility?.labels]),search: state.objectSearch, searchActive: runtime.isSearchOpen(),
        searchSurfaceOpen: runtime.isSearchSurfaceOpen() }),
      items: listObjectSearchItems,
      itemRef: layerItemObjectRef,
      selectionSnapshot: () => selectionDomain.snapshot(),
      compare: compareSearchItems,
    },
    commands: {
      clearSearchHover: () => selectionDomain.setHover(null, { source: 'list' }).catch(handleHoverError),
      hoverItem: (group, id, entered) => {
        if (state.tool !== 'select' || state.mapMoving) return;
        const ref = layerItemObjectRef(group, id);
        return selectionDomain.setHover(entered ? ref : null, { source: 'list', expectedKey: entered ? '' : ref?.key }).catch(handleHoverError);
      },
      syncCanonicalControls: runtime.syncCanonicalControls,
      syncSearchClear: () => syncSearchClearButton($('objectSearchInput'), $('objectSearchClearBtn')),
      beginHydration: () => {
        const metrics = window.__PANDOLAB_STARTUP_METRICS__;
        if (metrics && metrics.layerHydrationStartedMs == null) metrics.layerHydrationStartedMs = performance.now() - metrics.startedAt;
      },
      objectSearchRendered: () => {
        const metrics = window.__PANDOLAB_STARTUP_METRICS__;
        if (metrics) metrics.objectSearchRenderedMs = performance.now() - metrics.startedAt;
      },
      layerReady: () => {
        const metrics = window.__PANDOLAB_STARTUP_METRICS__;
        if (metrics) metrics.layerReadyMs = performance.now() - metrics.startedAt;
      },
      setSearchValue: value => {
        state.objectSearch = value;
        syncSearchClearButton($('objectSearchInput'), $('objectSearchClearBtn'));
      },
      commitSearch: invalidateObjectPresentation,
      selectItem: ({ group, id, additive, range, orderedRefs }) => {
        const didSelect = selectObjectSearchItem(group, id, {
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
