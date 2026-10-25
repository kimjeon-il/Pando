/** RenderQuality: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createRenderQuality({beforeMeshRebuild=null}={}) {
  let dependencies;
  let renderQualityController;
  let currentRenderQuality;
  let renderQualityApplyQueued;
  let gpuRebuildTimer;
  let meshRequestRevision=0;
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
    (0, dependencies.selectionServices.setSelectionInteractionStyle)(dependencies.preferences.resolvedInteractionStyle);
    dependencies.gpuRenderingA.selectionPass?.updateStyle?.(dependencies.preferences.resolvedInteractionStyle);
    dependencies.rendering.gpuMapRenderer.setInteractionStyle?.(dependencies.preferences.resolvedInteractionStyle);
    if (redraw) {
      dependencies.domains.renderingDomain?.invalidateSelectionStyle?.('selection-style');
    }
    return dependencies.preferences.resolvedInteractionStyle;
  }

  function applyMapAppearanceChange({ reason = 'user-preferences', rerender = true } = {}) {
    syncResolvedInteractionStyle({ redraw: rerender });
    dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, reason);
    dependencies.rendering.gpuMapRenderer.invalidatePhysicalStyle(reason);
    if (rerender) dependencies.domains.renderingDomain.invalidateBaseScene(reason);
  }

  async function prepareCanonicalMesh({features=null,mesh=null,slotIds=[],dirtyIds=[],projectGeneration=dependencies.rendering.gpuMapRenderer.getProjectGeneration(),reason='canonical-mesh'}={}){
    const renderer=dependencies.rendering.gpuMapRenderer,revision=++meshRequestRevision;
    const current=()=>revision===meshRequestRevision&&renderer.getProjectGeneration()===projectGeneration;
    if(!current())return false;
    try {
    const applied=mesh?await renderer.replaceBuiltInMesh({meshBuffer:mesh.meshBuffer,preparedStroke:mesh.preparedStroke,spatialBlocks:mesh.spatialBlocks,
      builtinIdentity:mesh.identity,features:slotIds.map(id=>({id})),quality:'canonical',countryPatchIds:[...dirtyIds],projectGeneration,
      onStaged:()=>{if(current()){renderer.syncCountryMeshQuality();dependencies.domains.renderingDomain.invalidateProject('canonical-staging-ready');}}}):
      await renderer.rebuildFromCountries(features||dependencies.countries.builtinTerritorialScene({canonical:true}).collection.features,{projectGeneration,reason});
    if(!current()||applied===false)return false;
    renderer.syncCountryMeshQuality();
    applyAdaptiveRenderQuality({refreshScene:false,reason:'canonical-ready'});
    dependencies.domains.renderingDomain.invalidateProject(reason);return true;
    } catch (error) {
      if (current() && error.name !== 'AbortError') renderer.failMapPreparation(error);
      throw error;
    }
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
      Promise.resolve().then(async()=>{
        if(beforeMeshRebuild)await beforeMeshRebuild();
        await prepareCanonicalMesh({projectGeneration:requestedGeneration});
      }).catch(error=>dependencies.feedback.reportOperationError(error,'지도 형상을 다시 준비하지 못했습니다.','PL-MAP-MESH-001',4200));
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
    initializeGpuRebuildTimer,prepareCanonicalMesh,applyMapAppearanceChange,
    get applyAdaptiveRenderQuality() { return applyAdaptiveRenderQuality; },
    get cancelGpuMeshRebuild() { return cancelGpuMeshRebuild; },
    get currentRenderQuality() { return currentRenderQuality; },
    get queueAdaptiveRenderQualityRefresh() { return queueAdaptiveRenderQualityRefresh; },
    get renderQualityController() { return renderQualityController; },
    get scheduleGpuMeshRebuild() { return scheduleGpuMeshRebuild; },
    get syncResolvedInteractionStyle() { return syncResolvedInteractionStyle; },
  });
}
