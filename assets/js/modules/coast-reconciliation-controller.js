export function createCoastReconciliationController({ document, window, elements, onResolve } = {}) {
  let pending = null;

  function close(reason = 'cancel') {
    if (!pending) return;
    const current = pending;
    pending = null;
    elements.modal?.classList.add('hidden');
    current.resolve({ direction: reason === 'country-to-admin' || reason === 'admin-to-country' ? reason : reason === 'independent' ? 'independent' : 'cancel' });
  }

  function open({ subjectName = '행정구역', subjectActionLabel = '행정구역', countryName = '국가', conflicts = [] } = {}) {
    if (!elements.modal) return Promise.resolve({ direction: 'cancel' });
    close('cancel');
    elements.title.textContent = '해안선이 서로 일치하지 않습니다';
    elements.message.textContent = `${subjectName}과(와) ${countryName}의 해안선이 같은 구간에서 서로 다릅니다.\n어느 해안선을 기준으로 맞출지 선택하세요.`;
    if (elements.subject) elements.subject.textContent = `${subjectActionLabel} 기준`;
    const impactItems = [
      `${conflicts.length}개 해안 구간에서 불일치가 발견되었습니다.`,
      '선택한 기준에 따라 한 번의 실행취소로 되돌릴 수 있습니다.',
    ];
    elements.impact?.classList.remove('hidden');
    if (elements.impactList) elements.impactList.replaceChildren(...impactItems.map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
    elements.modal.classList.remove('hidden');
    window.requestAnimationFrame(() => elements.country?.focus());
    return new Promise(resolve => {
      pending = { resolve };
      onResolve?.(pending);
    });
  }

  function bind() {
    elements.country?.addEventListener('click', () => close('country-to-admin'));
    elements.subject?.addEventListener('click', () => close('admin-to-country'));
    elements.independent?.addEventListener('click', () => close('independent'));
    elements.cancel?.addEventListener('click', () => close('cancel'));
    elements.backdrop?.addEventListener('click', () => close('cancel'));
    elements.modal?.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close('cancel');
      }
    });
  }

  return Object.freeze({ bind, close, isOpen: () => !elements.modal?.classList.contains('hidden'), open });
}
