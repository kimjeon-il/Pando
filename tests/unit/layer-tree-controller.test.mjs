import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import vm from 'node:vm';
import { createNavigationBindings } from '../../assets/js/modules/app-navigation-bindings.js';
import { createPlaceRuntime } from '../../assets/js/modules/place-runtime.js';
import { createSurfaceController } from '../../assets/js/modules/surface-controller.js';
import { createGlobalInputBindings } from '../../assets/js/modules/app-global-input-bindings.js';
import { createLayerTreeController, createAppLayerTreeController } from '../../assets/js/modules/layer-tree-controller.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { createSelectionUiController } from '../../assets/js/modules/selection-ui-controller.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { normalizePlace } from '../../assets/js/modules/place-contract.js';

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    children: [], dataset: {}, attributes: {}, listeners,
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    querySelectorAll() { return this.children.filter(node => node.dataset.objectKey); },
    closest(selector) {
      return selector === '[data-object-search-select]' && this.dataset.objectSearchSelect ? this : null;
    },
  };
}

function setup({ builtinSearch, cancelBuiltinSearch, builtinRecordVisible } = {}) {
  const rows = {
    countries: [{ id: 'D', name: 'D 항목' }, { id: 'C', name: 'C 항목 묶음' }],
    labels: [{ id: 'B', name: 'B 항목' }],
    genericFeatures: [{ id: 'A', name: 'A 항목 묶음' }],
  };
  const itemRef = (group, id) => normalizeObjectRef({
    domain: group === 'countries' ? 'territorial' : group === 'labels' ? 'label' : 'generic',
    type: group === 'countries' ? 'entity' : group === 'labels' ? 'label' : 'feature', id,
  });
  const selectionDomain = createSelectionDomain();
  const ui = createSelectionUiController({ selectionDomain, resolveRef: normalizeObjectRef });
  const results = element();
  const snapshot = { revision: 1, search: '항목' };
  const controller = createLayerTreeController({
    window: { setTimeout, clearTimeout }, builtinSearch, cancelBuiltinSearch, builtinRecordVisible,
    document: { createElement: element }, elements: { searchResults: results },
    groups: { search: Object.keys(rows) },
    model: {
      snapshot: () => snapshot, items: group => rows[group], itemRef,
      compare: (a, b) => a.name.localeCompare(b.name), selectionSnapshot: selectionDomain.snapshot,
    },
    createEmptyState: element,
    commands: { clearSearchHover: () => selectionDomain.setHover(null, { source: 'list' }), selectItem: ({ group, id, range, additive, orderedRefs }) => ui.applyIntent(itemRef(group, id), {
      mode: range ? 'range' : additive ? 'toggle' : 'replace', orderedRefs, scope: 'layer-list',
    }) },
  });
  controller.bind();
  controller.render();
  const click = (id, shiftKey = false) => {
    const row = results.children.find(node => node.children[0]?.dataset.itemId === id);
    assert.ok(row, `Rendered row ${id} must exist`);
    results.listeners.get('click')({ target: row.children[0], shiftKey, ctrlKey: false, metaKey: false });
  };
  return { controller, selectionDomain, results, snapshot, click };
}

test('search Shift range follows displayed sorting across object groups and sets clicked primary', () => {
  const { results, click, selectionDomain } = setup();
  assert.deepEqual(results.children.map(row => row.children[0].dataset.itemId), ['A', 'B', 'C', 'D']);
  click('A');
  click('C', true);
  assert.deepEqual(selectionDomain.snapshot().selection.items.map(ref => ref.id), ['A', 'B', 'C']);
  assert.equal(selectionDomain.primary().id, 'C');
  assert.equal(selectionDomain.snapshot().selection.items.some(ref => ref.id === 'D'), false);
});

