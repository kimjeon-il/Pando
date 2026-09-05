export function createMapInputPresentation({
  getElement: $,
  window,
  d3,
  navigator,
  createMapInputController,
  getInputSnapshot,
  setMoving,
  clearHoverHit,
  getQualityTier,
  getRevision,
  getDraftSnapshot,
  renderQualityController,
  mapWorkScheduler,
  gpuMapRenderer,
  renderingDomain,
  editingDomain,
  selectionDomain,
  projectDomain,
  mapInteractionGate,
  applyAdaptiveRenderQuality,
  queueAdaptiveRenderQualityRefresh,
  cancelCountryHoverPick,
  suppressNextMapClick,
  mapNavigationEnabled,
  dragMapBy,
  transformMapView,
  zoomBy,
  isMobile,
  isGenericFeatureDraftTool,
  handleMapClick,
  dispatchEditingInteraction,
  mapClickBlocked,
  screenToGeo,
  queueCountryHoverPick,
} = {}) {

  let boundInput = null;
  let boundSvg = null;
  function dispose() {
    boundInput?.destroy();
    boundInput = null;
    boundSvg?.on('click', null).on('mousemove', null).on('mouseleave', null);
    boundSvg = null;
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
    editingDomain?.clearDraftHover?.('map-movement-start');
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
    projectDomain.queueViewAutosave();
  }

  function bindMapInputPresentation(svg) {
    dispose();
    const mapInputController = createMapInputController({
      // Own the complete map surface so native touch/pinch gestures cannot
      // escape through a child SVG hit target and become page zoom.
      element: $('map'),
      interactiveTarget: target => {
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
        zoomBy(factor, false);
        if (navigator.vibrate && isMobile()) navigator.vibrate(8);
      },
      canDirectTap: () => {
        if (getInputSnapshot().tool === 'move') return false;
        const annexLine = getInputSnapshot().tool === 'annex-territory' && ['line', 'polygon'].includes(getInputSnapshot().annexPhase);
        const newCountryLine = getInputSnapshot().tool === 'new-country' && getInputSnapshot().newCountryPhase === 'line';
        const draftTap = (isGenericFeatureDraftTool(getInputSnapshot().tool) || newCountryLine || annexLine) && getDraftSnapshot().inputPhase === 'draw';
        return getInputSnapshot().labelPlacementMode || draftTap || getInputSnapshot().tool === 'point';
      },
      directTap: handleMapClick,
      canDoubleTap: () => isMobile() && getInputSnapshot().tool !== 'move' && ['select', 'country-border', 'country-coast', 'merge-country'].includes(getInputSnapshot().tool) && !getInputSnapshot().labelPlacementMode,
      suppressClick: suppressNextMapClick,
      canDrawStroke: () => {
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
      cancelStroke: reason => dispatchEditingInteraction('draft-stroke-cancel', { reason }),
    });

    svg.on('click', function() {
      if (mapClickBlocked()) return;
      handleMapClick(d3.mouse(this));
    });

    svg.on('mousemove', function() {
      const draft = getDraftSnapshot();
      if (draft.strokeActive) return;
      if (d3.event.target?.closest?.('.draft-interactive') || draft.dragging) {
        editingDomain?.clearDraftHover?.('draft-interactive-hover');
        return;
      }
      if (mapInputController?.isPanning()) {
        editingDomain?.clearDraftHover?.('map-panning');
        return;
      }
      const screenPoint = d3.mouse(this);
      const coord = screenToGeo(screenPoint);
      if (coord) {
        $('coordStatus').textContent = `경도 ${coord[0].toFixed(4)} · 위도 ${coord[1].toFixed(4)}`;
        const newCountryLineMode = getInputSnapshot().tool === 'new-country' && getInputSnapshot().newCountryPhase === 'line';
        if ((isGenericFeatureDraftTool(getInputSnapshot().tool) || newCountryLineMode || (getInputSnapshot().tool === 'annex-territory' && ['line', 'polygon'].includes(getInputSnapshot().annexPhase))) && draft.inputPhase === 'draw' && draft.coords.length) {
          dispatchEditingInteraction('draft-hover-move', { screenPoint, pointerType: 'mouse' });
        }
        if (getInputSnapshot().tool === 'select' && !isMobile() && !d3.event.target?.closest?.('.generic-feature-shape, .territorial-unit-shape, .distribution-shape')) {
          queueCountryHoverPick(screenPoint, coord);
        }
      } else {
        $('coordStatus').textContent = '지구본 바깥';
        dispatchEditingInteraction('draft-hover-clear');
        cancelCountryHoverPick({ clear: true });
        clearHoverHit();
        selectionDomain.setHover(null);
      }
    });

    svg.on('mouseleave', function() {
      cancelCountryHoverPick();
      dispatchEditingInteraction('draft-hover-clear');
      clearHoverHit();
      selectionDomain.setHover(null);
    });
    boundInput = mapInputController;
    boundSvg = svg;
    return mapInputController;
  }

  return Object.freeze({
    dispose,
    beginMovement: beginMapMovement,
    finishMovement: finishMapMovement,
    bindSvg: bindMapInputPresentation,
  });
}
