// Internal, late-bound input port. The map owns pointer routing, not listener order.
let owner = null;
export function registerReferenceImageInput(input) {
  owner = input;
  return () => { if (owner === input) owner = null; };
}
export function beginReferenceImageGesture(point, event, context) {
  return owner?.begin?.(point, event, context) || null;
}
export function referenceImageInputActive() { return !!owner?.active?.(); }
export function handleReferenceImageKey(event) { return owner?.key?.(event) === true; }
export function cancelReferenceImageInput() { owner?.cancel?.(); }
export function resetReferenceImageSession() { owner?.reset?.(); }
export function referenceImageKeyBlocked(event) {
  if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return true;
  return [...document.querySelectorAll('[aria-modal="true"]')].some(node => !node.hidden && !node.classList.contains('hidden') && node.getClientRects().length);
}
