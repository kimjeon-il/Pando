import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPropertyController } from "../../apps/editor/frontend/js/modules/object-property-controller.js";

function setup(runtime = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        children: [],attributes: new Map(),previousElementSibling: {},lastChild: {},closest() { return null; },
        classList: {
          toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
          add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
          contains(name) { return classes.has(name); },
        },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        getAttribute(name) { return this.attributes.get(name); },
        querySelector() { return null; }, append(child) { child.parentElement = this; },
      });
    }
    return nodes.get(id);
  };
  const controller = createObjectPropertyController({
    document: { querySelector: node, querySelectorAll: () => [] }, getElement: node,
    setEditorShellView() {},syncObjectActionsMenu() {},closeObjectActionsMenu() {},syncStatusBar() {},reportOperationError() {},...runtime,
  });
  return { controller, node };
}

test('the common editor exposes the flag action only for territorial entities across selection changes', () => {
  const { controller, node } = setup();
  for (const type of ['entity', 'hydro', 'label', 'generic', 'distribution', 'multi', '', 'entity']) {
    controller.show(type, 'Selected object');
    assert.equal(node('flagMenuBtn').classList.contains('hidden'), type !== 'entity', type || 'empty');
    assert.equal(node('entityProperties').classList.contains('hidden'), type !== 'entity');
    assert.equal(node('propertyTitle').textContent, type ? 'Selected object' : '');
    assert.equal(node('editorSurface').getAttribute('aria-labelledby'),
      type ? 'editSheetTitle editorObjectHeading' : 'editSheetTitle');
  }
});

test('all property types reuse the one permanently authored delete action without reparenting', () => {
  const { controller, node } = setup();
  const host = node('editorScrollBody');
  const action = node('editorDeleteSection');
  action.parentElement = host;
  for (const type of ['entity', 'hydro', 'label', 'generic', 'distribution', 'multi', '', 'entity']) {
    controller.show(type, 'Object');
    assert.equal(action.parentElement, host, type || 'empty');
  }
});

test('builtin hydro hydration awaits identity admission and reports its original rejected ACK',async () => {
  const feature={ id: 'builtin-river',properties: { category: 'river',__logicalFid: 1 } },full={ ...feature,geometry: { type: 'LineString',coordinates: [[0,0],[1,1]] } };
  let admitReject,signalAdmit,signalReport;const held=new Promise((_resolve,reject) => { admitReject=reject; }),
    admitting=new Promise(resolve => { signalAdmit=resolve; }),reported=new Promise(resolve => { signalReport=resolve; });
  const errors=[],failure=Object.assign(new Error('The builtin identity admission failed.'),{ code: 'PL-CORE-CATALOG' });
  const { controller }=setup({ hydroFeatureById: () => feature,hydroEditById: () => null,hydroCategoryKey: () => 'river',
    hydroCategoryLabel: () => '강',hydroFallbackName: () => '강',hydroEditorName: name => name || '강',prepareHydroFeature() {},
    objectSearchController: () => null,gpuMapRenderer: { loadHydroLogicalFeature: async () => full },
    onHydroLoaded: async value => { assert.equal(value,full);signalAdmit();await held; },
    reportOperationError: (...args) => { errors.push(args);signalReport(); } });
  assert.equal(controller.present({ domain: 'hydro',type: 'river',id: feature.id }),true);
  await admitting;assert.equal(feature.__geometryLoading,true);assert.deepEqual(errors,[]);
  admitReject(failure);await reported;
  assert.equal(errors[0][0],failure);assert.equal(errors[0][2],'PL-HYDRO-PROPERTY-001');
});

test('object property hydration fails visibly when its required operation reporter is missing',() => {
  assert.throws(() => createObjectPropertyController({}),/operation error reporter/);
});