test('search rerender replaces the range order with the newly visible results', () => {
  const { controller, results, snapshot, click, selectionDomain } = setup();
  click('A');
  snapshot.search = '묶음';
  snapshot.revision += 1;
  controller.render();
  assert.deepEqual(results.children.map(row => row.children[0].dataset.itemId), ['A', 'C']);
  click('C', true);
  assert.deepEqual(selectionDomain.snapshot().selection.items.map(ref => ref.id), ['A', 'C']);
  assert.equal(selectionDomain.primary().id, 'C');
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const builtin=id=>normalizePlace({source:'synthetic',sourceId:id,name:'서울',kind:'capital',coordinates:[127,37]});
test('late builtin results cannot replace a newer query or a cleared search', async () => {
  const jobs=[];
  const {controller,results,snapshot}=setup({builtinSearch:query=>new Promise(resolve=>jobs.push({query,resolve}))});
  await tick();snapshot.search='서울';controller.render(true);await tick();
  jobs[1].resolve({records:[builtin('new')]});await tick();
  jobs[0].resolve({records:[builtin('old')]});await tick();
  assert.deepEqual(results.children.map(row=>row.children[0]?.dataset.itemId),['builtin:place:synthetic:new']);
  snapshot.search='다른';controller.render(true);await tick();
  snapshot.search='';controller.render(true);jobs[2].resolve({records:[builtin('cleared')]});await tick();
  assert.equal(results.children.length,0);
});
test('cancelled search can retry the same prefix after interaction settles', async () => {
  let calls=0;
  const {controller,results}=setup({builtinSearch:async()=>{
    if(calls++===0) throw Object.assign(new Error('moving'),{name:'AbortError',cancelled:true});
    return {records:[builtin('settled')]};
  }});
  await tick();controller.render(true);await tick();
  assert.equal(calls,2);
  assert.ok(results.children.some(row=>row.children[0]?.dataset.itemId==='builtin:place:synthetic:settled'));
});
test('closing search cancels its result lifetime and opening resumes the same prefix', async () => {
  const jobs=[];
  const {controller,snapshot,results}=setup({builtinSearch:()=>new Promise(resolve=>jobs.push(resolve))});
  await tick();snapshot.searchActive=false;controller.cancelSearch();controller.render(true);
  jobs[0]({records:[builtin('closed')]});await tick();
  assert.equal(jobs.length,1);
  assert.ok(!results.children.some(row=>row.children[0]?.dataset.itemId==='builtin:place:synthetic:closed'));
  snapshot.searchActive=true;controller.render(true);await tick();jobs[1]({records:[builtin('opened')]});await tick();
  assert.ok(results.children.some(row=>row.children[0]?.dataset.itemId==='builtin:place:synthetic:opened'));
  controller.dispose();
});

test('editable copies suppress their builtin source in current search rows without another Worker query', async () => {
  let copied = false;
  let calls = 0;
  const { controller, results, snapshot } = setup({
    builtinSearch: async query => {
      calls += 1;
      return query === '서울' ? { records: [builtin('copied-source')] } : { records: [] };
    },
    builtinRecordVisible: record => !(copied && record.sourceId === 'copied-source'),
  });
  await tick();
  snapshot.search = '서울';
  snapshot.revision += 1;
  controller.render(true);
  await tick();
  assert.ok(results.children.some(row => row.children[0]?.dataset.itemId === 'builtin:place:synthetic:copied-source'));
  const callsAfterLoad = calls;
  copied = true;
  snapshot.revision += 1;
  controller.render();
  assert.equal(calls, callsAfterLoad);
  assert.ok(!results.children.some(row => row.children[0]?.dataset.itemId === 'builtin:place:synthetic:copied-source'));
});


// Use the real app adapter and canonical selection owners. Closing without a
// pointerout is the boundary reproduced by the CI's retained list hover.
function hoverLifecycle() {
  const nodes = new Map(['layerSearchInput', 'layerSearchClearBtn', 'layerSearchResults', 'objectSearchSection'].map(id => [id, element()]));
  const domain = createSelectionDomain();
  const ui = createSelectionUiController({ selectionDomain: domain, resolveRef: normalizeObjectRef });
  const ref = normalizeObjectRef({ domain: 'hydro', type: 'river', id: '00000000-0000-4000-8000-000000000005' });
  const state = { tool: 'select', mapMoving: false, layerSearch: '검증', layerTreeRevision: 1, labels: [] };
  let controller, wiring;
  const document = { createElement: element };
  const window = { setTimeout, clearTimeout, CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent() {} };
  const surfaces = createSurfaceController({ getElement: id => nodes.get(id), getLayout: () => 'wide', document });
  surfaces.open('search');
  const places = createPlaceRuntime({ rpc: { request: async () => ({ result: { records: [], signature: 'test' } }), stop() {} },
    onSettled: () => { controller.cancelSearch(); controller.render(true); } });
  const close = () => { surfaces.close('search'); controller.cancelSearch(); };
  const domains = { selectionDomain: domain };
  // Execute the real bindLayerUI composition: its query predicate combines the
  // actual surface owner and actual place-runtime moving state.
  const navigation = vm.runInNewContext(`(${createNavigationBindings.toString()})()`, { window, document });
  navigation.connect({
    uiRegistryCommands: { installLayerTreeController: value => { controller = value; domains.layerTreeController = value; } },
    uiFactoriesA: { createAppLayerTreeController: runtime => { wiring = runtime; return createAppLayerTreeController(runtime); } },
    platform: { $: id => nodes.get(id) }, projectState: { state },
    objectModelA: { LAYER_SEARCH_GROUP_KEYS: ['hydro'], layerNameCollator: { compare: (a, b) => String(a).localeCompare(String(b)) } },
    layerPresentation: { layerGroupNames: {} }, applicationFactories: { createSemanticIcon: () => null },
    platformConfigurationB: { createEmptyState: element, syncSearchClearButton() {} },
    layerTree: { layerTreeItems: () => [{ id: ref.id, name: '검증 강', typeLabel: '강' }] },
    objectLookup: { layerItemObjectRef: () => ref }, selectionServices: { normalizeObjectRef }, domains,
    hydroPresentation: { hydroCategoryKey: () => 'river' }, workspaceUiB: { surfaceController: surfaces },
    labelPresentation: { builtinPlaces: places }, feedback: { reportOperationError: error => { throw error; } },
    readinessUi: { syncCanonicalControls() {} }, layers: { markLayerTreeDirty() { state.layerTreeRevision++; } },
    navigation: { selectLayerTreeItem() { ui.applyIntent(ref, { mode: 'replace', scope: 'layer-list' }); return true; } },
    objectOperationsA: { focusObjectRef() {} }, workspaceUiA: { closeSurface: kind => { assert.equal(kind, 'search'); close(); } },
  });
  navigation.bindLayerUI(); controller.render();
  const dispatch = (type, extra = {}) => {
    const row = nodes.get('layerSearchResults').children[0].children[0];
    row.contains = target => target === row;
    nodes.get('layerSearchResults').listeners.get(type)({ target: row, relatedTarget: null, pointerType: 'mouse',
      ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
  };
  return { domain, ui, ref, state, controller, nodes, close, dispatch, surfaces, places, wiring,
    isOpen: () => surfaces.isOpen('search'), dispose: () => { controller.dispose(); places.dispose(); } };
}

function escapeThroughApp(fixture) {
  const listeners = new Map();
  const hidden = { classList: { contains: name => name === 'hidden' }, addEventListener() {} };
  const context = {
    document: { addEventListener: (type, fn) => listeners.set(type, fn), activeElement: { tagName: 'INPUT' },
      querySelectorAll: () => [], body: { classList: { contains: () => false } } },
    window: { addEventListener() {} },
    installReferenceImageEditingBridge() {}, handleReferenceImageKey: () => false, cancelReferenceImageInput() {},
  };
  const input = vm.runInNewContext(`(${createGlobalInputBindings.toString()})()`, context);
  input.connect({
    projectState: { state: fixture.state }, platform: { $: () => hidden },
    domains: { editingDomain: {} }, domainControllers: { closeTerritorialEditorTransient: () => false },
    libraryUi: { territorialLibraryController: { isOpen: () => false } },
    projectRestore: { confirmModalController: { isOpen: () => false } },
    workspaceUiB: { surfaceController: { isOpen: kind => kind === 'search' && fixture.isOpen() } },
    workspaceUiA: { closeSurface: kind => { assert.equal(kind, 'search'); fixture.close(); } },
    platformConfigurationB: { systemThemeQuery: { addEventListener() {} } },
  });
  input.bindGlobalInputUI();
  listeners.get('keydown')({ key: 'Escape', code: 'Escape', preventDefault() {} });
}

test('single result selection closes search and releases list hover without needing pointerout', () => {
  const f = hoverLifecycle(); f.dispatch('pointerover');
  assert.equal(f.domain.snapshot().hover.key, f.ref.key);
  f.dispatch('click');
  assert.equal(f.isOpen(), false); assert.equal(f.domain.primary().key, f.ref.key);
  assert.equal(f.domain.snapshot().hover, null);
  f.ui.clear({ reason: 'escape-selection-clear' }); f.domain.setHover(null, { source: 'map' });
  assert.equal(f.domain.primary(), null); assert.equal(f.domain.snapshot().hover, null);
  f.dispose();
});
test('explicit close and the real app Escape handler release only inactive search hover', () => {
  for (const close of [f => f.close(), escapeThroughApp]) {
    const f = hoverLifecycle(); f.dispatch('pointerover'); close(f);
    assert.equal(f.isOpen(), false); assert.equal(f.domain.snapshot().hover, null); f.dispose();
  }
});
test('cancelling or refreshing still-open search retains its valid row hover and selection', () => {
  const f = hoverLifecycle(); f.dispatch('pointerover'); f.domain.replace(f.ref);
  f.controller.cancelSearch();
  assert.equal(f.domain.snapshot().hover.key, f.ref.key); assert.equal(f.domain.primary().key, f.ref.key);
  const input = f.nodes.get('layerSearchInput'); input.value = '검증 강';
  input.listeners.get('input')({ currentTarget: input }); f.controller.render(true);
  assert.equal(f.isOpen(), true); assert.equal(f.domain.snapshot().hover.key, f.ref.key);
  assert.equal(f.domain.primary().key, f.ref.key); f.dispose();
});
test('inactive list cleanup preserves a newer map or other named hover owner', () => {
  for (const source of ['map', 'other-view']) for (const sameKey of [false, true]) {
    const f = hoverLifecycle(); f.dispatch('pointerover');
    const newer = sameKey ? f.ref : normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'DEU' });
    f.domain.setHover(newer, { source }); const before = f.domain.stats().selectionHoverRevision;
    f.close(); assert.equal(f.domain.snapshot().hover.key, newer.key);
    assert.equal(f.domain.stats().selectionHoverRevision, before); f.dispose();
  }
});
test('a late leave for an old row cannot erase the newer list key, but closing its owner can', () => {
  const f = hoverLifecycle(); f.dispatch('pointerover');
  const newer = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'DEU' });
  f.domain.setHover(newer, { source: 'list' }); f.dispatch('pointerout');
  assert.equal(f.domain.snapshot().hover.key, newer.key); f.controller.cancelSearch();
  assert.equal(f.domain.snapshot().hover.key, newer.key); f.close(); assert.equal(f.domain.snapshot().hover, null);
  f.dispose();
});
test('inactive cleanup is idempotent and is not suppressed by map movement', () => {
  const f = hoverLifecycle(); f.dispatch('pointerover'); f.state.mapMoving = true; f.close();
  assert.equal(f.domain.snapshot().hover, null); const revision = f.domain.stats().selectionHoverRevision;
  f.controller.cancelSearch(); assert.equal(f.domain.stats().selectionHoverRevision, revision); f.dispose();
});


