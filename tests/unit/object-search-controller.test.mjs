import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import vm from 'node:vm';
import { createNavigationBindings } from "../../shared/frontend/js/modules/navigation-bindings.js";
import { createPlaceRuntime } from "../../shared/frontend/js/modules/place-runtime.js";
import { createSurfaceController } from "../../shared/frontend/js/modules/surface-controller.js";
import { createObjectSearchController, createAppObjectSearchController } from "../../shared/frontend/js/modules/object-search-controller.js";
import { createSelectionUiController } from "../../shared/frontend/js/modules/selection-ui-controller.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { normalizePlace } from "../../shared/frontend/js/modules/place-contract.js";
import { createNodeSelection } from '../helpers/core-selection.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));

function trackSelection(domain) {
  const pending = [];
  const tracked = { ...domain };
  for (const method of ['replace', 'toggle', 'selectRange', 'setMany', 'clear', 'setHover']) {
    tracked[method] = (...args) => {
      const operation = domain[method](...args);
      pending.push(operation.then(() => null, error => error));
      return operation;
    };
  }
  return { domain: tracked, async settle() {
    while (pending.length) {
      const errors = await Promise.all(pending.splice(0));
      const failure = errors.find(error => error);
      if (failure) throw failure;
    }
  } };
}

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

