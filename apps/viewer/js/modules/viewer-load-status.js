/** Present loading feedback without owning document or renderer readiness. */
export function presentViewerLoadStatus(element, message, {error = false} = {}) {
  // The normal live region stays in the accessibility tree. Only errors use
  // the top notice stack; retries remain ordinary, focusable shared buttons.
  element.className = error ? 'ui-floating-surface viewer-map-error' : 'ui-visually-hidden';
  element.setAttribute('role', error ? 'alert' : 'status');
  element.setAttribute('aria-live', error ? 'assertive' : 'polite');
  element.setAttribute('aria-atomic', 'true');
  element.hidden = false;
  element.textContent = message;
}
