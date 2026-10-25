import { createWorkerRpcClient } from "../../../../../shared/frontend/js/modules/worker-rpc.js";

/** MapAudit: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createMapAudit() {
  let dependencies;
  let geometryValidationWorker;
  let geometryValidationRequestId;
  function connect(ports) {
    if (dependencies) throw new Error('map-audit already connected');
    dependencies = ports;
  }

  function issueCoordinate(issue) {
    if (Array.isArray(issue?.coordinate) && issue.coordinate.length >= 2) return issue.coordinate;
    const bounds = issue?.bounds;
    return Array.isArray(bounds) && bounds.length >= 4
      ? [(Number(bounds[0]) + Number(bounds[2])) / 2, (Number(bounds[1]) + Number(bounds[3])) / 2]
      : null;
  }

  function renderMapAuditPanel() {
    dependencies.lifecycleUi.mapDebug.renderPanel();
  }

  function ensureGeometryValidationWorker() {
    return geometryValidationWorker ||= createWorkerRpcClient({
      createWorker: () => new Worker(dependencies.platform.runtimeAssetUrl('workers/geometry-validation-worker.js'), { name: 'atlaswright-geometry-validation' }),
      getProjectRevision: () => dependencies.projectState.state.stateRevision,
    });
  }

  async function runFullMapAudit() {
    geometryValidationWorker?.cancelAll('superseded');
    const requestId = ++geometryValidationRequestId;
    dependencies.projectState.state.audit = { status: 'running', revision: requestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    dependencies.domains.renderingDomain?.invalidateEditingOverlays('audit-visual-frame');
    try {
      const { result: report } = await ensureGeometryValidationWorker().request('geometry.audit', {
        countries: dependencies.territorialModel.entityRepository.list({ kind: 'general', parentId: '' }),
        coarseCountries: dependencies.projectState.state.countryVisualPhase === 'preview' ? dependencies.projectState.state.auditPreviewCountries?.features || [] : [],
        preciseAffectedIds: [...dependencies.projectState.state.historyDirtyEntityIds],
        units: dependencies.territorialModel.entityRepository.list({}).filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId),
        distributionEntries: dependencies.projectState.state.distributionEntries || [],
      });
      if (requestId !== geometryValidationRequestId) return;
      dependencies.projectState.state.audit = { status: 'ready', revision: requestId, report, selectedIssueId: null };
      renderMapAuditPanel();
      dependencies.domains.renderingDomain?.invalidateEditingOverlays('audit-visual-frame');
      dependencies.feedback.setActionStatus(report.issues.length
        ? `지도 검사에서 ${report.issues.length.toLocaleString('ko-KR')}건을 찾았습니다.`
        : '지도 검사에서 오류를 찾지 못했습니다.', report.issues.length ? 'error' : 'success', 3600);
    } catch (error) {
      if (requestId !== geometryValidationRequestId) return;
      dependencies.projectState.state.audit.status = error.cancelled ? 'idle' : 'error';
      renderMapAuditPanel();
      if (!error.cancelled) dependencies.feedback.reportOperationError(error, '지도 검사에 실패했습니다. 검사할 레이어를 확인한 뒤 다시 시도하세요.', 'PL-AUDIT-001', 4200);
    }
  }

  function clearMapAudit() {
    geometryValidationWorker?.cancelAll('cleared');
    geometryValidationRequestId += 1;
    dependencies.projectState.state.audit = { status: 'idle', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    dependencies.domains.renderingDomain?.invalidateEditingOverlays('audit-visual-frame');
  }

  function focusAuditIssue(issueId) {
    const issue = dependencies.projectState.state.audit.report?.issues?.find(item => item.id === issueId);
    if (!issue) return;
    dependencies.projectState.state.audit.selectedIssueId = issue.id;
    renderMapAuditPanel();
    if (issue.geometry) (0, dependencies.navigation.fitMapToFeature)((0, dependencies.renderScene.featureFromGeometry)(issue.geometry), { maxZoom: (0, dependencies.surfaces.isMobile)() ? 12 : 10 });
    else {
      const coordinate = issueCoordinate(issue);
      if (coordinate) (0, dependencies.navigation.focusCoordinate)(coordinate);
    }
    dependencies.domains.renderingDomain?.invalidateEditingOverlays('audit-visual-frame');
  }

  function initializeGeometryValidationWorker() {
    (geometryValidationWorker = null);

    (geometryValidationRequestId = 0);
  }

  return Object.freeze({
    connect,
    initializeGeometryValidationWorker,
    get clearMapAudit() { return clearMapAudit; },
    get focusAuditIssue() { return focusAuditIssue; },
    get issueCoordinate() { return issueCoordinate; },
    get runFullMapAudit() { return runFullMapAudit; },
  });
}
