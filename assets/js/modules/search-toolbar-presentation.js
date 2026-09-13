/** Reposition the existing search surface without owning its state or results. */
export function createSearchToolbarPresentation({ document, panel, toolbar, slot, results, isOpen, isMobile, schedulePosition }) {
  const anchor = document.createComment('search-sheet-position');
  panel.before(anchor);
  const trigger = document.getElementById('objectSearchBtn');

  function sync() {
    const mobile = isMobile();
    const active = document.activeElement;
    const restoreInput = panel.contains(active) && isOpen();
    const destination = mobile ? anchor.parentNode : slot;
    const moved = panel.parentNode !== destination;
    if (moved) {
      if (mobile) anchor.after(panel);
      else slot.append(panel);
    }
    panel.classList.toggle('search-toolbar-desktop', !mobile);
    slot.classList.toggle('is-expanded', !mobile && isOpen());
    trigger.hidden = !mobile && isOpen();
    results.classList.toggle('ui-floating-surface', !mobile);
    if (mobile) {
      slot.style.removeProperty('--search-toolbar-available-width');
      slot.style.removeProperty('--search-results-max-height');
    }
    if (moved && restoreInput) active.focus({ preventScroll: true });
    if (!mobile) schedulePosition();
  }

  function position() {
    if (isMobile()) return;
    const window = document.defaultView;
    const viewport = window.visualViewport;
    const style = window.getComputedStyle(slot);
    const edge = parseFloat(style.getPropertyValue('--ui-menu-screen-edge'));
    const gap = parseFloat(style.getPropertyValue('--ui-menu-trigger-gap'));
    const toolbarRect = toolbar.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const chromeWidth = toolbarRect.width - slotRect.width;
    slot.style.setProperty('--search-toolbar-available-width', `${Math.max(0, viewportWidth - edge * 2 - chromeWidth)}px`);
    if (isOpen()) {
      const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom || viewportTop;
      slot.style.setProperty('--search-results-max-height', `${Math.max(0, slotRect.top - gap - Math.max(viewportTop, topbarBottom) - edge)}px`);
    } else {
      slot.style.removeProperty('--search-results-max-height');
    }
  }

  const observer = new document.defaultView.ResizeObserver(schedulePosition);
  observer.observe(toolbar);
  const topbar = document.querySelector('.topbar');
  if (topbar) observer.observe(topbar);
  return Object.freeze({ sync, position });
}
