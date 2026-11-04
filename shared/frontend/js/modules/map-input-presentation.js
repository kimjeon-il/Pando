/** Viewer input routing for the shared map surface. */
export function createMapInputPresentation({ports,window,navigator,createMapInputController,getRevision,mapInteractionGate,reservedTargetSelector=''} = {}) {
  if(typeof reservedTargetSelector!=='string')throw new TypeError('Map input reserved target selector must be a string.');
  if(typeof ports?.feedback?.reportOperationError!=='function')throw new TypeError('Map input requires its operation error reporter.');
  const reportOperationError=(error,code)=>ports.feedback.reportOperationError(error,'지도 입력을 적용하지 못했습니다.',code,4200);
  const {$,d3}=ports.platform;
  const {gpuMapRenderer}=ports.rendering;
  const {mapWorkScheduler}=ports.projectState;
  const {renderingDomain,selectionDomain}=ports.domains;
  const {renderQualityController,applyAdaptiveRenderQuality,queueAdaptiveRenderQualityRefresh}=ports.renderQuality;
  const {cancelCountryHoverPick,mapNavigationEnabled,mapClickBlocked,queueCountryHoverPick}=ports.pointerInteractionA;
  const {suppressNextMapClick}=ports.pointerInteractionB;
  const {dragMapBy,transformMapView,zoomBy}=ports.navigation;
  const {isMobile}=ports.surfaces;
  const {handleMapClick,getTerritorialLabelRef}=ports.objectPicking;
  const {screenToGeo}=ports.mapView;
  const setMoving=value=>{ports.projectState.state.mapMoving=value;};
  const clearHoverHit=()=>ports.interactionStateCommands.setHoverHit(null);
  const getQualityTier=()=>ports.renderScene.currentRenderQuality.tier;
  const getInputSnapshot=()=>{
    const state=ports.projectState.state;
    return {moving:state.mapMoving,projectReplacing:state.projectReplacing===true,spacePanActive:state.spacePanActive,
      tool:state.tool,projection:state.projection,globeZoom:state.view.globeZoom,flatZoom:state.view.flatZoom,
      labelPlacementMode:state.labelPlacementMode};
  };
  const setHover = async (ref,options) => {
    try { return await selectionDomain.setHover(ref,options); }
    catch (error) { reportOperationError(error,'PL-SELECTION-HOVER-001');return false; }
  };

  let boundInput = null;
  let boundSvg = null;
  let boundHoverSurface = null;
  function dispose() {
    if(boundInput)cancelCountryHoverPick({clear:true});
    boundInput?.destroy();
    boundInput = null;
    boundSvg?.on('click', null);
    boundHoverSurface?.on('mouseover.map-input', null).on('mousemove.map-input', null).on('mouseleave.map-input', null);
    boundSvg = null;
    boundHoverSurface = null;
  }

  function beginMapMovement() {
    if (getInputSnapshot().moving) return;
    setMoving(true);
    window.dispatchEvent(new window.CustomEvent('pandolab:interaction-state', {
      detail: { active: true, source: 'map-movement', timestamp: performance.now() },
    }));
    renderQualityController.beginInteraction('map-movement');
    applyAdaptiveRenderQuality({ refreshScene: false, reason: 'map-movement' });
    renderingDomain?.beginInteraction?.('map-movement');
    mapWorkScheduler.setInteractionActive(true);
    gpuMapRenderer.setHydroInteractionActive(true);
    cancelCountryHoverPick({ clear: true });
    $('map')?.classList.add('dragging');
  }

  function finishMapMovement(point = null) {
    if (!getInputSnapshot().moving) return;
    setMoving(false);
    window.dispatchEvent(new window.CustomEvent('pandolab:interaction-state', {
      detail: { active: false, source: 'map-movement', timestamp: performance.now() },
    }));
    const previousTier = getQualityTier();
    renderQualityController.endInteraction('map-movement-end');
    applyAdaptiveRenderQuality({ refreshScene: false, reason: 'map-movement-end' });
    if (previousTier !== getQualityTier()) queueAdaptiveRenderQualityRefresh('map-movement-quality-settle');
    mapWorkScheduler.setInteractionActive(false);
    gpuMapRenderer.setHydroInteractionActive(false);
    $('map')?.classList.remove('dragging');
    if (point) suppressNextMapClick(point);
    renderingDomain?.endInteraction?.('viewport-culling-settle');
    gpuMapRenderer.prioritizeLatest();
  }

  function bindMapInputPresentation(svg) {
    dispose();
    const mapInputController = createMapInputController({
      // Own the complete map surface so native touch/pinch gestures cannot
      // escape through a child SVG hit target and become page zoom.
      element: $('map'),
      isInputBlocked: () => getInputSnapshot().projectReplacing,
      interactiveTarget: (target, event) => {
        if (reservedTargetSelector && target?.closest?.(reservedTargetSelector)) return true;
        if (target?.closest?.('.map-overlay-layer')) return true;
        if (event?.button === 1) return false;
        mapInteractionGate.setForcedPan(getInputSnapshot().spacePanActive);
        return getInputSnapshot().tool !== 'move' && !getInputSnapshot().spacePanActive && mapInteractionGate.isPandoTarget(target);
      },
      canNavigate: () => {
        const enabled = mapNavigationEnabled();
        mapInteractionGate.setNavigationEnabled(enabled);
        return enabled;
      },
      getRevision: () => getRevision(),
      beginMovement: beginMapMovement,
      finishMovement: finishMapMovement,
      dragBy: dragMapBy,
      invalidateView: reason => renderingDomain?.invalidateView?.(reason) || false,
      getZoom: () => getInputSnapshot().projection === 'globe' ? getInputSnapshot().globeZoom : getInputSnapshot().flatZoom,
      transformView: transformMapView,
      zoomBy: factor => {
        zoomBy(factor);
        if (navigator.vibrate && isMobile()) navigator.vibrate(8);
      },
      canDirectTap: () => !getInputSnapshot().projectReplacing && getInputSnapshot().tool === 'select' && !getInputSnapshot().labelPlacementMode,
      directTap: handleMapClick,
      canDoubleTap: () => !getInputSnapshot().projectReplacing && isMobile() && getInputSnapshot().tool === 'select' && !getInputSnapshot().labelPlacementMode,
      suppressClick: suppressNextMapClick,
      canDrawStroke: () => false,
      cancelStroke: async () => false,
    });

    svg.on('click', function() {
      if (mapClickBlocked()) return;
      handleMapClick(d3.mouse(this));
    });

    // Labels live in a sibling interaction SVG. Hover belongs to their common
    // map surface; ground clicks keep their SVG owner.
    const hoverSurface = d3.select($('map'));
    const preservePeerLabelHover = () => {
      if (getInputSnapshot().tool !== 'select' || !d3.event.target?.closest?.('.user-label')) return false;
      // Cancel on entry too: the pointer can stop before another mousemove.
      cancelCountryHoverPick();
      return true;
    };
    hoverSurface.on('mouseover.map-input', preservePeerLabelHover);
    hoverSurface.on('mousemove.map-input', function() {
      if (getInputSnapshot().projectReplacing) return;
      if (mapInputController?.isPanning()) return;
      // User/place labels already publish their own explicit hover ref.
      if (preservePeerLabelHover()) return;
      const label = d3.event.target?.closest?.('.territorial-label-item[data-label-id]');
      if (label && getInputSnapshot().tool === 'select' && !isMobile()) {
        cancelCountryHoverPick();
        setHover(getTerritorialLabelRef(label.dataset.labelId), { source: 'map' });
        return;
      }
      const screenPoint = d3.mouse(this);
      const coord = screenToGeo(screenPoint);
      if (coord) {
        if (getInputSnapshot().tool === 'select' && !isMobile() && !d3.event.target?.closest?.('.generic-feature-shape')) {
          queueCountryHoverPick(screenPoint, coord);
        }
      } else {
        cancelCountryHoverPick({ clear: true });
        clearHoverHit();
        setHover(null, { source: 'map' });
      }
    });

    hoverSurface.on('mouseleave.map-input', function() {
      cancelCountryHoverPick();
      clearHoverHit();
      setHover(null, { source: 'map' });
    });
    boundInput = mapInputController;
    boundSvg = svg;
    boundHoverSurface = hoverSurface;
    return mapInputController;
  }

  return Object.freeze({
    dispose,
    beginMovement: beginMapMovement,
    finishMovement: finishMapMovement,
    bindSvg: bindMapInputPresentation,
  });
}
