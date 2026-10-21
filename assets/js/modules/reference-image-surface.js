import {
  registerReferenceImageSurfaceEditing,
  registerReferenceImageSurfaceActions,
} from './reference-image-surface-port.js';

const AUXILIARY_ACTIONS = Object.freeze({
  line: Object.freeze([
    { action: 'start', label: '선 보강', primary: true },
    { action: 'apply', label: '적용', primary: true },
    { action: 'redraw', label: '다시 그리기' },
    { action: 'cancel', label: '취소' },
  ]),
  'live-wire': Object.freeze([
    { action: 'start', label: '자동 추적', primary: true },
    { action: 'finish', label: '완료', primary: true },
    { action: 'undo', label: '마지막 점 취소' },
    { action: 'apply', label: '적용', primary: true },
    { action: 'redraw', label: '다시 그리기' },
    { action: 'cancel', label: '취소' },
  ]),
});

/** Late-loaded image UI uses the same lifecycle as the built-in workspace sheets. */
export function installReferenceImageSurface({ panel, launcher, mapElement, workspaceSurfaces, onAction, onAuxiliaryEditingStart, onClose, onOpen }) {
  if (!mapElement || typeof onAction !== 'function' || typeof onAuxiliaryEditingStart !== 'function') {
    throw new TypeError('Reference image workflows require mapElement, onAction and onAuxiliaryEditingStart.');
  }
  const document = panel.ownerDocument;
  const body = panel.querySelector('.surface-body');
  const collapseButton = panel.querySelector('[data-reference-panel-toggle]');
  const compact = panel.querySelector('.reference-image-editing-summary');
  const hint = panel.querySelector('.reference-image-editing-status');
  const compactActions = panel.querySelector('[data-ref-workflow-actions]');
  const auxiliaryRoot = panel.querySelector('[data-ref-auxiliary-actions]');
  const auxiliaryRows = {
    line: { element: panel.querySelector('[data-ref-line-actions]'), datasetKey: 'refLineAction' },
    'live-wire': { element: panel.querySelector('[data-ref-live-wire-actions]'), datasetKey: 'refLiveWireAction' },
  };
  const resizeHandle = panel.querySelector('.reference-image-resize-handle');
  const workspace = panel.closest('.workspace');
  if (!body || !collapseButton || !compact || !hint || !compactActions || !auxiliaryRoot
    || !auxiliaryRows.line.element || !auxiliaryRows['live-wire'].element || !resizeHandle || !workspace) {
    throw new TypeError('Reference image Surface must be created completely and mounted in the workspace before binding.');
  }
  const defaultCompletionButtons = compact.querySelectorAll('[data-ref-action="finish"], [data-ref-action="cancel"]');
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

  function renderActions(container, actions, datasetKey = 'refAction') {
    const previousButtons = [...container.children];
    for (const [index, action] of actions.entries()) {
      let button = previousButtons[index];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'ui-button btn';
        container.append(button);
      }
      button.dataset[datasetKey] = action.action;
      button.classList.toggle('ghost', !action.primary);
      button.disabled = action.disabled === true;
      button.hidden = action.hidden === true;
      setText(button, action.label);
    }
    for (const button of previousButtons.slice(actions.length)) button.remove();
  }

  /** Fixed footer groups share the same button renderer as reference-image workflows. */
  function setAuxiliaryActions(tool, projection = null) {
    const row = auxiliaryRows[tool];
    const definitions = AUXILIARY_ACTIONS[tool];
    if (!row || !definitions) throw new TypeError('Unknown reference image auxiliary action tool.');
    const actions = definitions.map(definition => ({
      ...definition,
      ...(projection?.[definition.action] ?? { hidden: true }),
    }));
    renderActions(row.element, actions, row.datasetKey);
    row.element.hidden = actions.every(action => action.hidden);
    sync();
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
    compact.classList.toggle('is-compact', compactEditing);
    // Ordinary image workflows own the footer until an auxiliary tool takes over.
    const hasAuxiliaryActions = Object.values(auxiliaryRows).some(row => !row.element.hidden);
    auxiliaryRoot.hidden = !hasAuxiliaryActions || !!workflow || (editing && !auxiliaryEditing);
    const showFooter = compactEditing || !auxiliaryRoot.hidden;
    if (compact.hidden !== !showFooter) compact.hidden = !showFooter;
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
  const unregisterSurfaceActions = registerReferenceImageSurfaceActions(setAuxiliaryActions);
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
      unregisterSurfaceActions();
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
