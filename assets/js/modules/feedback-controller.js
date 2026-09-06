import { installDialogAccessibilityController } from './dialog-accessibility-controller.js';

let installed = false;

const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function toneOf(element) {
  if (element?.classList?.contains('error')) return 'error';
  if (element?.classList?.contains('warning')) return 'warning';
  if (element?.classList?.contains('working')) return 'working';
  if (element?.classList?.contains('success')) return 'success';
  return 'info';
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
  // The observer below watches the class attribute. Calling classList.add()
  // for a class that is already present still emits an attribute mutation in
  // Chromium, which schedules this callback again and can starve the main
  // thread indefinitely. Keep the static toast semantics idempotent.
  if (!notice.classList.contains('ui-toast')) notice.classList.add('ui-toast');
  if (notice.getAttribute('role') !== 'status') notice.setAttribute('role', 'status');
  if (notice.getAttribute('aria-atomic') !== 'true') notice.setAttribute('aria-atomic', 'true');

  if (notice.classList.contains('hidden')) return;
  const message = normalizeText(notice.querySelector('strong')?.textContent);
  if (!message) return;
  const tone = toneOf(notice);
  notice.dataset.feedbackTone = tone;

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


export function installFeedbackController(documentRef = document) {
  if (installed) return;
  installed = true;
  installDialogAccessibilityController(documentRef);
  normalizeInlineFeedback(documentRef);
  installProgressSemantics(documentRef);
  observeToast(documentRef);
}
