import assert from 'node:assert/strict';
import test from 'node:test';
/* global Event, EventTarget */
import { createEditorWorkspacePresentation } from "../../apps/editor/frontend/js/modules/editor-workspace-presentation.js";

function fixture({ initiallyBlocked = false } = {}) {
  const node = () => {
    const classes = new Set();
    return {
      dataset: {}, hidden: false, moves: 0, parentElement: null,
      setAttribute(name, value) { this[name] = value; },
      append(child) { child.parentElement = this; this.moves++; },
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    };
  };
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  const panel = node(), task = node(), dockSlot = node(), content = node(), minimize = node();
  task.parentElement = dockSlot;
  dockSlot.hidden = true;
  let open = false, invalidations = 0, opens = 0, blocked = initiallyBlocked;
  const controller = createEditorWorkspacePresentation({
    document, panel, task, dockSlot,
    isEditorOpen: () => open,
    openEditor: () => { if (!blocked) { open = true; opens++; } },
    onLayoutChange: () => invalidations++,
  });
  const pointer = (type, id = 1) => {
    const event = new Event(type);
    Object.defineProperty(event, 'pointerId', { value: id });
    document.dispatchEvent(event);
  };
  return {
    controller, panel, task, dockSlot, content, minimize, document, pointer,
    releaseCreateMenu: () => { blocked = false; },
    switchToAnotherSurface: () => { open = false; },
    stats: () => ({ open, opens, invalidations }),
  };
}

test('an active task opens after the create menu releases its temporary open block', () => {
  const f = fixture({ initiallyBlocked: true });
  f.controller.sync({ active: true });
  assert.equal(f.stats().open, false);
  f.releaseCreateMenu();
  f.controller.sync({ active: true });
  assert.equal(f.stats().open, true);
  assert.equal(f.dockSlot.moves, 0);
  assert.equal(f.task.parentElement, f.dockSlot);
});

test('an already opened task does not override a subsequent explicit mobile surface switch', () => {
  const f = fixture();
  f.controller.sync({ active: true });
  f.switchToAnotherSurface();
  f.controller.sync({ active: true });
  assert.equal(f.stats().open, false);
  assert.equal(f.stats().opens, 1);
});

test('active tasks use their permanent inspector slot without creating another widget', () => {
  const f = fixture();
  f.content.hidden = true;
  f.controller.sync({ active: true });
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.panel.dataset.editorContent, 'task');
  assert.equal(f.panel['aria-labelledby'], 'modeTaskName');
  assert.equal(f.dockSlot.hidden, false);
  assert.equal(f.task.classList.contains('hidden'), false);
  assert.equal(f.content.hidden, true);
  assert.equal(f.minimize.hidden, false);
  for (let i = 0; i < 10; i++) f.controller.sync();
  assert.equal(f.dockSlot.moves, 0);
  assert.deepEqual(f.stats(), { open: true, opens: 1, invalidations: 1 });
});

test('completion restores property mode, without closing the inspector or moving the task', () => {
  const f = fixture();
  f.controller.sync({ active: true });
  f.controller.sync({ active: false });
  assert.equal(f.panel.dataset.editorContent, 'properties');
  assert.equal(f.panel['aria-labelledby'], 'editSheetTitle');
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.dockSlot.hidden, true);
  assert.equal(f.task.classList.contains('hidden'), true);
  assert.deepEqual(f.stats(), { open: true, opens: 1, invalidations: 2 });
});

test('minimization belongs to the task presenter and does not change the host', () => {
  const f = fixture();
  f.content.hidden = true;
  f.controller.sync({ active: true, minimized: true });
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.content.hidden, true);
  assert.equal(f.minimize.hidden, false);
  assert.equal(f.dockSlot.moves, 0);
});

test('presentation changes wait for the final pointer gesture, not DOM reparenting', async () => {
  const f = fixture();
  f.controller.sync({ active: false });
  f.pointer('pointerdown', 1); f.pointer('pointerdown', 2);
  f.controller.sync({ active: true });
  assert.equal(f.controller.isDocked(), false);
  assert.equal(f.panel.dataset.editorContent, 'properties');
  assert.equal(f.task.parentElement, f.dockSlot);
  f.pointer('pointerup', 1);
  await Promise.resolve();
  assert.equal(f.controller.isDocked(), false);
  f.pointer('pointercancel', 2);
  await Promise.resolve();
  assert.equal(f.controller.isDocked(), true);
  assert.equal(f.panel.dataset.editorContent, 'task');
  assert.equal(f.task.parentElement, f.dockSlot);
  assert.equal(f.dockSlot.moves, 0);
});

test('blur resolves a deferred transition; dispose stops future presentation changes', async () => {
  const f = fixture();
  f.pointer('pointerdown'); f.controller.sync({ active: true });
  f.document.defaultView.dispatchEvent(new Event('blur'));
  await Promise.resolve();
  assert.equal(f.controller.isDocked(), true);
  assert.equal(f.task.parentElement, f.dockSlot);
  f.controller.dispose(); f.controller.sync({ active: false });
  assert.equal(f.controller.isDocked(), true);
  assert.equal(f.task.parentElement, f.dockSlot);
});

test('a task in an obsolete floating host fails visibly instead of silently moving', () => {
  const f = fixture();
  const invalid = { parentElement: {} };
  assert.throws(() => createEditorWorkspacePresentation({
    document: f.document, panel: f.panel, task: invalid, dockSlot: f.dockSlot,
    isEditorOpen() { return false; }, openEditor() {}, onLayoutChange() {},
  }), /permanent inspector slot/);
});
