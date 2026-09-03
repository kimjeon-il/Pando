import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';
import { installObjectRegistryPresenter } from './object-registry-presenter.js';
import { createSemanticIcon } from './icon-utils.js';
import { installMobileSheetController } from './mobile-sheet-controller.js';

const COAST_DECISION_DETAIL_BY_ID = Object.freeze({
  coastReconciliationCountryBtn: '국가 해안선을 기준으로 가져온 영역을 맞춥니다.',
  coastReconciliationAdminBtn: '가져온 영역의 해안선을 기준으로 국가 쪽을 맞춥니다.',
  coastReconciliationIndependentBtn: '두 형상을 변경하지 않고 독립적으로 유지합니다.',
});

let initialized = false;

function workflowSemanticFromLabel(label, fallback = 'boundary') {
  const text = String(label || '');
  if (/삭제/.test(text)) return 'delete';
  if (/종류/.test(text)) return 'transform';
  if (/편입|소속|반영/.test(text)) return 'transfer';
  if (/합병|합치기/.test(text)) return 'merge';
  if (/나누기|분할/.test(text)) return 'split';
  if (/해안/.test(text)) return 'coastline';
  if (/국경|경계/.test(text)) return 'boundary';
  if (/국가로 전환|국가 추가|새 국가/.test(text)) return 'country';
  if (/구분 해제/.test(text)) return 'close';
  return fallback;
}

function replaceWorkflowIcon(host, semantic, className) {
  if (!(host instanceof Element)) return null;
  const next = createSemanticIcon(document, semantic, className);
  const current = host.querySelector(`:scope > .${className.split(' ').at(-1)}`);
  if (current) current.replaceWith(next);
  else host.prepend(next);
  return next;
}

function normalizeMapEditingWorkflow() {
  const hud = document.getElementById('modeEditingHud');
  const heading = hud?.querySelector('.mode-task-heading');
  const title = document.getElementById('modeTaskName');
  if (!(hud instanceof HTMLElement) || !(heading instanceof HTMLElement) || !(title instanceof HTMLElement)) return;
  const syncIcon = () => replaceWorkflowIcon(heading, workflowSemanticFromLabel(title.textContent), 'ui-icon mode-task-icon');
  syncIcon();
  new MutationObserver(syncIcon).observe(title, { childList: true, characterData: true, subtree: true });
  document.getElementById('modeActionBar')?.classList.add('workflow-actions');
  document.getElementById('geometryPreviewSummary')?.classList.add('workflow-impact');
}

function normalizeWorkflowDialog({ modalId, cardSelector, variant, semantic, titleId, descriptionId }) {
  const modal = document.getElementById(modalId);
  const card = modal?.querySelector(cardSelector);
  const title = titleId ? document.getElementById(titleId) : card?.querySelector(':scope > h2');
  if (!(modal instanceof HTMLElement) || !(card instanceof HTMLElement)) return null;
  card.classList.add('workflow-dialog-card', `workflow-dialog--${variant}`);
  if (title instanceof HTMLElement) title.classList.add('workflow-dialog-title');
  if (descriptionId && document.getElementById(descriptionId)) modal.setAttribute('aria-describedby', descriptionId);
  if (semantic) replaceWorkflowIcon(card, semantic, 'ui-icon workflow-dialog-icon');
  card.querySelector(':scope > .ui-dialog-actions, :scope > .confirm-modal-actions')?.classList.add('workflow-dialog-actions');
  return { modal, card, title };
}

function normalizeEditingDialogs() {
  normalizeWorkflowDialog({
    modalId: 'territorialTypeModal',
    cardSelector: '.territorial-type-card',
    variant: 'standard',
    semantic: 'transform',
    titleId: 'territorialTypeTitle',
    descriptionId: 'territorialTypeContext',
  });

  const confirm = normalizeWorkflowDialog({
    modalId: 'confirmModal',
    cardSelector: '.confirm-modal-card',
    variant: 'compact',
    semantic: 'check',
    titleId: 'confirmModalTitle',
    descriptionId: 'confirmModalMessage',
  });
  if (confirm?.title) {
    const syncConfirmIcon = () => replaceWorkflowIcon(
      confirm.card,
      workflowSemanticFromLabel(confirm.title.textContent, 'check'),
      'ui-icon workflow-dialog-icon',
    );
    syncConfirmIcon();
    new MutationObserver(syncConfirmIcon).observe(confirm.title, { childList: true, characterData: true, subtree: true });
  }
  document.getElementById('confirmModalChoiceRow')?.classList.add('workflow-choice-row');

  const coast = normalizeWorkflowDialog({
    modalId: 'coastReconciliationModal',
    cardSelector: '.coast-reconciliation-card',
    variant: 'wide',
    semantic: 'coastline',
    titleId: 'coastReconciliationTitle',
    descriptionId: 'coastReconciliationMessage',
  });
  coast?.card.classList.add('workflow-dialog--decision');
  for (const [id, detail] of Object.entries(COAST_DECISION_DETAIL_BY_ID)) {
    const button = document.getElementById(id);
    if (!(button instanceof HTMLButtonElement)) continue;
    button.classList.add('workflow-decision-option');
    if (!button.querySelector('.workflow-option-detail')) {
      const help = document.createElement('span');
      help.className = 'workflow-option-detail';
      help.textContent = detail;
      button.appendChild(help);
    }
  }
  document.getElementById('coastReconciliationCancelBtn')?.classList.add('workflow-decision-cancel');
}

