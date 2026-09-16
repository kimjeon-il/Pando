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
    if (geometryValidationWorker) return geometryValidationWorker;
    geometryValidationWorker = new Worker((0, dependencies.platform.runtimeAssetUrl)('workers/geometry-validation-worker.js'), { name: 'atlaswright-geometry-validation' });
    geometryValidationWorker.onmessage = event => {
      const message = event.data || {};
      if (message.type !== 'result' || Number(message.requestId) !== geometryValidationRequestId) return;
      if (!message.ok) {
        dependencies.projectState.state.audit.status = 'error';
        renderMapAuditPanel();
        (0, dependencies.feedback.reportOperationError)(new Error(String(message.message || '')), '지도 검사에 실패했습니다. 검사할 레이어를 확인한 뒤 다시 시도하세요.', 'PL-AUDIT-001', 4200);
        return;
      }
      dependencies.projectState.state.audit.status = 'ready';
      dependencies.projectState.state.audit.report = message.report;
      dependencies.projectState.state.audit.selectedIssueId = null;
      renderMapAuditPanel();
      dependencies.domains.renderingDomain?.renderValidation?.();
      (0, dependencies.feedback.setActionStatus)(message.report.issues.length
        ? `지도 검사에서 ${message.report.issues.length.toLocaleString('ko-KR')}건을 찾았습니다.`
        : '지도 검사에서 오류를 찾지 못했습니다.', message.report.issues.length ? 'error' : 'success', 3600);
    };
    geometryValidationWorker.onerror = () => {
      dependencies.projectState.state.audit.status = 'error';
      renderMapAuditPanel();
    };
    return geometryValidationWorker;
  }

  function runFullMapAudit() {
    geometryValidationRequestId += 1;
    dependencies.projectState.state.audit = { status: 'running', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    dependencies.domains.renderingDomain?.renderValidation?.();
    const worker = ensureGeometryValidationWorker();
    worker.postMessage({
      type: 'audit',
      requestId: geometryValidationRequestId,
      revision: dependencies.projectState.state.stateRevision,
      payload: {
        countries: dependencies.projectState.state.countriesData?.features || [],
        coarseCountries: dependencies.projectState.state.countryVisualPhase === 'preview' ? dependencies.projectState.state.auditPreviewCountries?.features || [] : [],
        preciseAffectedIds: [...dependencies.projectState.state.historyDirtyCountryIds],
        units: dependencies.projectState.state.territorialUnits || [],
        distributionEntries: dependencies.projectState.state.distributionEntries || [],
      },
    });
  }

  function clearMapAudit() {
    if (dependencies.projectState.state.audit.status === 'running') geometryValidationWorker?.postMessage({ type: 'cancel', requestId: geometryValidationRequestId });
    geometryValidationRequestId += 1;
    dependencies.projectState.state.audit = { status: 'idle', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    dependencies.domains.renderingDomain?.renderValidation?.();
  }

  function focusAuditIssue(issueId) {
    const issue = dependencies.projectState.state.audit.report?.issues?.find(item => item.id === issueId);
    if (!issue) return;
    dependencies.projectState.state.audit.selectedIssueId = issue.id;
    renderMapAuditPanel();
    if (issue.geometry) (0, dependencies.navigation.focusCountry)((0, dependencies.renderScene.featureFromGeometry)(issue.geometry), { maxZoom: (0, dependencies.surfaces.isMobile)() ? 12 : 10 });
    else {
      const coordinate = issueCoordinate(issue);
      if (coordinate) (0, dependencies.navigation.focusCoordinate)(coordinate);
    }
    dependencies.domains.renderingDomain?.renderValidation?.();
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
