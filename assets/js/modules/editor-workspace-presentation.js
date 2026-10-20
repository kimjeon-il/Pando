/** Presents a task already authored inside the inspector's permanent slot.
 * The editor domain owns workflow state; this module only switches visibility.
 * Pointer gestures defer panel transitions, not DOM reparenting. */
export function createEditorWorkspacePresentation({
  document, panel, task, dockSlot,
  isEditorOpen, openEditor, onLayoutChange,
}) {
  if (task?.parentElement !== dockSlot) {
    throw new TypeError('The editor task must be authored inside its permanent inspector slot.');
  }

  let active = false;
  let docked = false;
  let needsInitialOpen = false;
  let disposed = false;
  const pointers = new Set();

  const apply = () => {
    if (disposed) return;
    const nextDocked = active;
    // Do not change the panel while the user is dragging on the map or UI.
    if (nextDocked !== docked && pointers.size) return;
    const changed = nextDocked !== docked;
    if (changed) needsInitialOpen = nextDocked;
    docked = nextDocked;
    if (panel.dataset.editorContent !== (docked ? 'task' : 'properties')) {
      panel.dataset.editorContent = docked ? 'task' : 'properties';
      panel.setAttribute('aria-labelledby', docked ? 'modeTaskName' : 'editSheetTitle');
    }
    if (dockSlot.hidden !== !docked) dockSlot.hidden = !docked;
    task.classList.toggle('hidden', !active);
    if (needsInitialOpen && !isEditorOpen()) openEditor();
    if (isEditorOpen()) needsInitialOpen = false;
    if (changed) onLayoutChange();
  };

  const sync = (input = {}) => {
    if ('active' in input) active = !!input.active;
    apply();
  };
  const start = event => pointers.add(event.pointerId);
  const finish = event => {
    pointers.delete(event.pointerId);
    if (!pointers.size) queueMicrotask(apply);
  };
  const cancel = () => { pointers.clear(); queueMicrotask(apply); };
  const visibility = () => { if (document.hidden) cancel(); };

  document.addEventListener('pointerdown', start, true);
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
  document.addEventListener('visibilitychange', visibility);
  document.defaultView?.addEventListener('blur', cancel);

  return Object.freeze({
    sync,
    isDocked: () => docked,
    dispose() {
      disposed = true;
      pointers.clear();
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
      document.removeEventListener('visibilitychange', visibility);
      document.defaultView?.removeEventListener('blur', cancel);
    },
  });
}
