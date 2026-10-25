const DEFAULT_PANDO_SELECTOR = [
  '.vertex-handle',
  '.vertex-hit-area',
  '.draft-interactive',
  '.insert-handle',
  '.segment-hit-area',
  '.user-label',
  '.map-validation-marker',
  '[data-pando-map-input]',
].join(',');

export function createMapInteractionGate({ selector = DEFAULT_PANDO_SELECTOR } = {}) {
  let forcedPan = false;
  let navigationEnabled = true;
  let draftInputActive = false;

  function isPandoTarget(target) {
    return !!target?.closest?.(selector);
  }

  function ownerForEvent(target) {
    if (forcedPan) return 'host';
    if (isPandoTarget(target)) return 'pando';
    if (draftInputActive) return 'pando';
    return navigationEnabled ? 'host' : 'pando';
  }

  return Object.freeze({
    isPandoTarget,
    ownerForEvent,
    setForcedPan(value) { forcedPan = value === true; },
    setNavigationEnabled(value) { navigationEnabled = value !== false; },
    setDraftInputActive(value) { draftInputActive = value === true; },
    stats: () => Object.freeze({ forcedPan, navigationEnabled, draftInputActive }),
  });
}
