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
} = {}) {
  let searchTimer = 0;
  let renderedRevision = -1;
  let renderedSearch = '';
  let hydrated = false;
  let disposed = false;

  const selection = () => model.selectionSnapshot?.().selection || { primaryKey: null, items: [] };

  function searchResultIcon(item) {
    const semanticName = item.layerGroup === 'hydro'
      ? item.typeLabel === '호수' ? 'lake' : 'river'
      : ({
        countries: 'country', subunits: 'subunit', regions: 'region', languages: 'language',
        ethnicities: 'ethnicity', religions: 'religion', labels: 'place', genericFeatures: 'territory',
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
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ui-button layer-search-result ui-selectable-row';
    row.dataset.objectSearchSelect = item.layerGroup;
    row.dataset.itemId = item.id;
    row.dataset.objectKey = item.key;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.classList.toggle('is-selected', selected);
    row.classList.toggle('is-primary-selected', primary);
    const name = document.createElement('strong');
    name.textContent = item.name;
    const visual = searchResultVisual(item);
    if (visual) name.prepend(visual);
    const type = document.createElement('span');
    type.textContent = item.typeLabel;
    row.append(name, type);
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

  function render(force = false) {
    if (disposed) return false;
    const snapshot = model.snapshot();
    const query = String(snapshot.search || '').trim();
    if (!force && renderedRevision === snapshot.revision && renderedSearch === query) return false;
    const results = elements.searchResults;
    if (!results) return false;
    results.replaceChildren();
    results.classList.toggle('hidden', !query);
    if (query) {
      const rows = rowsFor(query);
      if (rows.length) results.append(...rows.map(rowFor));
      else results.append(createEmptyState('검색 결과가 없습니다.', '다른 이름이나 유형으로 검색해 보세요.'));
      commands.syncCanonicalControls?.(results);
    }
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
      orderedRefs: [],
    });
    if (didSelect && !additive && !range) commands.closeAfterSingleSelection?.();
  }

  function bind() {
    elements.search?.addEventListener('input', event => {
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
      const row = event.target.closest('[data-object-search-select]');
      if (row) selectResult(row, event);
    });
  }

  function dispose() {
    disposed = true;
    window.clearTimeout(searchTimer);
  }

  return Object.freeze({ bind, render, syncSelection, syncLocks, beginHydration, completeHydration, dispose });
}

export function createAppLayerTreeController(runtime = {}) {
  const {
    window, document, getElement: $, state,
    layerSearchGroupKeys, layerTreeItems, layerItemObjectRef, selectionDomain,
    compareItems, syncSearchClearButton, markLayerTreeDirty, selectLayerTreeItem, closeSearchAfterSingleSelection, createIcon,
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
    model: {
      snapshot: () => ({ revision: state.layerTreeRevision, search: state.layerSearch }),
      items: layerTreeItems,
      itemRef: layerItemObjectRef,
      selectionSnapshot: () => selectionDomain.snapshot(),
      compare: compareItems,
    },
    commands: {
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
      closeAfterSingleSelection: closeSearchAfterSingleSelection,
    },
  });
}
