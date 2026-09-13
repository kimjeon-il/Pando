const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

function viewportBounds(windowRef) {
  const viewport = windowRef.visualViewport;
  return {
    left: viewport?.offsetLeft || 0,
    top: viewport?.offsetTop || 0,
    width: viewport?.width || windowRef.innerWidth,
    height: viewport?.height || windowRef.innerHeight,
  };
}

function cssPixels(element, property, fallback) {
  const value = parseFloat(element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

function menuMetrics(menu, viewport, edge) {
  const rect = menu.getBoundingClientRect();
  const width = Math.min(rect.width, Math.max(0, viewport.width - edge * 2));
  const chromeHeight = Math.max(0, menu.offsetHeight - menu.clientHeight);
  const height = Math.min(menu.scrollHeight + chromeHeight, Math.max(0, viewport.height - edge * 2));
  return { width, height };
}

function setMenuPosition(menu, { left, top, maxHeight }) {
  menu.style.setProperty('--ui-menu-position-left', `${Math.round(left)}px`);
  menu.style.setProperty('--ui-menu-position-top', `${Math.round(top)}px`);
  menu.style.setProperty('--ui-menu-position-max-height', `${Math.max(0, Math.round(maxHeight))}px`);
}

export function clearMenuPosition(menu) {
  if (!menu) return;
  for (const property of ['left', 'top', 'max-height']) menu.style.removeProperty(`--ui-menu-position-${property}`);
}

export function positionRootMenu({ menu, trigger, windowRef = window }) {
  if (!menu || !trigger || !menu.getClientRects().length || !trigger.getClientRects().length) return false;
  const viewport = viewportBounds(windowRef);
  const edge = cssPixels(menu, '--ui-menu-screen-edge', 8);
  const gap = cssPixels(menu, '--ui-menu-trigger-gap', 6);
  const triggerRect = trigger.getBoundingClientRect();
  const { width, height } = menuMetrics(menu, viewport, edge);
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const availableBelow = Math.max(0, viewportBottom - edge - triggerRect.bottom - gap);
  const availableAbove = Math.max(0, triggerRect.top - gap - (viewport.top + edge));
  const opensAbove = height > availableBelow && availableAbove > availableBelow;
  const availableHeight = opensAbove ? availableAbove : availableBelow;
  const visibleHeight = Math.min(height, availableHeight);
  const idealTop = opensAbove ? triggerRect.top - gap - visibleHeight : triggerRect.bottom + gap;
  const left = Math.max(viewport.left + edge, Math.min(triggerRect.left, viewportRight - edge - width));
  const top = Math.max(viewport.top + edge, Math.min(idealTop, viewportBottom - edge - visibleHeight));
  setMenuPosition(menu, { left, top, maxHeight: availableHeight });
  return true;
}

export function positionSubmenu({ menu, trigger, parentMenu = null, windowRef = window }) {
  if (!menu || !trigger || !menu.getClientRects().length || !trigger.getClientRects().length) return false;
  const viewport = viewportBounds(windowRef);
  const edge = cssPixels(menu, '--ui-menu-screen-edge', 8);
  const gap = cssPixels(menu, '--ui-menu-trigger-gap', 6);
  const triggerRect = trigger.getBoundingClientRect();
  const parentRect = parentMenu?.getBoundingClientRect() || triggerRect;
  const { width, height } = menuMetrics(menu, viewport, edge);
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const rightLeft = parentRect.right + gap;
  const leftLeft = parentRect.left - gap - width;
  const rightSpace = viewportRight - edge - rightLeft;
  const leftSpace = leftLeft - (viewport.left + edge);
  const opensLeft = rightSpace < width && leftSpace > rightSpace;
  const idealLeft = opensLeft ? leftLeft : rightLeft;
  const left = Math.max(viewport.left + edge, Math.min(idealLeft, viewportRight - edge - width));
  const top = Math.max(viewport.top + edge, Math.min(triggerRect.top, viewportBottom - edge - height));
  setMenuPosition(menu, { left, top, maxHeight: viewport.height - edge * 2 });
  return true;
}

export function createMenuPositionScheduler(callback, {
  requestFrame = callbackToRun => requestAnimationFrame(callbackToRun),
  cancelFrame = frame => cancelAnimationFrame(frame),
} = {}) {
  let frame = 0;
  return Object.freeze({
    schedule() {
      if (frame) return;
      frame = requestFrame(() => {
        frame = 0;
        callback();
      });
    },
    cancel() {
      if (!frame) return;
      cancelFrame(frame);
      frame = 0;
    },
  });
}

function isTabbable(element) {
  if (!(element instanceof HTMLElement) || element.tabIndex < 0 || element.hidden || element.closest('[hidden], .hidden, [inert]')) return false;
  if (element.matches(':disabled, [aria-disabled="true"]')) return false;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function documentTabOrder(documentRef) {
  return [...documentRef.querySelectorAll(TABBABLE_SELECTOR)]
    .filter(isTabbable)
    .map((element, order) => ({ element, order, tabIndex: element.tabIndex }))
    .sort((left, right) => {
      const leftPositive = left.tabIndex > 0;
      const rightPositive = right.tabIndex > 0;
      if (leftPositive !== rightPositive) return leftPositive ? -1 : 1;
      if (leftPositive && left.tabIndex !== right.tabIndex) return left.tabIndex - right.tabIndex;
      return left.order - right.order;
    })
    .map(entry => entry.element);
}

export function exitMenuOnTab(event, { menus, trigger, close }) {
  if (event.key !== 'Tab') return false;
  const menuList = (Array.isArray(menus) ? menus : [menus]).filter(Boolean);
  const documentRef = trigger?.ownerDocument || event.currentTarget?.ownerDocument || document;
  const outside = documentTabOrder(documentRef)
    .filter(element => !menuList.some(menu => element === menu || menu.contains(element)));
  const triggerIndex = outside.indexOf(trigger);
  const targetIndex = triggerIndex + (event.shiftKey ? -1 : 1);
  const target = triggerIndex >= 0 && targetIndex >= 0 && targetIndex < outside.length
    ? outside[targetIndex]
    : trigger;
  event.preventDefault();
  event.stopPropagation();
  close?.();
  queueMicrotask(() => {
    const fallback = isTabbable(trigger) ? trigger : null;
    const focusTarget = isTabbable(target) ? target : fallback;
    focusTarget?.focus({ preventScroll: true });
  });
  return true;
}
