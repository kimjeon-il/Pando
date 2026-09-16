import { interactionCssProperties } from './map-interaction-style.js';
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
    const gpuQuality = dependencies.rendering.gpuMapRenderer.getRuntimeState?.() || {};
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
    dependencies.gpuRenderingA.renderSceneBuilder.setCacheByteBudget(currentRenderQuality.renderPacketCacheBudgetBytes);
    dependencies.rendering.gpuMapRenderer.setRenderQuality?.(currentRenderQuality);
    dependencies.mapView.mapHost?.setRenderPixelRatio?.(Math.min(
      (0, dependencies.hydroModel.currentMapDevicePixelRatio)(),
      Math.max(1, Number(currentRenderQuality.dprCap || 1)),
    ));
    if (refreshScene) dependencies.domains.renderingDomain?.invalidateQuality?.(reason);
    return currentRenderQuality;
  }

  function queueAdaptiveRenderQualityRefresh(reason = 'adaptive-render-quality') {
    if (renderQualityApplyQueued) return;
    renderQualityApplyQueued = true;
    dependencies.projectState.mapWorkScheduler.scheduleIdle('adaptive-render-quality', () => {
      renderQualityApplyQueued = false;
      applyAdaptiveRenderQuality({ refreshScene: true, reason });
    }, 80);
  }

  function syncResolvedInteractionStyle({ redraw = false } = {}) {
    dependencies.preferenceCommands.setResolvedInteractionStyle((0, dependencies.platformConfigurationB.resolveCurrentInteractionStyle)());
    (0, dependencies.selectionServices.setSelectionInteractionStyle)(dependencies.preferences.resolvedInteractionStyle);
    dependencies.gpuRenderingA.selectionPass?.updateStyle?.(dependencies.preferences.resolvedInteractionStyle);
    dependencies.rendering.gpuMapRenderer.setInteractionStyle?.(dependencies.preferences.resolvedInteractionStyle);
    for (const [property, value] of Object.entries(interactionCssProperties(dependencies.preferences.resolvedInteractionStyle))) document.documentElement.style.setProperty(property, value);
    window.__PANDOLAB_INTERACTION_STYLE__ = dependencies.preferences.resolvedInteractionStyle;
    if (redraw) {
      dependencies.domains.renderingDomain?.invalidateSelectionStyle?.('selection-style');
    }
    return dependencies.preferences.resolvedInteractionStyle;
  }

  function cancelGpuMeshRebuild() {
    clearTimeout(gpuRebuildTimer);
    gpuRebuildTimer = null;
  }

  function scheduleGpuMeshRebuild(delay = 80, projectGeneration = null) {
    clearTimeout(gpuRebuildTimer);
    const requestedGeneration = Number.isFinite(projectGeneration)
      ? Number(projectGeneration)
      : dependencies.rendering.gpuMapRenderer.getProjectGeneration?.();
    gpuRebuildTimer = setTimeout(() => {
      gpuRebuildTimer = null;
      if (Number.isFinite(requestedGeneration)
          && dependencies.rendering.gpuMapRenderer.getProjectGeneration?.() !== requestedGeneration) return;
      dependencies.spatialQuery.mapEditClient.rebase(dependencies.projectState.state.countriesData?.features || []);
      dependencies.rendering.gpuMapRenderer.rebuildFromCountries((0, dependencies.countries.builtinRenderCountries)().collection.features, {
        projectGeneration: requestedGeneration,
      });
    }, delay);
  }

  function initializeRenderQualityController() {
    (renderQualityController = (0, dependencies.uiFactoriesA.createAdaptiveRenderQualityController)({
      mobile: (0, dependencies.surfaces.isMobile)(),
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
    get cancelGpuMeshRebuild() { return cancelGpuMeshRebuild; },
    get currentRenderQuality() { return currentRenderQuality; },
    get queueAdaptiveRenderQualityRefresh() { return queueAdaptiveRenderQualityRefresh; },
    get renderQualityController() { return renderQualityController; },
    get scheduleGpuMeshRebuild() { return scheduleGpuMeshRebuild; },
    get syncResolvedInteractionStyle() { return syncResolvedInteractionStyle; },
  });
}
