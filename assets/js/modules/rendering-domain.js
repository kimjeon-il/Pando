import { MAP_RENDER_DIRTY } from './map-render-coordinator.js';

export function createRenderingDomain({
  context = null,
  gpuMapRenderer = null,
  sceneBuilder = null,
  coordinator = null,
  mapHost = null,
  selectionDomain = null,
  editingDomain = null,
  projectDomain = null,
  domLayers = null,
  renderers = {},
  renderSelectionFrame = null,
  renderEditingPreviewFrame = null,
  onFrameCommitted = () => {},
  reportDiagnostic = () => {},
} = {}) {
  let scene = null;
  let selectionPacket = null;
  let editingPreviewPacket = null;
  let disposed = false;
  let contextLost = false;
  const stats = { invalidations: 0, renders: 0, selectionRenders: 0, editingRenders: 0, lastReason: '' };
  const active = () => { if (disposed) throw new Error('Rendering domain is disposed.'); };
  const invalidate = (mask, reason = 'render-invalidation') => {
    active();
    stats.invalidations += 1;
    stats.lastReason = String(reason);
    return coordinator?.invalidate?.(mask, reason) ?? false;
  };
  const invalidateView = reason => invalidate(
    MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.SELECTION_VIEW | MAP_RENDER_DIRTY.LABEL_POSITIONS,
    reason || 'view-change',
  );
  const invalidateSelection = reason => invalidate(
    MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_INTERACTION,
    reason || 'selection-change',
  );
  const invalidateSelectionStyle = reason => invalidate(
    MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.GPU_INTERACTION,
    reason || 'selection-style',
  );
  const invalidateOverlayGeometry = (domain = 'overlay', reason = 'overlay-geometry') => {
    const domainBit = {
      country: MAP_RENDER_DIRTY.COUNTRY_PATCH,
      hydro: MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH,
      territorial: MAP_RENDER_DIRTY.TERRITORIAL_PATCH,
      generic: MAP_RENDER_DIRTY.GENERIC_PATCH,
    }[domain] || MAP_RENDER_DIRTY.OVERLAY_GEOMETRY;
    return invalidate(domainBit | MAP_RENDER_DIRTY.LAYER_TREE, reason);
  };
  const invalidateOverlayStyle = reason => invalidate(
    MAP_RENDER_DIRTY.OVERLAY_STYLE | MAP_RENDER_DIRTY.LAYER_TREE,
    reason || 'overlay-style',
  );
  const invalidateProjectRender = reason => coordinator?.scheduleFull?.(reason || 'project-render')
    ?? invalidate(MAP_RENDER_DIRTY.FULL, reason || 'project-render');
  const invalidatePatch = (bit, reason, extra = 0) => invalidate(
    bit | extra | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.LAYER_TREE,
    reason,
  );
  const invalidateCountryPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.COUNTRY_PATCH,
    reason || 'country-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.LABEL_LAYOUT,
  );
  const invalidateHydroPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH,
    reason || 'hydro-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS,
  );
  const invalidateTerritorialPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.TERRITORIAL_PATCH,
    reason || 'territorial-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS,
  );
  const invalidateGenericPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.GENERIC_PATCH,
    reason || 'generic-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS,
  );
  const invalidateLabels = reason => invalidate(
    MAP_RENDER_DIRTY.LABEL_POSITIONS | MAP_RENDER_DIRTY.LAYER_TREE,
    reason || 'labels',
  );
  const scheduleView = (reason = 'view-change') => {
    active();
    stats.invalidations += 1;
    stats.lastReason = String(reason);
    return coordinator?.scheduleView?.(reason) ?? coordinator?.invalidate?.(0, reason) ?? false;
  };
  const setScene = nextScene => {
    active();
    scene = nextScene || null;
    return scene;
  };
  const render = viewState => {
    active();
    stats.renders += 1;
    const frame = viewState || context?.getFrameContext?.() || null;
    const result = gpuMapRenderer?.render?.(frame?.revision, frame) || null;
    onFrameCommitted({ domain: 'rendering', result, sceneRevision: scene?.revision || 0 });
    return result;
  };
  const renderSelection = packet => {
    active();
    stats.selectionRenders += 1;
    selectionPacket = packet || null;
    if (typeof renderSelectionFrame === 'function') return renderSelectionFrame(selectionPacket);
    return gpuMapRenderer?.renderSelection?.(selectionPacket) || false;
  };
  const renderEditingPreview = packet => {
    active();
    stats.editingRenders += 1;
    editingPreviewPacket = packet || null;
    if (typeof renderEditingPreviewFrame === 'function') return renderEditingPreviewFrame(editingPreviewPacket);
    return gpuMapRenderer?.renderEditingPreview?.(editingPreviewPacket) || editingPreviewPacket;
  };
  const renderPass = (name, ...args) => {
    active();
    const renderer = renderers?.[name];
    if (typeof renderer !== 'function') return undefined;
    return renderer(...args);
  };
  const renderScene = (frameContext, dirtyMask = 0) => {
    active();
    if (contextLost) return null;
    const frame = frameContext || context?.getFrameContext?.() || null;
    const result = renderPass('base', frame, dirtyMask);
    onFrameCommitted({ domain: 'rendering', type: 'scene', frameId: frame?.frameId || null, dirtyMask, result });
    return result;
  };
  const renderDraft = packet => renderPass('draft', packet);
  const renderVertices = packet => renderPass('vertices', packet);
  const renderSnap = packet => renderPass('snapIndicator', packet);
  const resetProjectGeneration = generation => {
    active();
    scene = null;
    selectionPacket = null;
    editingPreviewPacket = null;
    contextLost = false;
    gpuMapRenderer?.resetProjectRenderState?.({ generation });
    return generation;
  };
  const handleContextLost = event => {
    contextLost = true;
    gpuMapRenderer?.handleContextLost?.(event);
    reportDiagnostic({ type: 'context-lost', event });
  };
  const handleContextRestored = event => {
    contextLost = false;
    gpuMapRenderer?.handleContextRestored?.(event);
    reportDiagnostic({ type: 'context-restored', event });
  };
  const getStats = () => Object.freeze({
    ...stats,
    contextLost,
    projectGeneration: projectDomain?.getGeneration?.() || 0,
    hasScene: !!scene,
    hasMapHost: typeof mapHost === 'function' ? !!mapHost() : !!mapHost,
    hasDomLayers: !!domLayers,
    hasSceneBuilder: !!sceneBuilder,
    hasSelectionDomain: !!selectionDomain,
    hasEditingDomain: !!editingDomain,
  });
  const dispose = () => { disposed = true; scene = null; selectionPacket = null; editingPreviewPacket = null; };
  return Object.freeze({
    setScene,
    invalidate,
    invalidateView,
    invalidateSelection,
    invalidateSelectionStyle,
    invalidateOverlayGeometry,
    invalidateOverlayStyle,
    invalidateProjectRender,
    invalidateCountryPatch,
    invalidateHydroPatch,
    invalidateTerritorialPatch,
    invalidateGenericPatch,
    invalidateLabels,
    scheduleView,
    render,
    renderScene,
    renderSelection,
    renderEditingPreview,
    renderDraft,
    renderVertices,
    renderSnap,
    renderPass,
    resetProjectGeneration,
    handleContextLost,
    handleContextRestored,
    getStats,
    dispose,
  });
}
