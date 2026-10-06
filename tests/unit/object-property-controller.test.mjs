import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPropertyController } from '../../assets/js/modules/object-property-controller.js';

function setup() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        children: [], attributes: new Map(),
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
    setEditorShellView() {}, syncObjectActionsMenu() {}, closeObjectActionsMenu() {}, syncStatusBar() {},
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
