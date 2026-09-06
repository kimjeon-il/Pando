import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorWorkspacePresentation } from '../../assets/js/modules/editor-workspace-presentation.js';

function fixture() {
  const node = () => ({
    dataset: {}, hidden: false, moves: 0,
    setAttribute(name, value) { this[name] = value; },
    append(child) { child.parentElement = this; this.moves++; },
    classList: { toggle() {} },
  });
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  const panel = node(), task = node(), dockSlot = node(), floatingSlot = node(), content = node(), minimize = node();
  task.parentElement = floatingSlot;
  let layout = 'wide', open = false, invalidations = 0, opens = 0;
  const controller = createEditorWorkspacePresentation({
    document, panel, task, dockSlot, floatingSlot, content, minimize,
    getLayout: () => layout, isEditorOpen: () => open,
    openEditor: () => { open = true; opens++; }, closeEditor: () => { open = false; },
    onLayoutChange: () => invalidations++,
  });
  const pointer = (type, id = 1) => {
    const event = new Event(type);
    Object.defineProperty(event, 'pointerId', { value: id });
    document.dispatchEvent(event);
  };
  return { controller, panel, task, dockSlot, floatingSlot, content, minimize, document, pointer,
    layout: value => { layout = value; controller.sync(); },
    stats: () => ({ open, opens, invalidations }),
  };
}

test('wide tasks reuse one DOM, open the inspector and ignore floating minimization', () => {
  const f = fixture();
  f.controller.sync({ active: true, minimized: true });
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.panel.dataset.editorContent, 'task');
  assert.equal(f.content.hidden, false);
  assert.equal(f.minimize.hidden, true);
  for (let i = 0; i < 10; i++) f.controller.sync();
  assert.equal(f.dockSlot.moves, 1);
  assert.deepEqual(f.stats(), { open: true, opens: 1, invalidations: 1 });
});

test('completion restores property mode without closing the inspector', () => {
  const f = fixture();
  f.controller.sync({ active: true });
  f.controller.sync({ active: false });
  assert.equal(f.panel.dataset.editorContent, 'properties');
  assert.equal(f.task.parentElement, f.floatingSlot);
  assert.equal(f.dockSlot.hidden, true);
  assert.equal(f.stats().open, true);
});

test('compact and mobile keep the original floating task and minimize state', () => {
  const f = fixture();
  f.controller.sync({ active: true, minimized: true });
  for (const layout of ['compact', 'mobile']) {
    f.layout(layout);
    assert.equal(f.task.parentElement, f.floatingSlot);
    assert.equal(f.content.hidden, true);
    assert.equal(f.minimize.hidden, false);
  }
  f.layout('wide');
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.content.hidden, false);
});

test('breakpoint reparenting waits for the last pointer and uses the latest layout', async () => {
  const f = fixture();
  f.controller.sync({ active: true });
  f.pointer('pointerdown', 1); f.pointer('pointerdown', 2);
  f.layout('compact');
  assert.equal(f.task.parentElement, f.dockSlot);
  f.pointer('pointerup', 1);
  await Promise.resolve();
  assert.equal(f.task.parentElement, f.dockSlot);
  f.pointer('pointercancel', 2);
  await Promise.resolve();
  assert.equal(f.task.parentElement, f.floatingSlot);
});

test('blur releases pending presentation and dispose removes lifecycle listeners', async () => {
  const f = fixture();
  f.controller.sync({ active: true });
  f.pointer('pointerdown'); f.layout('compact');
  f.document.defaultView.dispatchEvent(new Event('blur'));
  await Promise.resolve();
  assert.equal(f.task.parentElement, f.floatingSlot);
  f.controller.dispose(); f.layout('wide');
  assert.equal(f.task.parentElement, f.floatingSlot);
});
