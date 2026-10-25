import {createNotificationPresentation} from "../../../../../shared/frontend/js/modules/notification-presentation.js";
/** ReadinessNotifications: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createReadinessNotifications() {
  let dependencies;
  let clearNotification,clearErrorNotification,setActionStatus,isSafeKoreanErrorMessage,reportOperationError;
  let CANONICAL_CONTROL_SELECTOR;
  let READINESS_INDEPENDENT_CONTROL_SELECTOR;
  let canonicalControls;
  let canonicalControlReadiness;
  let canonicalControlsRegistered;
  function connect(ports) {
    if (dependencies) throw new Error('readiness-notifications already connected');
    dependencies = ports;
    ({clearNotification,clearErrorNotification,setActionStatus,isSafeKoreanErrorMessage,reportOperationError}=createNotificationPresentation({get document(){return globalThis.document;},getElement:(...args)=>ports.platform.$(...args),isMobile:()=>ports.surfaces.isMobile()}));
  }

  function setCurrentTool() {
    syncStatusBar();
  }

  function syncStatusBar() {
    const selectedText = (0, dependencies.platform.$)('selectionStatus')?.textContent?.trim() || '';
    const showSelection = !!dependencies.projectState.state.selected && !!selectedText;
    const projectionLabel = dependencies.projectState.state.projection === 'flat' ? '평면지도' : '지구본';
    if ((0, dependencies.platform.$)('projectionStatus')) (0, dependencies.platform.$)('projectionStatus').textContent = projectionLabel;
    (0, dependencies.platform.$)('statusSelection')?.classList.toggle('hidden', !showSelection);
  }

  function isReadinessIndependentControl(element) {
    return !!element?.matches?.(READINESS_INDEPENDENT_CONTROL_SELECTOR);
  }

  function syncCanonicalControls(scope = document) {
    const unavailable = !(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness);
    if (!canonicalControlsRegistered || scope !== document) {
      for (const element of scope.querySelectorAll(CANONICAL_CONTROL_SELECTOR)) canonicalControls.add(element);
      canonicalControlsRegistered = true;
    }
    (0, dependencies.platform.$)('app')?.setAttribute('data-readiness', dependencies.projectState.state.dataReadiness);
    document.body.dataset.mapReadiness = dependencies.projectState.state.dataReadiness;
    for (const element of canonicalControls) {
      if (!element.isConnected) { canonicalControls.delete(element); continue; }
      if (canonicalControlReadiness.get(element) === unavailable) continue;
      canonicalControlReadiness.set(element, unavailable);
      if (isReadinessIndependentControl(element)) continue;
      if (unavailable) {
        if (!Object.hasOwn(element.dataset, 'readinessDisabled')) {
          element.dataset.readinessDisabled = String('disabled' in element && element.disabled);
          element.dataset.readinessAriaDisabled = element.hasAttribute('aria-disabled')
            ? String(element.getAttribute('aria-disabled'))
            : '';
        }
        if ('disabled' in element) element.disabled = true;
        element.setAttribute('aria-disabled', 'true');
        continue;
      }
      if (Object.hasOwn(element.dataset, 'readinessDisabled')) {
        if ('disabled' in element) element.disabled = element.dataset.readinessDisabled === 'true';
        const previousAria = element.dataset.readinessAriaDisabled;
        if (previousAria) element.setAttribute('aria-disabled', previousAria);
        else element.removeAttribute('aria-disabled');
        delete element.dataset.readinessDisabled;
        delete element.dataset.readinessAriaDisabled;
      }
    }
  }

  function setDataReadiness(value) {
    dependencies.projectState.state.dataReadiness = Object.values(dependencies.readiness.DATA_READINESS).includes(value) ? value : dependencies.readiness.DATA_READINESS.PREVIEW;
    syncCanonicalControls();
  }

  function applyDataReadinessEvent(event) {
    setDataReadiness((0, dependencies.readiness.transitionDataReadiness)(dependencies.projectState.state.dataReadiness, event));
  }

  function requireCanonicalData() {
    if ((0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) return true;
    const message = dependencies.projectState.state.dataReadiness === dependencies.readiness.DATA_READINESS.ERROR
      ? '편집 데이터를 불러오지 못했습니다. 새로고침하세요.'
      : `편집 데이터 준비 중 · ${Math.round(dependencies.projectState.state.geometryProgress || 0)}%`;
    setActionStatus(message, dependencies.projectState.state.dataReadiness === dependencies.readiness.DATA_READINESS.ERROR ? 'error' : 'working', 2600);
    return false;
  }

  function blockUnavailableCanonicalAction(event) {
    if ((0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) return;
    const target = event.target instanceof window.Element ? event.target.closest(CANONICAL_CONTROL_SELECTOR) : null;
    if (!target || isReadinessIndependentControl(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireCanonicalData();
  }

  function createGisImportError(userMessage, {
    category = dependencies.readiness.RELIABILITY_ERROR_CATEGORIES.TRANSACTION,
    objectIds = [],
    technicalMessage = '',
    cause = null,
    code = 'PL-GIS-001',
  } = {}) {
    return (0, dependencies.readiness.createOperationalError)({
      code,
      category,
      userMessage,
      technicalMessage: technicalMessage || cause?.message || userMessage,
      objectIds,
      operationType: 'gis-import',
      cause,
    });
  }

  function reportGisImportError(error, { rollback = '' } = {}) {
    const code = String(error?.code || 'PL-GIS-001');
    const objectIds = [...new Set((error?.objectIds || []).map(String).filter(Boolean))];
    const technicalMessage = String(error?.message || error || 'GIS import failed');
    console.error(`[${code}]`, {
      operation: error?.operationType || 'gis-import',
      objectIds,
      rollback,
    }, error);
    dependencies.readiness.reliabilityDiagnostic.push({
      category: error?.category || 'gis',
      operation: error?.operationType || 'gis-import',
      objectIds,
      result: 'failed',
      errorCode: code,
      technicalMessage,
      stack: error?.stack || '',
      rollback,
    });
    const userMessage = String(error?.userMessage || '').trim()
      || (isSafeKoreanErrorMessage(error) ? technicalMessage.trim() : '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요.');
    setActionStatus(`${userMessage} · ${code}`, 'error', 5600);
  }

  function showFatalError(error) {
    if ((0, dependencies.readiness.isAbortError)(error)) return;
    console.error('[PL-RUNTIME-001]', error);
    const message = isSafeKoreanErrorMessage(error)
      ? String(error.message).trim()
      : '내부 오류로 판도연구소를 시작할 수 없습니다. 오류 코드 PL-RUNTIME-001을 확인하세요.';
    let box = document.getElementById('fatalErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatalErrorBox';
      box.className = 'fatal-runtime-message';
      document.body.appendChild(box);
    }
    box.textContent = `판도연구소를 시작할 수 없습니다.\n${message}\n\n페이지를 새로고침하세요. 문제가 계속되면 오류 코드를 확인하세요.`;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '실행 오류';
  }

  function handleUnexpectedRuntimeError(error) {
    if ((0, dependencies.readiness.isAbortError)(error)) return;
    if (!dependencies.readiness.runtimeReady) {
      showFatalError(error);
      return;
    }
    console.error('[PL-RUNTIME-001]', error);
    setActionStatus('작업 실패 · PL-RUNTIME-001', 'error', 0);
  }

  function initializeCANONICAL_CONTROL_SELECTOR() {
    (CANONICAL_CONTROL_SELECTOR = [
      '#createMenu .ui-menu-item',
      '#editorSurface input', '#editorSurface select', '#editorSurface textarea',
      '#editorSurface button:not(.sheet-close-btn):not(#focusSelectedObjectBtn)',
      '.top-actions button', '.top-actions input',
      '#mobileFileBtn', '#preferencesBtn', '#helpBtn', '#undoBtn', '#redoBtn',
      '[data-map-display-row]',
      '[data-layer-style-opacity]', '[data-layer-style-boundary]', '[data-layer-style-blend-mode]',
      '[data-territorial-symbol]',
      '#labelsVisible', '#objectNamesVisible',
    ].join(','));

    (READINESS_INDEPENDENT_CONTROL_SELECTOR = [
      '[data-map-display-row]',
      '[data-layer-style-opacity]',
      '[data-layer-style-boundary]',
      '[data-layer-style-blend-mode]',
      '[data-territorial-symbol]',
      'input[name="terrainStyle"]',
      '#labelsVisible',
      '#objectNamesVisible',
    ].join(','));

    (canonicalControls = new Set());

    (canonicalControlReadiness = new WeakMap());

    (canonicalControlsRegistered = false);

    document.addEventListener('click', blockUnavailableCanonicalAction, true);

    document.addEventListener('change', blockUnavailableCanonicalAction, true);

    window.addEventListener('error', event => {
      const error = event.error || event.message;
      if ((0, dependencies.readiness.isAbortError)(error)) {
        event.preventDefault();
        return;
      }
      handleUnexpectedRuntimeError(error);
    });

    window.addEventListener('unhandledrejection', event => {
      if ((0, dependencies.readiness.isAbortError)(event.reason)) {
        event.preventDefault();
        return;
      }
      handleUnexpectedRuntimeError(event.reason);
    });
  }

  return Object.freeze({
    connect,
    initializeCANONICAL_CONTROL_SELECTOR,
    get applyDataReadinessEvent() { return applyDataReadinessEvent; },
    get clearErrorNotification() { return clearErrorNotification; },
    get clearNotification() { return clearNotification; },
    get createGisImportError() { return createGisImportError; },
    get isSafeKoreanErrorMessage() { return isSafeKoreanErrorMessage; },
    get reportGisImportError() { return reportGisImportError; },
    get reportOperationError() { return reportOperationError; },
    get requireCanonicalData() { return requireCanonicalData; },
    get setActionStatus() { return setActionStatus; },
    get setCurrentTool() { return setCurrentTool; },
    get showFatalError() { return showFatalError; },
    get syncCanonicalControls() { return syncCanonicalControls; },
    get syncStatusBar() { return syncStatusBar; },
  });
}
