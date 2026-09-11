/** Own startup ordering and termination; a BFCache page remains alive. */
export function createApplicationLifecycle({
  window,
  compose = [],
  startup,
  getDisposables = () => [],
  onReady = () => {},
  onError = () => {},
  reportDisposeError = () => {},
} = {}) {
  let started;
  let disposed = false;
  const pagehide = event => { if (!event.persisted) dispose(); };

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', pagehide);
    for (const resource of getDisposables()) {
      try { resource?.dispose?.(); }
      catch (error) {
        try { reportDisposeError(error); } catch (_) { /* Release remaining resources. */ }
      }
    }
  }

  function start() {
    if (started) return started;
    if (disposed) return Promise.resolve(false);
    window.addEventListener('pagehide', pagehide);
    // Defer one microtask so reentrant callers see the same startup Promise.
    started = Promise.resolve().then(async () => {
      for (const step of compose) {
        if (disposed) return false;
        await step();
      }
      if (disposed) return false;
      await startup();
      if (disposed) return false;
      onReady();
      window.dispatchEvent(new window.CustomEvent('pandolab:ready'));
      return true;
    }).catch(error => {
      if (disposed) return false;
      try {
        window.dispatchEvent(new window.CustomEvent('pandolab:error', { detail: error?.message || String(error) }));
        onError(error);
      } finally { dispose(); }
      return false;
    });
    return started;
  }

  return Object.freeze({ start, dispose });
}
