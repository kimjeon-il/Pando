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
    dependencies.mapDebug.renderPanel();
  }

  function ensureGeometryValidationWorker() {
    if (geometryValidationWorker) return geometryValidationWorker;
    geometryValidationWorker = new Worker((0, dependencies.runtimeAssetUrl)('workers/geometry-validation-worker.js'), { name: 'atlaswright-geometry-validation' });
    geometryValidationWorker.onmessage = event => {
      const message = event.data || {};
      if (message.type !== 'result' || Number(message.requestId) !== geometryValidationRequestId) return;
      if (!message.ok) {
        dependencies.state.audit.status = 'error';
        renderMapAuditPanel();
        (0, dependencies.reportOperationError)(new Error(String(message.message || '')), '지도 검사에 실패했습니다. 검사할 레이어를 확인한 뒤 다시 시도하세요.', 'PL-AUDIT-001', 4200);
        return;
      }
      dependencies.state.audit.status = 'ready';
      dependencies.state.audit.report = message.report;
      dependencies.state.audit.selectedIssueId = null;
      renderMapAuditPanel();
      dependencies.renderingDomain?.renderValidation?.();
      (0, dependencies.setActionStatus)(message.report.issues.length
        ? `지도 검사에서 ${message.report.issues.length.toLocaleString('ko-KR')}건을 찾았습니다.`
        : '지도 검사에서 오류를 찾지 못했습니다.', message.report.issues.length ? 'error' : 'success', 3600);
    };
    geometryValidationWorker.onerror = () => {
      dependencies.state.audit.status = 'error';
      renderMapAuditPanel();
    };
    return geometryValidationWorker;
  }

  function runFullMapAudit() {
    geometryValidationRequestId += 1;
    dependencies.state.audit = { status: 'running', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    dependencies.renderingDomain?.renderValidation?.();
    const worker = ensureGeometryValidationWorker();
    worker.postMessage({
      type: 'audit',
      requestId: geometryValidationRequestId,
      revision: dependencies.state.stateRevision,
      payload: {
        countries: dependencies.state.countriesData?.features || [],
        coarseCountries: dependencies.state.countryVisualPhase === 'preview' ? dependencies.state.auditPreviewCountries?.features || [] : [],
        preciseAffectedIds: [...dependencies.state.historyDirtyCountryIds],
        units: dependencies.state.territorialUnits || [],
        distributionEntries: dependencies.state.distributionEntries || [],
      },
    });
  }

  function clearMapAudit() {
    if (dependencies.state.audit.status === 'running') geometryValidationWorker?.postMessage({ type: 'cancel', requestId: geometryValidationRequestId });
    geometryValidationRequestId += 1;
    dependencies.state.audit = { status: 'idle', revision: geometryValidationRequestId, report: null, selectedIssueId: null };
    renderMapAuditPanel();
    dependencies.renderingDomain?.renderValidation?.();
  }

  function focusAuditIssue(issueId) {
    const issue = dependencies.state.audit.report?.issues?.find(item => item.id === issueId);
    if (!issue) return;
    dependencies.state.audit.selectedIssueId = issue.id;
    renderMapAuditPanel();
    if (issue.geometry) (0, dependencies.focusCountry)((0, dependencies.featureFromGeometry)(issue.geometry), { maxZoom: (0, dependencies.isMobile)() ? 12 : 10 });
    else {
      const coordinate = issueCoordinate(issue);
      if (coordinate) (0, dependencies.focusCoordinate)(coordinate);
    }
    dependencies.renderingDomain?.renderValidation?.();
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
