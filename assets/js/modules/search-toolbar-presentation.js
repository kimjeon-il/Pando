/** Position the existing search surface over its desktop toolbar slot.
 * The surface remains at its authored DOM location across every layout. */
export function createSearchToolbarPresentation({ document, panel, toolbar, slot, results, isOpen, isMobile, schedulePosition }) {
  const trigger = document.getElementById('objectSearchBtn');
  const properties = ['--search-toolbar-left', '--search-toolbar-top',
    '--search-toolbar-width', '--search-toolbar-height', '--search-results-max-height'];

  function clearDesktopGeometry() {
    slot.style.removeProperty('--search-toolbar-available-width');
    for (const property of properties) panel.style.removeProperty(property);
  }

  function position() {
    if (isMobile() || !toolbar.getClientRects().length || !slot.getClientRects().length) return;
    const view = document.defaultView;
    const viewport = view.visualViewport;
    const style = view.getComputedStyle(slot);
    const edge = Number.parseFloat(style.getPropertyValue('--ui-menu-screen-edge')) || 8;
    const gap = Number.parseFloat(style.getPropertyValue('--ui-menu-trigger-gap')) || 6;
    const toolbarRect = toolbar.getBoundingClientRect();
    const initialSlotRect = slot.getBoundingClientRect();
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || view.innerWidth;
    const chromeWidth = toolbarRect.width - initialSlotRect.width;
    slot.style.setProperty('--search-toolbar-available-width',
      String(Math.max(0, viewportWidth - edge * 2 - chromeWidth)) + 'px');
    if (!isOpen()) {
      panel.style.removeProperty('--search-results-max-height');
      return;
    }
    // Re-measure once the toolbar width constraint has been applied.
    const rect = slot.getBoundingClientRect();
    panel.style.setProperty('--search-toolbar-left', String(rect.left) + 'px');
    panel.style.setProperty('--search-toolbar-top', String(rect.top) + 'px');
    panel.style.setProperty('--search-toolbar-width', String(rect.width) + 'px');
    panel.style.setProperty('--search-toolbar-height', String(rect.height) + 'px');
    const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom || viewportTop;
    panel.style.setProperty('--search-results-max-height',
      String(Math.max(0, rect.top - gap - Math.max(viewportTop, topbarBottom) - edge)) + 'px');
  }

  function sync() {
    const mobile = isMobile();
    const desktopOpen = !mobile && isOpen();
    panel.classList.toggle('search-toolbar-desktop', !mobile);
    slot.classList.toggle('is-expanded', desktopOpen);
    trigger.hidden = desktopOpen;
    results.classList.toggle('ui-floating-surface', !mobile);
    if (mobile) {
      clearDesktopGeometry();
    } else {
      position();
      schedulePosition();
    }
  }

  // The slot animates while the toolbar remains centered. Track its actual
  // rectangle throughout the transition without moving the search DOM.
  const observer = new document.defaultView.ResizeObserver(schedulePosition);
  observer.observe(toolbar);
  observer.observe(slot);
  const topbar = document.querySelector('.topbar');
  if (topbar) observer.observe(topbar);
  return Object.freeze({
    sync, position,
    dispose() { observer.disconnect(); clearDesktopGeometry(); },
  });
}
