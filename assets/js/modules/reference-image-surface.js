import { registerReferenceImageSurfaceEditing } from './reference-image-surface-port.js';

/** Late-loaded image UI uses the same lifecycle as the built-in workspace sheets. */
export function installReferenceImageSurface({ panel, launcher, mapElement, workspaceSurfaces, onAction, onAuxiliaryEditingStart, onClose, onOpen }) {
  if (!mapElement || typeof onAction !== 'function' || typeof onAuxiliaryEditingStart !== 'function') {
    throw new TypeError('Reference image workflows require mapElement, onAction and onAuxiliaryEditingStart.');
  }
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
  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'ui-button btn ghost reference-image-collapse-button';
  collapseButton.dataset.referencePanelToggle = '';
  collapseButton.setAttribute('aria-controls', 'referenceImageSurfaceBody');
  const closeButton = header.querySelector('[data-ref-action="close"]');
  if (closeButton) closeButton.before(collapseButton);
  else header.append(collapseButton);
  const body = document.createElement('div');
  body.className = 'surface-body reference-image-body gis-form-grid';
  body.id = 'referenceImageSurfaceBody';
  for (const child of [...panel.children]) if (child !== header) body.append(child);
  panel.append(body);
  const compact = document.createElement('div');
  compact.className = 'reference-image-editing-summary';
  const hint = document.createElement('span');
  hint.setAttribute('role', 'status');
  compact.append(hint);
  const defaultCompletionButtons = [];
  for (const [action, label] of [['navigation-toggle', '지도 이동'], ['undo', '실행 취소'], ['redo', '다시 실행'], ['finish', '완료'], ['cancel', '취소']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'finish' ? 'ui-button btn' : 'ui-button btn ghost';
    button.dataset.refAction = action;
    button.textContent = label;
    if (action === 'undo' || action === 'redo') {
      button.disabled = true;
      button.setAttribute('aria-label', `이미지 편집 ${label}`);
    }
    if (action === 'finish' || action === 'cancel') defaultCompletionButtons.push(button);
    compact.append(button);
  }
  const compactActions = document.createElement('div');
  compactActions.className = 'reference-image-workflow-actions';
  compactActions.dataset.refWorkflowActions = '';
  compactActions.hidden = true;
  compact.append(compactActions);
  panel.append(compact);
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'reference-image-resize-handle';
  resizeHandle.tabIndex = 0;
  for (const [key, value] of Object.entries({
    role: 'separator', 'aria-label': '참조 이미지 패널 너비 조절',
    'aria-orientation': 'vertical', 'aria-valuemin': '300', 'aria-valuemax': '480',
  })) resizeHandle.setAttribute(key, value);
  panel.prepend(resizeHandle);

  const workspace = panel.closest?.('.workspace') || document.querySelector('.workspace');
  const DOCK_WIDTH_KEY = 'pandolab-reference-image-dock-width';
  let dockWidth = 340;
  try {
    const storedWidth = Number(globalThis.localStorage?.getItem(DOCK_WIDTH_KEY));
    if (Number.isFinite(storedWidth) && storedWidth >= 300 && storedWidth <= 480) dockWidth = storedWidth;
  } catch (_) { /* The dock remains usable when preferences storage is blocked. */ }
  let resizePointerId = null;
  let previousOpen = false;
  let editing = false;
  let auxiliaryEditing = false;
  let editingText = '';
  // A rendering projection supplied by the controller; tool state remains there.
  let workflow = null;
  let guide = null;
  let collapsed = false;
  let expandedWhileEditing = false;
  let savedSnap = 1;

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function stopGuidePointer(event) {
    event.stopPropagation();
  }

  function onGuideClick(event) {
    event.stopPropagation();
    const button = event.target.closest('[data-ref-action]');
    if (!button || button.disabled || guide.root.hidden) return;
    onAction(event);
  }

  function createGuide() {
    const root = document.createElement('section');
    root.className = 'reference-image-workflow-guide';
    root.dataset.refWorkflowGuide = '';
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', '참조 이미지 작업 안내');
    const status = document.createElement('div');
    status.className = 'reference-image-workflow-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const heading = document.createElement('div');
    heading.className = 'reference-image-workflow-heading';
    const title = document.createElement('strong');
    const progress = document.createElement('span');
    progress.dataset.refWorkflowProgress = '';
    heading.append(title, progress);
    const steps = document.createElement('ol');
    steps.className = 'reference-image-workflow-steps';
    steps.setAttribute('aria-label', '작업 단계');
    const instruction = document.createElement('p');
    instruction.className = 'reference-image-workflow-instruction';
    const detail = document.createElement('p');
    detail.className = 'reference-image-workflow-detail';
    const actions = document.createElement('div');
    actions.className = 'reference-image-workflow-actions';
    actions.dataset.refWorkflowActions = '';
    status.append(heading, steps, instruction, detail);
    root.append(status, actions);
    root.addEventListener('pointerdown', stopGuidePointer);
    root.addEventListener('click', onGuideClick);
    mapElement.append(root);
    return { root, title, progress, steps, instruction, detail, actions };
  }

  function removeGuide() {
    if (!guide) return;
    guide.root.removeEventListener('pointerdown', stopGuidePointer);
    guide.root.removeEventListener('click', onGuideClick);
    guide.root.remove();
    guide = null;
  }

  function renderActions(container, actions) {
    const previousButtons = [...container.children];
    for (const [index, action] of actions.entries()) {
      let button = previousButtons[index];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'ui-button btn';
        container.append(button);
      }
      button.dataset.refAction = action.action;
      button.classList.toggle('ghost', !action.primary);
      button.disabled = action.disabled === true;
      setText(button, action.label);
    }
    for (const button of previousButtons.slice(actions.length)) button.remove();
  }

  function syncWorkflowText() {
    // setEditing supplies the current instruction, including a temporary map-pan
    // override. Workflow rendering must not replace that instruction.
    const instruction = editingText || workflow?.instruction || '';
    const text = workflow
      ? `${workflow.title} · ${workflow.step + 1}/${workflow.steps.length} · ${instruction}`
      : editingText;
    setText(hint, text);
    if (guide) setText(guide.instruction, instruction);
  }

  function setWorkflow(next) {
    workflow = next;
    compactActions.hidden = !workflow;
    if (!workflow) {
      compactActions.replaceChildren();
      removeGuide();
    } else {
      if (!guide) guide = createGuide();
      guide.root.dataset.refWorkflowId = workflow.id;
      setText(guide.title, workflow.title);
      setText(guide.progress, `${workflow.step + 1}/${workflow.steps.length}`);
      const previousSteps = [...guide.steps.children];
      for (const [index, label] of workflow.steps.entries()) {
        let item = previousSteps[index];
        if (!item) {
          item = document.createElement('li');
          guide.steps.append(item);
        }
        setText(item, label);
        item.classList.toggle('is-complete', index < workflow.step);
        if (index === workflow.step) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      }
      for (const item of previousSteps.slice(workflow.steps.length)) item.remove();
      setText(guide.detail, workflow.detail || '');
      guide.detail.hidden = !workflow.detail;
      renderActions(guide.actions, workflow.actions);
      // These buttons bubble to the panel's existing action handler exactly once.
      renderActions(compactActions, workflow.actions);
    }
    syncWorkflowText();
    sync();
  }

  function maxDockWidth() {
    const available = workspace?.getBoundingClientRect?.().width;
    return Number.isFinite(available) ? Math.max(300, Math.min(480, available - 320)) : 480;
  }

  function setDockWidth(value, { save = false } = {}) {
    const number = Number(value);
    dockWidth = Math.round(Math.max(300, Math.min(maxDockWidth(), Number.isFinite(number) ? number : 340)));
    workspace?.style?.setProperty('--reference-dock-width', dockWidth + 'px');
    resizeHandle.setAttribute('aria-valuenow', String(dockWidth));
    resizeHandle.setAttribute('aria-valuemax', String(maxDockWidth()));
    if (save) {
      try { globalThis.localStorage?.setItem(DOCK_WIDTH_KEY, String(dockWidth)); }
      catch (_) { /* The current layout is still applied without persistence. */ }
    }
  }
  setDockWidth(dockWidth);

  function onResizePointerDown(event) {
    if (workspaceSurfaces.isMobile() || collapsed || event.button !== 0) return;
    resizePointerId = event.pointerId;
    resizeHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onResizePointerMove(event) {
    if (event.pointerId !== resizePointerId) return;
    const rect = workspace?.getBoundingClientRect?.();
    if (rect) setDockWidth(rect.right - event.clientX);
    event.preventDefault();
  }

  function onResizePointerEnd(event) {
    if (event.pointerId !== resizePointerId) return;
    resizePointerId = null;
    try { resizeHandle.releasePointerCapture?.(event.pointerId); } catch (_) {}
    setDockWidth(dockWidth, { save: true });
  }

  function onResizeKeyDown(event) {
    const target = event.key === 'Home' ? 300 : event.key === 'End' ? maxDockWidth()
      : event.key === 'ArrowLeft' ? dockWidth + 12 : event.key === 'ArrowRight' ? dockWidth - 12 : null;
    if (target == null || workspaceSurfaces.isMobile() || collapsed) return;
    event.preventDefault();
    setDockWidth(target, { save: true });
  }

  function toggleCollapsed() {
    const mobile = workspaceSurfaces.isMobile();
    if (mobile && editing) {
      if (collapsed) { collapsed = false; expandedWhileEditing = true; }
      else expandedWhileEditing = !expandedWhileEditing;
      if (expandedWhileEditing) workspaceSurfaces.setMobileSheetHeight(panel, savedSnap);
    } else {
      if (mobile) {
        if (!collapsed) savedSnap = Math.max(1, Number(panel.dataset.sheetSnap ?? 1));
        workspaceSurfaces.setMobileSheetHeight(panel, collapsed ? savedSnap : 0);
      }
      collapsed = !collapsed;
    }
    sync();
  }

  function onCollapseClick(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    toggleCollapsed();
  }
  function sync() {
    for (const button of defaultCompletionButtons) button.hidden = !!workflow || auxiliaryEditing;
    const open = workspaceSurfaces.surfaceController.isOpen('reference');
    if (!open) {
      collapsed = false;
      expandedWhileEditing = false;
    }
    if (panel.hidden !== !open) panel.hidden = !open;
    const mobile = workspaceSurfaces.isMobile();
    if (guide) guide.root.hidden = !open || mobile || !workflow;
    const compactEditing = editing && mobile && !expandedWhileEditing;
    const bodyCollapsed = collapsed || compactEditing;
    panel.classList.toggle('reference-image-editing-active', editing);
    panel.classList.toggle('reference-image-editing', compactEditing);
    panel.classList.toggle('reference-image-collapsed', collapsed);
    workspace?.classList?.toggle('reference-image-docked', open && !mobile);
    workspace?.classList?.toggle('reference-image-dock-collapsed', open && !mobile && collapsed);
    if (body.inert !== bodyCollapsed) body.inert = bodyCollapsed;
    if (compact.hidden !== !compactEditing) compact.hidden = !compactEditing;
    const label = bodyCollapsed ? '펼치기' : '접기';
    if (collapseButton.textContent !== label) collapseButton.textContent = label;
    collapseButton.setAttribute('aria-label', '참조 이미지 패널 ' + label);
    collapseButton.setAttribute('aria-expanded', String(!bodyCollapsed));
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
  function setEditing(active, text = '', { auxiliary = false } = {}) {
    const next = active === true;
    // This is the controller's UI projection; auxiliary tools own their state
    // and completion actions, while the surface owns these shared buttons.
    auxiliaryEditing = next && auxiliary;
    if (next && !editing) {
      const currentSnap = Number(panel.dataset.sheetSnap ?? 1);
      if (currentSnap > 0) savedSnap = currentSnap;
      expandedWhileEditing = false;
    }
    const wasEditing = editing;
    editing = next;
    editingText = text;
    syncWorkflowText();
    if (wasEditing && !editing) {
      expandedWhileEditing = false;
      if (workspaceSurfaces.isMobile() && !collapsed) workspaceSurfaces.setMobileSheetHeight(panel, savedSnap);
    }
    sync();
  }
  const unregisterSurfaceEditing = registerReferenceImageSurfaceEditing((active, text) => {
    if (active === true) onAuxiliaryEditingStart();
    setEditing(active, text, { auxiliary: true });
  });
  collapseButton.addEventListener('click', onCollapseClick);
  resizeHandle.addEventListener('pointerdown', onResizePointerDown);
  resizeHandle.addEventListener('pointermove', onResizePointerMove);
  resizeHandle.addEventListener('pointerup', onResizePointerEnd);
  resizeHandle.addEventListener('pointercancel', onResizePointerEnd);
  resizeHandle.addEventListener('keydown', onResizeKeyDown);

  return {
    open: () => workspaceSurfaces.openSurface('reference', { trigger: launcher }),
    close: (options = {}) => workspaceSurfaces.closeSurface('reference', options),
    toggle,
    setEditing,
    setWorkflow,
    setGestureActive: active => workspaceSurfaces.setReferenceImageGestureActive(active),
    resetScroll: () => { body.scrollTop = 0; },
    destroy() {
      workspaceSurfaces.closeSurface('reference');
      workspaceSurfaces.setReferenceImageGestureActive(false);
      unregisterSurfaceEditing();
      unregister();
      setWorkflow(null);
      workspace?.classList?.remove('reference-image-docked', 'reference-image-dock-collapsed');
      collapseButton.removeEventListener('click', onCollapseClick);
      resizeHandle.removeEventListener('pointerdown', onResizePointerDown);
      resizeHandle.removeEventListener('pointermove', onResizePointerMove);
      resizeHandle.removeEventListener('pointerup', onResizePointerEnd);
      resizeHandle.removeEventListener('pointercancel', onResizePointerEnd);
      resizeHandle.removeEventListener('keydown', onResizeKeyDown);
      launcher.removeEventListener('click', toggle);
    },
  };
}
