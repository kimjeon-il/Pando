import { projectedPointDistance, projectedLineDistance as screenLineDistance, geometryHitsScreenPoint as screenGeometryHit } from './geometry-screen-hit.js';
import { layerObjectRank, territorialPaintRole } from './layer-presentation.js';
/** ObjectPicking: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectPicking({handleEditingClick=null,onBackgroundClear=null,openEditor=false,performanceRecorder=null,closeActiveOverlay=null}={}) {
  let dependencies;
  let objectPickRevision = 0;
  let objectChooserPresentationRevision = 0;
  let chooserCandidates=[];
  let objectChooserIntentMode = 'replace';
  let chooserSelection=null;

  function connect(ports) {
    if (dependencies) throw new Error('object-picking already connected');
    dependencies = ports;
  }

  function projectedLineDistance(geometry, screenPoint) {
    return screenLineDistance(geometry, screenPoint, (0, dependencies.mapView.activeProjection)());
  }

  function geometryHitsScreenPoint(geometry, coord, screenPoint, tolerance = 8) {
    return screenGeometryHit(geometry, coord, screenPoint, tolerance, {
      project: (0, dependencies.mapView.activeProjection)(),
      contains: dependencies.landRelations.pointInCountryFeature,
      coordinateBounds: dependencies.cutGeometry.coordinateBounds,
      zoom: (0, dependencies.labelPresentation.currentMapZoom)(),
      boundsCache: dependencies.spatialRecords.geometryBoundsCache,
    });
  }

  function objectRefSelectable(value) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref || !dependencies.objectOperationsA.objectRefVisible(ref)) return false;
    if (ref.domain === 'distribution') {
      const group = 'distributions';
      const state = dependencies.projectState.state;
      if (state.layerVisibility[group] === false || !(0, dependencies.layerPresentation.isLayerItemVisible)(group, ref.id)) return false;
      if (state.distributionSettings?.renderMode !== 'single') return true;
      const firstVisible = state.distributionLayers.find(layer => (0, dependencies.layerPresentation.isLayerItemVisible)(group, layer.id))?.id;
      const active = state.distributionLayers.some(layer => layer.id === state.distributionSettings.activeLayerId
        && (0, dependencies.layerPresentation.isLayerItemVisible)(group, layer.id))
        ? state.distributionSettings.activeLayerId : firstVisible;
      return ref.id === active;
    }
    return true;
  }

  function selectableVisualRank(ref) {
    const order = dependencies.projectState.state.layerPresentation?.overlayOrder || dependencies.renderScene.OVERLAY_GROUPS;
    let group = '';
    if (ref.domain === 'generic') group = 'genericFeatures';
    else if (ref.domain === 'distribution') group = 'distributions';
    else if (ref.domain === 'territorial') group = 'objects';
    else if (ref.domain === 'label') group = 'labels';
    else if (ref.domain === 'hydro') group = 'hydro';
    const index = order.indexOf(group);
    // General hierarchy fills claim land before independent overlays are drawn.
    if (ref.domain==='territorial') {const role=territorialPaintRole(dependencies.territorialModel.entityRepository.get(ref.id));if(role==='country-fill')return 500;if(role==='territorial-fill')return 600;}
    if (index >= 0) return 1000 + index;
    return { labels: 1300, hydro: 850, objects: 500 }[group] || 700;
  }

  function compareVisualOrder(left, right) {
    return selectableVisualRank(right) - selectableVisualRank(left)
      || (left.domain === 'territorial' && right.domain === 'territorial'
        ? dependencies.territorialModel.entityRepository.ancestors(right.id).length
          - dependencies.territorialModel.entityRepository.ancestors(left.id).length : 0)
      || layerObjectRank(dependencies.projectState.state.layerPresentation, right.key)
        - layerObjectRank(dependencies.projectState.state.layerPresentation, left.key);
  }

  // Pointer hits follow the presented surface; commands still use canonical data.
  function territorialObjectsAt(screenPoint, coord, records = dependencies.spatialRecords.indexedMapObjectCandidates(screenPoint)) {
    if (dependencies.projectState.state.countryVisualPhase === 'pending') return [];
    return records.filter(record => record.domain === 'territorial').flatMap(record => {
      const feature = dependencies.objectModelB.territorialScope.displayFeature(record.id);
      const ref = dependencies.selectionServices.normalizeObjectRef({ domain: 'territorial', type: 'entity', id: record.id });
      if (!feature || !objectRefSelectable(ref)) return [];
      dependencies.rendering.selectionPerformanceMetrics.exactHitTestCount += 1;
      return geometryHitsScreenPoint(feature.geometry, coord, screenPoint, dependencies.surfaces.isMobile() ? 12 : 7) ? [{ ref, feature }] : [];
    }).sort((a, b) => compareVisualOrder(a.ref, b.ref));
  }

  async function selectableObjectsAt(screenPoint, coord, { seedRefs = [], includeLabels = true, includeHydro = true } = {}) {
    const candidates = [];
    const add = ref => {
      const normalized = (0, dependencies.selectionServices.normalizeObjectRef)(ref);
      if (objectRefSelectable(normalized) && !candidates.some(candidate => candidate.key === normalized.key)) candidates.push(normalized);
    };
    seedRefs.forEach(add);
    dependencies.rendering.selectionPerformanceMetrics.exactHitTestCount = 0;
    const indexed = (0, dependencies.spatialRecords.indexedMapObjectCandidates)(screenPoint);
    territorialObjectsAt(screenPoint, coord, indexed).forEach(item => add(item.ref));
    for (const entry of indexed) {
      if (entry.domain === 'label') {
        if (!includeLabels) continue;
        if (dependencies.projectState.state.layerVisibility.labels===false || !(0, dependencies.layerPresentation.isLayerItemVisible)('labels', entry.id)) continue;
        const label = dependencies.projectState.state.labels.find(item => String(item.id) === entry.id);
        const projected = label ? (0, dependencies.mapView.activeProjection)()(label.coordinates) : null;
        dependencies.rendering.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (projected && projectedPointDistance(projected, screenPoint) <= ((0, dependencies.surfaces.isMobile)() ? 18 : 11)) add({ domain: 'label', type: label.kind || 'label', id: label.id });
        continue;
      }
      if (entry.domain === 'generic') {
        if (dependencies.projectState.state.layerVisibility.genericFeatures===false || !(0, dependencies.layerPresentation.isLayerItemVisible)('genericFeatures', entry.id)) continue;
        const feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === entry.id);
        dependencies.rendering.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, (0, dependencies.surfaces.isMobile)() ? 14 : 8)) add({ domain: 'generic', type: 'feature', id: feature.id });
        continue;
      }
      if (entry.domain === 'distribution') {
        const row = (0, dependencies.spatialRecords.indexedDistributionRow)(entry.id);
        dependencies.rendering.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (row && geometryHitsScreenPoint(row.geometry, coord, screenPoint, (0, dependencies.surfaces.isMobile)() ? 12 : 7)) add({ domain: 'distribution', type: 'distribution', id: row.layer.id });
        continue;
      }
      if (entry.domain === 'hydro') {
        if (!includeHydro) continue;
        const feature = (0, dependencies.hydroPresentation.hydroEditById)(entry.id);
        dependencies.rendering.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && (0, dependencies.physicalServices.isHydroFeatureVisible)(feature) && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, (0, dependencies.surfaces.isMobile)() ? 14 : 8)) add({ domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id });
      }
    }
    if (includeHydro && (dependencies.projectState.state.layerVisibility.rivers || dependencies.projectState.state.layerVisibility.lakes)) {
      const hydro = await (0, dependencies.pointerInteractionA.hydroAtScreenPoint)(screenPoint, coord);
      if (hydro) add({ domain: 'hydro', type: hydro.properties?.category || 'river', id: hydro.properties?.pandolab_id || hydro.id });
    }
    return candidates.sort((left, right) => compareVisualOrder(left, right) || (0, dependencies.objectOperationsA.objectDisplayInfo)(left).name.localeCompare((0, dependencies.objectOperationsA.objectDisplayInfo)(right).name, 'ko'));
  }

  function closeObjectChooser({ restoreFocus = false, cancelPending = true } = {}) {
    if (cancelPending) objectPickRevision += 1;
    objectChooserPresentationRevision += 1;
    objectChooserIntentMode = 'replace';
    chooserSelection=null;
    const chooser = (0, dependencies.platform.$)('objectChooser');
    if (!chooser) return;
    chooser.classList.add('hidden');
    chooser.removeAttribute('style');
    chooserCandidates=[];
    if (restoreFocus) (0, dependencies.platform.$)('map')?.focus();
  }

  function openObjectChooser(candidates, screenPoint, intentMode,options={}) {
    chooserSelection=options.onChoose||null;
    const chooser = (0, dependencies.platform.$)('objectChooser');
    const list = (0, dependencies.platform.$)('objectChooserList');
    if (!chooser || !list || candidates.length < 2) return closeObjectChooser();
    if(dependencies.surfaces.isMobile()&&closeActiveOverlay)closeActiveOverlay();
    objectChooserIntentMode = intentMode === 'toggle' ? 'toggle' : 'replace';
    chooserCandidates=candidates.slice();
    list.replaceChildren(...candidates.map((ref, index) => {
      const info = options.describe ? options.describe(ref,index) : (0, dependencies.objectOperationsA.objectDisplayInfo)(ref);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ui-button ui-row ui-card ui-selectable-row object-chooser-item${(!options.onChoose&&dependencies.domains.selectionDomain.has(ref)) ? ' is-selected' : ''}`;
      button.dataset.objectChooserIndex = String(index);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(dependencies.domains.selectionDomain.has(ref)));
      const name = document.createElement('span');
      const type = document.createElement('small');
      name.textContent = info.name;
      type.textContent = [info.type, info.detail].filter(Boolean).join(' · ');
      button.append(name, type);
      return button;
    }));
    chooser.classList.remove('hidden');
    const presentationRevision = ++objectChooserPresentationRevision;
    if ((0, dependencies.surfaces.isMobile)()) {
      chooser.removeAttribute('style');
      requestAnimationFrame(() => {
        if (presentationRevision !== objectChooserPresentationRevision || chooser.classList.contains('hidden')) return;
        list.querySelector('[role="option"]')?.focus({ preventScroll: true });
      });
      return;
    }
    const bounds = (0, dependencies.platform.$)('map')?.getBoundingClientRect();
    if (!bounds) return;
    const edge = 8;
    requestAnimationFrame(() => {
      if (presentationRevision !== objectChooserPresentationRevision || chooser.classList.contains('hidden')) return;
      const width = chooser.offsetWidth || 300;
      const height = chooser.offsetHeight || 200;
      chooser.style.left = `${(0, dependencies.platform.clamp)(screenPoint[0] + 12, edge, Math.max(edge, bounds.width - width - edge))}px`;
      chooser.style.top = `${(0, dependencies.platform.clamp)(screenPoint[1] + 12, edge, Math.max(edge, bounds.height - height - edge))}px`;
    });
  }

  async function chooseObjectCandidate(index, { toggle = false } = {}) {
    const ref = chooserCandidates[Number(index)];
    if(chooserSelection){const choose=chooserSelection;closeObjectChooser();return await choose(ref);}
    if (!objectRefSelectable(ref)) return false;
    const mode = toggle || objectChooserIntentMode === 'toggle' ? 'toggle' : 'replace';
    await dependencies.domains.selectionUiController.applyIntent(ref, { mode, scope: 'map',openEditor });
    return true;
  }

  async function handleObjectSelectionAt(screenPoint, { sourceEvent = dependencies.platform.d3.event, hitRef = null } = {}) {
    const requestRevision = ++objectPickRevision;
    const projectGeneration = dependencies.domains.projectDomain?.getGeneration?.() ?? 0;
    const pickViewRevision = dependencies.mapLayout.viewRevision;
    const source = sourceEvent?.sourceEvent || sourceEvent || {};
    const intentMode = source.ctrlKey || source.metaKey ? 'toggle' : 'replace';
    closeObjectChooser({ cancelPending: false });
    const inputStartedAt = performance.now();
    const performanceBefore = performanceRecorder ? performanceRecorder.snapshot() : null;
    Object.assign(dependencies.rendering.selectionPerformanceMetrics, {
      handlerMs: 0, indexQueryMs: 0, indexedCandidateCount: 0, exactHitTestCount: 0,
      gpuPickMs: 0, pickCacheHit: false, direct: false,
    });
    const normalizedHit = (0, dependencies.selectionServices.normalizeObjectRef)(hitRef);
    const coord = (0, dependencies.mapView.screenToGeo)(screenPoint);
    if (!coord) {
      closeObjectChooser();
      await dependencies.domains.selectionUiController.clear({ reason: 'map-background-selection-clear' });
      if(projectGeneration!==dependencies.domains.projectDomain.getGeneration())return false;
      if(onBackgroundClear)onBackgroundClear();
      return false;
    }
    const candidates = (await selectableObjectsAt(screenPoint, coord, { seedRefs: [normalizedHit] })).filter(objectRefSelectable);
    if (requestRevision !== objectPickRevision
      || projectGeneration !== (dependencies.domains.projectDomain?.getGeneration?.() ?? 0)
      || pickViewRevision !== dependencies.mapLayout.viewRevision
      || dependencies.projectState.state.tool !== 'select' || dependencies.projectState.state.labelPlacementMode) return false;
    if (!candidates.length) {
      closeObjectChooser({ cancelPending: false });
      await dependencies.domains.selectionUiController.clear({ reason: 'map-background-selection-clear' });
      if(projectGeneration!==dependencies.domains.projectDomain.getGeneration())return false;
      if(onBackgroundClear)onBackgroundClear();
      return false;
    }
    if (candidates.length > 1) {
      openObjectChooser(candidates, screenPoint, intentMode);
      return true;
    }
    const target = candidates[0];
    await dependencies.domains.selectionUiController.applyIntent(target, { mode: intentMode, scope: 'map',openEditor });
    if(projectGeneration!==dependencies.domains.projectDomain.getGeneration() || pickViewRevision!==dependencies.mapLayout.viewRevision)return false;
    dependencies.rendering.selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
    if(performanceRecorder)requestAnimationFrame(()=>performanceRecorder.publish(inputStartedAt,performanceBefore,`map:${target.key}`));
    return true;
  }

  function getTerritorialLabelRef(labelId) {
    const key = String(labelId);
    const ref = dependencies.countries.builtinTerritorialScene().labelRefs.get(key);
    const entity = dependencies.territorialModel.entityRepository.get(key);
    return dependencies.selectionServices.normalizeObjectRef(ref || (entity
      ? { domain: 'territorial', type: 'entity', id: entity.id } : null));
  }

  async function handleMapClick(screenPoint, { territorialLabelId = '' } = {}) {
    try {
    if (dependencies.projectState.state.spacePanActive || dependencies.projectState.state.tool === 'move') return;
    if(handleEditingClick){const editing=dependencies.domains.editingDomain;if(editing.snapshot().vertexPlacement)return await editing.handleInteraction({type:'vertex-placement-commit',projectGeneration:editing.snapshot().projectGeneration,screenPoint,pointerType:'touch'});}
    // A label names an explicit object even when its text is over another
    // territory or outside the globe. Other tools retain coordinate dispatch.
    if (territorialLabelId && dependencies.projectState.state.tool === 'select' && !dependencies.projectState.state.labelPlacementMode) {
      if (dependencies.projectState.state.projectReplacing || dependencies.projectState.state.modeProcessing) return false;
      const ref = getTerritorialLabelRef(territorialLabelId);
      if (!objectRefSelectable(ref)) return false;
      closeObjectChooser();
      const event = dependencies.platform.d3.event;
      const source = event?.sourceEvent || event || {};
      return await dependencies.domains.selectionUiController.applyIntent(ref, {
        mode: source.ctrlKey || source.metaKey ? 'toggle' : 'replace', scope: 'map',openEditor,
      });
    }
    if(dependencies.projectState.state.tool==='select'&&!dependencies.projectState.state.labelPlacementMode)return await handleObjectSelectionAt(screenPoint);
    if(handleEditingClick)return await handleEditingClick(screenPoint);
    } catch (error) {
      dependencies.feedback.reportOperationError(error, '지도 작업을 적용하지 못했습니다.', 'PL-MAP-CLICK-001', 4200);
      return false;
    }
  }

  function bindChooser(){
    (0, dependencies.platform.$)('objectChooserCloseBtn')?.addEventListener('click', () => (0, closeObjectChooser)({ restoreFocus: true }));
    (0, dependencies.platform.$)('objectChooserList')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-object-chooser-index]');
      if (!button) return;
      try { await chooseObjectCandidate(button.dataset.objectChooserIndex,{ toggle: event.ctrlKey || event.metaKey }); }
      catch(error) { dependencies.feedback.reportOperationError(error,'겹친 객체를 선택하지 못했습니다.','PL-SELECTION-CHOOSER-001',4200); }
    });
    (0, dependencies.platform.$)('objectChooserList')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[data-object-chooser-index]')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      event.stopPropagation();
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
        return;
      }
      if (delta) {
        event.preventDefault();
        items[(current + delta + items.length) % items.length]?.focus();
      }
    });

    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeObjectChooser({restoreFocus:true});});
    document.addEventListener('pointerdown',event=>{if(!event.target.closest('#objectChooser,#map'))closeObjectChooser();});
  }
  return Object.freeze({
    connect,

    get openVertexChooser(){return (candidates,screenPoint,onChoose)=>openObjectChooser(candidates,screenPoint,'replace',{onChoose,describe:(row,index)=>({name:'꼭짓점 '+(index+1),type:row.fixed?'고정점':'이동 가능',detail:(row.coordinate||row.coord||[]).map(n=>Number(n).toFixed(3)).join(', ')})});},
    get closeObjectChooser() { return closeObjectChooser; },
    get chooseObjectCandidate() { return chooseObjectCandidate; },
    selectableObjectsAt,
    bindChooser,
    get territorialObjectsAt() { return territorialObjectsAt; },
    get geometryHitsScreenPoint() { return geometryHitsScreenPoint; },
    get handleMapClick() { return handleMapClick; },
    get getTerritorialLabelRef() { return getTerritorialLabelRef; },
    get handleObjectSelectionAt() { return handleObjectSelectionAt; },
    get projectedLineDistance() { return projectedLineDistance; },
  });
}
