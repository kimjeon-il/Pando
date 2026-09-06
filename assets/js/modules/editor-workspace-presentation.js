/** Moves the existing task UI; never owns editing state or registers its handlers. */
export function createEditorWorkspacePresentation({
  document, getLayout, panel, task, dockSlot, floatingSlot, content, minimize,
  isEditorOpen, openEditor, closeEditor, onLayoutChange,
}) {
  let active = false;
  let minimized = false;
  let docked = false;
  let editorWasOpen = false;
  let disposed = false;
  const pointers = new Set();

  const apply = () => {
    if (disposed) return;
    const nextDocked = active && getLayout() === 'wide';
    if (nextDocked !== docked && pointers.size) return;
    const destination = nextDocked ? dockSlot : floatingSlot;
    const changed = nextDocked !== docked;
    if (changed && nextDocked) editorWasOpen = isEditorOpen();
    if (task.parentElement !== destination) destination.append(task);
    docked = nextDocked;
    if (panel.dataset.editorContent !== (docked ? 'task' : 'properties')) {
      panel.dataset.editorContent = docked ? 'task' : 'properties';
      panel.setAttribute('aria-labelledby', docked ? 'modeTaskName' : 'editSheetTitle');
    }
    if (dockSlot.hidden !== !docked) dockSlot.hidden = !docked;
    task.classList.toggle('hidden', !active);
    task.classList.toggle('is-minimized', !docked && minimized);
    if (content.hidden !== (!docked && minimized)) content.hidden = !docked && minimized;
    if (minimize.hidden !== docked) minimize.hidden = docked;
    if (docked && !isEditorOpen()) openEditor();
    else if (changed && active && !editorWasOpen) closeEditor();
    if (changed) onLayoutChange();
  };
  const sync = (input = {}) => {
    if ('active' in input) active = !!input.active;
    if ('minimized' in input) minimized = !!input.minimized;
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
