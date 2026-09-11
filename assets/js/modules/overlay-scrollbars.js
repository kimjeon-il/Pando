export function scrollbarGeometry(viewport, content, offset, minimum = 48) {
  const maximum = Math.max(0, content - viewport);
  const thumb = maximum ? Math.min(viewport, Math.max(minimum, viewport * viewport / content)) : viewport;
  const travel = viewport - thumb;
  return { maximum, thumb, travel, top: maximum ? Math.max(0, Math.min(maximum, offset)) / maximum * travel : 0 };
}

// Native elements retain scrolling, events and virtualization; chrome takes no space.
export function installOverlayScrollbars(documentRef = document) {
  const view = documentRef.defaultView;
  if (!view?.ResizeObserver) return () => {};
  const selector = '.ui-scroll-surface, .surface-body, .gis-import-content-rail, .historical-library-results, .historical-library-preview';
  const popupSelector = '[role="menu"], .ui-popover, .ui-select-popover';
  const visible = node => node.getClientRects().length
    && !node.closest('[hidden], .hidden, [aria-hidden="true"]')
    && view.getComputedStyle(node).visibility !== 'hidden';
  const records = new Map();
  const dialogOrder = new Map();
  let openSequence = 0;
  let frame = 0, nextId = 0;
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(update); };
  const resize = new view.ResizeObserver(schedule);
  const geometry = element => scrollbarGeometry(element.clientHeight, element.scrollHeight, element.scrollTop,
    (parseFloat(view.getComputedStyle(documentRef.documentElement).fontSize) || 16) * 3);
  const update = () => {
    frame = 0;
    const dialogs = [...documentRef.querySelectorAll('[aria-modal="true"]')].filter(node =>
      node.getClientRects().length && !node.closest('[hidden], .hidden, [aria-hidden="true"]')
      && view.getComputedStyle(node).visibility !== 'hidden');
    for (const node of dialogOrder.keys()) if (!dialogs.includes(node)) dialogOrder.delete(node);
    for (const node of dialogs) if (!dialogOrder.has(node)) dialogOrder.set(node, ++openSequence);
    const modal = dialogs.sort((a, b) => dialogOrder.get(a) - dialogOrder.get(b)).at(-1);
    const popups = [...documentRef.querySelectorAll(popupSelector)].filter(visible)
      .map(node => ({ node, rect: node.getBoundingClientRect() }));
    for (const [element, record] of records) if (!element.isConnected) { record.dispose(); records.delete(element); }
    for (const element of documentRef.querySelectorAll(selector)) {
      if (!records.has(element)) install(element);
      const { track, thumb } = records.get(element), rect = element.getBoundingClientRect(), style = view.getComputedStyle(element);
      const g = geometry(element), rootSize = parseFloat(view.getComputedStyle(documentRef.documentElement).fontSize) || 16;
      const owner = element.closest('[aria-modal="true"]');
      const host = owner || documentRef.body;
      if (track.parentElement !== host) host.append(track);
      track.classList.toggle('ui-overlay-scrollbar--dialog', !!owner);
      track.hidden = !g.maximum || !element.getClientRects().length || style.visibility === 'hidden'
        || (!!modal && !modal.contains(element))
        || rect.bottom <= 0 || rect.top >= view.innerHeight || rect.right <= 0 || rect.left >= view.innerWidth
        || !['auto', 'scroll'].includes(style.overflowY);
      track.tabIndex = track.hidden ? -1 : 0;
      if (track.hidden) { records.get(element).cancelDrag(); continue; }
      // Dialog tracks are absolute, outside the scrolling card but inside its focus scope.
      const base = owner?.getBoundingClientRect();
      track.style.left = `${rect.right - (parseFloat(style.borderRightWidth) || 0) - rootSize - (base?.left || 0) + (owner?.scrollLeft || 0) - (owner ? parseFloat(view.getComputedStyle(owner).borderLeftWidth) || 0 : 0)}px`;
      track.style.top = `${rect.top + (parseFloat(style.borderTopWidth) || 0) - (base?.top || 0) + (owner?.scrollTop || 0) - (owner ? parseFloat(view.getComputedStyle(owner).borderTopWidth) || 0 : 0)}px`;
      track.style.height = `${element.clientHeight}px`;
      const trackRect = track.getBoundingClientRect();
      track.hidden = popups.some(({ node, rect: popupRect }) => !node.contains(element)
        && popupRect.left < trackRect.right && popupRect.right > trackRect.left
        && popupRect.top < trackRect.bottom && popupRect.bottom > trackRect.top);
      track.tabIndex = track.hidden ? -1 : 0;
      if (track.hidden) records.get(element).cancelDrag();
      thumb.style.height = `${g.thumb}px`;
      thumb.style.transform = `translateY(${g.top}px)`;
      track.setAttribute('aria-valuemax', String(Math.round(g.maximum)));
      track.setAttribute('aria-valuenow', String(Math.round(Math.min(g.maximum, element.scrollTop))));
    }
    if ([...documentRef.querySelectorAll('.is-sheet-dragging, .is-sheet-settling')].some(node =>
      node.getClientRects().length && !node.closest('[hidden], .hidden'))) schedule();
  };
  const install = element => {
    const track = documentRef.createElement('div'), thumb = documentRef.createElement('span');
    track.className = 'ui-overlay-scrollbar'; thumb.className = 'ui-overlay-scrollbar-thumb';
    track.setAttribute('role', 'scrollbar'); track.setAttribute('aria-orientation', 'vertical'); track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-label', `${element.getAttribute('aria-label') || '내용'} 스크롤`);
    const generatedId = !element.id;
    if (generatedId) element.id = `ui-scroll-owner-${++nextId}`;
    track.setAttribute('aria-controls', element.id); track.tabIndex = 0; track.hidden = true;
    track.append(thumb); documentRef.body.append(track); element.classList.add('ui-native-scroll');
    let drag = null;
    const cancelDrag = () => {
      const pointerId = drag?.pointerId;
      drag = null;
      if (pointerId !== undefined && track.hasPointerCapture(pointerId)) track.releasePointerCapture(pointerId);
    };
    track.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); const g = geometry(element);
      if (event.target !== thumb) element.scrollTop = (event.clientY - track.getBoundingClientRect().top - g.thumb / 2) / Math.max(1, g.travel) * g.maximum;
      drag = { pointerId: event.pointerId, y: event.clientY, scroll: element.scrollTop, ratio: g.maximum / Math.max(1, g.travel) };
      track.setPointerCapture(event.pointerId); track.focus({ preventScroll: true }); schedule();
    });
    track.addEventListener('pointermove', event => {
      if (drag) { element.scrollTop = drag.scroll + (event.clientY - drag.y) * drag.ratio; schedule(); }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(type, () => { drag = null; });
    track.addEventListener('keydown', event => {
      const step = (parseFloat(view.getComputedStyle(documentRef.documentElement).fontSize) || 16) * 3;
      const offsets = { ArrowDown: step, ArrowUp: -step, PageDown: element.clientHeight, PageUp: -element.clientHeight, Home: -element.scrollHeight, End: element.scrollHeight };
      if (!(event.key in offsets)) return;
      event.preventDefault(); element.scrollTop += offsets[event.key]; schedule();
    });
    track.addEventListener('wheel', event => {
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      element.scrollTop += event.deltaY * scale; event.preventDefault(); schedule();
    }, { passive: false });
    element.addEventListener('scroll', schedule, { passive: true }); resize.observe(element);
    records.set(element, { track, thumb, cancelDrag, dispose() {
      cancelDrag();
      resize.unobserve(element); element.removeEventListener('scroll', schedule);
      element.classList.remove('ui-native-scroll'); track.remove(); if (generatedId) element.removeAttribute('id');
    } });
  };
  const mutation = new view.MutationObserver(entries => {
    if (entries.some(entry => !entry.target.closest?.('.ui-overlay-scrollbar')
      && (entry.attributeName !== 'style' || entry.target.closest?.(popupSelector)))) schedule();
  });
  mutation.observe(documentRef.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'open', 'data-layout', 'aria-modal', 'aria-hidden', 'style'] });
  view.addEventListener('resize', schedule); documentRef.addEventListener('scroll', schedule, true);
  documentRef.addEventListener('transitionend', schedule, true);
  documentRef.addEventListener('load', schedule, true);
  documentRef.fonts?.addEventListener('loadingdone', schedule);
  view.visualViewport?.addEventListener('resize', schedule);
  view.visualViewport?.addEventListener('scroll', schedule); update();
  return () => {
    mutation.disconnect(); resize.disconnect(); view.removeEventListener('resize', schedule); documentRef.removeEventListener('scroll', schedule, true);
    documentRef.removeEventListener('transitionend', schedule, true);
    documentRef.removeEventListener('load', schedule, true);
    documentRef.fonts?.removeEventListener('loadingdone', schedule);
    view.visualViewport?.removeEventListener('resize', schedule);
    view.visualViewport?.removeEventListener('scroll', schedule);
    for (const record of records.values()) record.dispose(); if (frame) view.cancelAnimationFrame(frame);
  };
}
