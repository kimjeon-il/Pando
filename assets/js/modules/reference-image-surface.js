/** Late-loaded image UI uses the same lifecycle as the built-in workspace sheets. */
export function installReferenceImageSurface({ panel, launcher, workspaceSurfaces, onClose, onOpen }) {
  const document = panel.ownerDocument;
  panel.id = 'referenceImageSurface';
  panel.classList.add('workspace-surface', 'surface-reference', 'ui-sheet');
  launcher.id = 'referenceImageBtn';
  launcher.setAttribute('aria-label', '이미지 추가');
  launcher.dataset.tooltip = '이미지 추가';
  launcher.setAttribute('aria-controls', panel.id);
  launcher.setAttribute('aria-haspopup', 'dialog');
  const header = panel.querySelector('.reference-image-panel-header');
  header.classList.add('surface-header');
  const handle = document.createElement('button');
  handle.className = 'ui-button sheet-drag-handle';
  handle.type = 'button';
  handle.dataset.sheetHandle = panel.id;
  for (const [key, value] of Object.entries({ role: 'slider', 'aria-label': '참조 이미지 창 높이 조절', 'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '2', 'aria-valuenow': '1', 'aria-valuetext': '중간 높이' })) handle.setAttribute(key, value);
  handle.append(document.createElement('span'));
  header.prepend(handle);
  const body = document.createElement('div');
  body.className = 'surface-body reference-image-body gis-form-grid';
  for (const child of [...panel.children]) if (child !== header) body.append(child);
  panel.append(body);
  const compact = document.createElement('div');
  compact.className = 'reference-image-editing-summary';
  const hint = document.createElement('span');
  hint.setAttribute('role', 'status');
  compact.append(hint);
  for (const [action, label] of [['finish', '완료'], ['cancel', '취소']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'finish' ? 'ui-button btn' : 'ui-button btn ghost';
    button.dataset.refAction = action;
    button.textContent = label;
    compact.append(button);
  }
  panel.append(compact);
  let previousOpen = false;
  let editing = false;
  let savedSnap = 1;
  function sync() {
    const open = workspaceSurfaces.surfaceController.isOpen('reference');
    if (panel.hidden !== !open) panel.hidden = !open;
    const mobile = workspaceSurfaces.isMobile();
    const compactEditing = editing && mobile;
    if (panel.classList.contains('reference-image-editing') !== compactEditing) panel.classList.toggle('reference-image-editing', compactEditing);
    if (body.inert !== compactEditing) body.inert = compactEditing;
    if (compact.hidden !== !compactEditing) compact.hidden = !compactEditing;
    if (previousOpen !== open) {
      previousOpen = open;
      if (open) {
        body.scrollTop = 0;
        onOpen?.();
      } else {
        onClose?.();
      }
    }
  }
  const unregister = workspaceSurfaces.registerReferenceImageSurface({ panel, sync });
  const toggle = () => workspaceSurfaces.toggleSurface('reference', launcher);
  launcher.addEventListener('click', toggle);
  return {
    open: () => workspaceSurfaces.openSurface('reference', { trigger: launcher }),
    close: (options = {}) => workspaceSurfaces.closeSurface('reference', options),
    toggle,
    setEditing(active, text = '') {
      const next = active === true;
      if (next && !editing) savedSnap = Number(panel.dataset.sheetSnap ?? 1);
      const wasEditing = editing;
      editing = next;
      if (hint.textContent !== text) hint.textContent = text;
      if (wasEditing && !editing && workspaceSurfaces.isMobile()) workspaceSurfaces.setMobileSheetHeight(panel, savedSnap);
      sync();
    },
    setGestureActive: active => workspaceSurfaces.setReferenceImageGestureActive(active),
    resetScroll: () => { body.scrollTop = 0; },
    destroy() {
      workspaceSurfaces.closeSurface('reference');
      workspaceSurfaces.setReferenceImageGestureActive(false);
      unregister();
      launcher.removeEventListener('click', toggle);
    },
  };
}
