const UI_TARGET_SELECTOR = 'button,input,select,textarea,a,[contenteditable="true"],.reference-image-panel,.editor-drawer';

export function referenceImageEventTargetsMap(event, mapElement) {
  if (!event || !mapElement) return false;
  if (event.target?.closest?.(UI_TARGET_SELECTOR)) return false;
  const x = Number(event.clientX);
  const y = Number(event.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const rect = mapElement.getBoundingClientRect?.();
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** In-progress touch gestures have one map owner; the second finger promotes
 * the gesture to pinch without committing reference-image trace points. */
export function createReferenceImageTouchTracker() {
  const pointers = new Set();
  let pinching = false;
  return {
    begin(event) {
      if (event.pointerType !== 'touch') return false;
      pointers.add(event.pointerId);
      if (pointers.size > 1) pinching = true;
      return pinching;
    },
    end(event) {
      if (event.pointerType !== 'touch') return false;
      const wasPinching = pinching;
      pointers.delete(event.pointerId);
      if (pointers.size === 0) pinching = false;
      return wasPinching;
    },
    get pinching() { return pinching; },
    reset() { pointers.clear(); pinching = false; },
  };
}
