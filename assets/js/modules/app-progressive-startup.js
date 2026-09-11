/** ProgressiveStartup: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createProgressiveStartup() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('progressive-startup already connected');
    dependencies = ports;
  }

  function handleGeometryProgress(event) {
    const detail = event.detail || {};
    dependencies.state.geometryProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.geometryProgress = { stage: detail.stage || '', percent: dependencies.state.geometryProgress };
    if ((0, dependencies.canMutateProject)(dependencies.state.dataReadiness)) return;
    if (dependencies.state.dataReadiness === dependencies.DATA_READINESS.ERROR) (0, dependencies.applyDataReadinessEvent)(dependencies.READINESS_EVENTS.RETRY_GEOMETRY);
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `빠른 미리보기 · 편집 데이터 ${Math.round(dependencies.state.geometryProgress)}%`;
  }

  function handleMeshProgress(event) {
    const detail = event.detail || {};
    dependencies.state.meshProgress = Number(detail.percent || 0);
    const metrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (metrics) metrics.meshProgress = { stage: detail.stage || '', percent: dependencies.state.meshProgress };
    if (!(0, dependencies.canMutateProject)(dependencies.state.dataReadiness) || dependencies.state.dataReadiness === dependencies.DATA_READINESS.ENHANCED) return;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `빠른 미리보기 · 고화질 지도 ${Math.round(dependencies.state.meshProgress)}%`;
  }

  function handleGeometryError(event) {
    (0, dependencies.applyDataReadinessEvent)(dependencies.READINESS_EVENTS.GEOMETRY_ERROR);
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '편집 데이터 오류 · 자동 재시도 중';
  }

  function handleMeshError(event) {
    if (!(0, dependencies.canMutateProject)(dependencies.state.dataReadiness)) return;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '고화질 지도 오류 · 자동 재시도 중';
  }

  async function completeGeometryInitialization(geometry, autosaveRestore, previewStart) {
    const applyStartedAt = performance.now();
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'start';
    const navigationView = (0, dependencies.deepClone)(dependencies.state.view);
    const navigationProjection = dependencies.state.projection;
    const navigationChanged = navigationProjection !== previewStart.projection
      || JSON.stringify(navigationView) !== previewStart.viewJson;
    const previewSearch = dependencies.state.layerSearch;
    const previewSelection = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? String(dependencies.state.selected.id || '') : '';
    (0, dependencies.installCanonicalCountryStore)(geometry.canonicalCountryStore);
    // Preview-to-canonical promotion stays inside the same project generation.
    // A project hard reset here discarded the painted preview scene and forced
    // the renderer down the expensive canonical fallback path before the
    // Worker mesh was ready.
    const projectGeneration = dependencies.gpuMapRenderer.getProjectGeneration?.();
    dependencies.boundarySelectionAnalysisCache.clear();
    // The low-resolution country source is a one-way startup aid.  After the
    // first canonical promotion a project reset starts from canonical data or
    // a neutral loading state and must not briefly re-expose preview geometry.
    const previewAllowed = dependencies.gpuMapRenderer.getRuntimeState?.().previewAllowed !== false;
    dependencies.state.countryVisualPhase = previewAllowed ? 'preview' : 'canonical';
    dependencies.countryDisplaySource = null;
    dependencies.countryDisplayIndex = new Map();

    const restored = autosaveRestore.project;
    if (restored) (0, dependencies.applySharedProjectFields)(restored);
    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    dependencies.state.countriesData = restoredDelta
      ? dependencies.projectDomain.countriesFromAutosaveDelta(restored, geometry.countries)
      : restored?.countriesData
        ? (0, dependencies.reindexCountries)(restored.countriesData, true)
        : (0, dependencies.reindexCountries)(geometry.countries, true, { assumeCanonical: true });
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'countries-indexed';
    if (!restored) (0, dependencies.applyFreshBuiltinClassification)();
    if (!restored) (0, dependencies.applyPristineLabelAnchors)(dependencies.state.countriesData);
    if (navigationChanged) {
      dependencies.state.view = navigationView;
      dependencies.state.projection = navigationProjection;
    } else {
      (0, dependencies.applyAutosavedView)(autosaveRestore.view);
    }
    (0, dependencies.syncMapHostFromState)();
    dependencies.state.layerSearch = previewSearch;
    (0, dependencies.normalizeProjectObjects)();
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.configureDatasetSession)(restored);
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'project-normalized';
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== dependencies.BASE_DATASET;
    const useBuiltInMesh = !externalGeometry && !dependencies.state.sessionBaseCountriesJson;
    window.PANDOLAB_COUNTRIES = null;
    (0, dependencies.applyDataReadinessEvent)(dependencies.READINESS_EVENTS.GEOMETRY_READY);
    dependencies.state.geometryProgress = 100;
    (0, dependencies.syncProjectControls)();
    dependencies.projectUi.syncHistory();
    // Keep the already-painted preview scene stable until the canonical mesh is
    // ready. A full project invalidation here made the renderer traverse the
    // 10m geometry on the main thread before the Worker-produced mesh could be
    // applied, defeating the interaction-first startup contract.
    // The canonical state becomes editable here, but the painted preview and
    // its interaction packet remain active until the canonical mesh commits.
    // The mesh commit performs the first full canonical render atomically.
    dependencies.renderingDomain?.invalidateView?.('canonical-geometry-applied');
    if (previewSelection && (0, dependencies.countryFeatureById)(previewSelection)) (0, dependencies.applyCountrySelectionIntent)(previewSelection, true);
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'layer-hydration';
    await dependencies.layerTreeController?.completeHydration();
    if (startupMetrics) startupMetrics.canonicalStateApplyStage = 'complete';
    // Do not structured-clone the full canonical country collection into the
    // edit Worker during startup. The client rebases lazily on the first edit
    // operation, so the initial canonical promotion stays isolated from
    // non-essential editing preparation.

    if (startupMetrics) {
      startupMetrics.geometryApplyMs = performance.now() - applyStartedAt;
      const renderer = dependencies.gpuMapRenderer.getRuntimeState();
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    if (restored) {
      dependencies.saveState.markNewProject(`content:${Date.now()}`);
      dependencies.saveState.setAutosave(dependencies.AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === dependencies.BASE_DATASET) dependencies.projectDomain.queueAutosave(0);
      const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
      (0, dependencies.setActionStatus)(`${restoredLabel} 복원 완료. 고화질 지도 준비 중…`, 'success', 3600);
    } else {
      dependencies.saveState.markNewProject('content:0');
      const restoreMessage = autosaveRestore.error
        ? (0, dependencies.compactNotificationMessage)(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 })
        : '편집 준비 완료. 고화질 지도 준비 중…';
      (0, dependencies.setActionStatus)(restoreMessage, autosaveRestore.error ? 'error' : 'success', autosaveRestore.error ? 0 : 3200);
    }
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = useBuiltInMesh ? '빠른 미리보기 · 고화질 지도 준비 중' : '프로젝트 지도를 다시 구성하는 중입니다.';
    window.dispatchEvent(new CustomEvent('pandolab:editable', { detail: { useBuiltInMesh } }));
    return { useBuiltInMesh, restored, projectGeneration };
  }

  async function completeMeshEnhancement(mesh, context) {
    const meshReplaceStartedAt = performance.now();
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    let meshApplied;
    const projectGeneration = context?.projectGeneration ?? dependencies.gpuMapRenderer.getProjectGeneration?.();
    if (!context.useBuiltInMesh || dependencies.state.sessionBaseCountriesJson) {
      meshApplied = (await dependencies.gpuMapRenderer.rebuildFromCountries((0, dependencies.builtinRenderCountries)().collection.features, { projectGeneration })) !== false;
    } else {
      meshApplied = (await dependencies.gpuMapRenderer.replaceBuiltInMesh({
        meshBuffer: mesh.meshBuffer,
        preparedStroke: mesh.preparedStroke,
        spatialBlocks: mesh.spatialBlocks,
        onStaged: () => {
          dependencies.state.countryVisualPhase = 'canonical';
          dependencies.countryDisplaySource = null;
          dependencies.countryDisplayIndex = new Map();
          dependencies.renderingDomain?.invalidateProject?.('canonical-staging-ready');
        },
        // Binary country slots retain canonical source order, even when a
        // source now lives in Subunits, is hidden, edited or deleted.
        features: dependencies.canonicalCountryStore.ids().map(id => ({ id })),
        quality: 'canonical',
        projectGeneration,
      })) !== false;
      const dirtyIds = new Set([...dependencies.state.historyDirtyCountryIds, ...dependencies.state.pendingCountryRenderIds]);
      if (dirtyIds.size) {
        for (const id of dirtyIds) dependencies.state.pendingCountryRenderIds.add(String(id));
        await dependencies.gpuMapRenderer.applyCountryPatch(dirtyIds);
      }
    }
    // Once the canonical mesh is successfully displayed, every country SVG
    // path must use the same source. This prevents edit/selection state from
    // mixing preview and canonical geometries on a single frame.
    if (meshApplied) {
      dependencies.state.countryVisualPhase = 'canonical';
      dependencies.countryDisplaySource = null;
      dependencies.countryDisplayIndex = new Map();
      dependencies.state.auditPreviewCountries = null;
      window.PANDOLAB_COUNTRIES = null;
      if (startupMetrics) startupMetrics.canonicalPreviewReleasedBytes = Number(
        startupMetrics.preview?.assets?.countries?.decodedBytes || 0,
      );
      void window.PANDOLAB_SAMPLE_STARTUP_MEMORY?.('preview-released');
      (0, dependencies.applyAdaptiveRenderQuality)({ refreshScene: false, reason: 'canonical-ready' });
    }
    (0, dependencies.loadTerrainManifest)();
    (0, dependencies.loadHydroData)();
    (0, dependencies.applyDataReadinessEvent)(dependencies.READINESS_EVENTS.MESH_READY);
    dependencies.state.meshProgress = 100;
    if (!context.useBuiltInMesh || dependencies.state.sessionBaseCountriesJson) {
      dependencies.renderingDomain?.invalidateProject?.('canonical-mesh-ready');
    }
    const renderer = dependencies.gpuMapRenderer.getRuntimeState();
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = `Natural Earth 5.1.1 · ${renderer.renderer === 'webgl2' ? 'WebGL2' : renderer.renderer === 'webgl1' ? 'WebGL1' : 'Canvas'} 고화질`;
    if (startupMetrics) {
      startupMetrics.meshApplyMs = performance.now() - meshReplaceStartedAt;
      startupMetrics.renderer = renderer.renderer;
      startupMetrics.fallbackReason = renderer.fallbackReason;
      startupMetrics.devicePixelRatio = renderer.devicePixelRatio;
      startupMetrics.effectivePixelRatio = renderer.effectivePixelRatio;
    }
    (0, dependencies.setActionStatus)('고화질 지도를 준비했습니다.', 'success', 2400);
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

  async function initProgressive() {
    (0, dependencies.assertRuntimeCompatibility)();
    if (!window.d3) throw new Error('내장 지도 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.');
    if (!window.PANDOLAB_COUNTRIES?.features?.length) throw new Error('미리보기 국가 데이터를 불러올 수 없습니다. 페이지를 새로고침하세요.');

    const autosavePromise = dependencies.projectDomain.restoreAutosave();
    dependencies.state.countriesData = (0, dependencies.reindexCountries)(window.PANDOLAB_COUNTRIES, true);
    (0, dependencies.applyFreshBuiltinClassification)();
    (0, dependencies.normalizeProjectObjects)();
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.configureDatasetSession)(null);
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '빠른 미리보기 GPU 지도를 준비하는 중입니다.';

    (0, dependencies.applyLayoutMode)({ initial: true });
    (0, dependencies.bindUI)();
    dependencies.layerTreeController.beginHydration();
    window.addEventListener('pandolab:geometry-progress', handleGeometryProgress);
    window.addEventListener('pandolab:mesh-progress', handleMeshProgress);
    window.addEventListener('pandolab:geometry-error', handleGeometryError);
    window.addEventListener('pandolab:mesh-error', handleMeshError);
    (0, dependencies.initSvg)();
    (0, dependencies.resizeMap)();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'frame-pending';
    await awaitVisualFrame();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'host-initialize';
    dependencies.mapHostReadyPromise = (0, dependencies.initializeMapHost)();
    await dependencies.mapHostReadyPromise;
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'gpu-initialize';
    const previewMeshStartedAt = performance.now();
    await dependencies.gpuMapRenderer.initialize();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'ready';
    if (window.__PANDOLAB_STARTUP_METRICS__) {
      const previewRenderer = dependencies.gpuMapRenderer.getRuntimeState();
      window.__PANDOLAB_STARTUP_METRICS__.previewMeshUploadMs = performance.now() - previewMeshStartedAt;
      window.__PANDOLAB_STARTUP_METRICS__.renderer = previewRenderer.renderer;
      window.__PANDOLAB_STARTUP_METRICS__.fallbackReason = previewRenderer.fallbackReason;
      window.__PANDOLAB_STARTUP_METRICS__.devicePixelRatio = previewRenderer.devicePixelRatio;
      window.__PANDOLAB_STARTUP_METRICS__.effectivePixelRatio = previewRenderer.effectivePixelRatio;
    }
    (0, dependencies.startMapResizeObserver)();

    (0, dependencies.syncProjectControls)();
    (0, dependencies.resizeMap)();
    dependencies.projectUi.syncHistory();
    dependencies.editingDomain?.setTool('select', { announce: false });
    (0, dependencies.applyDataReadinessEvent)(dependencies.READINESS_EVENTS.PREVIEW_READY);
    dependencies.runtimeReady = true;
    const previewStart = { projection: dependencies.state.projection, viewJson: JSON.stringify(dependencies.state.view) };
    (0, dependencies.setActionStatus)('미리보기 표시 완료. 편집 데이터 준비 중…', 'working', 0);
    window.dispatchEvent(new CustomEvent('pandolab:interactive'));
    if (window.__PANDOLAB_STARTUP_METRICS__?.geometryError) {
      handleGeometryError({ detail: window.__PANDOLAB_STARTUP_METRICS__.geometryError });
    }

    const [geometry, autosaveRestore] = await Promise.all([
      window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE,
      autosavePromise,
    ]);
    const previewCountries = dependencies.state.countriesData;
    dependencies.state.auditPreviewCountries = previewCountries;
    let context;
    try {
      context = await completeGeometryInitialization(geometry, autosaveRestore, previewStart);
    } catch (error) {
      console.error('[PL-GEOMETRY-APPLY-001]', error);
      dependencies.state.countriesData = (0, dependencies.reindexCountries)(previewCountries, true);
      (0, dependencies.applyDataReadinessEvent)(dependencies.READINESS_EVENTS.GEOMETRY_ERROR);
      (0, dependencies.scheduleMapObjectSpatialIndexRebuild)();
      dependencies.renderingDomain?.invalidateProject?.('progressive-initialization');
      handleGeometryError({ detail: '무손실 편집 지도를 적용하지 못했습니다.' });
      return;
    }
    if (!context.useBuiltInMesh) {
      await completeMeshEnhancement(null, context);
      return;
    }
    if (window.__PANDOLAB_STARTUP_METRICS__?.meshError) {
      handleMeshError({ detail: window.__PANDOLAB_STARTUP_METRICS__.meshError });
    }
    const mesh = await window.PANDOLAB_CANONICAL_MESH_PROMISE;
    try {
      await completeMeshEnhancement(mesh, context);
    } catch (error) {
      console.error('[PL-MESH-APPLY-001]', error);
      handleMeshError({ detail: '고화질 지도를 적용하지 못했습니다.' });
      return;
    }
  }

  async function init() {
    if (window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE instanceof Promise) return initProgressive();
    (0, dependencies.assertRuntimeCompatibility)();
    if (!window.d3) {
      (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '엔진 오류';
      (0, dependencies.setActionStatus)('지도 엔진 로드 실패. 새로고침하세요', 'error', 0);
      return;
    }
    if (!window.PANDOLAB_COUNTRIES?.features?.length) {
      (0, dependencies.setActionStatus)('국가 자료 로드 실패. 새로고침하세요', 'error', 0);
      return;
    }

    const autosaveRestore = await dependencies.projectDomain.restoreAutosave();
    const restored = autosaveRestore.project;
    if (restored) (0, dependencies.applySharedProjectFields)(restored);
    (0, dependencies.applyAutosavedView)(autosaveRestore.view);
    dependencies.state.auditPreviewCountries = window.PANDOLAB_COUNTRIES;

    const restoredDelta = restored?.format === 'pandolab-autosave-delta';
    dependencies.state.countriesData = restoredDelta
      ? dependencies.projectDomain.countriesFromAutosaveDelta(restored)
      : restored?.countriesData
        ? (0, dependencies.reindexCountries)((0, dependencies.deepClone)(restored.countriesData), true)
        : (0, dependencies.freshPristineCountries)(true);
    dependencies.state.countryVisualPhase = 'canonical';
    if (!restored) (0, dependencies.applyFreshBuiltinClassification)();
    (0, dependencies.normalizeProjectObjects)();
    (0, dependencies.pruneLayerItemVisibility)();
    (0, dependencies.scheduleCountryLabelAnchors)(null, 10);
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.configureDatasetSession)(restored);
    const externalGeometry = !!restored?.countriesData && restored.baseDataset !== dependencies.BASE_DATASET;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = 'Natural Earth 5.1.1 · GPU 렌더러를 준비하는 중입니다.';
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };

    (0, dependencies.applyLayoutMode)({ initial: true });
    (0, dependencies.bindUI)();
    dependencies.layerTreeController.beginHydration();
    (0, dependencies.initSvg)();
    (0, dependencies.resizeMap)();
    dependencies.mapEditClient.rebase(dependencies.state.countriesData?.features || []);
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'frame-pending';
    await awaitVisualFrame();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'host-initialize';
    dependencies.mapHostReadyPromise = (0, dependencies.initializeMapHost)();
    await dependencies.mapHostReadyPromise;
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'gpu-initialize';
    const gpuReady = await dependencies.gpuMapRenderer.initialize();
    if (window.__PANDOLAB_STARTUP_METRICS__) window.__PANDOLAB_STARTUP_METRICS__.mapHostStage = 'ready';
    if (gpuReady) {
      dependencies.state.countryVisualPhase = 'canonical';
      dependencies.countryDisplaySource = null;
      dependencies.countryDisplayIndex = new Map();
    }
    (0, dependencies.startMapResizeObserver)();
    if (restored && gpuReady) {
      if (externalGeometry || dependencies.state.sessionBaseCountriesJson) (0, dependencies.scheduleGpuMeshRebuild)(0);
      else if (dependencies.state.historyDirtyCountryIds.size) {
        for (const id of dependencies.state.historyDirtyCountryIds) dependencies.state.pendingCountryRenderIds.add(String(id));
        dependencies.gpuMapRenderer.applyCountryPatch(dependencies.state.historyDirtyCountryIds);
      }
    }

    (0, dependencies.$)('countriesVisible').checked = dependencies.state.layerVisibility.countries;
    (0, dependencies.$)('subunitsVisible').checked = dependencies.state.layerVisibility.subunits !== false;
    (0, dependencies.$)('regionsVisible').checked = dependencies.state.layerVisibility.regions !== false;
    (0, dependencies.$)('languagesVisible').checked = dependencies.state.layerVisibility.languages !== false;
    (0, dependencies.$)('ethnicitiesVisible').checked = dependencies.state.layerVisibility.ethnicities !== false;
    (0, dependencies.$)('religionsVisible').checked = dependencies.state.layerVisibility.religions !== false;
    (0, dependencies.$)('riversVisible').checked = dependencies.state.layerVisibility.rivers !== false;
    (0, dependencies.$)('lakesVisible').checked = dependencies.state.layerVisibility.lakes !== false;
    (0, dependencies.$)('genericFeaturesVisible').checked = dependencies.state.layerVisibility.genericFeatures;
    (0, dependencies.$)('labelsVisible').checked = dependencies.state.layerVisibility.labels;
    (0, dependencies.$)('basemapLabelsVisible').checked = dependencies.state.layerVisibility.basemapLabels;
    (0, dependencies.$)('countryFlagsVisible').checked = dependencies.state.layerVisibility.countryFlags !== false;
    (0, dependencies.syncPhysicalControls)();
    if ((0, dependencies.$)('layerSearchInput')) (0, dependencies.$)('layerSearchInput').value = dependencies.state.layerSearch;
    dependencies.layerTreeController?.render(true);
    (0, dependencies.syncProjectionButtons)();

    (0, dependencies.resizeMap)();
    dependencies.projectUi.syncHistory();
    dependencies.editingDomain?.setTool('select');
    (0, dependencies.loadPhysicalData)();
    await dependencies.layerTreeController?.completeHydration();

    if (restored) {
      dependencies.saveState.markNewProject(`content:${Date.now()}`);
      dependencies.saveState.setAutosave(dependencies.AUTOSAVE_STATES.SAVED, { fallback: autosaveRestore.source === 'localstorage' ? '브라우저 로컬 저장소' : '' });
      if (restored.countriesData && restored.baseDataset === dependencies.BASE_DATASET) dependencies.projectDomain.queueAutosave(0);
      if (gpuReady) {
        const restoredLabel = externalGeometry ? '외부 GIS 자동저장 데이터를' : '자동저장 프로젝트를';
        (0, dependencies.setActionStatus)(`${restoredLabel} 복원했습니다.`, 'success', 3200);
      } else {
        (0, dependencies.setActionStatus)('자동저장을 복원했습니다.', 'success', 4200);
      }
    } else {
      dependencies.saveState.markNewProject('content:0');
      if (autosaveRestore.error) {
        const restoreMessage = (0, dependencies.compactNotificationMessage)(autosaveRestore.error?.message || '현재 스키마와 다른 자동저장입니다.', { tone: 'error', maxLength: 52 });
        (0, dependencies.setActionStatus)(restoreMessage, 'error', 0);
      } else if (gpuReady) {
        (0, dependencies.setActionStatus)('고해상도 지도를 준비했습니다.', 'success');
      } else {
        (0, dependencies.setActionStatus)('무손실 렌더러 준비 완료.', 'success', 4200);
      }
    }
  }



  return Object.freeze({
    connect,

    get init() { return init; },
  });
}
