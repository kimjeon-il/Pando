/** ProgressiveStartup: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
import { matchesDefaultPreview, previewSourceForProject } from './project-preview-policy.js';
import { geometryRevision } from './geometry-versions.js';

export async function resolveStartupSource({libraryGeometryContext = null,restoreAutosave}){
  if(libraryGeometryContext){
    const workspace=await libraryGeometryContext.prepare();
    return {project:workspace.project,source:'library-geometry',view:null,error:null};
  }
  return restoreAutosave();
}

export function createProgressiveStartup({ startupMesh = 'builtin',libraryGeometryContext = null } = {}) {
  if (!['builtin', 'project'].includes(startupMesh)) throw new TypeError('Unsupported startup mesh source.');
  let dependencies;
  let restoringCountryFirstPaint = false;

  function connect(ports) {
    if (dependencies) throw new Error('progressive-startup already connected');
    dependencies = ports;
  }

  async function restoreSavedProject(project) {
    const expectedGeneration=dependencies.domains.projectDomain.getGeneration();
    const prepared=await dependencies.domains.projectDomain.prepareImport(project,{expectedGeneration});
    return dependencies.domains.projectDomain.admit(prepared,{reason:'startup-saved-project',expectedGeneration});
  }

  function requireCurrentBaseline(baseline,expectedGeneration) {
    const domain=dependencies.domains.projectDomain,state=domain.state();
    if(domain.getGeneration()!==expectedGeneration)
      throw Object.assign(new Error('The builtin source belongs to another project request.'),{code:'PL-CORE-STALE',name:'AbortError'});
    if(!Number.isSafeInteger(baseline?.baselineId)||baseline.baselineId<=0||state.storageBaselineId!==baseline.baselineId)
      throw Object.assign(new Error('The verified C++ builtin source receipt is unavailable.'),{code:'PL-SCHEMA-BASE'});
    return state;
  }

  async function admitTerritorialBaseline(baseline, reason) {
    const expectedGeneration=dependencies.domains.projectDomain.getGeneration();
    const receipt=requireCurrentBaseline(baseline,expectedGeneration);
    return dependencies.domains.projectDomain.admit(dependencies.domains.projectDomain.snapshot(), {
      baselineId:receipt.storageBaselineId,preserveCursor:true,reason,expectedGeneration,
    });
  }

  async function admitFeatures(features, reason) {
    return dependencies.domains.projectDomain.admit(dependencies.domains.projectDomain.snapshot(), {
      features, preserveCursor: true, reason,
    });
  }

  function handleGeometryProgress(event) {
    const detail = event.detail || {};
    dependencies.projectState.state.geometryProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.geometryProgress = { stage: detail.stage || '', percent: dependencies.projectState.state.geometryProgress };
    if ((0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) return;
    if (dependencies.projectState.state.dataReadiness === dependencies.readiness.DATA_READINESS.ERROR) {
      (0, dependencies.readinessUi.applyDataReadinessEvent)(restoringCountryFirstPaint
        ? dependencies.applicationConstantsA.READINESS_EVENTS.RESTORE_STARTED
        : dependencies.applicationConstantsA.READINESS_EVENTS.RETRY_GEOMETRY);
    }
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = restoringCountryFirstPaint
      ? `저장된 지도 복원 · 편집 데이터 ${Math.round(dependencies.projectState.state.geometryProgress)}%`
      : `빠른 미리보기 · 편집 데이터 ${Math.round(dependencies.projectState.state.geometryProgress)}%`;
  }

  function handleMeshProgress(event) {
    const detail = event.detail || {};
    dependencies.projectState.state.meshProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.meshProgress = { stage: detail.stage || '', percent: dependencies.projectState.state.meshProgress };
    if (!(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness) || dependencies.projectState.state.dataReadiness === dependencies.readiness.DATA_READINESS.ENHANCED) return;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = restoringCountryFirstPaint
      ? `저장된 지도 복원 · 고화질 지도 ${Math.round(dependencies.projectState.state.meshProgress)}%`
      : `빠른 미리보기 · 고화질 지도 ${Math.round(dependencies.projectState.state.meshProgress)}%`;
  }

  function handleGeometryError(event) {
    (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.GEOMETRY_ERROR);
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '편집 데이터 오류 · 자동 재시도 중';
  }

  function handleMeshError(event) {
    if (!(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) return;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '고화질 지도 오류 · 자동 재시도 중';
  }

  async function completeGeometryInitialization(geometry, autosaveRestore, previewStart) {
    const applyStartedAt = performance.now();
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'start';
    const navigationView = (0, dependencies.platform.deepClone)(dependencies.projectState.state.view);
    const navigationProjection = dependencies.projectState.state.projection;
    const navigationChanged = navigationProjection !== previewStart.projection
      || JSON.stringify(navigationView) !== previewStart.viewJson;
    const previewSearch = dependencies.projectState.state.objectSearch;
    const liveMonthBeforeAdmission = dependencies.domains.commandOwner.state()?.timelineCursor || '';
    const previewSelection = (dependencies.projectState.state.selected?.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.parentId)) ? String(dependencies.projectState.state.selected.id || '') : '';
    (0, dependencies.builtinCountries.installCanonicalCountryStore)(geometry.canonicalCountryStore);
    const restored = autosaveRestore.project;
    const projectGeneration = previewStart.projectGeneration;
    const baseline = !restored
      ? await dependencies.builtinBaseline.prepareProjectBaseline() : null;
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return null;
    // Preview-to-canonical promotion stays inside the same project generation.
    // A project hard reset here discarded the painted preview scene and forced
    // the renderer down the expensive canonical fallback path before the
    // Worker mesh was ready.
    dependencies.geometryPreview.boundarySelectionAnalysisCache.clear();
    // Display-only preview sources survive canonical hydration for zoom LOD.
    // The renderer invalidates these on project replacement, never the Store.
    const previewAllowed = dependencies.rendering.gpuMapRenderer.getRuntimeState?.().previewAllowed !== false;
    dependencies.projectState.state.auditPreviewTerritorialUnits = previewAllowed
      ? dependencies.territorialModel.entityRepository.list({  }).filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId) : null;

    if (restored) {
      if(baseline)requireCurrentBaseline(baseline,dependencies.domains.projectDomain.getGeneration());
      await restoreSavedProject(restored);
    } else await admitTerritorialBaseline(baseline,'startup-canonical-territories');
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return null;
    const userChangedPreviewMonth = !!previewStart.timelineMonth
      && liveMonthBeforeAdmission !== previewStart.timelineMonth;
    if(!libraryGeometryContext)await dependencies.persistence.applyAutosavedTimeline(userChangedPreviewMonth
      ? { documentId:dependencies.domains.projectDomain.snapshot().documentId,lastViewedMonth: liveMonthBeforeAdmission } : autosaveRestore.view);
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return null;
    // A display request may have initialized the edit Worker from preview countries.
    // Retire it before any canonical edit; its next request lazily rebases from this state.
    dependencies.spatialQuery.mapEditClient.stop();
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'countries-indexed';
    if (!restored) (0, dependencies.countryRecords.applyPristineLabelAnchors)(({ type: 'FeatureCollection', features: dependencies.territorialModel.entityRepository.list({ kind: 'general', parentId: '' }) }));
    if (navigationChanged) {
      dependencies.projectState.state.view = navigationView;
      dependencies.projectState.state.projection = navigationProjection;
    } else if(!libraryGeometryContext){
      (0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view);
    }
    (0, dependencies.mapView.syncMapHostFromState)();
    dependencies.projectState.state.objectSearch = previewSearch;
    await (0, dependencies.objectCatalogView.pruneLayerItemVisibility)();
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return null;
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(restored || dependencies.domains.projectDomain.snapshot());
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'project-normalized';
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    const externalGeometry = !!restored?.territorialEntities && restored.baseDataset !== dependencies.platformConfigurationA.BASE_DATASET;
    const useBuiltInMesh = !externalGeometry
      && dependencies.projectState.state.autosaveMode !== 'full';
    // Capture the shape that produced the display preview before readiness
    // permits edits or an editable listener can change the canonical geometry.
    dependencies.projectState.state.auditPreviewGeometryReferences = new Map(
      dependencies.territorialModel.entityRepository.list().map(entity => [String(entity.id), { geometry: entity.geometry, revision: geometryRevision(entity.geometry) }]),
    );
    window.PANDOLAB_COUNTRIES = null;
    (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.GEOMETRY_READY);
    dependencies.projectState.state.geometryProgress = 100;
    (0, dependencies.editorBindings.syncProjectControls)();
    dependencies.lifecycleUi.projectUi.syncHistory();
    // Keep the already-painted preview scene stable until the canonical mesh is
    // ready. A full project invalidation here made the renderer traverse the
    // 10m geometry on the main thread before the Worker-produced mesh could be
    // applied, defeating the interaction-first startup contract.
    // The canonical state becomes editable here, but the painted preview and
    // its interaction packet remain active until the canonical mesh commits.
    // The mesh commit performs the first full canonical render atomically.
    dependencies.domains.renderingDomain?.invalidateView?.('canonical-geometry-applied');
    if (previewSelection && dependencies.territorialModel.entityRepository.get(previewSelection)) await dependencies.domains.selectionUiController.applyIntent({ domain: 'territorial', type: 'entity', id: String(previewSelection) }, { refreshOnly: true, openEditor: false });
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'layer-hydration';
    await dependencies.domains.objectSearchController?.completeHydration();
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return null;
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'complete';
    // Do not structured-clone the full canonical country collection into the
    // edit Worker during startup. The client rebases lazily on the first edit
    // operation, so the initial canonical promotion stays isolated from
    // non-essential editing preparation.

    if (startupMetrics) {
      startupMetrics.geometryApplyMs = performance.now() - applyStartedAt;
      const renderer = dependencies.rendering.gpuMapRenderer.getRuntimeState();
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    if (restored && !libraryGeometryContext) {
      await dependencies.lifecycleUi.projectUi.completeAutosaveRecovery();
      if (Number.isFinite(projectGeneration)
        && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return null;
      dependencies.projectSession.saveState.markNewProject();
      dependencies.projectSession.saveState.setAutosave(dependencies.applicationConstantsA.AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.territorialEntities && restored.baseDataset === dependencies.platformConfigurationA.BASE_DATASET) dependencies.domains.projectDomain.queueAutosave(0);
      const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
      (0, dependencies.feedback.setActionStatus)(`${restoredLabel} 복원 완료. 고화질 지도 준비 중…`, 'success', 3600);
    } else {
      dependencies.projectSession.saveState.markNewProject();
      const restoreMessage = autosaveRestore.error
        ? (0, dependencies.readiness.compactNotificationMessage)(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 })
        : '편집 준비 완료. 고화질 지도 준비 중…';
      (0, dependencies.feedback.setActionStatus)(restoreMessage, autosaveRestore.error ? 'error' : 'success', autosaveRestore.error ? 0 : 3200);
    }
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = useBuiltInMesh ? '빠른 미리보기 · 고화질 지도 준비 중' : '프로젝트 지도를 다시 구성하는 중입니다.';
    window.dispatchEvent(new CustomEvent('pandolab:editable', { detail: { useBuiltInMesh } }));
    return { useBuiltInMesh, restored, projectGeneration };
  }

  async function completeMeshEnhancement(mesh, context) {
    const meshReplaceStartedAt = performance.now();
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    let meshApplied;
    const projectGeneration = context?.projectGeneration ?? dependencies.rendering.gpuMapRenderer.getProjectGeneration?.();
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return;
    meshApplied=await dependencies.renderQuality.prepareCanonicalMesh({projectGeneration,
      mesh:context.useBuiltInMesh&&dependencies.projectState.state.autosaveMode!=='full'?mesh:null,
      slotIds:dependencies.builtinCountries.canonicalCountryStore.ids(),
      dirtyIds:new Set([...dependencies.projectState.state.historyDirtyEntityIds,...dependencies.projectState.state.pendingCountryRenderIds])});
    if (Number.isFinite(projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== projectGeneration) return;
    // Keep the single preview as a display source. Exact edit/save geometry
    // remains in the repository and mesh availability cannot override zoom.
    if (meshApplied) {
      dependencies.rendering.gpuMapRenderer.syncCountryMeshQuality();
      window.PANDOLAB_COUNTRIES = null;
      if (startupMetrics) startupMetrics.canonicalPreviewReleasedBytes = 0;
      (0, dependencies.renderQuality.applyAdaptiveRenderQuality)({ refreshScene: false, reason: 'canonical-ready' });
    }
    (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.MESH_READY);
    dependencies.projectState.state.meshProgress = 100;
    if (!context.useBuiltInMesh || (dependencies.projectState.state.autosaveMode === 'full')) {
      dependencies.domains.renderingDomain?.invalidateProject?.('canonical-mesh-ready');
    }
    const renderer = dependencies.rendering.gpuMapRenderer.getRuntimeState();
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `Natural Earth 5.1.1 · ${renderer.renderer === 'webgl2' ? 'WebGL2' : renderer.renderer === 'webgl1' ? 'WebGL1' : 'Canvas'} 고화질`;
    if (startupMetrics) {
      startupMetrics.meshApplyMs = performance.now() - meshReplaceStartedAt;
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    (0, dependencies.feedback.setActionStatus)('정밀 경계를 사용할 수 있습니다.', 'success', 2400);
  }

  function awaitVisualFrame(maxWaitMs = 120) {
    return new Promise(resolve => {
      let settled = false;
      let timeout = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      timeout = setTimeout(finish, Math.max(16, Number(maxWaitMs) || 120));
      requestAnimationFrame(finish);
    });
  }

  async function initializeStartupRuntime({ afterInitialMapSetup = null, allowPreview = true, preview = null } = {}) {
    (0, dependencies.workspaceUiA.applyLayoutMode)({ initial: true });
    (0, dependencies.editorBindings.bindUI)();
    dependencies.domains.objectSearchController.beginHydration();
    (0, dependencies.mapHostViewA.initSvg)();
    (0, dependencies.mapHostViewB.resizeMap)();
    if (typeof afterInitialMapSetup === 'function') afterInitialMapSetup();

    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) startupMetrics.mapHostStage = 'frame-pending';
    await awaitVisualFrame();
    if (startupMetrics) startupMetrics.mapHostStage = 'host-initialize';
    dependencies.mapHostCommands.setReadyPromise((0, dependencies.mapHostViewB.initializeMapHost)());
    await dependencies.mapHostViewB.mapHostReadyPromise;
    if (startupMetrics) startupMetrics.mapHostStage = 'gpu-initialize';
    const gpuInitializeStartedAt = performance.now();
    const gpuReady = await dependencies.rendering.gpuMapRenderer.initialize({ allowPreview, preview });
    const gpuInitializeMs = performance.now() - gpuInitializeStartedAt;
    if (startupMetrics) startupMetrics.mapHostStage = 'ready';
    (0, dependencies.mapHostViewC.startMapResizeObserver)();
    return { gpuReady, gpuInitializeMs };
  }

  async function initProgressive() {
    (0, dependencies.platformConfigurationB.assertRuntimeCompatibility)();
    if (!window.d3) throw new Error('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.');
    if (!window.PANDOLAB_COUNTRIES?.features?.length) throw new Error('미리보기 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.');

    const autosavePromise = resolveStartupSource({libraryGeometryContext,
      restoreAutosave:()=>dependencies.lifecycleUi.projectUi.restoreAutosave()});
    const autosaveRestore = await autosavePromise;
    const savedProject = autosaveRestore.project;
    const baseline = window.PANDOLAB_PREVIEW_BASELINE;
    const previewInput=savedProject ? {project:savedProject,
      territorialViews:(await dependencies.domains.projectDomain.inspectImport(savedProject)).territorialViews}:null;
    const defaultPreview = !savedProject || matchesDefaultPreview(previewInput, baseline);
    const cachedPreview = !defaultPreview && !libraryGeometryContext
      ? await dependencies.domains.projectDomain.restorePreview(savedProject, previewInput) : null;
    const previewSource = !savedProject ? {kind:'default'} : previewSourceForProject(previewInput, baseline, cachedPreview);
    const hasStoredCountryGeometry = previewSource.kind === 'restore';
    const sourceMonth = new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
    const allowDefaultPreview = !dependencies.projectState.state.timelineCursor || dependencies.projectState.state.timelineCursor === sourceMonth;
    const allowPreview = !hasStoredCountryGeometry && (previewSource.kind !== 'default' || allowDefaultPreview);
    restoringCountryFirstPaint = hasStoredCountryGeometry;
    if (hasStoredCountryGeometry) {
      (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.RESTORE_STARTED);
    }
    if (savedProject && !libraryGeometryContext) (0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view);
    if (savedProject) {
      await restoreSavedProject(savedProject);
    } else {
      const classified = allowPreview
        ? (0, dependencies.applicationServicesA.classifyBuiltinCountries)((0, dependencies.countryServices.normalizeCountryCollection)(window.PANDOLAB_COUNTRIES))
        : { countries: { features: [] }, subunits: [] };
      await admitFeatures([...classified.countries.features, ...classified.subunits], 'startup-preview-territories');
    }
    await (0, dependencies.objectCatalogView.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = hasStoredCountryGeometry
      ? '저장된 지도 형상을 준비하는 중입니다.'
      : '빠른 미리보기 GPU 지도를 준비하는 중입니다.';

    window.addEventListener('pandolab:geometry-progress', handleGeometryProgress);
    window.addEventListener('pandolab:mesh-progress', handleMeshProgress);
    window.addEventListener('pandolab:geometry-error', handleGeometryError);
    window.addEventListener('pandolab:mesh-error', handleMeshError);
    const { gpuInitializeMs } = await initializeStartupRuntime({ allowPreview,
      preview: previewSource.kind === 'project' ? cachedPreview : null });
    if (window.__PANDOLAB_STARTUP_METRICS__) {
      const previewRenderer = dependencies.rendering.gpuMapRenderer.getRuntimeState();
      window.__PANDOLAB_STARTUP_METRICS__.previewMeshUploadMs = gpuInitializeMs;
      window.__PANDOLAB_STARTUP_METRICS__.renderer = previewRenderer.renderer;
      window.__PANDOLAB_STARTUP_METRICS__.fallbackReason = previewRenderer.fallbackReason;
      window.__PANDOLAB_STARTUP_METRICS__.devicePixelRatio = previewRenderer.devicePixelRatio;
      window.__PANDOLAB_STARTUP_METRICS__.effectivePixelRatio = previewRenderer.effectivePixelRatio;
    }
    (0, dependencies.editorBindings.syncProjectControls)();
    (0, dependencies.mapHostViewB.resizeMap)();
    dependencies.lifecycleUi.projectUi.syncHistory();
    await dependencies.domains.editingDomain.setTool('select', { announce: false });
    if (allowPreview) {
      const framePromise = dependencies.rendering.gpuMapRenderer.waitForPreviewFrame();
      // Geometry preparation must never wait for a preview that the shared
      // surface policy may withhold at the current scale.
      framePromise.then(presented => {
        if (presented && !(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) {
          (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.PREVIEW_READY);
        }
      }).catch(error => dependencies.feedback.reportOperationError(error, '미리보기 화면을 표시하지 못했습니다.', 'PL-PREVIEW-FRAME-001', 4200));
    }
    dependencies.startupCommands.markRuntimeReady();
    const previewStart = { projection: dependencies.projectState.state.projection, viewJson: JSON.stringify(dependencies.projectState.state.view),
      timelineMonth: dependencies.domains.commandOwner.state()?.timelineCursor || '',
      projectGeneration: dependencies.rendering.gpuMapRenderer.getProjectGeneration?.() };
    (0, dependencies.feedback.setActionStatus)(
      hasStoredCountryGeometry ? '저장된 지도 복원 중…' : '정밀 경계 준비 중…',
      'working',
      0,
    );
    window.dispatchEvent(new CustomEvent('pandolab:interactive'));
    if (window.__PANDOLAB_STARTUP_METRICS__?.geometryError) {
      handleGeometryError({ detail: window.__PANDOLAB_STARTUP_METRICS__.geometryError });
    }

    let geometry;
    try {
      geometry = await window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE;
    } catch (error) {
      if (Number.isFinite(previewStart.projectGeneration)
        && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== previewStart.projectGeneration) return;
      console.error('[PL-GEOMETRY-LOAD-001]', error);
      handleGeometryError({ detail: '저장된 지도 형상을 불러오지 못했습니다.' });
      return;
    }
    if (Number.isFinite(previewStart.projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== previewStart.projectGeneration) return;
    const previewEntities = hasStoredCountryGeometry ? [] : dependencies.territorialModel.entityStore.snapshot();
    const previewCountries = { type: 'FeatureCollection', features: previewEntities.filter(feature => (feature.properties.entityKind === 'general' && !feature.properties.parentId)) };
    dependencies.projectState.state.auditPreviewCountries = previewCountries;
    let context;
    try {
      context = await completeGeometryInitialization(geometry, autosaveRestore, previewStart);
    } catch (error) {
      if (Number.isFinite(previewStart.projectGeneration)
        && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== previewStart.projectGeneration) return;
      try { await admitFeatures(previewEntities, 'startup-preview-rollback'); }
      catch (restoreError) { error.restoreError = restoreError; }
      console.error('[PL-GEOMETRY-APPLY-001]', error);
      (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.GEOMETRY_ERROR);
      (0, dependencies.spatialRecords.scheduleMapObjectSpatialIndexRebuild)();
      dependencies.domains.renderingDomain?.invalidateProject?.('progressive-initialization');
      handleGeometryError({ detail: '무손실 편집 지도를 적용하지 못했습니다.' });
      return;
    }
    if (!context) return;
    if (Number.isFinite(context.projectGeneration)
      && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== context.projectGeneration) return;
    // Without a matching project preview, preserve the neutral restore screen
    // until exact geometry and saved display settings have been applied.
    try {
      if (!context.useBuiltInMesh) {
        await completeMeshEnhancement(null, context);
      } else {
        if (window.__PANDOLAB_STARTUP_METRICS__?.meshError) {
          handleMeshError({ detail: window.__PANDOLAB_STARTUP_METRICS__.meshError });
        }
        const mesh = await window.PANDOLAB_CANONICAL_MESH_PROMISE;
        await completeMeshEnhancement(mesh, context);
      }
      if (Number.isFinite(context.projectGeneration)
        && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== context.projectGeneration) return;
      if (savedProject && !cachedPreview) await dependencies.domains.projectDomain.ensurePreview(savedProject);
    } catch (error) {
      if (error?.name === 'AbortError' || (Number.isFinite(context.projectGeneration)
        && dependencies.rendering.gpuMapRenderer.getProjectGeneration() !== context.projectGeneration)) return;
      console.error('[PL-MESH-APPLY-001]', error);
      handleMeshError({ detail: '고화질 지도를 적용하지 못했습니다.' });
      return;
    }
  }

  async function init() {
    if (window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE instanceof Promise) return initProgressive();
    (0, dependencies.platformConfigurationB.assertRuntimeCompatibility)();
    if (!window.d3) {
      (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '엔진 오류';
      (0, dependencies.feedback.setActionStatus)('지도 엔진 로드 실패. 새로고침하세요', 'error', 0);
      return;
    }
    if (!window.PANDOLAB_COUNTRIES?.features?.length) {
      (0, dependencies.feedback.setActionStatus)('국가 자료 로드 실패. 새로고침하세요', 'error', 0);
      return;
    }

    const autosaveRestore = await resolveStartupSource({libraryGeometryContext,
      restoreAutosave:()=>dependencies.lifecycleUi.projectUi.restoreAutosave()});
    const restored = autosaveRestore.project;
    if(!libraryGeometryContext)(0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view);
    dependencies.projectState.state.auditPreviewCountries = window.PANDOLAB_COUNTRIES;

    const baseline = !restored
      ? await dependencies.builtinBaseline.prepareProjectBaseline() : null;
    if (restored) {
      if(baseline)requireCurrentBaseline(baseline,dependencies.domains.projectDomain.getGeneration());
      await restoreSavedProject(restored);
    } else await admitTerritorialBaseline(baseline,'startup-canonical-territories');
    if(!libraryGeometryContext)await dependencies.persistence.applyAutosavedTimeline(autosaveRestore.view);
    await (0, dependencies.objectCatalogView.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.objectDisplay.invalidateObjectPresentation)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(restored || dependencies.domains.projectDomain.snapshot());
    const externalGeometry = !!restored?.territorialEntities && restored.baseDataset !== dependencies.platformConfigurationA.BASE_DATASET;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = 'Natural Earth 5.1.1 · GPU 렌더러를 준비하는 중입니다.';
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;

    const { gpuReady } = await initializeStartupRuntime({
      allowPreview: startupMesh !== 'project',
      afterInitialMapSetup: () => dependencies.spatialQuery.mapEditClient.rebase(),
    });
    if (startupMesh === 'project') {
      (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.GEOMETRY_READY);
      const rebuilt=await dependencies.renderQuality.prepareCanonicalMesh({reason:'project-startup'});
      if (rebuilt === false) throw new Error('Project startup mesh could not be prepared.');
      (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.MESH_READY);
    }
    if (gpuReady) {
      dependencies.projectState.state.countryVisualPhase = 'canonical';
    }
    if (restored && gpuReady) {
      if (externalGeometry || (dependencies.projectState.state.autosaveMode === 'full')) (0, dependencies.renderQuality.scheduleGpuMeshRebuild)(0);
      else if (dependencies.projectState.state.historyDirtyEntityIds.size) {
        for (const id of dependencies.projectState.state.historyDirtyEntityIds) dependencies.projectState.state.pendingCountryRenderIds.add(String(id));
        dependencies.rendering.gpuMapRenderer.applyCountryPatch(dependencies.projectState.state.historyDirtyEntityIds);
      }
    }

    (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
    if ((0, dependencies.platform.$)('objectSearchInput')) (0, dependencies.platform.$)('objectSearchInput').value = dependencies.projectState.state.objectSearch;
    dependencies.domains.objectSearchController?.render(true);
    (0, dependencies.readinessUi.syncStatusBar)();

    (0, dependencies.mapHostViewB.resizeMap)();
    dependencies.lifecycleUi.projectUi.syncHistory();
    await dependencies.domains.editingDomain.setTool('select');
    await dependencies.domains.objectSearchController?.completeHydration();

    if (restored && !libraryGeometryContext) {
      await dependencies.lifecycleUi.projectUi.completeAutosaveRecovery();
      dependencies.projectSession.saveState.markNewProject();
      dependencies.projectSession.saveState.setAutosave(dependencies.applicationConstantsA.AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.territorialEntities && restored.baseDataset === dependencies.platformConfigurationA.BASE_DATASET) dependencies.domains.projectDomain.queueAutosave(0);
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
        (0, dependencies.feedback.setActionStatus)(`${restoredLabel} 복원했습니다.`, 'success', 3200);
      } else {
        (0, dependencies.feedback.setActionStatus)('자동저장을 복원했습니다.', 'success', 4200);
      }
    } else {
      dependencies.projectSession.saveState.markNewProject();
      if (autosaveRestore.error) {
        const restoreMessage = (0, dependencies.readiness.compactNotificationMessage)(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 });
        (0, dependencies.feedback.setActionStatus)(restoreMessage, 'error', 0);
      } else if (gpuReady) {
        (0, dependencies.feedback.setActionStatus)('고해상도 지도를 준비했습니다.', 'success');
      } else {
        (0, dependencies.feedback.setActionStatus)('무손실 렌더러 준비 완료.', 'success', 4200);
      }
    }
  }

  return Object.freeze({
    connect,

    get init() { return init; },
  });
}
