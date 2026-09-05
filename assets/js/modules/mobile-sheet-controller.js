import { installFeedbackController } from './feedback-controller.js';

const TWO_SNAP_PANEL_IDS = new Set(['leftPanel', 'createMenu']);
const EDIT_PANEL_ID = 'rightPanel';
const SNAP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

let installed = false;
let programmaticSnapDepth = 0;
let editSession = null;

const isHtmlElement = value => {
  const HTMLElementCtor = value?.ownerDocument?.defaultView?.HTMLElement;
  return typeof HTMLElementCtor === 'function' && value instanceof HTMLElementCtor;
};

const isMobile = documentRef => {
  const app = documentRef.getElementById('app');
  return app?.dataset.layout === 'mobile' || documentRef.body?.dataset.layout === 'mobile';
};

const handleForPanel = panel => panel?.querySelector?.('[data-sheet-handle]') || null;

function internalSnap(panel) {
  const fromPanel = Number(panel?.dataset?.sheetSnap);
  if (Number.isFinite(fromPanel)) return fromPanel;
  const fromHandle = Number(handleForPanel(panel)?.getAttribute('aria-valuenow'));
  return Number.isFinite(fromHandle) ? fromHandle : 1;
}

function dispatchHandleKey(handle, key) {
  if (!isHtmlElement(handle)) return false;
  const KeyboardEventCtor = handle.ownerDocument?.defaultView?.KeyboardEvent;
  if (typeof KeyboardEventCtor !== 'function') return false;
  programmaticSnapDepth += 1;
  try {
    return handle.dispatchEvent(new KeyboardEventCtor('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));
  } finally {
    programmaticSnapDepth -= 1;
  }
}

function normalizeTwoSnapAria(panel) {
  if (!isHtmlElement(panel) || !TWO_SNAP_PANEL_IDS.has(panel.id)) return;
  const handle = handleForPanel(panel);
  if (!isHtmlElement(handle)) return;
  const snap = internalSnap(panel);
  const expanded = snap >= 2;
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '1');
  handle.setAttribute('aria-valuenow', expanded ? '1' : '0');
  handle.setAttribute('aria-valuetext', expanded ? '확장' : '중간 높이');
}

function normalizeEditorAria(panel) {
  if (!isHtmlElement(panel) || panel.id !== EDIT_PANEL_ID) return;
  const handle = handleForPanel(panel);
  if (!isHtmlElement(handle)) return;
  const snap = Math.max(0, Math.min(2, internalSnap(panel)));
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '2');
  handle.setAttribute('aria-valuenow', String(snap));
  handle.setAttribute('aria-valuetext', ['접힘', '중간 높이', '확장'][snap]);
}

function closeTransientCollapsedSheet(panel, documentRef) {
  if (!isHtmlElement(panel) || !TWO_SNAP_PANEL_IDS.has(panel.id)) return;
  if (!isMobile(documentRef) || !panel.classList.contains('mobile-open') || internalSnap(panel) !== 0) return;
  queueMicrotask(() => {
    if (!isMobile(documentRef) || !panel.classList.contains('mobile-open') || internalSnap(panel) !== 0) return;
    dispatchHandleKey(handleForPanel(panel), 'Escape');
  });
}

function setEditorSnap(panel, target) {
  if (!isHtmlElement(panel)) return;
  const handle = handleForPanel(panel);
  if (!isHtmlElement(handle)) return;
  const current = internalSnap(panel);
  if (current === target) return;
  if (target <= 0) dispatchHandleKey(handle, 'Home');
  else if (target >= 2) dispatchHandleKey(handle, 'End');
  else if (current < 1) dispatchHandleKey(handle, 'ArrowUp');
  else if (current > 1) dispatchHandleKey(handle, 'ArrowDown');
}

function redirectHiddenToolbarFocus(documentRef, active) {
  if (!active) return;
  const toolbar = documentRef.getElementById('mapToolToolbar');
  if (!toolbar?.contains(documentRef.activeElement)) return;
  requestAnimationFrame(() => documentRef.getElementById('modeCancelBtn')?.focus({ preventScroll: true }));
}

