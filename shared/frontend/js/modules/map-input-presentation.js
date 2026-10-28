export function createMapInputPresentation({productMode,ports,window,navigator,createMapInputController,getRevision,mapInteractionGate,editing:editingHooks=null} = {}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Map input requires explicit product mode.');
  const editing=productMode==='editor';
  if(!editing&&editingHooks)throw new TypeError('Viewer input cannot register editing hooks.');
  if(editing&&!editingHooks)throw new TypeError('Editor input requires its editing hooks.');
  if(typeof ports?.feedback?.reportOperationError!=='function')throw new TypeError('Map input requires its operation error reporter.');
  const reportOperationError=(error,code)=>ports.feedback.reportOperationError(error,'지도 입력을 적용하지 못했습니다.',code,4200);
  const {$,d3}=ports.platform;
  const {gpuMapRenderer}=ports.rendering;
  const {mapWorkScheduler}=ports.projectState;
  const {renderingDomain,selectionDomain,projectDomain}=ports.domains;
  const {renderQualityController,applyAdaptiveRenderQuality,queueAdaptiveRenderQualityRefresh}=ports.renderQuality;
  const {cancelCountryHoverPick,mapNavigationEnabled,mapClickBlocked,queueCountryHoverPick}=ports.pointerInteractionA;
  const {suppressNextMapClick}=ports.pointerInteractionB;
  const {dragMapBy,transformMapView,zoomBy}=ports.navigation;
  const {isMobile}=ports.surfaces;
  const {handleMapClick,getTerritorialLabelRef}=ports.objectPicking;
  const {screenToGeo}=ports.mapView;
  const editingDomain=editingHooks?.domain,getDraftSnapshot=editingHooks?.getDraftSnapshot;
  const isGenericFeatureDraftTool=editingHooks?.isGenericFeatureDraftTool,dispatchEditingInteraction=editingHooks?.dispatchInteraction;
  const setMoving=value=>{ports.projectState.state.mapMoving=value;};
  const clearHoverHit=()=>ports.interactionStateCommands.setHoverHit(null);
  const getQualityTier=()=>ports.renderScene.currentRenderQuality.tier;
  const getInputSnapshot=()=>{
    const state=ports.projectState.state;
    return {moving:state.mapMoving,projectReplacing:state.projectReplacing===true,spacePanActive:state.spacePanActive,
      tool:state.tool,projection:state.projection,globeZoom:state.view.globeZoom,flatZoom:state.view.flatZoom,
      territorySelectionSession:state.territorySelectionSession,labelPlacementMode:state.labelPlacementMode};
  };
  const clearDraftHover = async reason => {
    if(!editing)return false;
    try { return await editingDomain.clearDraftHover(reason); }
    catch (error) { reportOperationError(error,'PL-DRAFT-HOVER-001');return false; }
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
    clearDraftHover('map-movement-start');
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
    if(editing)projectDomain.queueViewAutosave();
  }

  function bindMapInputPresentation(svg) {
    dispose();
    const mapInputController = createMapInputController({
      // Own the complete map surface so native touch/pinch gestures cannot
      // escape through a child SVG hit target and become page zoom.
      element: $('map'),
      interactiveTarget: (target, event) => {
        if (getInputSnapshot().projectReplacing) return true;
        if (target?.closest?.('button,input,select,textarea,a,[contenteditable="true"],.editor-drawer,.project-bounds-picker')) return true;
        if (target?.closest?.('.map-overlay-layer')) return true;
        if (event?.button === 1) return false;
        mapInteractionGate.setForcedPan(getInputSnapshot().spacePanActive);
        return getInputSnapshot().tool !== 'move' && !getInputSnapshot().spacePanActive && mapInteractionGate.isPandoTarget(target);
      },
      canNavigate: () => {
        if (getInputSnapshot().projectReplacing) return false;
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
        zoomBy(factor, false);
        if (navigator.vibrate && isMobile()) navigator.vibrate(8);
      },
      canDirectTap: () => {
        const input = getInputSnapshot();
        if (input.projectReplacing) return false;
        if(input.tool==='select'&&!input.labelPlacementMode)return true;
        if(!editing)return false;
        if (input.tool === 'move') return false;
        const territoryDraft = input.territorySelectionSession?.tool === input.tool
          && input.territorySelectionSession.stage === 'selection'
          && input.territorySelectionSession.activePhase === 'drawing'
          && ['line', 'polygon'].includes(input.territorySelectionSession.activeMethod);
        const draftTap = (isGenericFeatureDraftTool(input.tool) || territoryDraft) && getDraftSnapshot().inputPhase === 'draw';
        return input.labelPlacementMode || draftTap || input.tool === 'point';
      },
      directTap: handleMapClick,
      canDoubleTap: () => !getInputSnapshot().projectReplacing && isMobile() && getInputSnapshot().tool !== 'move' && ['select', 'territorial-border', 'country-coast', 'merge-country'].includes(getInputSnapshot().tool) && !getInputSnapshot().labelPlacementMode,
      suppressClick: suppressNextMapClick,
      canDrawStroke: () => {
        if(!editing)return false;
        if (getInputSnapshot().projectReplacing) return false;
        const active = editingDomain?.draftInputActive?.() && getDraftSnapshot().inputPhase === 'draw' && !getInputSnapshot().spacePanActive;
        mapInteractionGate.setDraftInputActive(active);
        return active;
      },
      beginStroke: (screenPoint, event) => dispatchEditingInteraction('draft-stroke-start', {
        screenPoint,
        pointerId: event?.pointerId,
        pointerType: event?.pointerType || 'mouse',
      }),
      moveStroke: screenPoints => dispatchEditingInteraction('draft-stroke-move', { screenPoints }),
      endStroke: screenPoint => dispatchEditingInteraction('draft-stroke-end', { screenPoint }),
      cancelStroke: async reason => {
        try {
          await editingDomain.cancelActiveGesture('pinch-or-cancel');
          return await dispatchEditingInteraction('draft-stroke-cancel',{ reason: typeof reason==='string' ? reason : 'pointer-cancel' });
        } catch (error) { reportOperationError(error,'PL-DRAFT-CANCEL-001');return false; }
      },
    });

    svg.on('click', function() {
      if (mapClickBlocked()) return;
      handleMapClick(d3.mouse(this));
    });

    // Labels and editing overlays live in a sibling interaction SVG. Hover
    // belongs to their common map surface; ground clicks keep their SVG owner.
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
      const draft = editing?getDraftSnapshot():null;
      if (draft?.strokeActive) return;
      // Draft controls own segment/vertex/insert hover, including its cleanup.
      // Their bubbling events must not erase the target they just published.
      if (d3.event.target?.closest?.('.draft-interactive')) return;
      if (draft?.dragging) {
        clearDraftHover('draft-interactive-hover');
        return;
      }
      if (mapInputController?.isPanning()) {
        clearDraftHover('map-panning');
        return;
      }
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
        const input = getInputSnapshot();
        const territoryDraft = input.territorySelectionSession?.tool === input.tool
          && input.territorySelectionSession.stage === 'selection'
          && input.territorySelectionSession.activePhase === 'drawing'
          && ['line', 'polygon'].includes(input.territorySelectionSession.activeMethod);
        if (editing&&(isGenericFeatureDraftTool(input.tool) || territoryDraft) && draft.inputPhase === 'draw' && draft.coords.length) {
          dispatchEditingInteraction('draft-hover-move', { screenPoint, pointerType: 'mouse' });
        }
        if (getInputSnapshot().tool === 'select' && !isMobile() && !d3.event.target?.closest?.('.generic-feature-shape, .territorial-unit-shape, .distribution-shape')) {
          queueCountryHoverPick(screenPoint, coord);
        }
      } else {
        if(editing)dispatchEditingInteraction('draft-hover-clear');
        cancelCountryHoverPick({ clear: true });
        clearHoverHit();
        setHover(null, { source: 'map' });
      }
    });

    hoverSurface.on('mouseleave.map-input', function() {
      cancelCountryHoverPick();
      if(editing)dispatchEditingInteraction('draft-hover-clear');
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
