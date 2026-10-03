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
