/** ProgressiveStartup: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
import { matchesDefaultPreview, previewCountriesWithProjectProperties, previewSourceForProject } from './project-preview-policy.js';

export function createProgressiveStartup() {
  let dependencies;
  let restoringCountryFirstPaint = false;

  function connect(ports) {
    if (dependencies) throw new Error('progressive-startup already connected');
    dependencies = ports;
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
    const previewSearch = dependencies.projectState.state.layerSearch;
    const previewSelection = (dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) ? String(dependencies.projectState.state.selected.id || '') : '';
    (0, dependencies.builtinCountries.installCanonicalCountryStore)(geometry.canonicalCountryStore);
    // Preview-to-canonical promotion stays inside the same project generation.
    // A project hard reset here discarded the painted preview scene and forced
    // the renderer down the expensive canonical fallback path before the
    // Worker mesh was ready.
    const projectGeneration = dependencies.rendering.gpuMapRenderer.getProjectGeneration?.();
    dependencies.geometryPreview.boundarySelectionAnalysisCache.clear();
    // The low-resolution country source is a one-way startup aid.  After the
    // first canonical promotion a project reset starts from canonical data or
    // a neutral loading state and must not briefly re-expose preview geometry.
    const previewAllowed = dependencies.rendering.gpuMapRenderer.getRuntimeState?.().previewAllowed !== false;
    dependencies.projectState.state.auditPreviewTerritorialUnits = previewAllowed
      ? dependencies.projectState.state.territorialUnits : null;
    dependencies.projectState.state.countryVisualPhase = previewAllowed ? 'preview' : 'canonical';
    dependencies.labelCacheCommands.resetCountryDisplayCache();

    const restored = autosaveRestore.project;
    if (restored) (0, dependencies.snapshots.applySharedProjectFields)(restored);
    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    dependencies.projectState.state.countriesData = restoredDelta
      ? dependencies.domains.projectDomain.countriesFromAutosaveDelta(restored, geometry.countries)
      : restored?.countriesData
        ? (0, dependencies.geometryMutation.reindexCountries)(restored.countriesData, true)
        : (0, dependencies.geometryMutation.reindexCountries)(geometry.countries, true, { assumeCanonical: true });
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'countries-indexed';
    if (!restored) (0, dependencies.builtinCountries.applyFreshBuiltinClassification)();
    if (!restored) (0, dependencies.countryRecords.applyPristineLabelAnchors)(dependencies.projectState.state.countriesData);
    if (navigationChanged) {
      dependencies.projectState.state.view = navigationView;
      dependencies.projectState.state.projection = navigationProjection;
    } else {
      (0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view);
    }
    (0, dependencies.mapView.syncMapHostFromState)();
    dependencies.projectState.state.layerSearch = previewSearch;
    (0, dependencies.snapshots.normalizeProjectObjects)();
    (0, dependencies.layerTree.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(restored);
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'project-normalized';
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== dependencies.platformConfigurationA.BASE_DATASET;
    const useBuiltInMesh = !externalGeometry
      && !dependencies.projectState.state.sessionBaseCountriesJson;
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
    if (previewSelection && (0, dependencies.countries.countryFeatureById)(previewSelection)) (0, dependencies.propertyEditingA.applyCountrySelectionIntent)(previewSelection, true);
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'layer-hydration';
    await dependencies.domains.layerTreeController?.completeHydration();
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
    if (restored) {
      dependencies.projectSession.saveState.markNewProject(`content:${Date.now()}`);
      dependencies.projectSession.saveState.setAutosave(dependencies.applicationConstantsA.AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === dependencies.platformConfigurationA.BASE_DATASET) dependencies.domains.projectDomain.queueAutosave(0);
      const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
      (0, dependencies.feedback.setActionStatus)(`${restoredLabel} 복원 완료. 고화질 지도 준비 중…`, 'success', 3600);
    } else {
      dependencies.projectSession.saveState.markNewProject('content:0');
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
    if (!context.useBuiltInMesh || dependencies.projectState.state.sessionBaseCountriesJson) {
      meshApplied = (await dependencies.rendering.gpuMapRenderer.rebuildFromCountries((0, dependencies.countries.builtinRenderCountries)().collection.features, { projectGeneration })) !== false;
    } else {
      const dirtyIds = new Set([...dependencies.projectState.state.historyDirtyCountryIds, ...dependencies.projectState.state.pendingCountryRenderIds]);
      meshApplied = (await dependencies.rendering.gpuMapRenderer.replaceBuiltInMesh({
        meshBuffer: mesh.meshBuffer,
        preparedStroke: mesh.preparedStroke,
        spatialBlocks: mesh.spatialBlocks,
        builtinIdentity: mesh.identity,
        onStaged: () => {
          dependencies.projectState.state.countryVisualPhase = 'canonical';
          dependencies.labelCacheCommands.resetCountryDisplayCache();
          dependencies.domains.renderingDomain?.invalidateProject?.('canonical-staging-ready');
        },
        // Binary country slots retain canonical source order, even when a
        // source now lives in Subunits, is hidden, edited or deleted.
        features: dependencies.builtinCountries.canonicalCountryStore.ids().map(id => ({ id })),
        quality: 'canonical',
        countryPatchIds: [...dirtyIds],
        projectGeneration,
      })) !== false;
    }
    // Once the canonical mesh is successfully displayed, every country SVG
    // path must use the same source. This prevents edit/selection state from
    // mixing preview and canonical geometries on a single frame.
    if (meshApplied) {
      dependencies.projectState.state.countryVisualPhase = 'canonical';
      dependencies.labelCacheCommands.resetCountryDisplayCache();
      dependencies.projectState.state.auditPreviewCountries = null;
      dependencies.projectState.state.auditPreviewTerritorialUnits = null;
      window.PANDOLAB_COUNTRIES = null;
      if (startupMetrics) startupMetrics.canonicalPreviewReleasedBytes = Number(
        startupMetrics.preview?.assets?.countries?.decodedBytes || 0,
      );
      void window.PANDOLAB_SAMPLE_STARTUP_MEMORY?.('preview-released');
      (0, dependencies.renderQuality.applyAdaptiveRenderQuality)({ refreshScene: false, reason: 'canonical-ready' });
    }
    (0, dependencies.physicalResources.loadTerrainManifest)();
    (0, dependencies.physicalData.loadHydroData)();
    (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.MESH_READY);
    dependencies.projectState.state.meshProgress = 100;
    if (!context.useBuiltInMesh || dependencies.projectState.state.sessionBaseCountriesJson) {
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
    (0, dependencies.feedback.setActionStatus)('고화질 지도를 준비했습니다.', 'success', 2400);
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
    dependencies.domains.layerTreeController.beginHydration();
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

    const autosavePromise = dependencies.domains.projectDomain.restoreAutosave();
    const autosaveRestore = await autosavePromise;
    const savedProject = autosaveRestore.project;
    const baseline = window.PANDOLAB_PREVIEW_BASELINE;
    const defaultPreview = matchesDefaultPreview(savedProject, baseline);
    const cachedPreview = !defaultPreview ? await dependencies.domains.projectDomain.restorePreview(savedProject) : null;
    const previewSource = previewSourceForProject(savedProject, baseline, cachedPreview);
    const hasStoredCountryGeometry = previewSource.kind === 'restore';
    restoringCountryFirstPaint = hasStoredCountryGeometry;
    if (hasStoredCountryGeometry) {
      (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.RESTORE_STARTED);
    }
    if (savedProject && !hasStoredCountryGeometry) (0, dependencies.snapshots.applySharedProjectFields)(savedProject);
    if (savedProject) (0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view);
    if (previewSource.kind === 'project') {
      dependencies.projectState.state.countriesData = (0, dependencies.geometryMutation.reindexCountries)(
        previewCountriesWithProjectProperties(cachedPreview.countries, savedProject), true);
      const unitGeometries = new Map(cachedPreview.territorialUnits.map(unit => [String(unit.id), unit.geometry]));
      dependencies.projectState.state.territorialUnits = dependencies.projectState.state.territorialUnits.map(unit => ({
        ...unit, geometry: unitGeometries.get(String(unit.id)) || unit.geometry,
      }));
    } else if (hasStoredCountryGeometry) {
      dependencies.projectState.state.countriesData = { type: 'FeatureCollection', features: [] };
    } else {
      dependencies.projectState.state.countriesData = (0, dependencies.geometryMutation.reindexCountries)(window.PANDOLAB_COUNTRIES, true);
      if (savedProject) {
        const classified = (0, dependencies.applicationServicesA.classifyBuiltinCountries)(dependencies.projectState.state.countriesData);
        dependencies.projectState.state.countriesData = (0, dependencies.geometryMutation.reindexCountries)(
          previewCountriesWithProjectProperties(classified.countries, savedProject), true);
        const unitGeometries = new Map(classified.subunits.map(unit => [String(unit.id), unit.geometry]));
        dependencies.projectState.state.territorialUnits = dependencies.projectState.state.territorialUnits.map(unit => ({
          ...unit, geometry: unitGeometries.get(String(unit.id)) || unit.geometry,
        }));
      } else (0, dependencies.builtinCountries.applyFreshBuiltinClassification)();
    }
    if (!hasStoredCountryGeometry) (0, dependencies.snapshots.normalizeProjectObjects)();
    (0, dependencies.layerTree.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(null);
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = hasStoredCountryGeometry
      ? '저장된 지도 형상을 준비하는 중입니다.'
      : '빠른 미리보기 GPU 지도를 준비하는 중입니다.';

    window.addEventListener('pandolab:geometry-progress', handleGeometryProgress);
    window.addEventListener('pandolab:mesh-progress', handleMeshProgress);
    window.addEventListener('pandolab:geometry-error', handleGeometryError);
    window.addEventListener('pandolab:mesh-error', handleMeshError);
    const { gpuInitializeMs } = await initializeStartupRuntime({ allowPreview: !hasStoredCountryGeometry,
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
    dependencies.domains.editingDomain?.setTool('select', { announce: false });
    let previewFrameReady = false;
    if (!hasStoredCountryGeometry) {
      const framePromise = dependencies.rendering.gpuMapRenderer.waitForPreviewFrame();
      previewFrameReady = await Promise.race([
        framePromise,
        new Promise(resolve => setTimeout(() => resolve(false), 4000)),
      ]);
      if (previewFrameReady) (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.PREVIEW_READY);
      else void framePromise.then(presented => {
        if (presented && !(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) {
          (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.PREVIEW_READY);
        }
      });
    }
    dependencies.startupCommands.markRuntimeReady();
    const previewStart = { projection: dependencies.projectState.state.projection, viewJson: JSON.stringify(dependencies.projectState.state.view) };
    (0, dependencies.feedback.setActionStatus)(
      hasStoredCountryGeometry || !previewFrameReady ? '저장된 지도 복원 중…' : '미리보기 표시 완료. 편집 데이터 준비 중…',
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
      console.error('[PL-GEOMETRY-LOAD-001]', error);
      handleGeometryError({ detail: '저장된 지도 형상을 불러오지 못했습니다.' });
      return;
    }
    const previewCountries = hasStoredCountryGeometry ? null : dependencies.projectState.state.countriesData;
    dependencies.projectState.state.auditPreviewCountries = previewCountries;
    let context;
    try {
      context = await completeGeometryInitialization(geometry, autosaveRestore, previewStart);
    } catch (error) {
      console.error('[PL-GEOMETRY-APPLY-001]', error);
      dependencies.projectState.state.countriesData = previewCountries
        ? (0, dependencies.geometryMutation.reindexCountries)(previewCountries, true)
        : { type: 'FeatureCollection', features: [] };
      (0, dependencies.readinessUi.applyDataReadinessEvent)(dependencies.applicationConstantsA.READINESS_EVENTS.GEOMETRY_ERROR);
      (0, dependencies.spatialRecords.scheduleMapObjectSpatialIndexRebuild)();
      dependencies.domains.renderingDomain?.invalidateProject?.('progressive-initialization');
      handleGeometryError({ detail: '무손실 편집 지도를 적용하지 못했습니다.' });
      return;
    }
    if (!context.useBuiltInMesh) {
      await completeMeshEnhancement(null, context);
      if (savedProject && !cachedPreview) dependencies.domains.projectDomain.ensurePreview(savedProject);
      return;
    }
    if (window.__PANDOLAB_STARTUP_METRICS__?.meshError) {
      handleMeshError({ detail: window.__PANDOLAB_STARTUP_METRICS__.meshError });
    }
    const mesh = await window.PANDOLAB_CANONICAL_MESH_PROMISE;
    try {
      await completeMeshEnhancement(mesh, context);
      if (savedProject && !cachedPreview) dependencies.domains.projectDomain.ensurePreview(savedProject);
    } catch (error) {
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

    const autosaveRestore = await dependencies.domains.projectDomain.restoreAutosave();
    const restored = autosaveRestore.project;
    if (restored) (0, dependencies.snapshots.applySharedProjectFields)(restored);
    (0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view);
    dependencies.projectState.state.auditPreviewCountries = window.PANDOLAB_COUNTRIES;

    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    dependencies.projectState.state.countriesData = restoredDelta
      ? dependencies.domains.projectDomain.countriesFromAutosaveDelta(restored)
      : restored?.countriesData
        ? (0, dependencies.geometryMutation.reindexCountries)((0, dependencies.platform.deepClone)(restored.countriesData), true)
        : (0, dependencies.builtinCountries.freshPristineCountries)(true);
    dependencies.projectState.state.countryVisualPhase = 'canonical';
    if (!restored) (0, dependencies.builtinCountries.applyFreshBuiltinClassification)();
    (0, dependencies.snapshots.normalizeProjectObjects)();
    (0, dependencies.layerTree.pruneLayerItemVisibility)();
    (0, dependencies.countries.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.projectSnapshots.configureDatasetSession)(restored);
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== dependencies.platformConfigurationA.BASE_DATASET;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = 'Natural Earth 5.1.1 · GPU 렌더러를 준비하는 중입니다.';
    dependencies.projectState.state.boundaryPreparation?.cancel();
    dependencies.projectState.state.boundaryPreparation = null;

    const { gpuReady } = await initializeStartupRuntime({
      afterInitialMapSetup: () => dependencies.spatialQuery.mapEditClient.rebase(dependencies.projectState.state.countriesData?.features || []),
    });
    if (gpuReady) {
      dependencies.projectState.state.countryVisualPhase = 'canonical';
      dependencies.labelCacheCommands.resetCountryDisplayCache();
    }
    if (restored && gpuReady) {
      if (externalGeometry || dependencies.projectState.state.sessionBaseCountriesJson) (0, dependencies.renderQuality.scheduleGpuMeshRebuild)(0);
      else if (dependencies.projectState.state.historyDirtyCountryIds.size) {
        for (const id of dependencies.projectState.state.historyDirtyCountryIds) dependencies.projectState.state.pendingCountryRenderIds.add(String(id));
        dependencies.rendering.gpuMapRenderer.applyCountryPatch(dependencies.projectState.state.historyDirtyCountryIds);
      }
    }

    (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
    if ((0, dependencies.platform.$)('layerSearchInput')) (0, dependencies.platform.$)('layerSearchInput').value = dependencies.projectState.state.layerSearch;
    dependencies.domains.layerTreeController?.render(true);
    (0, dependencies.mapSettingsUi.syncProjectionButtons)();

    (0, dependencies.mapHostViewB.resizeMap)();
    dependencies.lifecycleUi.projectUi.syncHistory();
    dependencies.domains.editingDomain?.setTool('select');
    (0, dependencies.physicalResources.loadPhysicalData)();
    await dependencies.domains.layerTreeController?.completeHydration();

    if (restored) {
      dependencies.projectSession.saveState.markNewProject(`content:${Date.now()}`);
      dependencies.projectSession.saveState.setAutosave(dependencies.applicationConstantsA.AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === dependencies.platformConfigurationA.BASE_DATASET) dependencies.domains.projectDomain.queueAutosave(0);
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
        (0, dependencies.feedback.setActionStatus)(`${restoredLabel} 복원했습니다.`, 'success', 3200);
      } else {
        (0, dependencies.feedback.setActionStatus)('자동저장을 복원했습니다.', 'success', 4200);
      }
    } else {
      dependencies.projectSession.saveState.markNewProject('content:0');
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
