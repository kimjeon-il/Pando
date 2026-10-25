export function createMapDebugController({
  getElement: $,
  window,
  document,
  location,
  localStorage,
  readDiagnostics,
  getFeatureBounds,
  gpuMapRenderer,
  mapEditClient,
  editPreviewController,
  editPipelineMetrics,
  MAP_HOST_KINDS,
  mapInteractionGate,
  selectionPerformanceMetrics,
  boundarySelectionAnalysisMetrics,
  selectionPerformanceBaseline,
  mapObjectSpatialIndex,
  viewportCullingMetrics,
  distributionRenderRowCache,
  renderQualityController,
  renderSceneBuilder,
  deepClone,
  updateProjection,
  projectionViewSnapshot,
  screenToGeo,
  activeProjection,
  validLabelAnchor,
  countryLabelAnchors,
  runFullMapAudit,
  clearMapAudit,
  focusAuditIssue,
} = {}) {

  function renderDebugMapPanel() {
    const panel = $('debugMapPanel');
    if (!panel) return;
    const params = new URLSearchParams(location.search);
    const enabled = params.has('debug') || localStorage.getItem('atlaswright.debug-map') === 'true';
    const perfOnly = params.has('perf');
    panel.classList.toggle('hidden', !enabled);
    if (!enabled && !perfOnly) return;
    const { state, viewRevision, mapHost, renderingDomain } = readDiagnostics();
    const metrics = gpuMapRenderer.getStats?.() || {};
    const mapEditMetrics = mapEditClient.stats?.() || {};
    const editPreviewMetrics = editPreviewController.stats?.() || {};
    const mapHostMetrics = mapHost?.getDebugState?.() || {};
    const renderMetrics = renderingDomain?.getStats?.() || {};
    const selectionMetrics = window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {};
    if (!enabled) return;
    const lines = [
      `renderer: ${metrics.renderer || 'unknown'}`,
      `map host: ${mapHostMetrics.kind || 'legacy'} / ${mapHostMetrics.projection || state.projection}`,
      `WebGL contexts: ${Number(metrics.activeWebGlContextCount || 0)}`,
      `mesh quality: ${metrics.activeMeshQuality || metrics.meshQuality || 'unknown'}`,
      `render revision: ${renderMetrics.renderRevision || 0}`,
      `view revision: ${viewRevision}`,
      `full / view renders: ${renderMetrics.fullRenderCount || 0} / ${renderMetrics.viewRenderCount || 0}`,
      `last render: ${Number(renderMetrics.lastRenderMs || 0).toFixed(1)} ms`,
      `label layouts: ${renderMetrics.labelLayoutCount || 0}`,
      `selection paths / chars: ${selectionMetrics.pathCount || 0} / ${selectionMetrics.pathCharacterCount || 0}`,
      `GPU picks: ${metrics.pickCount || 0} / ${Number(metrics.pickReadPixelsMs || 0).toFixed(1)} ms`,
      `state revision: ${state.stateRevision}`,
      `pending country patches: ${state.pendingCountryRenderIds.size}`,
      `affected country ids: ${[...state.pendingCountryRenderIds].join(', ') || '—'}`,
      `worker busy: ${metrics.canvasWorkerBusy ? 'yes' : 'no'}`,
      `edit queue / running: ${Number(mapEditMetrics.queueDepth || 0)} / ${Number(mapEditMetrics.runningCount || 0)}`,
      `coalesced / stale: ${Number(mapEditMetrics.coalesced || 0)} / ${Number(mapEditMetrics.staleDiscarded || 0)}`,
      `edit worker p95: ${Number(mapEditMetrics.latencyP95Ms || 0).toFixed(1)} ms`,
      `preview update: ${Number(editPreviewMetrics.lastUpdateMs || 0).toFixed(2)} ms / ${Number(editPreviewMetrics.activeSegmentCount || 0)} segments`,
      `edit commit: ${Number(editPipelineMetrics.lastCommitMs || 0).toFixed(1)} ms / ${editPipelineMetrics.lastCommitDomain || '—'}`,
      `patch queue / stale: ${Number(metrics.patchWorkerJobs?.queueDepth || 0)} / ${Number(metrics.patchWorkerJobs?.staleDiscarded || 0)}`,
      `patch GPU bytes: ${Number(metrics.patchWorkerOutputBytes || 0).toLocaleString('ko-KR')}`,
      `frame p95 / p99: ${Number(metrics.p95CpuSubmitMs || 0).toFixed(1)} / ${Number(metrics.p99CpuSubmitMs || 0).toFixed(1)} ms`,
      `terrain / hydro: ${state.physicalLoadState.terrain} / ${state.physicalLoadState.hydro}`,
      `audit: ${state.audit.status}${state.audit.report ? ` / ${state.audit.report.issues.length} issues` : ''}`,
    ];
    panel.replaceChildren();
    const output = document.createElement('pre');
    output.textContent = lines.join('\n');
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'ui-button btn ghost compact';
    run.textContent = state.audit.status === 'running' ? '지도 검사 중…' : '전체 지도 검사';
    run.disabled = state.audit.status === 'running';
    run.addEventListener('click', runFullMapAudit, { once: true });
    panel.append(output, run);
    if (state.audit.status !== 'idle') {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'ui-button btn ghost compact';
      clear.textContent = '검사 결과 지우기';
      clear.addEventListener('click', clearMapAudit, { once: true });
      panel.append(clear);
    }
    const issues = state.audit.report?.issues || [];
    if (issues.length) {
      const list = document.createElement('div');
      list.className = 'debug-audit-issues';
      list.setAttribute('aria-label', '지도 검사 결과');
      for (const issue of issues.slice(0, 20)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ui-button ui-row-button';
        item.dataset.category = auditCategory(issue.kind);
        item.textContent = issue.message || issue.kind || '검사 항목';
        item.addEventListener('click', () => focusAuditIssue(issue.id));
        list.append(item);
      }
      panel.append(list);
    }
  }

  function auditCategory(kind) {
    if (kind === 'overlap') return 'overlap';
    if (kind === 'gap' || kind === 'shared-boundary-gap') return 'gap';
    if (['invalid-sovereign', 'orphan-administrative', 'outside-parent', 'missing-territorial-reference', 'duplicate-id'].includes(kind)) return 'relation';
    return 'invalid';
  }

  function installRenderDebugFacade() {
    if (new URLSearchParams(location.search).has('debug') || new URLSearchParams(location.search).has('perf')) {
      window.__PANDOLAB_RENDER_DEBUG__ = Object.freeze({
        snapshot: () => {
          const { mapHost, renderingDomain, selectionDomain, selectionPass, resolvedInteractionStyle, labelLayoutMetrics, mapLayoutMetricsRefreshCount, mapLayoutMetricsSnapshot } = readDiagnostics();
          return {
          ...(renderingDomain?.getStats?.() || {}),
          gpu: gpuMapRenderer.getStats?.() || {},
          gpuSelection: {
            ...(selectionPass?.stats?.() || {}),
            host: null,
          },
          mapHost: mapHost?.getDebugState?.() || { kind: MAP_HOST_KINDS.LEGACY, ready: false },
          interactionGate: mapInteractionGate.stats(),
          interactionStyle: resolvedInteractionStyle,
          selection: { ...(window.__PANDOLAB_SELECTION_RENDER_METRICS__ || {}) },
          selectionInput: {
            ...selectionPerformanceMetrics,
            ...(selectionDomain?.stats?.() || {}),
            boundaryAnalysisBuildCount: boundarySelectionAnalysisMetrics.builds,
            boundaryAnalysisCacheHitCount: boundarySelectionAnalysisMetrics.cacheHits,
            boundaryAnalysisCacheMissCount: boundarySelectionAnalysisMetrics.cacheMisses,
            boundaryAnalysisMs: boundarySelectionAnalysisMetrics.buildMs,
          },
          selectionBaseline: selectionPerformanceBaseline.snapshot(),
          spatialIndex: mapObjectSpatialIndex.stats(),
          viewportCulling: { ...viewportCullingMetrics },
          distributionRows: {
            rebuildCount: distributionRenderRowCache.rebuildCount,
            rowCount: distributionRenderRowCache.rows.length,
            buildMs: distributionRenderRowCache.buildMs,
          },
          labelLayout: { ...labelLayoutMetrics },
          layoutMetrics: {
            refreshCount: mapLayoutMetricsRefreshCount,
            revision: mapLayoutMetricsSnapshot?.revision || 0,
            reason: mapLayoutMetricsSnapshot?.reason || 'initial',
            projectionSignature: mapLayoutMetricsSnapshot?.projectionSignature || '',
          },
          territorialBoundaryTopologyRebuildCount: renderingDomain?.getStats?.().territorialBoundaryTopologyRebuildCount || 0,
          adaptiveRenderQuality: renderQualityController.stats(),
          renderScene: renderSceneBuilder.stats(),
          rendering: renderingDomain?.getStats?.() || {},
          startup: { ...(window.__PANDOLAB_STARTUP_METRICS__ || {}) },
          };
      },
      });
    }
  }

  function installViewDebugFacade() {
    if (new URLSearchParams(location.search).has('debug')) {
      window.__PANDOLAB_VIEW_DEBUG__ = Object.freeze({
        snapshot: () => {
          updateProjection();
          return deepClone({ ...projectionViewSnapshot(), revision: readDiagnostics().viewRevision });
        },
        screenToGeo: point => {
          updateProjection();
          const coordinate = screenToGeo(point);
          return coordinate ? coordinate.slice() : null;
        },
        geoToScreen: coordinate => {
          updateProjection();
          const point = activeProjection()(coordinate);
          return point ? point.slice() : null;
        },
        featureBounds: feature => {
          updateProjection();
          try { return deepClone(getFeatureBounds(feature)); } catch (_) { return null; }
        },
        countryLabelAnchor: id => {
          const anchor = countryLabelAnchors.get(String(id));
          return validLabelAnchor(anchor) ? [Number(anchor[0]), Number(anchor[1])] : null;
        },
      });
    } else {
      delete window.__PANDOLAB_VIEW_DEBUG__;
    }
  }

  return Object.freeze({
    renderPanel: renderDebugMapPanel,
    installRenderFacade: installRenderDebugFacade,
    installViewFacade: installViewDebugFacade,
  });
}
