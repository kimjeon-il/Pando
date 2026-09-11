/** RenderQuality: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createRenderQuality() {
  let dependencies;
  let renderQualityController;
  let currentRenderQuality;
  let renderQualityApplyQueued;
  let gpuRebuildTimer;
  function connect(ports) {
    if (dependencies) throw new Error('render-quality already connected');
    dependencies = ports;
  }

  function applyAdaptiveRenderQuality({ refreshScene = false, reason = 'adaptive-render-quality' } = {}) {
    currentRenderQuality = renderQualityController.profile();
    const gpuQuality = dependencies.gpuMapRenderer.getRuntimeState?.() || {};
    if (gpuQuality.canonicalMeshReady) {
      // Background LOD is allowed to be coarse only while the initial
      // preview is visible.  After canonical promotion, interaction may
      // throttle work but must not replace visible geometry with preview LOD.
      currentRenderQuality = Object.freeze({
        ...currentRenderQuality,
        backgroundLod: 'high',
        countryMeshQuality: 'canonical',
        terrainResolutionScale: 1,
      });
    }
    dependencies.renderSceneBuilder.setCacheByteBudget(currentRenderQuality.renderPacketCacheBudgetBytes);
    dependencies.gpuMapRenderer.setRenderQuality?.(currentRenderQuality);
    dependencies.mapHost?.setRenderPixelRatio?.(Math.min(
      (0, dependencies.currentMapDevicePixelRatio)(),
      Math.max(1, Number(currentRenderQuality.dprCap || 1)),
    ));
    if (refreshScene) dependencies.renderingDomain?.invalidateQuality?.(reason);
    return currentRenderQuality;
  }

  function queueAdaptiveRenderQualityRefresh(reason = 'adaptive-render-quality') {
    if (renderQualityApplyQueued) return;
    renderQualityApplyQueued = true;
    dependencies.mapWorkScheduler.scheduleIdle('adaptive-render-quality', () => {
      renderQualityApplyQueued = false;
      applyAdaptiveRenderQuality({ refreshScene: true, reason });
    }, 80);
  }

  function syncResolvedInteractionStyle({ redraw = false } = {}) {
    dependencies.resolvedInteractionStyle = (0, dependencies.resolveCurrentInteractionStyle)();
    (0, dependencies.setSelectionInteractionStyle)(dependencies.resolvedInteractionStyle);
    dependencies.selectionPass?.updateStyle?.(dependencies.resolvedInteractionStyle);
    dependencies.gpuMapRenderer.setInteractionStyle?.(dependencies.resolvedInteractionStyle);
    document.documentElement.style.setProperty('--map-selection-halo', dependencies.resolvedInteractionStyle.selection.color);
    window.__PANDOLAB_INTERACTION_STYLE__ = dependencies.resolvedInteractionStyle;
    if (redraw) {
      dependencies.renderingDomain?.invalidateSelectionStyle?.('selection-style');
    }
    return dependencies.resolvedInteractionStyle;
  }

  function scheduleGpuMeshRebuild(delay = 80) {
    clearTimeout(gpuRebuildTimer);
    gpuRebuildTimer = setTimeout(() => {
      dependencies.mapEditClient.rebase(dependencies.state.countriesData?.features || []);
      dependencies.gpuMapRenderer.rebuildFromCountries((0, dependencies.builtinRenderCountries)().collection.features);
    }, delay);
  }

  function initializeRenderQualityController() {
    (renderQualityController = (0, dependencies.createAdaptiveRenderQualityController)({
      mobile: (0, dependencies.isMobile)(),
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      saveData: navigator.connection?.saveData === true,
    }));

    (currentRenderQuality = renderQualityController.profile());

    (renderQualityApplyQueued = false);
  }

  function initializeGpuRebuildTimer() {
    (gpuRebuildTimer = null);
  }

  return Object.freeze({
    connect,
    initializeRenderQualityController,
    initializeGpuRebuildTimer,
    get applyAdaptiveRenderQuality() { return applyAdaptiveRenderQuality; },
    get currentRenderQuality() { return currentRenderQuality; },
    get queueAdaptiveRenderQualityRefresh() { return queueAdaptiveRenderQualityRefresh; },
    get renderQualityController() { return renderQualityController; },
    get scheduleGpuMeshRebuild() { return scheduleGpuMeshRebuild; },
    get syncResolvedInteractionStyle() { return syncResolvedInteractionStyle; },
  });
}
