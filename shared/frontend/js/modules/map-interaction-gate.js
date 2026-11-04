const DEFAULT_PANDO_SELECTOR = [
  '.user-label',
  '.map-validation-marker',
  '[data-pando-map-input]',
].join(',');

export function createMapInteractionGate({ selector = DEFAULT_PANDO_SELECTOR } = {}) {
  let forcedPan = false;
  let navigationEnabled = true;

  function isPandoTarget(target) {
    return !!target?.closest?.(selector);
  }

  function ownerForEvent(target) {
    if (forcedPan) return 'host';
    if (isPandoTarget(target)) return 'pando';
    return navigationEnabled ? 'host' : 'pando';
  }

  return Object.freeze({
    isPandoTarget,
    ownerForEvent,
    setForcedPan(value) { forcedPan = value === true; },
    setNavigationEnabled(value) { navigationEnabled = value !== false; },
    stats: () => Object.freeze({ forcedPan, navigationEnabled }),
  });
}
