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
  let open = false, invalidations = 0, opens = 0;
  const controller = createEditorWorkspacePresentation({
    document, panel, task, dockSlot, floatingSlot, content, minimize,
    isEditorOpen: () => open,
    openEditor: () => { open = true; opens++; },
    onLayoutChange: () => invalidations++,
  });
  const pointer = (type, id = 1) => {
    const event = new Event(type);
    Object.defineProperty(event, 'pointerId', { value: id });
    document.dispatchEvent(event);
  };
  return { controller, panel, task, dockSlot, floatingSlot, content, minimize, document, pointer,
    stats: () => ({ open, opens, invalidations }),
  };
}

test('active tasks reuse one editor slot, open the inspector and ignore minimization', () => {
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

test('active task presentation never restores the floating task surface', () => {
  const f = fixture();
  f.controller.sync({ active: true, minimized: true });
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.content.hidden, false);
  assert.equal(f.minimize.hidden, true);
  assert.equal(f.floatingSlot.moves, 0);
});

test('task reparenting waits for the last pointer gesture', async () => {
  const f = fixture();
  f.pointer('pointerdown', 1); f.pointer('pointerdown', 2);
  f.controller.sync({ active: true });
  assert.equal(f.task.parentElement, f.floatingSlot);
  f.pointer('pointerup', 1);
  await Promise.resolve();
  assert.equal(f.task.parentElement, f.floatingSlot);
  f.pointer('pointercancel', 2);
  await Promise.resolve();
  assert.equal(f.task.parentElement, f.dockSlot);
});

test('blur releases pending presentation and dispose removes lifecycle listeners', async () => {
  const f = fixture();
  f.pointer('pointerdown'); f.controller.sync({ active: true });
  f.document.defaultView.dispatchEvent(new Event('blur'));
  await Promise.resolve();
  assert.equal(f.task.parentElement, f.dockSlot);
  f.controller.dispose(); f.controller.sync({ active: false });
  assert.equal(f.task.parentElement, f.dockSlot);
});
