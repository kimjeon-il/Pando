/** GeometryPreview: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGeometryPreview() {
  let dependencies;
  let editPreviewController;
  let editPipelineMetrics;
  let boundarySelectionAnalysisCache;
  let boundarySelectionAnalysisMetrics;
  let activeGeometryPreviewApply;
  let activeGeometryPreviewDiscard;
  function connect(ports) {
    if (dependencies) throw new Error('geometry-preview already connected');
    dependencies = ports;
  }

  function assertCurrentProjectReferences() {
    return (0, dependencies.assertProjectReferenceIntegrity)({
      countries: dependencies.state.countriesData?.features || [],
      countryOverrides: dependencies.state.countryOverrides || {},
      territorialUnits: dependencies.state.territorialUnits || [],
      territorialRelations: dependencies.state.territorialRelations || [],
      distributionLayers: dependencies.state.distributionLayers || [],
      distributionEntries: dependencies.state.distributionEntries || [],
      labels: dependencies.state.labels || [],
      genericFeatures: dependencies.state.genericFeatures || [],
      itemVisibility: dependencies.state.itemVisibility || {},
      labelSettings: dependencies.state.labelSettings || {},
    });
  }

  function transactCountryEdit({ operation, payload, snapshot, applyResult, onSuccess, onError }) {
    return (0, dependencies.runCountryEditTransaction)({
      client: dependencies.mapEditClient,
      operation,
      payload,
      snapshot,
      applyResult,
      validateCanonical: assertCurrentProjectReferences,
      commitHistory: (...args) => dependencies.projectDomain.commitHistorySnapshot(...args),
      restore: (editableSnapshot, { rebaseWorker }) => {
        (0, dependencies.restoreCountryEditSnapshot)(editableSnapshot);
        if (rebaseWorker) dependencies.mapEditClient.rebase(dependencies.state.countriesData?.features || []);
      },
      queueAutosave: (...args) => dependencies.projectDomain.queueAutosave(...args),
      diagnostic: dependencies.reliabilityDiagnostic,
      onSuccess,
      onError,
    });
  }

  function geometryPolygonSets(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function countryRingForVertex(feature, vertex) {
    if (!feature?.geometry || !vertex) return null;
    if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates?.[vertex.ringIndex] || null;
    if (feature.geometry.type === 'MultiPolygon') return feature.geometry.coordinates?.[vertex.polygonIndex]?.[vertex.ringIndex] || null;
    return null;
  }

  function setCountryVertexCoord(feature, vertex, coord) {
    const ring = countryRingForVertex(feature, vertex);
    if (!ring || vertex.index < 0 || vertex.index >= ring.length - 1) return false;
    // 배열 객체를 교체하지 않고 값만 바꿔 토폴로지 세그먼트 참조가 드래그 중에도 유지되게 한다.
    ring[vertex.index][0] = coord[0];
    ring[vertex.index][1] = coord[1];
    if (vertex.index === 0) {
      ring[ring.length - 1][0] = coord[0];
      ring[ring.length - 1][1] = coord[1];
    }
    return true;
  }

  function coordKey(coord, precision = 7) {
    return `${Number(coord?.[0] || 0).toFixed(precision)},${Number(coord?.[1] || 0).toFixed(precision)}`;
  }

  function edgeKey(a, b, precision = 7) {
    const ka = coordKey(a, precision), kb = coordKey(b, precision);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  function coordNear(a, b, tolerance = 0.00008) {
    if (!a || !b) return false;
    let dx = Math.abs(a[0] - b[0]);
    dx = Math.min(dx, Math.abs(dx - 360));
    return dx <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
  }

  function rebuildBoundaryTopology(targetCountryIds = dependencies.state.coastEditCountryId) {
    const edges = new Map();
    const nodes = new Map();
    const targetIds = [...new Set((Array.isArray(targetCountryIds) ? targetCountryIds : [targetCountryIds]).map(String).filter(Boolean))];
    const targets = targetIds.map(dependencies.countryFeatureById).filter(Boolean);
    if (!targets.length) {
      dependencies.state.boundaryTopology = { edges, nodes };
      dependencies.state.sharedBoundaryTopology = { segments: new Map(), nodes: new Map() };
      return;
    }
    const margin = 0.0002;
    const nearby = new Map();
    for (const target of targets) {
      const targetBounds = (0, dependencies.geometryBounds)(target.geometry);
      const queryBounds = [targetBounds[0] - margin, targetBounds[1] - margin, targetBounds[2] + margin, targetBounds[3] + margin];
      for (const feature of (0, dependencies.spatialFeatures)(queryBounds)) nearby.set(String(feature?.id || ''), feature);
    }
    const features = [...nearby.values()];

    for (const feature of features) {
      const countryId = String(feature?.id || '');
      const polygons = geometryPolygonSets(feature.geometry);
      polygons.forEach((polygon, polygonIndex) => {
        polygon.forEach((ring, ringIndex) => {
          const count = Math.max(0, (ring?.length || 0) - 1);
          if (count < 2) return;
          for (let index = 0; index < count; index += 1) {
            const a = ring[index];
            const b = ring[(index + 1) % count];
            const eKey = edgeKey(a, b);
            if (!edges.has(eKey)) edges.set(eKey, { key: eKey, refs: [], countryIds: new Set(), kind: 'coast' });
            const edge = edges.get(eKey);
            edge.refs.push({ countryId, feature, polygonIndex, ringIndex, index, a, b });
            edge.countryIds.add(countryId);

            const nKey = coordKey(a);
            if (!nodes.has(nKey)) nodes.set(nKey, { key: nKey, coord: a, refs: [], countryIds: new Set() });
            const node = nodes.get(nKey);
            node.refs.push({
              countryId, feature,
              vertex: { key: `${polygonIndex}:${ringIndex}:${index}`, polygonIndex, ringIndex, index, coord: a },
              prevEdgeKey: edgeKey(ring[(index - 1 + count) % count], a),
              nextEdgeKey: eKey,
            });
            node.countryIds.add(countryId);
          }
        });
      });
    }

    for (const edge of edges.values()) edge.kind = edge.countryIds.size >= 2 ? 'land' : 'coast';
    for (const node of nodes.values()) {
      for (const ref of node.refs) {
        ref.prevKind = edges.get(ref.prevEdgeKey)?.kind || 'coast';
        ref.nextKind = edges.get(ref.nextEdgeKey)?.kind || 'coast';
      }
    }

    dependencies.state.boundaryTopology = { edges, nodes };
    dependencies.state.sharedBoundaryTopology = (0, dependencies.buildSharedBoundaryTopology)(features);
  }

  function boundaryEditSelectionAnalysis(countryIds = dependencies.state.boundaryEditCountryIds, { rebuild = false } = {}) {
    const ids = [...new Set(countryIds.map(String).filter(id => (0, dependencies.countryFeatureById)(id)))];
    const cacheKey = `${dependencies.countryLandRevision}:${ids.slice().sort().join('|')}`;
    const cached = boundarySelectionAnalysisCache.get(cacheKey);
    if (cached) {
      boundarySelectionAnalysisMetrics.cacheHits += 1;
      return cached;
    }
    if (!rebuild) {
      boundarySelectionAnalysisMetrics.cacheMisses += 1;
      return {
        selectedIds: ids,
        segmentKeys: new Set(),
        isolatedIds: [],
        valid: ids.length >= 2,
        analyzed: false,
        message: ids.length >= 2 ? '국경 조정 시작 시 공유국경을 확인합니다.' : '접경국을 하나 이상 더 선택하세요.',
      };
    }
    boundarySelectionAnalysisMetrics.cacheMisses += 1;
    const startedAt = performance.now();
    rebuildBoundaryTopology(ids);
    const plan = (0, dependencies.planSharedBoundaryEdit)(dependencies.state.sharedBoundaryTopology, ids);
    const names = plan.isolatedIds.map(id => (0, dependencies.countryName)((0, dependencies.countryFeatureById)(id)) || id);
    let message = '';
    if (ids.length < 2) message = '접경국을 하나 이상 더 선택하세요.';
    else if (!plan.segmentKeys.size) message = '선택 국가 사이에 편집할 공유국경이 없습니다.';
    else if (names.length) message = `${names.join(', ')}은(는) 다른 선택 국가와 접하지 않습니다.`;
    const result = { ...plan, message, analyzed: true };
    boundarySelectionAnalysisCache.set(cacheKey, result);
    boundarySelectionAnalysisMetrics.builds += 1;
    boundarySelectionAnalysisMetrics.buildMs += performance.now() - startedAt;
    while (boundarySelectionAnalysisCache.size > 64) boundarySelectionAnalysisCache.delete(boundarySelectionAnalysisCache.keys().next().value);
    return result;
  }

  async function beginWorkerGeometryPreview({
    operation,
    payload,
    snapshot,
    transferredGeometry = null,
    applyResult,
    onSuccess = () => {},
    onError = () => {},
    shouldKeepResult = () => true,
  }) {
    discardActiveGeometryPreview({ announce: false });
    const baseDataRevision = dependencies.state.stateRevision;
    (0, dependencies.setActionStatus)('변경 미리보기 계산 중…', 'working', 0);
    let requestId = 0;
    try {
      const response = await dependencies.mapEditClient.execute(operation, payload);
      requestId = response.requestId;
      if (dependencies.state.stateRevision !== baseDataRevision || !shouldKeepResult()) {
        dependencies.mapEditClient.discard(requestId);
        throw Object.assign(new Error('계산 중 지도 상태가 바뀌어 미리보기를 폐기했습니다.'), { cancelled: true });
      }
      const result = response.result;
      transferredGeometry = result.transferredGeometry || transferredGeometry;
      const affectedIds = new Set((result.affectedIds || []).map(String));
      const removedIds = new Set((result.removedIds || []).map(String));
      const beforeFeatures = [...affectedIds]
        .map(id => (0, dependencies.countryFeatureById)(id))
        .filter(Boolean)
        .map(feature => (0, dependencies.deepClone)(feature));
      const patchById = new Map((result.features || []).map(feature => [String(feature?.id || ''), (0, dependencies.deepClone)(feature)]));
      const afterFeatures = [...affectedIds].filter(id => !removedIds.has(id))
        .map(id => patchById.get(id) || (0, dependencies.countryFeatureById)(id))
        .filter(Boolean).map(feature => (0, dependencies.deepClone)(feature));
      const proposedFeatures = (dependencies.state.countriesData?.features || [])
        .filter(feature => !affectedIds.has(String(feature?.id || '')))
        .map(feature => feature)
        .concat(afterFeatures);
      const baselineIssues = (0, dependencies.validateTerritorialGeometry)(dependencies.state.countriesData?.features || [], {
        clipper: window.polygonClipping,
        affectedIds,
      });
      const baselineIssueKeys = new Set(baselineIssues.map(issue => `${issue.kind}:${[...(issue.entityRefs || [])].sort().join('|')}`));
      const validationIssues = (0, dependencies.validateTerritorialGeometry)(proposedFeatures, {
        clipper: window.polygonClipping,
        affectedIds,
      }).filter(issue => !baselineIssueKeys.has(`${issue.kind}:${[...(issue.entityRefs || [])].sort().join('|')}`));
      const preview = (0, dependencies.buildGeometryPreview)({
        operation,
        beforeFeatures,
        afterFeatures,
        removedIds: [...removedIds],
        clipper: window.polygonClipping,
        transferredGeometry,
      });
      const session = (0, dependencies.beginGeometryPreview)(dependencies.state.geometryPreview, {
        operation,
        baseDataRevision,
        workerRequestId: requestId,
        affectedIds: [...affectedIds],
        beforeFeatures,
        afterFeatures,
        removedIds: [...removedIds],
        ...preview,
        validation: {
          issues: validationIssues,
          blocking: validationIssues.some(issue => issue.severity !== 'warning'),
        },
      });
      activeGeometryPreviewDiscard = () => dependencies.mapEditClient.discard(requestId);
      activeGeometryPreviewApply = async () => {
        if (!shouldKeepResult() || !(0, dependencies.previewIsCurrent)(dependencies.state.geometryPreview, session.sessionId, baseDataRevision) || dependencies.state.stateRevision !== baseDataRevision) {
          dependencies.mapEditClient.discard(requestId);
          (0, dependencies.clearGeometryPreview)(dependencies.state.geometryPreview);
          activeGeometryPreviewApply = null;
          activeGeometryPreviewDiscard = null;
          dependencies.renderingDomain?.invalidateGpuInteraction?.('geometry-preview-cancelled');
          (0, dependencies.updateModeButtons)();
          (0, dependencies.setActionStatus)('지도가 바뀌어 미리보기를 취소했습니다.', 'error', 3800);
          return false;
        }
        if (session.validation?.blocking) {
          (0, dependencies.setActionStatus)('미리보기 형상을 수정하세요.', 'error', 3400);
          return false;
        }
        (0, dependencies.clearGeometryPreview)(dependencies.state.geometryPreview);
        activeGeometryPreviewApply = null;
        activeGeometryPreviewDiscard = null;
        try {
          await applyResult(result);
          assertCurrentProjectReferences();
          dependencies.mapEditClient.commit(requestId);
          dependencies.projectDomain.commitHistorySnapshot(snapshot);
          dependencies.projectDomain.queueAutosave();
          onSuccess(result);
          dependencies.renderingDomain?.invalidateCountryPatch?.('country-geometry-preview-applied');
          (0, dependencies.updateModeButtons)();
          return true;
        } catch (error) {
          dependencies.mapEditClient.discard(requestId);
          (0, dependencies.restoreCountryEditSnapshot)(snapshot);
          onError(error);
          return false;
        }
      };
      dependencies.renderingDomain?.invalidateGpuInteraction?.('geometry-preview-ready');
      (0, dependencies.updateModeButtons)();
      const blockingIssue = validationIssues.find(issue => issue.severity !== 'warning');
      const included = result.autoIncludedSlivers;
      const inclusionNote = included?.count
        ? ` 미세 잔여 영역 ${included.count}개 포함 · ${included.areaM2 < 0.01 ? '0.01m² 미만' : `${included.areaM2.toFixed(2)}m²`}.` : '';
      (0, dependencies.setModeBanner)(blockingIssue?.message || `변경 결과를 확인한 뒤 적용하세요.${inclusionNote}`);
      if (blockingIssue) (0, dependencies.$)('modeTaskInstruction')?.classList.add('cut-invalid');
      (0, dependencies.setActionStatus)(validationIssues.length
        ? `미리보기에서 geometry 문제 ${validationIssues.length}건을 찾았습니다.`
        : '변경 결과 미리보기를 준비했습니다.', validationIssues.length ? 'error' : 'success', 3600);
      return true;
    } catch (error) {
      if (requestId) dependencies.mapEditClient.discard(requestId);
      if (!error?.cancelled) onError(error);
      else (0, dependencies.setActionStatus)('지도 작업을 취소했습니다.', 'success', 2200);
      return false;
    }
  }

  function beginLocalGeometryPreview({
    operation,
    beforeFeatures = [],
    afterFeatures = [],
    removedIds = [],
    transferredGeometry = null,
    snapshot = (0, dependencies.snapshotEditable)(),
    applyResult,
    shouldKeepResult = () => true,
    commitHistorySnapshot = false,
    successMessage = '변경을 적용했습니다.',
    errorMessage = '변경을 적용하지 못했습니다.',
  }) {
    discardActiveGeometryPreview({ announce: false });
    if (!shouldKeepResult()) return false;
    const baseDataRevision = dependencies.state.stateRevision;
    const issues = afterFeatures.flatMap(feature => (0, dependencies.validateStructuredGeometry)(feature));
    const preview = (0, dependencies.buildGeometryPreview)({ operation, beforeFeatures, afterFeatures, removedIds, clipper: window.polygonClipping, transferredGeometry });
    const session = (0, dependencies.beginGeometryPreview)(dependencies.state.geometryPreview, {
      operation,
      baseDataRevision,
      affectedIds: [...new Set([...beforeFeatures, ...afterFeatures].map(feature => String(feature?.id || '')).filter(Boolean))],
      beforeFeatures,
      afterFeatures,
      removedIds,
      ...preview,
      validation: { issues, blocking: issues.some(issue => issue.severity !== 'warning') },
    });
    activeGeometryPreviewDiscard = null;
    activeGeometryPreviewApply = async () => {
      if (!shouldKeepResult() || !(0, dependencies.previewIsCurrent)(dependencies.state.geometryPreview, session.sessionId, baseDataRevision) || dependencies.state.stateRevision !== baseDataRevision) {
        (0, dependencies.clearGeometryPreview)(dependencies.state.geometryPreview);
        activeGeometryPreviewApply = null;
        dependencies.renderingDomain?.invalidateGpuInteraction?.('local-geometry-preview-cancelled');
        (0, dependencies.updateModeButtons)();
        (0, dependencies.setActionStatus)('지도가 바뀌어 미리보기를 취소했습니다.', 'error', 3600);
        return false;
      }
      if (session.validation?.blocking) {
        (0, dependencies.setActionStatus)('미리보기 형상을 수정하세요.', 'error', 3400);
        return false;
      }
      (0, dependencies.clearGeometryPreview)(dependencies.state.geometryPreview);
      activeGeometryPreviewApply = null;
      activeGeometryPreviewDiscard = null;
      try {
        await applyResult();
        assertCurrentProjectReferences();
        if (commitHistorySnapshot) dependencies.projectDomain.commitHistorySnapshot(snapshot);
        dependencies.state.stateRevision += 1;
        dependencies.projectDomain.queueAutosave();
        dependencies.renderingDomain?.invalidateGenericPatch?.('local-geometry-preview-applied');
        (0, dependencies.updateModeButtons)();
        (0, dependencies.setActionStatus)(successMessage, 'success', 3600);
        return true;
      } catch (error) {
        (0, dependencies.restoreCountryEditSnapshot)(snapshot);
        (0, dependencies.reportOperationError)(error, errorMessage, 'PL-PREVIEW-001', 4400);
        return false;
      }
    };
    dependencies.editingDomain?.refreshDraftPresentation?.('draft-preview-ready');
    dependencies.renderingDomain?.invalidateGpuInteraction?.('local-geometry-preview-ready');
    (0, dependencies.updateModeButtons)();
    const blockingIssue = issues.find(issue => issue.severity !== 'warning');
    (0, dependencies.setModeBanner)(blockingIssue?.message || '변경 결과를 확인한 뒤 적용하세요.');
    if (blockingIssue) (0, dependencies.$)('modeTaskInstruction')?.classList.add('cut-invalid');
    return true;
  }

  async function applyActiveGeometryPreview() {
    if (!activeGeometryPreviewApply) return false;
    return activeGeometryPreviewApply();
  }

  function discardActiveGeometryPreview({ announce = true } = {}) {
    if (!dependencies.state.geometryPreview.session) return false;
    activeGeometryPreviewDiscard?.();
    activeGeometryPreviewApply = null;
    activeGeometryPreviewDiscard = null;
    (0, dependencies.clearGeometryPreview)(dependencies.state.geometryPreview);
    dependencies.editingDomain?.refreshDraftPresentation?.('draft-preview-discard');
    dependencies.renderingDomain?.invalidateGpuInteraction?.('geometry-preview-discard');
    (0, dependencies.updateModeButtons)();
    if (announce) (0, dependencies.setActionStatus)('미리보기를 닫았습니다.', 'success', 2600);
    return true;
  }

  function activeCountryBoundaryPlan() {
    if (dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'editing') {
      return { mode: 'border', ...(0, dependencies.planSharedBoundaryEdit)(dependencies.state.sharedBoundaryTopology, dependencies.state.boundaryEditCountryIds) };
    }
    if (dependencies.state.tool === 'country-coast' && dependencies.state.coastEditCountryId) {
      return { mode: 'coast', ...(0, dependencies.planCoastEdit)(dependencies.state.sharedBoundaryTopology, dependencies.state.coastEditCountryId) };
    }
    return null;
  }

  function getCountryBoundaryHandles() {
    const plan = activeCountryBoundaryPlan();
    if (!plan) return [];
    const allowedIds = new Set(plan.mode === 'border' ? dependencies.state.boundaryEditCountryIds.map(String) : [String(dependencies.state.coastEditCountryId)]);
    const scope = dependencies.state.coastEditScopeGenericFeatureId
      ? dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.coastEditScopeGenericFeatureId))
      : null;
    const handles = [];
    const nodeKeys = new Set([...plan.editableNodeKeys, ...plan.fixedNodeKeys]);
    for (const nodeKey of nodeKeys) {
      const node = dependencies.state.sharedBoundaryTopology?.nodes?.get?.(nodeKey);
      if (!node) continue;
      const ref = node.refs.find(item => allowedIds.has(String(item.featureId)))
        || node.virtualRefs?.find(item => allowedIds.has(String(item.featureId)));
      if (!ref) continue;
      if (scope && !(0, dependencies.pointInGenericFeature)(node.coordinate, (0, dependencies.genericFeatureDisplayFeature)(scope))) continue;
      handles.push({
        key: `${ref.polygonIndex}:${ref.ringIndex}:${ref.vertexIndex ?? ref.segmentIndex}`,
        polygonIndex: ref.polygonIndex,
        ringIndex: ref.ringIndex,
        index: ref.vertexIndex ?? ref.segmentIndex,
        nodeKey: node.key,
        coord: node.coordinate,
        boundaryKind: node.kind === 'coast' ? 'coast' : 'shared',
        ownerIds: [...node.ownerIds],
        fixed: plan.fixedNodeKeys.has(node.key),
      });
    }
    return handles;
  }

  function getCountryBoundarySegments() {
    const plan = activeCountryBoundaryPlan();
    if (!plan) return [];
    const result = [];
    for (const segmentKey of plan.segmentKeys) {
      const edge = dependencies.state.sharedBoundaryTopology?.segments?.get?.(segmentKey);
      if (!edge) continue;
      result.push({
        key: edge.key,
        kind: plan.mode === 'border' ? 'shared' : 'coast',
        geometry: { type: 'LineString', coordinates: [edge.a, edge.b] },
      });
    }
    return result;
  }

  function initializeEditPreviewController() {
    (editPreviewController = (0, dependencies.createEditPreviewController)());

    (editPipelineMetrics = {
      commitCount: 0,
      rollbackCount: 0,
      lastCommitMs: 0,
      lastCommitDomain: '',
      commitP95Ms: 0,
      commitP99Ms: 0,
    });
  }

  function initializeBoundarySelectionAnalysisCache() {
    (boundarySelectionAnalysisCache = new Map());

    (boundarySelectionAnalysisMetrics = { builds: 0, cacheHits: 0, cacheMisses: 0, buildMs: 0 });
  }

  function initializeActiveGeometryPreviewApply() {
    (activeGeometryPreviewApply = null);

    (activeGeometryPreviewDiscard = null);
  }

  return Object.freeze({
    connect,
    initializeEditPreviewController,
    initializeBoundarySelectionAnalysisCache,
    initializeActiveGeometryPreviewApply,
    get applyActiveGeometryPreview() { return applyActiveGeometryPreview; },
    get assertCurrentProjectReferences() { return assertCurrentProjectReferences; },
    get beginLocalGeometryPreview() { return beginLocalGeometryPreview; },
    get beginWorkerGeometryPreview() { return beginWorkerGeometryPreview; },
    get boundaryEditSelectionAnalysis() { return boundaryEditSelectionAnalysis; },
    get boundarySelectionAnalysisCache() { return boundarySelectionAnalysisCache; },
    get boundarySelectionAnalysisMetrics() { return boundarySelectionAnalysisMetrics; },
    get coordKey() { return coordKey; },
    get coordNear() { return coordNear; },
    get countryRingForVertex() { return countryRingForVertex; },
    get discardActiveGeometryPreview() { return discardActiveGeometryPreview; },
    get editPipelineMetrics() { return editPipelineMetrics; },
    get editPreviewController() { return editPreviewController; },
    get geometryPolygonSets() { return geometryPolygonSets; },
    get getCountryBoundaryHandles() { return getCountryBoundaryHandles; },
    get getCountryBoundarySegments() { return getCountryBoundarySegments; },
    get rebuildBoundaryTopology() { return rebuildBoundaryTopology; },
    get setCountryVertexCoord() { return setCountryVertexCoord; },
    get transactCountryEdit() { return transactCountryEdit; },
  });
}