function syncDirectEditState(documentRef) {
  const context = documentRef.getElementById('modeEditingContext');
  const panel = documentRef.getElementById(EDIT_PANEL_ID);
  if (!isHtmlElement(context) || !isHtmlElement(panel)) return;

  const active = isMobile(documentRef) && !context.classList.contains('hidden');
  documentRef.body.classList.toggle('mobile-direct-edit', active);
  redirectHiddenToolbarFocus(documentRef, active);

  if (active && !editSession) {
    const wasOpen = panel.classList.contains('mobile-open');
    editSession = {
      wasOpen,
      preSnap: wasOpen ? Math.max(0, Math.min(2, internalSnap(panel))) : null,
      autoCollapsed: false,
      userTouched: false,
    };
    if (wasOpen && internalSnap(panel) !== 0) {
      editSession.autoCollapsed = true;
      setEditorSnap(panel, 0);
    }
    return;
  }

  if (!active && editSession) {
    const session = editSession;
    editSession = null;
    if (
      session.autoCollapsed
      && !session.userTouched
      && panel.classList.contains('mobile-open')
      && session.preSnap != null
    ) {
      setEditorSnap(panel, session.preSnap);
    }
  }
}

function markEditorTouched(target, documentRef) {
  if (!editSession || programmaticSnapDepth > 0 || !isMobile(documentRef)) return;
  const handle = target?.closest?.('[data-sheet-handle]');
  if (handle?.dataset.sheetHandle === EDIT_PANEL_ID) editSession.userTouched = true;
}

function installHandleGuards(documentRef) {
  documentRef.addEventListener('click', event => {
    const handle = event.target?.closest?.('[data-sheet-handle]');
    if (!isHtmlElement(handle) || !isMobile(documentRef)) return;
    const panel = documentRef.getElementById(handle.dataset.sheetHandle || '');
    if (!isHtmlElement(panel)) return;

    if (panel.id === EDIT_PANEL_ID) markEditorTouched(handle, documentRef);
    if (!TWO_SNAP_PANEL_IDS.has(panel.id) || programmaticSnapDepth > 0 || handle.dataset.dragged === 'true') return;

    const current = internalSnap(panel);
    if (current >= 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dispatchHandleKey(handle, 'ArrowDown');
    }
  }, true);

  documentRef.addEventListener('keydown', event => {
    const handle = event.target?.closest?.('[data-sheet-handle]');
    if (!isHtmlElement(handle) || !isMobile(documentRef)) return;
    const panel = documentRef.getElementById(handle.dataset.sheetHandle || '');
    if (!isHtmlElement(panel)) return;

    if (panel.id === EDIT_PANEL_ID && SNAP_KEYS.has(event.key)) markEditorTouched(handle, documentRef);
    if (!TWO_SNAP_PANEL_IDS.has(panel.id) || programmaticSnapDepth > 0) return;

    const current = internalSnap(panel);
    if ((event.key === 'ArrowDown' || event.key === 'PageDown') && current <= 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (current >= 2) dispatchHandleKey(handle, 'ArrowDown');
    }
  }, true);

  documentRef.addEventListener('pointerdown', event => markEditorTouched(event.target, documentRef), true);
}

function observePanels(documentRef) {
  for (const id of ['leftPanel', 'createMenu', EDIT_PANEL_ID]) {
    const panel = documentRef.getElementById(id);
    if (!isHtmlElement(panel)) continue;
    const sync = () => {
      if (TWO_SNAP_PANEL_IDS.has(id)) {
        normalizeTwoSnapAria(panel);
        closeTransientCollapsedSheet(panel, documentRef);
      } else {
        normalizeEditorAria(panel);
      }
    };
    sync();
    new MutationObserver(sync).observe(panel, {
      attributes: true,
      attributeFilter: ['data-sheet-snap', 'class'],
    });
  }
}

function observeEditContext(documentRef) {
  const context = documentRef.getElementById('modeEditingContext');
  if (!isHtmlElement(context)) return;
  const sync = () => syncDirectEditState(documentRef);
  sync();
  new MutationObserver(sync).observe(context, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

function observeLayout(documentRef) {
  const app = documentRef.getElementById('app');
  if (!isHtmlElement(app)) return;
  const sync = () => {
    syncDirectEditState(documentRef);
    for (const id of ['leftPanel', 'createMenu', EDIT_PANEL_ID]) {
      const panel = documentRef.getElementById(id);
      if (TWO_SNAP_PANEL_IDS.has(id)) normalizeTwoSnapAria(panel);
      else normalizeEditorAria(panel);
    }
  };
  sync();
  new MutationObserver(sync).observe(app, {
    attributes: true,
    attributeFilter: ['data-layout'],
  });
}

export function installMobileSheetController(documentRef = document) {
  if (installed) return;
  installed = true;
  installFeedbackController(documentRef);
  installHandleGuards(documentRef);
  observePanels(documentRef);
  observeEditContext(documentRef);
  observeLayout(documentRef);
}
