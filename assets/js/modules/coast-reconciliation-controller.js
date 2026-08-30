export function createCoastReconciliationController({ document, window, elements, onResolve } = {}) {
  let pending = null;

  function close(reason = 'cancel') {
    if (!pending) return;
    const current = pending;
    pending = null;
    elements.modal?.classList.add('hidden');
    current.resolve({ direction: reason === 'country-to-admin' || reason === 'admin-to-country' ? reason : reason === 'independent' ? 'independent' : 'cancel' });
  }

  function open({
    subjectName = '행정구역',
    subjectActionLabel = '행정구역',
    countryName = '국가',
    conflicts = [],
    automaticAvailable = true,
    unavailableReason = '',
  } = {}) {
    if (!elements.modal) return Promise.resolve({ direction: 'cancel' });
    close('cancel');
    elements.title.textContent = automaticAvailable ? '해안선이 서로 일치하지 않습니다' : '해안선을 자동으로 판별할 수 없습니다';
    elements.message.textContent = automaticAvailable
      ? `${subjectName}과(와) ${countryName}의 해안선이 같은 구간에서 서로 다릅니다.\n어느 해안선을 기준으로 맞출지 선택하세요.`
      : `${countryName}의 실제 해안 topology를 신뢰할 수 있게 판별하지 못했습니다.\n독립 유지로 가져오거나 작업을 취소하세요.`;
    if (elements.subject) elements.subject.textContent = `${subjectActionLabel} 기준`;
    if (elements.country) {
      elements.country.disabled = !automaticAvailable;
      elements.country.setAttribute?.('aria-disabled', String(!automaticAvailable));
    }
    if (elements.subject) {
      elements.subject.disabled = !automaticAvailable;
      elements.subject.setAttribute?.('aria-disabled', String(!automaticAvailable));
    }
    const impactItems = automaticAvailable ? [
      `${conflicts.length}개 해안 구간에서 불일치가 발견되었습니다.`,
      '선택한 기준에 따라 한 번의 실행취소로 되돌릴 수 있습니다.',
    ] : [
      unavailableReason === 'country-coast-not-found'
        ? '국가 경계에서 단일 소유 exterior 해안선을 찾지 못했습니다.'
        : '자동 정합에 사용할 신뢰 가능한 해안 구간이 없습니다.',
      '육상 국경을 해안으로 오인하지 않도록 자동 정합을 중단했습니다.',
    ];
    elements.impact?.classList.remove('hidden');
    if (elements.impactList) elements.impactList.replaceChildren(...impactItems.map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
    elements.modal.classList.remove('hidden');
    window.requestAnimationFrame(() => (automaticAvailable ? elements.country : elements.independent || elements.cancel)?.focus());
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
