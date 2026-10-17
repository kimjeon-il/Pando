/** Schedule optional physical resources after the canonical country mesh.
 * No timer is allocated until readiness; viewport tile loading remains in Web owners.
 */
export function schedulePhysicalAfterCanonical({
  scope, load, timeout = 1500,
} = {}) {
  if (!scope?.addEventListener || typeof load !== 'function') {
    throw new TypeError('A readable app event source and physical loader are required.');
  }
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    load();
  };
  scope.addEventListener('pandolab:ready', () => {
    if (typeof scope.requestIdleCallback === 'function') {
      scope.requestIdleCallback(start, { timeout });
    } else {
      // A WebView may omit requestIdleCallback. The ready event must not
      // permanently strand terrain or hydro in that environment.
      scope.setTimeout(start, 0);
    }
  }, { once: true });
}