async function setup(t, { builtinSearch, cancelBuiltinSearch, builtinRecordVisible } = {}) {
  const rows = {
    objects: [{ id: 'D', name: 'D 항목' }, { id: 'C', name: 'C 항목 묶음' }],
    labels: [{ id: 'B', name: 'B 항목' }],
    genericFeatures: [{ id: 'A', name: 'A 항목 묶음' }],
  };
  const itemRef = (group, id) => normalizeObjectRef({
    domain: group === 'objects' ? 'territorial' : group === 'labels' ? 'label' : 'generic',
    type: group === 'objects' ? 'entity' : group === 'labels' ? 'label' : 'feature', id,
  });
  const owner = await createNodeSelection();
  const tracked = trackSelection(owner.domain);
  t.after(async () => { try { await tracked.settle(); } finally { owner.dispose(); } });
  const selectionDomain = tracked.domain;
  const ui = createSelectionUiController({ selectionDomain, resolveRef: normalizeObjectRef });
  const results = element();
  const snapshot = { revision: 1, search: '항목' };
  const controller = createObjectSearchController({
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
  const click = async (id, shiftKey = false) => {
    const row = results.children.find(node => node.children[0]?.dataset.itemId === id);
    assert.ok(row, `Rendered row ${id} must exist`);
    results.listeners.get('click')({ target: row.children[0], shiftKey, ctrlKey: false, metaKey: false });
    await tracked.settle();
  };
  return { controller, selectionDomain, results, snapshot, click, settle: tracked.settle };
}

test('search Shift range follows displayed sorting across object groups and sets clicked primary', async t => {
  const { results, click, selectionDomain } = await setup(t);
  assert.deepEqual(results.children.map(row => row.children[0].dataset.itemId), ['A', 'B', 'C', 'D']);
  await click('A');
  await click('C', true);
  assert.deepEqual(selectionDomain.snapshot().selection.items.map(ref => ref.id), ['A', 'B', 'C']);
  assert.equal(selectionDomain.primary().id, 'C');
  assert.equal(selectionDomain.snapshot().selection.items.some(ref => ref.id === 'D'), false);
});

test('search rerender replaces the range order with the newly visible results', async t => {
  const { controller, results, snapshot, click, selectionDomain } = await setup(t);
  await click('A');
  snapshot.search = '묶음';
  snapshot.revision += 1;
  controller.render();
  assert.deepEqual(results.children.map(row => row.children[0].dataset.itemId), ['A', 'C']);
  await click('C', true);
  assert.deepEqual(selectionDomain.snapshot().selection.items.map(ref => ref.id), ['A', 'C']);
  assert.equal(selectionDomain.primary().id, 'C');
});

test('an unrelated global revision retains the same search rows and flag image allocations', async t => {
  const { controller, results, snapshot } = await setup(t);
  const before = [...results.children];
  snapshot.revision++;
  assert.equal(controller.render(), false);
  assert.deepEqual(results.children, before);
  before.forEach((row,index)=>assert.strictEqual(results.children[index],row));
});

const builtin=id=>normalizePlace({source:'synthetic',sourceId:id,name:'서울',kind:'capital',coordinates:[127,37]});
test('late builtin results cannot replace a newer query or a cleared search', async t => {
  const jobs=[];
  const {controller,results,snapshot}=await setup(t,{builtinSearch:query=>new Promise(resolve=>jobs.push({query,resolve}))});
  await tick();snapshot.search='서울';controller.render();await tick();
  jobs[1].resolve({records:[builtin('new')]});await tick();
  jobs[0].resolve({records:[builtin('old')]});await tick();
  assert.deepEqual(results.children.map(row=>row.children[0]?.dataset.itemId),['builtin:place:synthetic:new']);
  snapshot.search='다른';controller.render();await tick();
  snapshot.search='';controller.render();jobs[2].resolve({records:[builtin('cleared')]});await tick();
  assert.equal(results.children.length,0);
});
test('cancelled search can retry the same prefix after interaction settles', async t => {
  let calls=0;
  const {controller,results}=await setup(t,{builtinSearch:async()=>{
    if(calls++===0) throw Object.assign(new Error('moving'),{name:'AbortError',cancelled:true});
    return {records:[builtin('settled')]};
  }});
  await tick();controller.render();await tick();
  assert.equal(calls,2);
  assert.ok(results.children.some(row=>row.children[0]?.dataset.itemId==='builtin:place:synthetic:settled'));
});
test('closing search cancels its result lifetime and opening resumes the same prefix', async t => {
  const jobs=[];
  const {controller,snapshot,results}=await setup(t,{builtinSearch:()=>new Promise(resolve=>jobs.push(resolve))});
  await tick();snapshot.searchActive=false;controller.cancelSearch();controller.render();
  jobs[0]({records:[builtin('closed')]});await tick();
  assert.equal(jobs.length,1);
  assert.ok(!results.children.some(row=>row.children[0]?.dataset.itemId==='builtin:place:synthetic:closed'));
  snapshot.searchActive=true;controller.render();await tick();jobs[1]({records:[builtin('opened')]});await tick();
  assert.ok(results.children.some(row=>row.children[0]?.dataset.itemId==='builtin:place:synthetic:opened'));
  controller.dispose();
});

test('editable copies suppress their builtin source in current search rows without another Worker query', async t => {
  let copied = false;
  let calls = 0;
  const { controller, results, snapshot } = await setup(t,{
    builtinSearch: async query => {
      calls += 1;
      return query === '서울' ? { records: [builtin('copied-source')] } : { records: [] };
    },
    builtinRecordVisible: record => !(copied && record.sourceId === 'copied-source'),
  });
  await tick();
  snapshot.search = '서울';
  snapshot.revision += 1;
  controller.render();
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
async function hoverLifecycle(t) {
  const nodes = new Map(['objectSearchInput', 'objectSearchClearBtn', 'objectSearchResults', 'objectSearchSection'].map(id => [id, element()]));
  const owner = await createNodeSelection();
  const tracked = trackSelection(owner.domain);
  t.after(async () => { try { await tracked.settle(); } finally { owner.dispose(); } });
  const domain = tracked.domain;
  const ui = createSelectionUiController({ selectionDomain: domain, resolveRef: normalizeObjectRef });
  const ref = normalizeObjectRef({ domain: 'hydro', type: 'river', id: 'builtin-hydro' });
  const state = { tool: 'select', mapMoving: false, objectSearch: '검증', objectPresentationRevision: 1, labels: [] };
  let controller, wiring;
  const document = { createElement: element };
  const window = { setTimeout, clearTimeout, CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent() {} };
  const surfaces = createSurfaceController({ getElement: id => nodes.get(id), getLayout: () => 'wide', document });
  surfaces.open('search');
  const places = createPlaceRuntime({ admitReferences:async ()=>{}, rpc: { request: async () => ({ result: { records: [], signature: 'test' } }), stop() {} },
    onSettled: () => { controller.cancelSearch(); controller.render(); } });
  const close = () => { surfaces.close('search'); controller.cancelSearch(); };
  const domains = { selectionDomain: domain };
  // Execute the real bindLayerUI composition: its query predicate combines the
  // actual surface owner and actual place-runtime moving state.
  const navigation = vm.runInNewContext(`(${createNavigationBindings.toString()})()`, { window, document });
  navigation.connect({
    uiRegistryCommands: { installObjectSearchController: value => { controller = value; domains.objectSearchController = value; } },
    uiFactoriesA: { createAppObjectSearchController: runtime => { wiring = runtime; return createAppObjectSearchController(runtime); } },
    platform: { $: id => nodes.get(id) }, projectState: { state },
    objectModelA: { LAYER_SEARCH_GROUP_KEYS: ['hydro'], layerNameCollator: { compare: (a, b) => String(a).localeCompare(String(b)) } },
    layerPresentation: { layerGroupNames: {} }, applicationFactories: { createSemanticIcon: () => null },
    platformConfigurationB: { createEmptyState: element, syncSearchClearButton() {} },
    objectCatalogView: { listObjectSearchItems: () => [{ id: ref.id, name: '검증 강', typeLabel: '강' }] },
    objectLookup: { layerItemObjectRef: () => ref }, selectionServices: { normalizeObjectRef }, domains,
    hydroPresentation: { hydroCategoryKey: () => 'river' }, workspaceUiB: { surfaceController: surfaces },
    labelPresentation: { builtinPlaces: places }, feedback: { reportOperationError: error => { throw error; } },
    readinessUi: { syncCanonicalControls() {} }, objectDisplay: { invalidateObjectPresentation() { state.objectPresentationRevision++; } },
    navigation: { selectObjectSearchItem() { ui.applyIntent(ref, { mode: 'replace', scope: 'layer-list' }); return true; } },
    objectOperationsA: { focusObjectRef() {} }, workspaceUiA: { closeSurface: kind => { assert.equal(kind, 'search'); close(); } },
  });
  navigation.bindLayerUI(); controller.render();
  const dispatch = async (type, extra = {}) => {
    const row = nodes.get('objectSearchResults').children[0].children[0];
    row.contains = target => target === row;
    nodes.get('objectSearchResults').listeners.get(type)({ target: row, relatedTarget: null, pointerType: 'mouse',
      ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
    await tracked.settle();
  };
  return { domain, ui, ref, state, controller, nodes, close, dispatch, surfaces, places, wiring,
    settle: tracked.settle,
    isOpen: () => surfaces.isOpen('search'), dispose: () => { controller.dispose(); places.dispose(); } };
}

function escapeThroughApp(fixture) {
  const listeners=new Map(),hidden={hidden:true,classList:{contains:name=>name==='hidden'},addEventListener(){},querySelector(){return null;}};
  const document={addEventListener:(type,listener)=>listeners.set(type,listener),querySelector:()=>null,activeElement:{tagName:'INPUT'},body:{classList:{contains:()=>false}}};
  const owner=vm.runInNewContext(`(${createNavigationBindings.toString()})({productMode:'viewer'})`,{document,isMobileWorkspaceLayout:()=>false});
  const workspace={MOBILE_SHEET_IDS:{},surfaceController:fixture.surfaces,closeSurface:kind=>{assert.equal(kind,'search');fixture.close();}};
  owner.connect({platform:{$:()=>hidden},readinessUi:{clearNotification(){}},mapSettingsUi:{bindMapDisplayUI(){}},workspaceUiA:workspace,workspaceUiB:workspace,surfaces:{layoutMode:'wide'},projectState:{state:fixture.state}});
  owner.bindNavigationUI();listeners.get('keydown')({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
}

test('single result selection closes search and releases list hover without needing pointerout', async t => {
  const f = await hoverLifecycle(t); await f.dispatch('pointerover');
  assert.equal(f.domain.snapshot().hover.key, f.ref.key);
  await f.dispatch('click');
  assert.equal(f.isOpen(), false); assert.equal(f.domain.primary().key, f.ref.key);
  assert.equal(f.domain.snapshot().hover, null);
  await f.ui.clear({ reason: 'escape-selection-clear' }); await f.domain.setHover(null, { source: 'map' });
  assert.equal(f.domain.primary(), null); assert.equal(f.domain.snapshot().hover, null);
  f.dispose();
});
test('explicit close and the real app Escape handler release only inactive search hover', async t => {
  for (const close of [f => f.close(), escapeThroughApp]) {
    const f = await hoverLifecycle(t); await f.dispatch('pointerover'); close(f); await f.settle();
    assert.equal(f.isOpen(), false); assert.equal(f.domain.snapshot().hover, null); f.dispose();
  }
});
test('cancelling or refreshing still-open search retains its valid row hover and selection', async t => {
  const f = await hoverLifecycle(t); await f.dispatch('pointerover'); await f.domain.replace(f.ref);
  f.controller.cancelSearch();
  assert.equal(f.domain.snapshot().hover.key, f.ref.key); assert.equal(f.domain.primary().key, f.ref.key);
  const input = f.nodes.get('objectSearchInput'); input.value = '검증 강';
  input.listeners.get('input')({ currentTarget: input }); f.controller.render();
  assert.equal(f.isOpen(), true); assert.equal(f.domain.snapshot().hover.key, f.ref.key);
  assert.equal(f.domain.primary().key, f.ref.key); f.dispose();
});
test('inactive list cleanup preserves a newer map or other named hover owner', async t => {
  for (const source of ['map', 'other-view']) for (const sameKey of [false, true]) {
    const f = await hoverLifecycle(t); await f.dispatch('pointerover');
    const newer = sameKey ? f.ref : normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'DEU' });
    await f.domain.setHover(newer, { source }); const before = f.domain.stats().selectionHoverRevision;
    f.close(); await f.settle(); assert.equal(f.domain.snapshot().hover.key, newer.key);
    assert.equal(f.domain.stats().selectionHoverRevision, before); f.dispose();
  }
});
test('a late leave for an old row cannot erase the newer list key, but closing its owner can', async t => {
  const f = await hoverLifecycle(t); await f.dispatch('pointerover');
  const newer = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'DEU' });
  await f.domain.setHover(newer, { source: 'list' }); await f.dispatch('pointerout');
  assert.equal(f.domain.snapshot().hover.key, newer.key); f.controller.cancelSearch();
  assert.equal(f.domain.snapshot().hover.key, newer.key); f.close(); await f.settle(); assert.equal(f.domain.snapshot().hover, null);
  f.dispose();
});
test('inactive cleanup is idempotent and is not suppressed by map movement', async t => {
  const f = await hoverLifecycle(t); await f.dispatch('pointerover'); f.state.mapMoving = true; f.close(); await f.settle();
  assert.equal(f.domain.snapshot().hover, null); const revision = f.domain.stats().selectionHoverRevision;
  f.controller.cancelSearch(); assert.equal(f.domain.stats().selectionHoverRevision, revision); f.dispose();
});


test('real navigation/place composition preserves open search hover while moving blocks requests', async t => {
  const f = await hoverLifecycle(t); await f.dispatch('pointerover');
  assert.equal(f.isOpen(), true); assert.equal(f.wiring.isSearchOpen(), true);
  f.places.beginInteraction(); // Same ordering as beginPlaceInteraction in the app domain assembly.
  assert.equal(f.places.stats().moving, true); assert.equal(f.isOpen(), true);
  assert.equal(f.wiring.isSearchSurfaceOpen(), true);
  assert.equal(f.wiring.isSearchOpen(), false);
  f.controller.cancelSearch();
  assert.equal(f.domain.snapshot().hover?.key, f.ref.key, 'request suspension is not surface closure');
  await f.places.settle();
  assert.equal(f.wiring.isSearchOpen(), true); assert.equal(f.domain.snapshot().hover.key, f.ref.key);
  f.places.beginInteraction(); f.controller.cancelSearch(); f.close(); await f.settle();
  assert.equal(f.isOpen(), false); assert.equal(f.wiring.isSearchSurfaceOpen(), false);
  assert.equal(f.domain.snapshot().hover, null); f.dispose();
});

test('request inactivity without an explicit closed surface never triggers hover cleanup', async t => {
  const { controller, selectionDomain, snapshot, settle } = await setup(t);
  const ref = normalizeObjectRef({ domain: 'generic', type: 'feature', id: 'A' });
  await selectionDomain.setHover(ref, { source: 'list' }); snapshot.searchActive = false;
  controller.cancelSearch(); assert.equal(selectionDomain.snapshot().hover.key, ref.key);
  snapshot.searchSurfaceOpen = false; controller.cancelSearch(); await settle();
  assert.equal(selectionDomain.snapshot().hover, null); controller.dispose();
});
test('a late cancellation after reopening cannot clear the current visible list hover', async t => {
  const f = await hoverLifecycle(t); await f.dispatch('pointerover'); f.close(); await f.settle();
  f.surfaces.open('search'); await f.domain.setHover(f.ref, { source: 'list' });
  f.places.beginInteraction(); f.controller.cancelSearch();
  assert.equal(f.wiring.isSearchSurfaceOpen(), true); assert.equal(f.wiring.isSearchOpen(), false);
  assert.equal(f.domain.snapshot().hover.key, f.ref.key); f.dispose();
});

test('cached builtin results follow current month and visibility and restore the unchanged query',async()=>{
 const nodes=new Map(['objectSearchInput','objectSearchClearBtn','objectSearchResults','objectSearchSection'].map(id=>[id,element()]));
 const state={tool:'select',objectSearch:'서울',objectPresentationRevision:1,timelineCursor:'1914-06',layerVisibility:{labels:true},itemVisibility:{},labels:[]};
 let calls=0;
 const controller=createAppObjectSearchController({window:{setTimeout,clearTimeout},document:{createElement:element},getElement:id=>nodes.get(id),state,
  objectSearchGroupKeys:[],listObjectSearchItems:()=>[],layerItemObjectRef:()=>null,selectionDomain:{snapshot:()=>({selection:{items:[]}}),setHover:async()=>true},
  invalidateObjectPresentation(){},selectObjectSearchItem(){},closeSearchAfterSingleSelection(){},focusObjectRef(){},createEmptyState:element,
  isSearchOpen:()=>true,isSearchSurfaceOpen:()=>true,builtinSearch:async()=>{calls++;return {records:[{id:'builtin:place:synthetic:seoul',kind:'city',name:'서울'}],displayNames:{'builtin:place:synthetic:seoul':'서울'}};},cancelBuiltinSearch(){}});
 const rows=()=>nodes.get('objectSearchResults').children.filter(row=>row.children[0]?.dataset.itemId);
 controller.render();await tick();assert.equal(rows().length,1);
 state.layerVisibility.labels=false;controller.render();await tick();assert.equal(rows().length,0);
 state.layerVisibility.labels=true;controller.render();await tick();assert.equal(rows().length,1);assert.equal(calls,2);
 state.timelineCursor='1915-01';controller.render();await tick();assert.equal(calls,3);
 state.itemVisibility.labels={'builtin:place:synthetic:seoul':false};controller.render();await tick();assert.equal(rows().length,0);controller.dispose();
});
