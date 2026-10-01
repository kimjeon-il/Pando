import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { createLayerTreeController } from '../../assets/js/modules/layer-tree-controller.js';
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
    type: group === 'countries' ? 'country' : group === 'labels' ? 'label' : 'polygon', id,
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
    commands: { selectItem: ({ group, id, range, additive, orderedRefs }) => ui.applyIntent(itemRef(group, id), {
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
