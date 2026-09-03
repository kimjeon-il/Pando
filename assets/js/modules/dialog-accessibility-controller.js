const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const MODAL_SELECTOR = '.ui-dialog[aria-modal="true"]:not(#confirmModal)';

let installed = false;
let openSequence = 0;
const dialogState = new WeakMap();

function isHidden(element) {
  return !element
    || element.hidden
    || element.classList?.contains('hidden')
    || element.closest?.('[hidden], .hidden, [aria-hidden="true"]')
    || (element instanceof HTMLElement && element.getClientRects().length === 0);
}

function focusables(container) {
  if (!(container instanceof HTMLElement)) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => !isHidden(element));
}

function dialogOpen(dialog) {
  return dialog instanceof HTMLElement && !dialog.hidden && !dialog.classList.contains('hidden');
}

function topOpenDialog(documentRef) {
  return [...documentRef.querySelectorAll(MODAL_SELECTOR)]
    .filter(dialogOpen)
    .sort((a, b) => (dialogState.get(a)?.order || 0) - (dialogState.get(b)?.order || 0))
    .at(-1) || null;
}

function syncDialog(dialog, documentRef) {
  if (!(dialog instanceof HTMLElement)) return;
  let state = dialogState.get(dialog);
  if (!state) {
    state = { open: false, order: 0, trigger: null };
    dialogState.set(dialog, state);
  }

  const open = dialogOpen(dialog);
  if (open && !state.open) {
    state.open = true;
    state.order = ++openSequence;
    const active = documentRef.activeElement;
    state.trigger = active instanceof HTMLElement && !dialog.contains(active) ? active : null;
    requestAnimationFrame(() => {
      if (!dialogOpen(dialog) || dialog.contains(documentRef.activeElement)) return;
      focusables(dialog)[0]?.focus({ preventScroll: true });
    });
    return;
  }

  if (!open && state.open) {
    state.open = false;
    const trigger = state.trigger;
    state.trigger = null;
    requestAnimationFrame(() => {
      if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return;
      if (topOpenDialog(documentRef)) return;
      trigger.focus({ preventScroll: true });
    });
  }
}

export function installDialogAccessibilityController(documentRef = document) {
  if (installed) return;
  installed = true;

  const dialogs = [...documentRef.querySelectorAll(MODAL_SELECTOR)];
  dialogs.forEach(dialog => {
    syncDialog(dialog, documentRef);
    new MutationObserver(() => syncDialog(dialog, documentRef)).observe(dialog, {
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  });

  documentRef.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const dialog = topOpenDialog(documentRef);
    if (!(dialog instanceof HTMLElement)) return;
    const active = documentRef.activeElement;
    if (active?.closest?.('.ui-select-popover:not([hidden]), [data-color-picker].is-open')) return;
    const items = focusables(dialog);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, true);
}
