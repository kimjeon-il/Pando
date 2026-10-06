export function createTooltipController({
  document,
  window,
  tooltip,
  clamp,
  idPrefix = 'ui-tooltip-owner-',
}) {
  let showTimer = 0;
  let mapPointer = null;
  // Derived presentation is updated only by the canonical hover callback. A
  // dismissal hides it, while a fresh pointer hover can present the same ref.
  let mapHoverView = null;
  let mapInteractionActive = false;

  function hide() {
    window.clearTimeout(showTimer);
    showTimer = 0;
    if (!tooltip) return;
    const ownerId = tooltip.dataset.ownerId;
    const owner = ownerId && document.getElementById(ownerId);
    if (owner) {
      const ids = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltip.id);
      if (ids.length) owner.setAttribute('aria-describedby', ids.join(' '));
      else owner.removeAttribute('aria-describedby');
    }
    tooltip.classList.add('hidden');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.textContent = '';
    delete tooltip.dataset.ownerId;
    delete tooltip.dataset.kind;
  }

  function show(target, source = 'pointer') {
    if (!target) return;
    if (source !== 'keyboard' && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const value = String(target.dataset.tooltip || '').trim();
    if (!value || !tooltip) return;
    hide();
    if (!target.id) target.id = `${idPrefix}${Math.random().toString(36).slice(2, 9)}`;
    tooltip.textContent = value;
    tooltip.dataset.ownerId = target.id;
    tooltip.classList.remove('hidden');
    tooltip.setAttribute('aria-hidden', 'false');
    const descriptions = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    descriptions.add(tooltip.id);
    target.setAttribute('aria-describedby', [...descriptions].join(' '));
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

  function positionMapHover() {
    const rect = tooltip.getBoundingClientRect(), edge = 8;
    tooltip.style.left = `${Math.round(clamp(mapPointer.x + edge, edge, Math.max(edge, window.innerWidth - rect.width - edge)))}px`;
    tooltip.style.top = `${Math.round(mapPointer.y + edge + rect.height <= window.innerHeight - edge
      ? mapPointer.y + edge : Math.max(edge, mapPointer.y - rect.height - edge))}px`;
  }

  function setMapHover(view) {
    mapHoverView = view;
    presentMapHover();
  }

  function presentMapHover() {
    const view = mapHoverView;
    if (!view || !mapPointer || mapInteractionActive || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      if (tooltip.dataset.kind === 'country') hide();
      return;
    }
    hide();
    const name = document.createElement('span');
    name.textContent = view.name || view.displayName || '이름 없는 객체';
    const nodes = [name];
    if (view.flagUrl) {
      const flag = document.createElement('img');
      flag.src = view.flagUrl; flag.alt = '';
      flag.addEventListener('error', () => flag.remove(), { once: true });
      nodes.unshift(flag);
    }
    tooltip.replaceChildren(...nodes);
    tooltip.dataset.kind = 'country';
    tooltip.classList.remove('hidden');
    tooltip.setAttribute('aria-hidden', 'false');
    positionMapHover();
  }

  function bind() {
    document.addEventListener('pointermove', event => {
      const map = event.target.closest?.('#map');
      if (event.pointerType !== 'mouse' || event.buttons > 0 || mapInteractionActive || !map || event.target.closest?.('.map-overlay-layer, button, input, select, textarea')) {
        mapPointer = null;
        if (tooltip.dataset.kind === 'country') hide();
        return;
      }
      const moved = !mapPointer || mapPointer.x !== event.clientX || mapPointer.y !== event.clientY;
      mapPointer = { x: event.clientX, y: event.clientY };
      if (tooltip.dataset.kind === 'country') positionMapHover();
      else if (moved) presentMapHover();
    }, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('pandolab:project-changed', () => { mapHoverView = null; hide(); });
    window.addEventListener('pandolab:interaction-state', event => { mapInteractionActive = event.detail?.active === true; hide(); });
    document.addEventListener('pointerover', event => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const target = event.target.closest?.('[data-tooltip]');
      if (!target || target.contains(event.relatedTarget)) return;
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        showTimer = 0;
        if (target.matches(':hover')) show(target);
      }, 420);
    });
    document.addEventListener('pointerout', event => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target && !target.contains(event.relatedTarget)) hide();
    });
    document.addEventListener('focusin', event => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target && document.documentElement.classList.contains('keyboard-navigation')) show(target, 'keyboard');
    });
    document.addEventListener('focusout', event => {
      if (event.target.closest?.('[data-tooltip]')) hide();
    });
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    window.addEventListener('resize', hide);
  }

  return Object.freeze({ bind, hide, show, setMapHover });
}
