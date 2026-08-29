export function createTooltipController({
  document,
  window,
  tooltip,
  clamp,
  idPrefix = 'ui-tooltip-owner-',
}) {
  function hide() {
    if (!tooltip) return;
    const ownerId = tooltip.dataset.ownerId;
    if (ownerId) document.getElementById(ownerId)?.removeAttribute('aria-describedby');
    tooltip.classList.add('hidden');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.textContent = '';
    delete tooltip.dataset.ownerId;
  }

  function show(target) {
    if (!target || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const value = String(target.dataset.tooltip || '').trim();
    if (!value || !tooltip) return;
    if (!target.id) target.id = `${idPrefix}${Math.random().toString(36).slice(2, 9)}`;
    tooltip.textContent = value;
    tooltip.dataset.ownerId = target.id;
    tooltip.classList.remove('hidden');
    tooltip.setAttribute('aria-hidden', 'false');
    target.setAttribute('aria-describedby', tooltip.id);
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const edge = 8;
    const left = clamp(targetRect.left + targetRect.width / 2 - tooltipRect.width / 2, edge, window.innerWidth - tooltipRect.width - edge);
    const preferredTop = targetRect.bottom + edge;
    const top = preferredTop + tooltipRect.height <= window.innerHeight - edge
      ? preferredTop
      : Math.max(edge, targetRect.top - tooltipRect.height - edge);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function bind() {
    document.addEventListener('pointerover', event => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const target = event.target.closest?.('[data-tooltip]');
      if (target && !target.contains(event.relatedTarget)) show(target);
    });
    document.addEventListener('pointerout', event => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target && !target.contains(event.relatedTarget)) hide();
    });
    document.addEventListener('focusin', event => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target && document.documentElement.classList.contains('keyboard-navigation')) show(target);
    });
    document.addEventListener('focusout', event => {
      if (event.target.closest?.('[data-tooltip]')) hide();
    });
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  return Object.freeze({ bind, hide, show });
}
