const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function createConfirmModalController({
  document,
  window,
  elements,
  setChoices,
  beforeOpen = () => {},
}) {
  let action = null;
  let restoreFocusTarget = null;

  const focusableElements = () => [...(elements.modal?.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])]
    .filter(element => !element.hidden && !element.closest('[hidden], .hidden, [aria-hidden="true"]'));

  function restoreFocus() {
    const target = restoreFocusTarget;
    restoreFocusTarget = null;
    if (!(target instanceof HTMLElement) || !target.isConnected) return;
    window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  function close({ restore = true } = {}) {
    elements.modal?.classList.add('hidden');
    elements.choiceRow?.classList.add('hidden');
    elements.impactSection?.classList.add('hidden');
    action = null;
    if (restore) restoreFocus();
  }

  function open({
    title = '확인', message = '', confirmText = '확인', cancelText = '취소', danger = false,
    choices = [], impacts = [], onConfirm = null,
  } = {}) {
    if (!elements.modal) return false;
    beforeOpen();
    const active = document.activeElement;
    restoreFocusTarget = active instanceof HTMLElement && !elements.modal.contains(active) ? active : restoreFocusTarget;
    elements.title.textContent = title;
    elements.message.textContent = message;
    const impactItems = (impacts || []).map(value => String(value || '').trim()).filter(Boolean);
    elements.impactSection?.classList.toggle('hidden', !impactItems.length);
    if (elements.impactList) elements.impactList.replaceChildren(...impactItems.map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
    elements.ok.textContent = confirmText;
    elements.ok.classList.toggle('danger-confirm', !!danger);
    if (elements.cancel) elements.cancel.textContent = cancelText;
    const hasChoices = Array.isArray(choices) && choices.length > 0;
    elements.choiceRow.classList.toggle('hidden', !hasChoices);
    if (hasChoices) setChoices(elements.choice, choices, choices[0].value);
    action = typeof onConfirm === 'function'
      ? () => onConfirm(hasChoices ? elements.choice.value : undefined)
      : null;
    elements.modal.classList.remove('hidden');
    window.requestAnimationFrame(() => {
      const initial = danger && elements.cancel
        ? elements.cancel
        : hasChoices ? elements.choice : elements.ok;
      initial?.focus({ preventScroll: true });
    });
    return true;
  }

  function confirm() {
    const pending = action;
    close();
    pending?.();
  }

  function handleKeydown(event) {
    if (elements.modal?.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = focusableElements();
    if (!focusables.length) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables.at(-1);
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !elements.modal.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function bind() {
    elements.cancel?.addEventListener('click', close);
    elements.backdrop?.addEventListener('click', close);
    elements.ok?.addEventListener('click', confirm);
    elements.modal?.addEventListener('keydown', handleKeydown);
  }

  return Object.freeze({ bind, close, confirm, isOpen: () => !elements.modal?.classList.contains('hidden'), open });
}