test('real navigation/place composition preserves open search hover while moving blocks requests', async () => {
  const f = hoverLifecycle(); f.dispatch('pointerover');
  assert.equal(f.isOpen(), true); assert.equal(f.wiring.isSearchOpen(), true);
  f.places.beginInteraction(); // Same ordering as beginPlaceInteraction in the app domain assembly.
  assert.equal(f.places.stats().moving, true); assert.equal(f.isOpen(), true);
  assert.equal(f.wiring.isSearchSurfaceOpen(), true);
  assert.equal(f.wiring.isSearchOpen(), false);
  f.controller.cancelSearch();
  assert.equal(f.domain.snapshot().hover?.key, f.ref.key, 'request suspension is not surface closure');
  await f.places.settle();
  assert.equal(f.wiring.isSearchOpen(), true); assert.equal(f.domain.snapshot().hover.key, f.ref.key);
  f.places.beginInteraction(); f.controller.cancelSearch(); f.close();
  assert.equal(f.isOpen(), false); assert.equal(f.wiring.isSearchSurfaceOpen(), false);
  assert.equal(f.domain.snapshot().hover, null); f.dispose();
});

test('request inactivity without an explicit closed surface never triggers hover cleanup', () => {
  const { controller, selectionDomain, snapshot } = setup();
  const ref = normalizeObjectRef({ domain: 'generic', type: 'feature', id: 'A' });
  selectionDomain.setHover(ref, { source: 'list' }); snapshot.searchActive = false;
  controller.cancelSearch(); assert.equal(selectionDomain.snapshot().hover.key, ref.key);
  snapshot.searchSurfaceOpen = false; controller.cancelSearch();
  assert.equal(selectionDomain.snapshot().hover, null); controller.dispose();
});
test('a late cancellation after reopening cannot clear the current visible list hover', () => {
  const f = hoverLifecycle(); f.dispatch('pointerover'); f.close();
  f.surfaces.open('search'); f.domain.setHover(f.ref, { source: 'list' });
  f.places.beginInteraction(); f.controller.cancelSearch();
  assert.equal(f.wiring.isSearchSurfaceOpen(), true); assert.equal(f.wiring.isSearchOpen(), false);
  assert.equal(f.domain.snapshot().hover.key, f.ref.key); f.dispose();
});
