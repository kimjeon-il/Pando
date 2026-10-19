// Internal, late-bound input port. The map owns pointer routing, not listener order.
let owner = null;
let temporarySpacePan = false;
export function registerReferenceImageInput(input) {
  owner = input;
  return () => { if (owner === input) { owner = null; temporarySpacePan = false; } };
}
export function beginReferenceImageGesture(point, event, context) {
  return owner?.begin?.(point, event, context) || null;
}
export function referenceImageSurfaceOpen() { return owner?.surfaceOpen?.() === true; }
export function setReferenceImageSpacePan(active) { temporarySpacePan = active === true; }
export function referenceImageNavigationHeld() {
  return temporarySpacePan || owner?.mapNavigationActive?.() === true;
}
export function referenceImageInputActive() {
  return !!owner?.active?.() || (referenceImageSurfaceOpen() && referenceImageNavigationHeld());
}
export function handleReferenceImageKey(event) { return owner?.key?.(event) === true; }
export function cancelReferenceImageInput() { owner?.cancel?.(); }
export function resetReferenceImageSession() { owner?.reset?.(); }
export function referenceImageKeyBlocked(event) {
  if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return true;
  return [...document.querySelectorAll('[aria-modal="true"]')].some(node => !node.hidden && !node.classList.contains('hidden') && node.getClientRects().length);
}