function addDialogHeaderIcon(modalId, semantic, className) {
  const header = document.querySelector(`#${modalId} .ui-dialog-header`);
  if (!(header instanceof HTMLElement) || header.querySelector(`:scope > .${className}`)) return;
  header.prepend(createSemanticIcon(document, semantic, `ui-icon ${className}`));
}

function normalizeLibraryPresentation() {
  const card = document.querySelector('#historicalLibraryModal .historical-library-card');
  if (card instanceof HTMLElement) card.classList.add('library-workflow-card');
  addDialogHeaderIcon('historicalLibraryModal', 'library', 'library-dialog-icon');
  document.getElementById('historicalLibraryPreview')?.classList.remove('ui-card');
}

function bindVisualStepper({ modalId, indicatorId }) {
  const modal = document.getElementById(modalId);
  const stepper = modal?.querySelector('.gis-stepper');
  const indicator = document.getElementById(indicatorId);
  if (!(stepper instanceof HTMLOListElement) || !(indicator instanceof HTMLElement)) return;
  const sync = () => {
    const match = String(indicator.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    const current = Math.max(0, (Number(match?.[1]) || 1) - 1);
    Array.from(stepper.children).forEach((item, index) => {
      item.classList.toggle('is-current', index === current);
      item.classList.toggle('is-complete', index < current);
      if (index === current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  };
  sync();
  new MutationObserver(sync).observe(indicator, { childList: true, characterData: true, subtree: true });
}

function bindGisExportFormat() {
  const select = document.getElementById('gisExportFormat');
  const list = document.querySelector('.gis-export-format-list');
  if (!(select instanceof HTMLSelectElement) || !(list instanceof HTMLElement)) return;
  if (list.dataset.bound === 'true') return;
  list.dataset.bound = 'true';

  for (const radio of list.querySelectorAll('input[type="radio"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      select.value = radio.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  const sync = () => {
    list.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.checked = radio.value === select.value;
    });
  };
  sync();
  select.addEventListener('change', sync);
}

function constrainGenericFallbackUi() {
  const form = document.getElementById('genericFeatureProperties');
  if (form) form.dataset.genericFeatureMode = 'fallback';
  for (const id of ['genericFeatureLandRelationSection', 'genericFeatureLandActionsSection']) {
    const section = document.getElementById(id);
    if (!section) continue;
    section.hidden = false;
    section.removeAttribute('aria-hidden');
    delete section.dataset.legacyGenericSemantics;
  }
}

function normalizeEmptyConditionalSurfaces() {
  for (const selector of ['.gis-import-status', '.territorial-type-impact', '.ui-callout', '.ui-alert']) {
    document.querySelectorAll(selector).forEach(node => {
      if (!node.textContent?.trim() && !node.children.length) node.hidden = true;
    });
  }
}

export function initializeUiRuntime(documentRef = document) {
  if (initialized) return;
  initialized = true;
  installBoundaryGhostingGuard();
  installObjectRegistryPresenter();
  normalizeMapEditingWorkflow();
  normalizeEditingDialogs();
  normalizeLibraryPresentation();
  bindVisualStepper({ modalId: 'gisImportModal', indicatorId: 'gisStepIndicator' });
  bindVisualStepper({ modalId: 'gisExportModal', indicatorId: 'gisExportStepIndicator' });
  bindGisExportFormat();
  installMobileSheetController(documentRef);
  constrainGenericFallbackUi();
  normalizeEmptyConditionalSurfaces();
  const app = documentRef.getElementById('app');
  if (app) app.dataset.uiArchitecture = '2';
}
