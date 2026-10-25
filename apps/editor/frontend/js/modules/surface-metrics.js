/* Layout measurements only: preserve native scrolling and controller state. */
export function installSurfaceMetrics(documentRef = document) {
  const view = documentRef.defaultView;
  if (!view?.ResizeObserver) return () => {};
  const root = documentRef.documentElement;
  const selector = '.topbar, .surface-header';
  const observed = new Set();
  let frame = 0;
  const set = (node, name, value) => {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  };
  const measure = () => {
    frame = 0;
    for (const node of observed) if (!node.isConnected) { resize.unobserve(node); observed.delete(node); }
    for (const node of documentRef.querySelectorAll(selector)) {
      if (!observed.has(node)) { observed.add(node); resize.observe(node); }
      if (!node.getClientRects().length) continue;
      if (node.classList.contains('topbar')) set(root, '--ui-topbar-measured', `${node.getBoundingClientRect().height}px`);
      if (node.classList.contains('surface-header')) set(node.parentElement, '--ui-sheet-header-measured', `${node.getBoundingClientRect().height}px`);
    }
  };
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(measure); };
  const resize = new view.ResizeObserver(schedule);
  const mutations = new view.MutationObserver(schedule);
  mutations.observe(documentRef.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'data-layout'] });
  view.addEventListener('resize', schedule);
  documentRef.fonts?.ready.then(schedule);
  measure();
  return () => { resize.disconnect(); mutations.disconnect(); view.removeEventListener('resize', schedule); if (frame) view.cancelAnimationFrame(frame); };
}
