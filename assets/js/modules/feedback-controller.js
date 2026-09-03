import { installDialogAccessibilityController } from './dialog-accessibility-controller.js';

const READINESS_PATTERN = /(편집 데이터|고화질 지도|무손실 데이터|지도 엔진|자동 재시도|다시 준비|미리보기 오류)/u;
const SAVE_WORKING_PATTERN = /저장\s*(중|하는 중|준비)/u;

let installed = false;

const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function toneOf(element) {
  if (element?.classList?.contains('error')) return 'error';
  if (element?.classList?.contains('warning')) return 'warning';
  if (element?.classList?.contains('working')) return 'working';
  if (element?.classList?.contains('success')) return 'success';
  return 'info';
}

function engineTone(message) {
  const text = normalizeText(message);
  if (/오류|실패|불러오지 못/u.test(text)) return 'error';
  if (/주의|제외|대기/u.test(text)) return 'warning';
  if (/%|준비|재시도|처리/u.test(text)) return 'working';
  return 'info';
}

function setPersistentEngineStatus(documentRef, message, tone = engineTone(message)) {
  const engine = documentRef.getElementById('engineStatus');
  if (!(engine instanceof HTMLElement)) return;
  const text = normalizeText(message);
  if (!text) return;
  engine.textContent = text;
  engine.dataset.feedbackTone = tone;
  engine.classList.remove('hidden');
  engine.removeAttribute('aria-hidden');
}

function activeDialog(documentRef, id) {
  const modal = documentRef.getElementById(id);
  return modal instanceof HTMLElement && !modal.classList.contains('hidden');
}

function routeWorkingToWorkflow(documentRef, message) {
  if (activeDialog(documentRef, 'gisImportModal')) {
    const status = documentRef.getElementById('gisImportStatus');
    if (status) status.textContent = normalizeText(message);
    return true;
  }

  if (activeDialog(documentRef, 'gisExportModal')) {
    const form = documentRef.getElementById('gisExportForm');
    if (!(form instanceof HTMLElement)) return false;
    let status = form.querySelector('.gis-export-working-status');
    if (!(status instanceof HTMLElement)) {
      status = documentRef.createElement('p');
      status.className = 'gis-export-working-status';
      status.setAttribute('role', 'status');
      const error = documentRef.getElementById('gisExportError');
      if (error) error.insertAdjacentElement('beforebegin', status);
      else form.appendChild(status);
    }
    status.textContent = normalizeText(message);
    return true;
  }

  return false;
}

function hasVisibleInlineDuplicate(documentRef, message) {
  const target = normalizeText(message);
  if (!target) return false;
  const nodes = documentRef.querySelectorAll('.ui-alert:not(.hidden), .ui-field-error:not(.hidden)');
  return Array.from(nodes).some(node => {
    const inline = normalizeText(node.textContent);
    if (!inline) return false;
    return target.includes(inline) || inline.includes(target);
  });
}

function syncToast(documentRef) {
  const notice = documentRef.getElementById('actionStatus');
  if (!(notice instanceof HTMLElement)) return;
  notice.classList.add('ui-toast');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-atomic', 'true');

  if (notice.classList.contains('hidden')) return;
  const message = normalizeText(notice.querySelector('strong')?.textContent);
  if (!message) return;
  const tone = toneOf(notice);
  notice.dataset.feedbackTone = tone;

  if (READINESS_PATTERN.test(message)) {
    setPersistentEngineStatus(documentRef, message, tone === 'error' ? 'error' : 'working');
    notice.dataset.feedbackRouted = 'engine';
    notice.classList.add('hidden');
    return;
  }

  if (tone === 'working' && SAVE_WORKING_PATTERN.test(message)) {
    notice.dataset.feedbackRouted = 'save';
    notice.classList.add('hidden');
    return;
  }

  if (tone === 'working' && routeWorkingToWorkflow(documentRef, message)) {
    notice.dataset.feedbackRouted = 'workflow';
    notice.classList.add('hidden');
    return;
  }

  if (tone === 'error' && hasVisibleInlineDuplicate(documentRef, message)) {
    notice.dataset.feedbackRouted = 'inline';
    notice.classList.add('hidden');
    return;
  }

  delete notice.dataset.feedbackRouted;
}

function normalizeInlineFeedback(documentRef) {
  documentRef.getElementById('gisSecurityNote')?.classList.add('ui-alert--warning');
  documentRef.getElementById('gisImportError')?.classList.add('ui-alert--error');
  documentRef.getElementById('gisExportError')?.classList.add('ui-alert--error');
  documentRef.querySelector('.fatal-noscript')?.classList.add('ui-alert--error');
}

function parseProgressValue(bar) {
  const width = bar?.style?.width || '';
  const match = String(width).match(/(-?\d+(?:\.\d+)?)%/);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}

function installProgressSemantics(documentRef) {
  const targets = [documentRef.querySelector('#gisImportProgress .ui-progress')].filter(Boolean);

  for (const progress of targets) {
    const bar = progress.querySelector(':scope > span');
    if (!(bar instanceof HTMLElement)) continue;
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    const sync = () => {
      const value = parseProgressValue(bar);
      if (value == null) progress.removeAttribute('aria-valuenow');
      else progress.setAttribute('aria-valuenow', String(Math.round(value)));
    };
    sync();
    new MutationObserver(sync).observe(bar, { attributes: true, attributeFilter: ['style'] });
  }
}

function observeToast(documentRef) {
  const notice = documentRef.getElementById('actionStatus');
  if (!(notice instanceof HTMLElement)) return;
  const sync = () => syncToast(documentRef);
  sync();
  new MutationObserver(sync).observe(notice, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function observeEngineStatus(documentRef) {
  const engine = documentRef.getElementById('engineStatus');
  if (!(engine instanceof HTMLElement)) return;
  const sync = () => {
    const message = normalizeText(engine.textContent);
    if (!message) return;
    const tone = engineTone(message);
    engine.dataset.feedbackTone = tone;
    if (/%|오류|실패|대기|재시도/u.test(message)) {
      engine.classList.remove('hidden');
      engine.removeAttribute('aria-hidden');
    }
  };
  sync();
  new MutationObserver(sync).observe(engine, { childList: true, characterData: true, subtree: true });
}

export function installFeedbackController(documentRef = document) {
  if (installed) return;
  installed = true;
  installDialogAccessibilityController(documentRef);
  normalizeInlineFeedback(documentRef);
  installProgressSemantics(documentRef);
  observeToast(documentRef);
  observeEngineStatus(documentRef);
}
