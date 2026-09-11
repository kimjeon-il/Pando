/** DomainAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createDomainAssembly() {
  let dependencies;
  let projectDomain;
  let selectionDomain;
  let renderingDomain;
  let gisDomain;
  let editingDomain;
  let selectionUiController;
  let countryPropertyController;
  let objectPropertyController;
  let layerTreeController;
  function connect(ports) {
    if (dependencies) throw new Error('domain-assembly already connected');
    dependencies = ports;
  }

  function initializeDomainBoundaries() {
    if (projectDomain || selectionDomain || renderingDomain || gisDomain || editingDomain) return;
    const domainListeners = new Map();
    // Rendering domains are created before initSvg() so project/GIS services can
    // be available during bootstrap. Resource references are plain snapshots;
    // the rendering coordinator refreshes them once at the start of a frame.
    const resourceSnapshots = Object.create(null);
    let renderResourceSnapshotFrameId = null;
    const createResourceSnapshot = (name, values, live = {}) => {
      const resource = { ...values };
      const refresh = () => {
        for (const [property, getter] of Object.entries(live)) {
          if (typeof getter === 'function') resource[property] = getter();
        }
        return resource;
      };
      Object.defineProperty(resource, '__refresh', { value: refresh, enumerable: false });
      resourceSnapshots[name] = resource;
      refresh();
      return resource;
    };
    const refreshRenderResources = frameId => {
      if (frameId !== null && frameId !== undefined && frameId === renderResourceSnapshotFrameId) return;
      for (const resource of Object.values(resourceSnapshots)) resource.__refresh?.();
      renderResourceSnapshotFrameId = frameId ?? `direct-${Date.now()}`;
      return renderResourceSnapshotFrameId;
    };
    const domainContext = Object.freeze({
      getProjectSnapshot: () => projectDomain?.snapshot?.() || dependencies.projectSerializer.buildProject(),
      getSessionSnapshot: () => (0, dependencies.deepClone)({ projection: dependencies.state.projection, view: dependencies.state.view, selected: dependencies.state.selected }),
      dispatchProjectCommand: command => projectDomain?.dispatch?.(command),
      requestRender: invalidation => renderingDomain?.requestRender?.(invalidation) || false,
      publish: (name, detail) => {
        for (const listener of domainListeners.get(String(name)) || []) listener(detail);
      },
      subscribe: (name, listener) => {
        const key = String(name);
        const listeners = domainListeners.get(key) || new Set();
        listeners.add(listener);
        domainListeners.set(key, listeners);
        return () => listeners.delete(listener);
      },
      getViewport: () => {
        const layout = (0, dependencies.projectionLayoutMetrics)();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      getFrameContext: () => window.__PANDOLAB_VIEW_STATE__ || null,
      reportDiagnostic: entry => dependencies.reliabilityDiagnostic.push({ category: 'domain', ...entry }),
    });
    projectDomain = (0, dependencies.createProjectDomain)({
      context: domainContext,
      getSnapshot: () => dependencies.projectSerializer.buildProject(),
      replaceSnapshot: (project, options) => {
        const resetOptions = {
          projectGeneration: options?.generation,
          skipRenderReset: options?.skipRenderReset === true,
          prepared: options?.prepared,
        };
        if (project) return (0, dependencies.applyAtlasState)(project, options?.reason === 'load', resetOptions);
        return (0, dependencies.resetProjectInPlace)(resetOptions);
      },
      serializer: dependencies.projectSerializer,
      history: dependencies.historyService,
      persistence: dependencies.persistenceService,
      saveState: dependencies.saveState,
      prepareEmpty: () => (0, dependencies.materializePristineCountries)(),
      createProjectFile: async project => {
        await (0, dependencies.ensureGisIoRuntime)();
        if (!window.PandoLabGIS?.exportGeoPackage) throw new Error('GeoPackage 저장 모듈을 불러오지 못했습니다.');
        return window.PandoLabGIS.exportGeoPackage(project, () => undefined);
      },
      captureReplacement: () => ({
        project: dependencies.projectSerializer.buildProject(),
        history: [...dependencies.state.history], historyMeta: [...dependencies.state.historyMeta],
        future: [...dependencies.state.future], futureMeta: [...dependencies.state.futureMeta],
        save: dependencies.saveState.checkpoint(),
      }),
      restoreReplacement: (checkpoint, generation) => {
        (0, dependencies.applyAtlasState)(checkpoint.project, false, { projectGeneration: generation, skipRenderReset: true });
        Object.assign(dependencies.historyStore, {
          history: checkpoint.history, historyMeta: checkpoint.historyMeta,
          future: checkpoint.future, futureMeta: checkpoint.futureMeta,
        });
        dependencies.saveState.restore(checkpoint.save);
        dependencies.projectUi.syncHistory();
        renderingDomain?.invalidateProject?.('project-rollback');
      },
      invalidateProject: reason => renderingDomain?.invalidateProject?.(reason),
      invalidateHistory: reason => renderingDomain?.invalidateCountryPatch?.(reason),
      reportDiagnostic: entry => dependencies.reliabilityDiagnostic.push({ category: 'project', ...entry }),
      commandPipeline: dependencies.projectCommandPipeline,
      invariants: { assertProjectReferenceIntegrity: dependencies.assertProjectReferenceIntegrity },
      restoreCountriesFromDelta: (project, suppliedBase = null) => (0, dependencies.restoreCountriesFromDelta)(project, {
        base: suppliedBase || (0, dependencies.materializePristineCountriesSync)(),
        clone: dependencies.deepClone,
        reindex: base => (0, dependencies.reindexCountries)(base, true),
        applyPristineLabelAnchors: dependencies.applyPristineLabelAnchors,
      }),
      onProjectChanged: event => {
        window.dispatchEvent(new CustomEvent('pandolab:project-changed', { detail: event }));
      },
      onProjectReset: event => {
        selectionDomain?.resetProject(event.generation);
        editingDomain?.resetProject?.(event.generation);
        renderingDomain?.resetProjectGeneration(event.generation);
      },
    });

    gisDomain = (0, dependencies.createGisDomain)({
      projectDomain,
      importService: () => dependencies.gisWorkflow.ensure(),
      riverPartitionWorkerFactory: () => new Worker((0, dependencies.runtimeAssetUrl)('workers/river-territory-partition-worker.js'), {
        type: 'module', name: 'pandolab-river-territory-partitions',
      }),
      riverPartitionFallback: async payload => {
        await (0, dependencies.ensureGisRuntime)();
        return (0, dependencies.buildRiverTerritoryPartitions)({ ...payload, clipper: window.polygonClipping });
      },
      riverPartitionSource: {
        ensureReady: async () => {
          if (dependencies.state.physicalLoadState.hydro === 'ready') return true;
          const ready = await (0, dependencies.loadHydroData)(dependencies.state.physicalLoadState.hydro === 'error');
          if (!ready) throw new Error('강·호수 데이터가 아직 준비되지 않았습니다.');
          return true;
        },
        queryBounds: dependencies.riverPartitionQueryBounds,
        queryLogicalFeatures: bounds => dependencies.gpuMapRenderer.queryHydroLogicalFeatures(bounds, { category: 'river' }),
        loadLogicalFeature: logicalId => dependencies.gpuMapRenderer.loadHydroLogicalFeature(logicalId),
        getEditRivers: boundsList => dependencies.state.hydroEdits.filter(feature => (
          feature?.properties?.category === 'river'
          && feature.geometry
          && boundsList.some(bounds => (0, dependencies.riverPartitionBoundsOverlap)((0, dependencies.geometryBounds)(feature.geometry), bounds))
        )),
        featureKey: dependencies.riverPartitionFeatureKey,
      },
      reportDiagnostic: entry => dependencies.reliabilityDiagnostic.push({ category: 'gis-domain', ...entry }),
    });

    selectionDomain = (0, dependencies.createSelectionDomain)({
      context: domainContext,
      projectDomain,
      selectionPacketFactory: dependencies.createSelectionPacket,
      normalizeRef: dependencies.normalizeObjectRef,
      refExists: dependencies.objectRefExists,
      onSelectionChanged: snapshot => {
        const selection = snapshot.selection;
        dependencies.state.selected = selection.items.find(item => item.key === selection.primaryKey) || null;
        selectionUiController?.sync?.(snapshot);
      },
      requestRender: reason => renderingDomain?.invalidateSelectionOverlay?.(reason) || false,
    });

    objectPropertyController = (0, dependencies.createObjectPropertyController)({
      document,
      getElement: dependencies.$,
      state: dependencies.state,
      territorialUnitTypes: dependencies.TERRITORIAL_UNIT_TYPES,
      distributionModes: dependencies.DISTRIBUTION_MODES,
      distributionTypeLabels: dependencies.DISTRIBUTION_TYPE_LABELS,
      colorDomains: dependencies.COLOR_DOMAINS,
      defaultGenericFeatureColor: dependencies.DEFAULT_GENERIC_FEATURE_COLOR,
      hydroToolConfig: dependencies.HYDRO_TOOL_CONFIG,
      territorialUnitById: dependencies.territorialUnitById,
      territorialUnitName: dependencies.territorialUnitName,
      territorialUnitCountryName: dependencies.territorialUnitCountryName,
      territorialUnitCountryOptions: dependencies.territorialUnitCountryOptions,
      territorialUnitParentOptions: dependencies.territorialUnitParentOptions,
      territorialParentOptions: dependencies.territorialParentOptions,
      territorialUnitColor: dependencies.territorialUnitColor,
      territorialRepository: dependencies.territorialRepository,
      territorialChildren: dependencies.territorialChildren,
      distributionService: dependencies.distributionService,
      distributionEntriesForLayer: dependencies.distributionEntriesForLayer,
      genericFeatureById: id => dependencies.state.genericFeatures.find(feature => String(feature.id) === String(id)),
      normalizeGenericFeatureSemantics: dependencies.normalizeGenericFeatureSemantics,
      genericFeatureGeometryKind: dependencies.genericFeatureGeometryKind,
      genericFeatureRole: dependencies.genericFeatureRole,
      genericFeatureRoleLabel: dependencies.genericFeatureRoleLabel,
      genericFeatureRoleHelp: dependencies.genericFeatureRoleHelp,
      genericFeatureLandBinding: dependencies.genericFeatureLandBinding,
      genericFeatureName: dependencies.genericFeatureName,
      genericFeatureRoleLabels: dependencies.GENERIC_FEATURE_ROLE_LABELS,
      defaultGenericFeatureColorFor: dependencies.defaultGenericFeatureColor,
      labelKey: dependencies.labelKey,
      automaticLabelSettings: dependencies.automaticLabelSettings,
      hydroFeatureById: dependencies.hydroFeatureById,
      hydroEditById: dependencies.hydroEditById,
      isHydroFeatureVisible: dependencies.isHydroFeatureVisible,
      hydroCategoryKey: dependencies.hydroCategoryKey,
      hydroCategoryLabel: dependencies.hydroCategoryLabel,
      hydroFallbackName: dependencies.hydroFallbackName,
      hydroEditorName: dependencies.hydroEditorName,
      prepareHydroFeature: dependencies.prepareHydroFeature,
      gpuMapRenderer: dependencies.gpuMapRenderer,
      readDomainColor: dependencies.readDomainColor,
      syncColorPicker: dependencies.syncColorPicker,
      replaceSelectOptions: dependencies.replaceSelectOptions,
      formatArea: dependencies.formatArea,
      geometryAreaKm2: dependencies.sphericalGeometryAreaKm2,
      layerNameCompare: (left, right) => dependencies.layerNameCollator.compare(left, right),
      layerTreeController: () => layerTreeController,
      syncObjectActionsMenu: dependencies.syncObjectActionsMenu,
      closeObjectActionsMenu: dependencies.closeObjectActionsMenu,
      setEditorShellView: dependencies.setEditorShellView,
      syncStatusBar: dependencies.syncStatusBar,
      createEmptyState: dependencies.createEmptyState,
      createSemanticIcon: dependencies.createSemanticIcon,
      territorialTypeLabel: dependencies.territorialTypeLabel,
      countryFeatureById: dependencies.countryFeatureById,
      onHydroLoaded: full => {
        const key = String(full.properties?.pandolab_id || full.id);
        dependencies.state.hydroFeatureCache.set(key, full);
        for (const [fid, cached] of dependencies.state.hydroFeatureByFid) {
          if (String(cached?.properties?.pandolab_id || cached?.id) === key) dependencies.state.hydroFeatureByFid.set(fid, full);
        }
        if (dependencies.state.selected?.domain === 'hydro' && dependencies.state.selected.id === key) objectPropertyController.presentHydro(key, true);
      },
    });

    countryPropertyController = (0, dependencies.createCountryPropertyController)({
      window,
      document,
      elements: {
        name: (0, dependencies.$)('countryNameInput'),
        color: (0, dependencies.$)('countryColorInput'),
        notes: (0, dependencies.$)('notesInput'),
        area: (0, dependencies.$)('countryAreaValue'),
        selectionStatus: (0, dependencies.$)('selectionStatus'),
        flagPreview: (0, dependencies.$)('flagPreview'),
        flagTrigger: (0, dependencies.$)('flagMenuBtn'),
        flagMenu: (0, dependencies.$)('flagMenu'),
        flagUpload: (0, dependencies.$)('flagUploadBtn'),
        flagFile: (0, dependencies.$)('flagFileInput'),
        flagRemove: (0, dependencies.$)('flagRemoveBtn'),
      },
      getCountryView: value => {
        const ref = (0, dependencies.normalizeObjectRef)(value);
        const id = String(ref?.id || value?.id || value || '');
        const feature = (0, dependencies.countryFeatureById)(id);
        if (!feature) return null;
        const properties = feature.properties || {};
        const override = dependencies.state.countryOverrides[id] || {};
        return { ref: (0, dependencies.countryObjectRef)(id), id, feature, properties, override, displayName: (0, dependencies.countryName)(feature) };
      },
      getPrimaryRef: () => selectionDomain.primary(),
      showPropertyForm: (...args) => objectPropertyController.show(...args),
      resolveColor: view => (0, dependencies.readDomainColor)(dependencies.COLOR_DOMAINS.COUNTRY, {
        feature: view.feature,
        override: view.override,
      }, { fallback: (0, dependencies.defaultCountryColor)() }),
      defaultColor: dependencies.defaultCountryColor,
      syncColorPicker: dependencies.syncColorPicker,
      resolveFlagUrl: view => (0, dependencies.effectiveCountryFlagUrl)({
        countryId: view.id,
        properties: view.properties,
        override: view.override,
        assetRevision: dependencies.ASSET_REVISION,
      }),
      calculateAreaKm2: dependencies.sphericalGeometryAreaKm2,
      formatArea: dependencies.formatArea,
      syncActions: dependencies.syncCountryActionButtons,
      syncStatus: dependencies.syncStatusBar,
      commitField: dependencies.commitCountryEdit,
      metrics: dependencies.selectionPerformanceMetrics,
    });

    selectionUiController = (0, dependencies.createSelectionUiController)({
      window,
      document,
      selectionDomain,
      elements: {
        selectionStatus: (0, dependencies.$)('selectionStatus'),
      },
      resolveRef: dependencies.normalizeObjectRef,
      refExists: dependencies.objectRefExists,
      displayInfo: dependencies.objectDisplayInfo,
      presenters: {
        resolve: ref => {
          if (ref.domain === 'territorial' && ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
            return (value, options) => countryPropertyController.present(value, options);
          }
          if (ref.domain !== 'territorial' || ref.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) {
            return (value, options) => objectPropertyController.present(value, options);
          }
          return null;
        },
        multiple: (selection, detail) => objectPropertyController.show('multi', '공통 속성', {
          resetScroll: false,
          typeLabel: detail.typeLabel,
        }),
      },
      uiActions: {
        focusObject: dependencies.focusObjectRef,
        openEditor: () => {
          const startedAt = performance.now();
          (0, dependencies.openSelectionEditor)();
          dependencies.selectionPerformanceMetrics.editorOpenMs = performance.now() - startedAt;
        },
        clearPresenter: () => {
          countryPropertyController.clear();
          if ((0, dependencies.$)('selectionStatus')) (0, dependencies.$)('selectionStatus').textContent = '';
          objectPropertyController.show(null);
          (0, dependencies.syncCountryActionButtons)();
          (0, dependencies.syncMobileNavigation)();
          if (dependencies.layoutMode === 'wide') {
            dependencies.surfaceState.editorManuallyCollapsed = false;
            if (dependencies.surfaceState.editorOpen) (0, dependencies.closeSurface)('editor');
          }
        },
        syncBatchActions: dependencies.syncBatchActionAvailability,
        syncMapSurfaces: dependencies.syncMapContextSurfaces,
        syncLayerRows: selection => layerTreeController?.syncSelection(selection, { reveal: true }),
        closeChooser: dependencies.closeObjectChooser,
      },
      metrics: dependencies.selectionPerformanceMetrics,
    });
    countryPropertyController.bind();
    selectionUiController.bind();

    editingDomain = (0, dependencies.createEditingDomain)({
      context: domainContext,
      projectDomain,
      gisDomain,
      selectionDomain,
      toolController: {
        requireCanonicalData: dependencies.requireCanonicalData,
        getGeometryPreviewSession: () => dependencies.state.geometryPreview.session,
        getCurrentTool: () => dependencies.state.tool,
        discardGeometryPreview: dependencies.discardActiveGeometryPreview,
        clearHover: () => { dependencies.lastHoverHit = null; selectionDomain.setHover(null); },
        resetForTool: tool => {
          dependencies.state.labelPlacementMode = false;
          if (tool !== 'country-coast') {
            dependencies.state.coastEditCountryId = null;
            dependencies.state.coastEditScopeGenericFeatureId = null;
            dependencies.state.coastEditReturnSelection = null;
          }
          if (tool !== 'country-border') (0, dependencies.resetBoundaryEditState)();
          if (tool !== 'merge-country') (0, dependencies.resetMergeState)();
          if (tool !== 'merge-generic-feature') (0, dependencies.resetGenericFeatureMergeState)();
          if (tool !== 'split-generic-feature') dependencies.state.genericFeatureSplitSourceId = null;
          if (tool !== 'merge-territorial-unit') {
            dependencies.state.territorialUnitMergeSourceId = null;
            dependencies.state.territorialUnitMergeTargetIds = [];
          }
          if (tool !== 'split-territorial-unit') {
            dependencies.state.territorialUnitSplitSourceId = null;
            dependencies.state.territorialUnitSplitVirtualSource = null;
          }
          if (tool !== 'redraw-territorial-unit') dependencies.state.territorialUnitRedrawSourceId = null;
          if (tool !== 'draw-territorial-unit') dependencies.state.territorialCreateContext = null;
          if (tool !== 'annex-territory') (0, dependencies.resetAnnexState)();
          if (tool !== 'new-country') (0, dependencies.resetNewCountryState)();
        },
        applyToolPresentation: (tool, options = {}) => {
          dependencies.state.tool = tool;
          (0, dependencies.setCurrentTool)((0, dependencies.toolLabel)(tool));
          (0, dependencies.setModeBanner)();
          (0, dependencies.syncMobileNavigation)();
          (0, dependencies.updateModeButtons)();
          return options;
        },
      },
      previewController: dependencies.editPreviewController,
      draftServices: {
        getToolConfig: tool => {
          const config = (0, dependencies.draftToolConfig)(tool);
          return config ? { ...config, minimumPoints: config.shape === 'polygon' ? 3 : 2 } : null;
        },
        isSpacePanActive: () => dependencies.state.spacePanActive,
        screenSample: screenPoint => {
          const coordinate = (0, dependencies.screenToGeo)(screenPoint);
          return coordinate ? { screen: screenPoint.slice(), coordinate } : null;
        },
        projectCoordinate: coordinate => (0, dependencies.activeProjection)()(coordinate),
        screenToCoordinate: point => (0, dependencies.screenToGeo)(point),
        snapCandidates: ({ coordinate, excludeNodeKey }) => (0, dependencies.localSnapCandidates)(coordinate)
          .filter(candidate => !excludeNodeKey || candidate.nodeKey !== excludeNodeKey),
        assessDraft: ({ tool, coords, buildPreview }) => {
          const sourceGeometry = (0, dependencies.activeCutDraftSourceGeometry)();
          if (sourceGeometry) {
            const assessment = (0, dependencies.assessCutDraft)(coords, sourceGeometry);
            if (assessment.valid && buildPreview) {
              try {
                const split = (0, dependencies.buildCutSplitCandidates)(sourceGeometry, coords);
                assessment.splitPreview = {
                  revision: Number(editingDomain?.snapshot?.().revision || 0),
                  candidates: split.candidates.map(candidate => ({ geometry: (0, dependencies.deepClone)(candidate.geometry), area: candidate.area })),
                };
              } catch (_) { assessment.splitPreview = null; }
            }
            return assessment;
          }
          return null;
        },
        requestFrame: callback => requestAnimationFrame(callback),
        cancelFrame: handle => cancelAnimationFrame(handle),
        onTooShort: config => (0, dependencies.setActionStatus)(`형상이 너무 짧습니다. ${config?.shape === 'polygon' ? '영역의 경계를 더 크게' : '선을 더 길게'} 그려주세요.`, 'error', 3200),
        onFinished: () => {
          if (!(0, dependencies.activeCutDraftSourceGeometry)()) (0, dependencies.setModeBanner)('꼭짓점을 드래그해 미세조정하세요.');
        },
      },
      geometryEditing: {
        resolveObjectFeature: targetRef => {
          if (targetRef?.domain === 'hydro') return dependencies.state.hydroEdits.find(item => String(item.id) === String(targetRef.id)) || null;
          if (targetRef?.domain === 'generic') return dependencies.state.genericFeatures.find(item => String(item.id) === String(targetRef.id)) || null;
          return null;
        },
        canEditObject: feature => {
          if (feature?.properties?.locked === true) {
            (0, dependencies.setActionStatus)('잠금을 해제한 뒤 꼭짓점을 이동하세요.', 'error', 3200);
            return false;
          }
          const hydroEdit = (0, dependencies.isHydroEditFeature)(feature);
          const owner = hydroEdit ? null : (0, dependencies.countryFeatureById)(feature.properties?.ownerId);
          if (!hydroEdit && (0, dependencies.genericFeatureLandBinding)(feature) === 'hard' && owner) {
            (0, dependencies.setActionStatus)('국가 해안선과 연결된 점입니다. 편집창의 해안 구간 수정을 사용하세요.', 'error', 3800);
            return false;
          }
          projectDomain.recordHistory();
          return true;
        },
        getObjectVertexTarget: () => {
          if (dependencies.state.tool !== 'select') return null;
          const selected = dependencies.state.selected;
          if (selected?.domain === 'hydro') {
            const feature = dependencies.state.hydroEdits.find(item => String(item.id) === String(selected.id));
            return feature ? { targetRef: { domain: 'hydro', type: 'hydro', id: String(feature.id) }, mode: 'hydro', feature } : null;
          }
          if (selected?.domain === 'generic') {
            const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(selected.id));
            return feature ? { targetRef: { domain: 'generic', type: 'generic', id: String(feature.id) }, mode: 'generic', feature } : null;
          }
          return null;
        },
        previewObjectGesture: ({ source, feature, segments }) => {
          (0, dependencies.beginActiveEditPreview)({
            key: `${(0, dependencies.isHydroEditFeature)(source) ? 'hydro' : 'generic'}:${source.id}`,
            segments,
            style: {
              color: (0, dependencies.isHydroEditFeature)(source) ? '#72c9ef' : dependencies.resolvedInteractionStyle.selection.color,
              alpha: 1,
              width: 3.2,
              casing: { color: '#101820', alpha: 0.55, width: 4.8 },
              cap: 'round', join: 'round',
            },
          });
          return feature;
        },
        commitObjectGesture: ({ source, feature, beforeGeometry, changed }) => {
          const hydroEdit = (0, dependencies.isHydroEditFeature)(source);
          (0, dependencies.clearActiveEditPreview)('vertex-edit-preview-end');
          if (!changed) {
            projectDomain.discardHistory();
            renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-preview-no-change');
            return false;
          }
          const issues = ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ? (0, dependencies.validateStructuredGeometry)(feature) : [];
          if (issues.length) {
            projectDomain.discardHistory();
            (0, dependencies.setActionStatus)(issues[0].message || '유효하지 않은 geometry라 꼭짓점 이동을 되돌렸습니다.', 'error', 3800);
            return false;
          }
          source.geometry = (0, dependencies.deepClone)(feature.geometry);
          dependencies.genericFeatureLandClipCache.delete(source);
          if (hydroEdit) dependencies.mapObjectGeometryRevisions.hydro += 1;
          else dependencies.mapObjectGeometryRevisions.generic += 1;
          renderingDomain?.invalidateEditedGeometryPatch?.(hydroEdit ? 'hydro' : 'generic', 'vertex-edit-commit');
          projectDomain.queueAutosave();
          (0, dependencies.setActionStatus)('꼭짓점을 이동했습니다.', 'success');
          void beforeGeometry;
          return true;
        },
        beginBoundaryGesture: event => {
          if (!['country-border', 'country-coast'].includes(dependencies.state.tool)) return false;
          const node = dependencies.state.sharedBoundaryTopology?.nodes?.get?.(String(event.vertexKey || ''));
          if (!node) return false;
          const borderMode = dependencies.state.tool === 'country-border';
          const selectedIds = new Set(dependencies.state.boundaryEditCountryIds.map(String));
          const coastId = String(dependencies.state.coastEditCountryId || event.targetRef?.id || '');
          const allowed = borderMode
            ? node.ownerIds.size >= 2 && [...node.ownerIds].every(id => selectedIds.has(String(id)))
            : node.kind === 'coast' && node.ownerIds.size === 1 && node.ownerIds.has(coastId);
          if (!allowed) return false;
          const affectedIds = borderMode ? new Set([...node.ownerIds].map(String)) : new Set([coastId]);
          if (!(0, dependencies.requireCountriesUnlocked)([...affectedIds], borderMode ? '국경을 조정' : '해안선을 조정')) return false;
          const features = new Map([...affectedIds]
            .map(id => [id, (0, dependencies.countryFeatureById)(id)])
            .filter(([, feature]) => feature)
            .map(([id, feature]) => [id, (0, dependencies.deepClone)(feature)]));
          const refs = [...(node.refs || []), ...(node.virtualRefs || [])]
            .filter(ref => affectedIds.has(String(ref.featureId)))
            .map(ref => ({
              countryId: String(ref.featureId),
              vertex: { polygonIndex: ref.polygonIndex, ringIndex: ref.ringIndex, index: ref.vertexIndex ?? ref.segmentIndex },
            }));
          (0, dependencies.beginActiveEditPreview)({
            key: `${borderMode ? 'border' : 'coast'}:${[...affectedIds].sort().join('|')}:${node.key}`,
            segments: (0, dependencies.getCountryBoundarySegments)().map(item => ({
              start: item.geometry.coordinates[0], end: item.geometry.coordinates[1],
            })),
            style: {
              color: borderMode ? dependencies.resolvedInteractionStyle.selection.color : '#72c9ef',
              alpha: 1,
              width: 3.8,
              casing: { color: '#101820', alpha: 0.65, width: 5.4 },
              cap: 'round', join: 'round',
            },
          });
          return {
            borderMode,
            affectedIds,
            features,
            refs,
            startCoordinate: node.coordinate.slice(),
            changed: false,
            snapshot: (0, dependencies.snapshotEditable)(),
            validationBaseline: affectedIds.size > 1 ? (0, dependencies.captureCountryGeometryValidationBaseline)(affectedIds) : null,
            structuredBaseline: new Set([...affectedIds]
              .flatMap(id => (0, dependencies.validateStructuredGeometry)((0, dependencies.countryFeatureById)(id)).filter(Boolean))
              .map(dependencies.structuredGeometryIssueKey)),
            beforeGeometries: new Map([...affectedIds].map(id => [id, (0, dependencies.deepClone)((0, dependencies.countryFeatureById)(id)?.geometry)])),
          };
        },
        moveBoundaryGesture: (session, coordinate) => {
          session.changed = session.changed || !(0, dependencies.coordNear)(session.startCoordinate, coordinate, 1e-9);
          for (const ref of session.refs) {
            const feature = session.features.get(ref.countryId);
            if (feature) (0, dependencies.setCountryVertexCoord)(feature, ref.vertex, coordinate);
          }
          const segments = session.refs.flatMap(ref => {
            const feature = session.features.get(ref.countryId);
            const ring = feature ? (0, dependencies.countryRingForVertex)(feature, ref.vertex) : null;
            const count = Math.max(0, (ring?.length || 0) - 1);
            if (!ring || !count) return [];
            return [
              { start: ring[(ref.vertex.index - 1 + count) % count], end: ring[ref.vertex.index] },
              { start: ring[ref.vertex.index], end: ring[(ref.vertex.index + 1) % count] },
            ];
          });
          (0, dependencies.updateActiveEditPreview)(segments);
        },
        commitBoundaryGesture: session => {
          (0, dependencies.clearActiveEditPreview)('country-boundary-preview-end');
          if (!session.changed) return false;
          try {
            const structuredIssues = [...session.affectedIds]
              .flatMap(id => (0, dependencies.validateStructuredGeometry)(session.features.get(id)).filter(Boolean))
              .filter(issue => !session.structuredBaseline.has((0, dependencies.structuredGeometryIssueKey)(issue)));
            if (structuredIssues.length) throw new Error(structuredIssues[0].message);
            const validation = (0, dependencies.validateCountryGeometryEdit)(session.affectedIds, session.validationBaseline, { featureOverrides: session.features });
            if (!validation.ok) throw new Error(validation.message);
            for (const id of session.affectedIds) {
              const current = (0, dependencies.countryFeatureById)(id);
              const preview = session.features.get(id);
              if (current && preview?.geometry) current.geometry = (0, dependencies.deepClone)(preview.geometry);
            }
            for (const id of session.affectedIds) {
              const current = (0, dependencies.countryFeatureById)(id);
              const before = session.beforeGeometries.get(id);
              if (current && before) (0, dependencies.syncHardLandDependents)(id, before, current.geometry, session.startCoordinate);
            }
            (0, dependencies.markCountryGeometriesChanged)(session.affectedIds);
            (0, dependencies.refreshCountryCentroids)(session.affectedIds);
            (0, dependencies.rebuildBoundaryTopology)(session.borderMode ? dependencies.state.boundaryEditCountryIds : dependencies.state.coastEditCountryId);
            projectDomain.commitHistorySnapshot(session.snapshot);
            renderingDomain?.invalidateEditedGeometryPatch?.('country', 'boundary-edit-commit');
            projectDomain.queueAutosave();
            (0, dependencies.setActionStatus)(session.borderMode
              ? `${session.affectedIds.size}개 국가의 공유국경을 함께 수정했습니다.`
              : '해안선을 수정했습니다.', 'success');
            return true;
          } catch (error) {
            (0, dependencies.rebuildBoundaryTopology)(session.borderMode ? dependencies.state.boundaryEditCountryIds : dependencies.state.coastEditCountryId);
            (0, dependencies.reportOperationError)(error, session.borderMode
              ? '공유국경을 이동하지 못해 변경을 되돌렸습니다.'
              : '해안선을 이동하지 못해 변경을 되돌렸습니다.', session.borderMode ? 'PL-BORDER-001' : 'PL-COAST-001', 4300);
            return false;
          }
        },
        renderPacket: () => {
          const boundarySegments = (0, dependencies.getCountryBoundarySegments)().flatMap(item => {
            const coordinates = item.geometry?.coordinates || [];
            return coordinates.length >= 2 ? [{ key: item.key, kind: item.kind, start: coordinates[0], end: coordinates[1] }] : [];
          });
          const boundaryHandles = (0, dependencies.getCountryBoundaryHandles)();
          const territoryItems = (0, dependencies.territoryComponentItems)();
          const candidates = dependencies.state.tool === 'annex-territory'
            ? dependencies.state.annexCandidates
            : dependencies.state.tool === 'new-country' ? dependencies.state.newCountryCandidates : [];
          return {
            boundaryEdit: boundarySegments.length || boundaryHandles.length ? { segments: boundarySegments, handles: boundaryHandles } : null,
            territoryOperation: territoryItems.length || candidates.length ? {
              kind: dependencies.state.tool,
              phase: dependencies.state.tool === 'annex-territory' ? dependencies.state.annexPhase : dependencies.state.newCountryPhase,
              components: territoryItems.map(item => ({ ...item, hovered: item.key === dependencies.state.annexHoveredComponentKey })),
              candidates: candidates.map((item, index) => ({
                index,
                geometry: item.geometry,
                selected: index === (dependencies.state.tool === 'annex-territory' ? dependencies.state.annexSelectedCandidateIndex : dependencies.state.newCountrySelectedCandidateIndex),
              })),
            } : null,
          };
        },
        handleTerritoryInteraction: event => {
          if (event.type === 'territory-component-hover') dependencies.state.annexHoveredComponentKey = event.componentKey;
          else if (event.type === 'territory-component-leave' && dependencies.state.annexHoveredComponentKey === event.componentKey) dependencies.state.annexHoveredComponentKey = null;
          else if (event.type === 'territory-component-toggle') (0, dependencies.toggleTerritoryComponentSelection)(event.componentKey);
          else if (event.type === 'territory-candidate-select') (0, dependencies.selectTerritoryCandidate)(event.candidateIndex);
          else return false;
          return true;
        },
      },
      getImportCommitter: dependencies.getGisImportCommitter,
      onEditingStateChanged: snapshot => {
        dependencies.state.tool = snapshot.activeTool;
        (0, dependencies.$)('map')?.classList.toggle('draft-stroke-active', snapshot.draft.strokeActive);
        (0, dependencies.syncCutDraftFeedback)(snapshot.draft.cutAssessment, !!snapshot.draft.hover);
        if (!snapshot.draft.cutAssessment && !snapshot.draft.hover) (0, dependencies.syncGenericDraftFeedback)(snapshot.draft);
        (0, dependencies.updateModeButtons)();
        dependencies.projectUi.syncHistory();
      },
      transactionRunner: ({ domain, patch: geometryPatch }) => {
        if (geometryPatch?.commit && typeof geometryPatch.commit === 'function') return geometryPatch.commit();
        const error = new TypeError(`${domain} geometry patch requires an explicit transaction commit().`);
        error.code = 'PL-EDIT-TRANSACTION-001';
        throw error;
      },
    });

    renderingDomain = (0, dependencies.createRenderingDomain)({
      context: domainContext,
      gpuMapRenderer: dependencies.gpuMapRenderer,
      sceneBuilder: dependencies.renderSceneBuilder,
      mapHost: () => dependencies.mapHost,
      selectionDomain,
      projectDomain,
      getEditingRenderPacket: () => editingDomain?.createRenderPacket?.(),
      emitEditingInteraction: event => editingDomain?.handleInteraction?.(event),
      domLayers: () => ({
        baseSvg: dependencies.baseSvg,
        svg: dependencies.svg,
        interactionSvg: dependencies.interactionSvg,
        gpuCanvas: (0, dependencies.$)('map')?.querySelector('.gpu-map-canvas') || null,
      }),
      labelResources: createResourceSnapshot('labels', {
        d3: dependencies.d3,
        countryLabelLayer: dependencies.countryLabelLayer,
        labelLayer: dependencies.labelLayer,
        svg: dependencies.svg,
        getState: () => dependencies.state,
        visibleLabelLayout: dependencies.visibleLabelLayout,
        mapClickBlocked: dependencies.mapClickBlocked,
        handleObjectSelectionAt: dependencies.handleObjectSelectionAt,
        handleMapClick: dependencies.handleMapClick,
        countryName: dependencies.countryName,
        layerStyle: dependencies.layerStyle,
        isMobile: dependencies.isMobile,
        automaticLabelSettings: dependencies.automaticLabelSettings,
        labelSettings: (currentState, domain, id) => currentState.labelSettings?.[(0, dependencies.labelKey)(domain, id)] || {},
        labelKey: dependencies.labelKey,
        countryLabelAnchors: () => dependencies.countryLabelAnchors,
        activeProjection: dependencies.activeProjection,
        projectVisibleCoordinate: dependencies.projectVisibleCoordinate,
        isCoordVisible: dependencies.isCoordVisible,
        labelDragBehavior: dependencies.labelDragBehavior,
        normalizeObjectRef: dependencies.normalizeObjectRef,
        selectionSnapshot: () => selectionDomain.snapshot().selection,
        selectionHas: ref => selectionDomain.has(ref),
      }, {
        countryLabelLayer: () => dependencies.countryLabelLayer,
        labelLayer: () => dependencies.labelLayer,
        svg: () => dependencies.svg,
      }),
      countryResources: createResourceSnapshot('countries', {
        getState: () => dependencies.state,
        getViewRevision: () => dependencies.viewRevision,
        countryLayer: dependencies.countryLayer,
        path: dependencies.path,
        countryOutlineFeature: dependencies.countryOutlineFeature,
        countryFeatureById: dependencies.countryFeatureById,
        isLayerItemVisible: dependencies.isLayerItemVisible,
        renderPendingCountryOverlays: dependencies.renderPendingCountryOverlays,
        selectionGeometryRevision: dependencies.selectionGeometryRevision,
        countryColor: dependencies.countryColor,
        mapTheme: dependencies.mapTheme,
        resolvedInteractionStyle: () => dependencies.resolvedInteractionStyle,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        syncGpuRenderScene: dependencies.syncGpuRenderScene,
        gpuMapRenderer: dependencies.gpuMapRenderer,
        applyGpuSceneCoverage: dependencies.applyGpuSceneCoverage,
        applyGpuInteractionCoverage: dependencies.applyGpuInteractionCoverage,
      }, {
        countryLayer: () => dependencies.countryLayer,
      }),
      hydroResources: createResourceSnapshot('hydro', {
        getState: () => dependencies.state,
        getStateRevision: () => dependencies.state.stateRevision,
        hydroLakeLayer: dependencies.hydroLakeLayer,
        hydroRiverLayer: dependencies.hydroRiverLayer,
        hydroEditLayer: dependencies.hydroEditLayer,
        gpuMapRenderer: dependencies.gpuMapRenderer,
        layerStyle: dependencies.layerStyle,
        hydroRenderGroups: dependencies.hydroRenderGroups,
        hydroDisplayColor: dependencies.hydroDisplayColor,
        hydroEditColor: dependencies.hydroEditColor,
        path: dependencies.path,
        visibleMapObjectCandidates: dependencies.visibleMapObjectCandidates,
        geometryMayIntersectViewport: dependencies.geometryMayIntersectViewport,
        isHydroFeatureVisible: dependencies.isHydroFeatureVisible,
        normalizeObjectRef: dependencies.normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        viewportCullingMetrics: dependencies.viewportCullingMetrics,
        setMapHover: dependencies.setMapHover,
        mapClickBlocked: dependencies.mapClickBlocked,
        d3: dependencies.d3,
        svg: dependencies.svg?.node?.() || dependencies.svg,
        handleObjectSelectionAt: dependencies.handleObjectSelectionAt,
        buildRenderableStrokeFeature: dependencies.buildRenderableStrokeFeature,
      }, {
        hydroLakeLayer: () => dependencies.hydroLakeLayer,
        hydroRiverLayer: () => dependencies.hydroRiverLayer,
        hydroEditLayer: () => dependencies.hydroEditLayer,
        svg: () => dependencies.svg?.node?.() || dependencies.svg,
      }),
      territorialResources: createResourceSnapshot('territorial', {
        isNativeBuiltinSubunit: dependencies.isNativeBuiltinSubunit,
        syncBuiltinPalette: dependencies.syncBuiltinPalette,
        getState: () => dependencies.state,
        territorialUnitLayer: dependencies.territorialUnitLayer,
        territorialOperationLayer: dependencies.territorialOperationLayer,
        TERRITORIAL_UNIT_TYPES: dependencies.TERRITORIAL_UNIT_TYPES,
        visibleMapObjectCandidates: dependencies.visibleMapObjectCandidates,
        geometryMayIntersectViewport: dependencies.geometryMayIntersectViewport,
        isLayerItemVisible: dependencies.isLayerItemVisible,
        selectionHas: ref => selectionDomain.has(ref),
        normalizeObjectRef: dependencies.normalizeObjectRef,
        viewportCullingMetrics: dependencies.viewportCullingMetrics,
        setMapHover: dependencies.setMapHover,
        mapClickBlocked: dependencies.mapClickBlocked,
        toggleTerritorialUnitMergeTarget: dependencies.toggleTerritorialUnitMergeTarget,
        d3: dependencies.d3,
        svg: dependencies.svg?.node?.() || dependencies.svg,
        handleObjectSelectionAt: dependencies.handleObjectSelectionAt,
        path: dependencies.path,
        territorialStyleColor: dependencies.territorialStyleColor,
        territorialUnitColor: dependencies.territorialUnitColor,
        presentationGroupForTerritorialFeature: dependencies.presentationGroupForTerritorialFeature,
        layerStyle: dependencies.layerStyle,
        selectionGeometryRevision: dependencies.selectionGeometryRevision,
        gpuSceneOrder: dependencies.gpuSceneOrder,
        resolvedInteractionStyle: () => dependencies.resolvedInteractionStyle,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        buildRenderableStrokeFeature: dependencies.buildRenderableStrokeFeature,
      }, {
        territorialUnitLayer: () => dependencies.territorialUnitLayer,
        territorialOperationLayer: () => dependencies.territorialOperationLayer,
        svg: () => dependencies.svg?.node?.() || dependencies.svg,
      }),
      genericResources: createResourceSnapshot('generic', {
        getState: () => dependencies.state,
        genericFeatureLayer: dependencies.genericFeatureLayer,
        path: dependencies.path,
        genericFeatureDisplayFeature: dependencies.genericFeatureDisplayFeature,
        genericFeatureColor: dependencies.genericFeatureColor,
        visibleMapObjectCandidates: dependencies.visibleMapObjectCandidates,
        isLayerItemVisible: dependencies.isLayerItemVisible,
        geometryMayIntersectViewport: dependencies.geometryMayIntersectViewport,
        normalizeObjectRef: dependencies.normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        selectionSnapshot: () => selectionDomain.snapshot().selection,
        viewportCullingMetrics: dependencies.viewportCullingMetrics,
        mapClickBlocked: dependencies.mapClickBlocked,
        d3: dependencies.d3,
        svg: dependencies.svg?.node?.() || dependencies.svg,
        handleObjectSelectionAt: dependencies.handleObjectSelectionAt,
        setMapHover: dependencies.setMapHover,
        toggleGenericFeatureMergeTarget: dependencies.toggleGenericFeatureMergeTarget,
        layerStyle: dependencies.layerStyle,
        selectionGeometryRevision: dependencies.selectionGeometryRevision,
        gpuSceneOrder: dependencies.gpuSceneOrder,
        resolvedInteractionStyle: () => dependencies.resolvedInteractionStyle,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        buildRenderableStrokeFeature: dependencies.buildRenderableStrokeFeature,
      }, {
        genericFeatureLayer: () => dependencies.genericFeatureLayer,
        svg: () => dependencies.svg?.node?.() || dependencies.svg,
      }),
      distributionResources: createResourceSnapshot('distribution', {
        getState: () => dependencies.state,
        distributionLayer: dependencies.distributionLayer,
        distributionEntriesForLayer: dependencies.distributionEntriesForLayer,
        dominantDistributionEntries: dependencies.dominantDistributionEntries,
        territorialRepository: dependencies.territorialRepository,
        featureFromGeometry: dependencies.featureFromGeometry,
        geometryBounds: dependencies.geometryBounds,
        distributionColor: dependencies.distributionColor,
        DISTRIBUTION_TYPES: dependencies.DISTRIBUTION_TYPES,
        DISTRIBUTION_MODES: dependencies.DISTRIBUTION_MODES,
        DISTRIBUTION_RENDER_MODES: dependencies.DISTRIBUTION_RENDER_MODES,
        DISTRIBUTION_TYPE_GROUPS: dependencies.DISTRIBUTION_TYPE_GROUPS,
        visibleMapObjectCandidates: dependencies.visibleMapObjectCandidates,
        geometryMayIntersectViewport: dependencies.geometryMayIntersectViewport,
        isLayerItemVisible: dependencies.isLayerItemVisible,
        normalizeObjectRef: dependencies.normalizeObjectRef,
        selectionHas: ref => selectionDomain.has(ref),
        viewportCullingMetrics: dependencies.viewportCullingMetrics,
        mapClickBlocked: dependencies.mapClickBlocked,
        d3: dependencies.d3,
        svg: dependencies.svg?.node?.() || dependencies.svg,
        handleObjectSelectionAt: dependencies.handleObjectSelectionAt,
        setMapHover: dependencies.setMapHover,
        layerStyle: dependencies.layerStyle,
        selectionGeometryRevision: dependencies.selectionGeometryRevision,
        gpuSceneOrder: dependencies.gpuSceneOrder,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        buildRenderableStrokeFeature: dependencies.buildRenderableStrokeFeature,
        getCountryGeometryRevision: () => dependencies.countryLandRevision,
        getDistributionVisibilityRevision: () => dependencies.distributionVisibilityRevision,
      }, {
        distributionLayer: () => dependencies.distributionLayer,
        svg: () => dependencies.svg?.node?.() || dependencies.svg,
      }),
      territorialBoundaryResources: createResourceSnapshot('territorialBoundary', {
        getState: () => dependencies.state,
        getCountryLandRevision: () => dependencies.countryLandRevision,
        getTerritorialGeometryRevision: () => dependencies.mapObjectGeometryRevisions.territorial,
        geometryToken: geometry => (0, dependencies.territorialBoundaryGeometryToken)(geometry),
        buildTerritorialInternalBoundarySegments: dependencies.buildTerritorialInternalBoundarySegments,
        territorialUnitColor: dependencies.territorialUnitColor,
        layerStyle: dependencies.layerStyle,
        presentationGroupForTerritorialFeature: dependencies.presentationGroupForTerritorialFeature,
        mapTheme: dependencies.mapTheme,
        territorialBoundaryLayer: dependencies.territorialBoundaryLayer,
        path: dependencies.path,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        gpuSceneOrder: dependencies.gpuSceneOrder,
      }, {
        territorialBoundaryLayer: () => dependencies.territorialBoundaryLayer,
      }),
      baseResources: createResourceSnapshot('base', {
        getState: () => dependencies.state,
        updatePandoGlobeShell: dependencies.updatePandoGlobeShell,
        graticule: dependencies.graticule,
        graticuleLayer: dependencies.graticuleLayer,
        path: dependencies.path,
        gpuMapRenderer: dependencies.gpuMapRenderer,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        buildGraticuleStrokeGeometryPacket: dependencies.buildGraticuleStrokeGeometryPacket,
        getProjection: () => dependencies.state.projection,
        isLightTheme: () => (document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || dependencies.systemTheme) === 'light',
      }, {
        graticuleLayer: () => dependencies.graticuleLayer,
      }),
      projectedOverlayResources: createResourceSnapshot('projectedOverlays', {
        layers: null,
        path: dependencies.path,
      }, {
        layers: () => [dependencies.territorialBoundaryLayer, dependencies.overlayStackLayer, dependencies.hydroEditLayer, dependencies.territorialOperationLayer],
      }),
      selectionResources: createResourceSnapshot('selection', {
        getState: () => dependencies.state,
        countryType: dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY,
        selectionLayer: dependencies.selectionLayer,
        hoverLayer: dependencies.hoverLayer,
        d3: dependencies.d3,
        path: dependencies.path,
        document,
        selectionPass: dependencies.selectionPass,
        resolvedInteractionStyle: () => dependencies.resolvedInteractionStyle,
        countryDisplayFeature: dependencies.countryDisplayFeature,
        countryOutlineFeature: dependencies.countryOutlineFeature,
        countrySubunitExtent: id => dependencies.territorialScope.scope(id).extra,
        mapFeatureForObjectRef: dependencies.mapFeatureForObjectRef,
        selectionGeometryRevision: dependencies.selectionGeometryRevision,
        buildRenderableStrokeFeature: dependencies.buildRenderableStrokeFeature,
        buildSelectionBoundarySegments: dependencies.buildSelectionBoundarySegments,
        getCountryLandRevision: () => dependencies.countryLandRevision,
        getStateRevision: () => dependencies.state.stateRevision,
        getTerritorialBoundaryRevision: () => renderingDomain?.getTerritorialBoundaryStats?.().revision || '',
        getViewRevision: () => dependencies.viewRevision,
        getProjection: () => dependencies.state.projection,
        isMobile: dependencies.isMobile,
        gpuMapRenderer: dependencies.gpuMapRenderer,
        buildGpuInteractionFillItems: dependencies.buildGpuInteractionFillItems,
        syncGpuInteractionState: dependencies.syncGpuInteractionState,
        setCurrentSelectionPacket: packet => { dependencies.currentSelectionPacket = packet || null; },
        updatePerformanceMetrics: partial => Object.assign(dependencies.selectionPerformanceMetrics, partial || {}),
        publishMetrics: metrics => {
          window.__PANDOLAB_SELECTION_RENDER_METRICS__ = {
            ...(window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {}),
            ...metrics,
          };
        },
        reportError: ({ stage = 'selection-overlay-render', error } = {}) => {
          dependencies.reliabilityDiagnostic.push({
            category: 'render',
            operation: 'selection-overlay-render',
            result: 'recovered',
            errorCode: '',
            technicalMessage: String(error?.message || error || stage),
            stack: error?.stack || '',
          });
          console.warn(`[${stage}] 직전 정상 선택 프레임을 유지합니다.`, error);
        },
      }, {
        selectionLayer: () => dependencies.selectionLayer,
        hoverLayer: () => dependencies.hoverLayer,
        selectionPass: () => dependencies.selectionPass,
      }),
      interactionResources: createResourceSnapshot('interaction', {
        draftLayer: dependencies.draftLayer,
        d3: dependencies.d3,
        svg: dependencies.svg,
        isMobile: dependencies.isMobile,
        selectionStyle: dependencies.SELECTION_STYLE,
        projectedLineDistance: dependencies.projectedLineDistance,
        formatTerritoryArea: dependencies.formatTerritoryArea,
        setModeBanner: dependencies.setModeBanner,
        previewLayer: dependencies.previewLayer,
        validationLayer: dependencies.validationLayer,
        snapLayer: dependencies.snapLayer,
        path: dependencies.path,
        featureFromGeometry: dependencies.featureFromGeometry,
        hasAreaGeometry: dependencies.hasAreaGeometry,
        buildRenderableStrokeFeature: dependencies.buildRenderableStrokeFeature,
        issueCoordinate: dependencies.issueCoordinate,
        getValidationPacket: () => ({
          issues: dependencies.state.audit?.report?.issues || dependencies.state.geometryPreview?.session?.validation?.issues || [],
          selectedIssueId: dependencies.state.audit?.selectedIssueId || null,
        }),
        geometryMayIntersectViewport: dependencies.geometryMayIntersectViewport,
        isCoordVisible: dependencies.isCoordVisible,
        activeProjection: dependencies.activeProjection,
        syncGpuInteractionLayer: dependencies.syncGpuInteractionLayer,
        applyGpuInteractionCoverage: dependencies.applyGpuInteractionCoverage,
        scheduleSpatialIndexRebuild: () => dependencies.mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => (0, dependencies.rebuildMapObjectSpatialIndex)(), 40),
        getViewRevision: () => dependencies.viewRevision,
        getViewState: () => window.__PANDOLAB_VIEW_STATE__ || null,
      }, {
        draftLayer: () => dependencies.draftLayer,
        previewLayer: () => dependencies.previewLayer,
        validationLayer: () => dependencies.validationLayer,
        snapLayer: () => dependencies.snapLayer,
        svg: () => dependencies.svg,
      }),
      editingRenderResources: createResourceSnapshot('editing', {
        isCoordVisible: dependencies.isCoordVisible,
        activeProjection: dependencies.activeProjection,
        currentMapZoom: dependencies.currentMapZoom,
        isMobile: dependencies.isMobile,
        path: dependencies.path,
        d3: dependencies.d3,
        vertexLayer: dependencies.vertexLayer,
        boundaryEditLayer: dependencies.boundaryEditLayer,
        replaceGpuSceneDomain: dependencies.replaceGpuSceneDomain,
        getEditInteractionRevision: () => dependencies.editInteractionRevision,
        getInteractionStyle: () => dependencies.resolvedInteractionStyle,
      }, {
        vertexLayer: () => dependencies.vertexLayer,
        boundaryEditLayer: () => dependencies.boundaryEditLayer,
      }),
      refreshRenderResources,
      requestFrame: callback => requestAnimationFrame(callback),
      prepareView: ({ frameId } = {}) => {
        (0, dependencies.updateProjection)();
        const viewState = (0, dependencies.syncViewRevision)();
        if (dependencies.lastVisualProjectionKind !== viewState.projection) {
          dependencies.lastVisualProjectionKind = viewState.projection;
          dependencies.visualProjectionRevision += 1;
        }
        const visualProjection = (0, dependencies.visualProjectionForSnapshot)(viewState);
        const visualPath = dependencies.d3.geo.path().projection(visualProjection);
        return (0, dependencies.createMapVisualFrame)({
          frameId,
          viewRevision: viewState.revision,
          projectGeneration: projectDomain?.getGeneration?.() || 0,
          projectionRevision: dependencies.visualProjectionRevision,
          viewState,
          layoutSnapshot: dependencies.mapLayoutMetricsSnapshot,
          projectCoordinate: coordinate => visualProjection(coordinate),
          projectPath: geometry => visualPath(geometry),
        });
      },
      onFrameComplete: dependencies.handleRenderFrameComplete,
      invalidMaskMode: ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
        || new URLSearchParams(location.search).has('debug')
        || new URLSearchParams(location.search).has('perf')
        ? 'throw'
        : 'report',
      renderers: {
        view: visualFrame => dependencies.gpuMapRenderer.renderFrame(visualFrame),
        stackOverlays: dependencies.applyOverlayStackOrder,
        labelLayout: dependencies.visibleLabelLayout,
        debug: (...args) => dependencies.mapDebug.renderPanel(...args),
        layerTree: (...args) => layerTreeController?.render?.(...args),
      },
      reportDiagnostic: entry => dependencies.reliabilityDiagnostic.push({ category: 'rendering-domain', ...entry }),
    });

  }

  function initializeProjectDomain() {
    (projectDomain = null);

    (selectionDomain = null);

    (renderingDomain = null);

    (gisDomain = null);

    (editingDomain = null);

    (selectionUiController = null);

    (countryPropertyController = null);

    (objectPropertyController = null);

    (layerTreeController = null);
  }

  return Object.freeze({
    connect,
    initializeProjectDomain,
    get countryPropertyController() { return countryPropertyController; },
    get editingDomain() { return editingDomain; },
    get gisDomain() { return gisDomain; },
    get initializeDomainBoundaries() { return initializeDomainBoundaries; },
    get layerTreeController() { return layerTreeController; },
    set layerTreeController(value) { layerTreeController = value; },
    get objectPropertyController() { return objectPropertyController; },
    get projectDomain() { return projectDomain; },
    get renderingDomain() { return renderingDomain; },
    get selectionDomain() { return selectionDomain; },
    get selectionUiController() { return selectionUiController; },
  });
}
