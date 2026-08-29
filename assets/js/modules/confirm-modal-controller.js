export function createConfirmModalController({
  document,
  window,
  elements,
  setChoices,
  beforeOpen = () => {},
}) {
  let action = null;

  function close() {
    elements.modal?.classList.add('hidden');
    elements.choiceRow?.classList.add('hidden');
    elements.impactSection?.classList.add('hidden');
    action = null;
  }

  function open({
    title = '확인', message = '', confirmText = '확인', cancelText = '취소', danger = false,
    choices = [], impacts = [], onConfirm = null,
  } = {}) {
    if (!elements.modal) return false;
    beforeOpen();
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
    window.requestAnimationFrame(() => (hasChoices ? elements.choice : elements.ok).focus());
    return true;
  }

  function confirm() {
    const pending = action;
    close();
    pending?.();
  }

  function bind() {
    elements.cancel?.addEventListener('click', close);
    elements.backdrop?.addEventListener('click', close);
    elements.ok?.addEventListener('click', confirm);
  }

  return Object.freeze({ bind, close, confirm, isOpen: () => !elements.modal?.classList.contains('hidden'), open });
}
