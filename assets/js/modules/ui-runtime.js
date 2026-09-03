import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';
import { installObjectRegistryPresenter } from './object-registry-presenter.js';
import { createSemanticIcon } from './icon-utils.js';
import { installMobileSheetController } from './mobile-sheet-controller.js';

const COMMAND_ROW_ICON_BY_ID = Object.freeze({
  multiBorderEditBtn: 'boundary',
  annexTerritoryBtn: 'transfer',
  mergeCountryBtn: 'merge',
  editBorderBtn: 'boundary',
  editCoastBtn: 'coastline',
  changeCountryTypeBtn: 'transform',
  reassignTerritoryShapeBtn: 'boundary',
  mergeTerritoryBtn: 'merge',
  splitTerritoryBtn: 'split',
  transferTerritoryBtn: 'transfer',
  changeTerritoryTypeBtn: 'transform',
  promoteTerritoryBtn: 'country',
  removeTerritoryDivisionBtn: 'merge',
  reassignAdministrativeShapeBtn: 'boundary',
  reconcileAdministrativeCoastBtn: 'coastline',
  mergeAdministrativeBtn: 'merge',
  splitAdministrativeBtn: 'split',
  transferAdministrativeBtn: 'transfer',
  changeAdministrativeTypeBtn: 'transform',
  promoteAdministrativeBtn: 'country',
  removeAdministrativeDivisionBtn: 'merge',
  reassignRegionShapeBtn: 'boundary',
  mergeRegionBtn: 'merge',
  transferRegionBtn: 'transfer',
  addTerritorialDistributionBtn: 'add',
  addGeometryDistributionBtn: 'boundary',
  editGenericFeatureBoundaryBtn: 'boundary',
  mergeGenericFeatureBtn: 'merge',
  splitGenericFeatureBtn: 'split',
  syncGenericFeatureCoastBtn: 'coastline',
  editGenericFeatureCoastBtn: 'coastline',
  applyGenericFeatureToCountryBtn: 'transfer',
  promoteGenericFeatureToCountryBtn: 'country',
});

const COAST_DECISION_DETAIL_BY_ID = Object.freeze({
  coastReconciliationCountryBtn: '국가 해안선을 기준으로 가져온 영역을 맞춥니다.',
  coastReconciliationAdminBtn: '가져온 영역의 해안선을 기준으로 국가 쪽을 맞춥니다.',
  coastReconciliationIndependentBtn: '두 형상을 변경하지 않고 독립적으로 유지합니다.',
});

const GIS_IMPORT_STEPS = Object.freeze(['파일', '종류', '속성', '적용', '확인']);
const GIS_EXPORT_STEPS = Object.freeze(['데이터', '형식']);
const GIS_EXPORT_FORMAT_HELP = Object.freeze({
  gpkg: '하나의 GIS 패키지 파일로 저장합니다.',
  'geojson-zip': '레이어별 GeoJSON을 ZIP 파일로 저장합니다.',
});

let initialized = false;

function commandRowChevron() {
  return createSemanticIcon(document, 'chevronRight', 'ui-icon command-row-chevron');
}

function normalizeCommandRows() {
  for (const [id, semanticIcon] of Object.entries(COMMAND_ROW_ICON_BY_ID)) {
    const row = document.getElementById(id);
    if (!(row instanceof HTMLElement)) continue;
    row.classList.add('has-command-row-icon');
    const nextIcon = createSemanticIcon(document, semanticIcon, 'ui-icon command-row-icon');
    const currentIcon = row.querySelector(':scope > .command-row-icon');
    if (currentIcon) currentIcon.replaceWith(nextIcon);
    else row.prepend(nextIcon);
    const directIcons = Array.from(row.children).filter(node => node instanceof SVGElement && node !== nextIcon);
    const trailing = directIcons.at(-1);
    if (trailing) trailing.replaceWith(commandRowChevron());
    else row.appendChild(commandRowChevron());
  }
}

function normalizeMapCreateSurfaceLabels() {
  const mapSheetTitle = document.getElementById('mapSheetTitle');
  if (mapSheetTitle) mapSheetTitle.textContent = '지도';
  const mapViewTab = document.getElementById('mapViewTabBtn');
  if (mapViewTab) mapViewTab.textContent = '지도';
  const terrainTitle = document.getElementById('terrainLayerSettingsTitle');
  if (terrainTitle) terrainTitle.textContent = '지형';
  const projectionControl = document.getElementById('projectionControl');
  if (projectionControl) projectionControl.setAttribute('aria-label', '투영법');
}

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
  hud.classList.add('workflow-map-session');
  hud.setAttribute('aria-labelledby', 'modeTaskName');
  hud.removeAttribute('aria-label');
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

function installVisualStepper({ modalId, indicatorId, steps }) {
  const modal = document.getElementById(modalId);
  const card = modal?.querySelector('.ui-dialog-card');
  const header = card?.querySelector(':scope > .ui-dialog-header');
  const indicator = document.getElementById(indicatorId);
  if (!(card instanceof HTMLElement) || !(header instanceof HTMLElement) || !(indicator instanceof HTMLElement)) return;
  let stepper = card.querySelector(':scope > .gis-stepper');
  if (!(stepper instanceof HTMLOListElement)) {
    stepper = document.createElement('ol');
    stepper.className = `gis-stepper gis-stepper--${steps.length}`;
    stepper.setAttribute('aria-label', '진행 단계');
    steps.forEach((label, index) => {
      const item = document.createElement('li');
      item.dataset.stepNumber = String(index + 1);
      item.textContent = label;
      stepper.appendChild(item);
    });
    header.insertAdjacentElement('afterend', stepper);
  }
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

function normalizeLibraryPresentation() {
  const card = document.querySelector('#historicalLibraryModal .historical-library-card');
  if (card instanceof HTMLElement) card.classList.add('library-workflow-card');
  addDialogHeaderIcon('historicalLibraryModal', 'library', 'library-dialog-icon');
}

function normalizeGisExportFormat() {
  const select = document.getElementById('gisExportFormat');
  if (!(select instanceof HTMLSelectElement) || select.dataset.v2RadioPresentation === 'true') return;
  select.dataset.v2RadioPresentation = 'true';
  select.classList.add('gis-export-format-native');
  const host = select.closest('.field-group');
  if (!(host instanceof HTMLElement)) return;
  host.classList.add('gis-export-format-field');
  const list = document.createElement('div');
  list.className = 'gis-export-format-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', '파일 형식');
  for (const option of Array.from(select.options)) {
    const label = document.createElement('label');
    label.className = 'gis-export-format-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'gisExportFormatPresentation';
    radio.value = option.value;
    radio.checked = option.value === select.value;
    const copy = document.createElement('span');
    copy.className = 'gis-export-format-copy';
    const strong = document.createElement('strong');
    strong.textContent = option.textContent;
    const small = document.createElement('small');
    small.textContent = GIS_EXPORT_FORMAT_HELP[option.value] || '';
    copy.append(strong, small);
    label.append(radio, copy);
    list.appendChild(label);
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      select.value = radio.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  host.insertAdjacentElement('afterend', list);
  select.addEventListener('change', () => {
    list.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.checked = radio.value === select.value;
    });
  });
}

function normalizeFileMenuPresentation() {
  const labels = {
    openGisBtn: 'GIS 가져오기',
    saveProjectBtn: '저장',
    dataExportBtn: 'GIS 데이터 내보내기',
  };
  for (const [id, text] of Object.entries(labels)) {
    const button = document.getElementById(id);
    const label = button?.querySelector('span');
    if (label) label.textContent = text;
  }
  document.getElementById('saveProjectBtn')?.classList.add('ghost');
  document.getElementById('dataExportBtn')?.classList.add('file-menu-export-boundary');
}

function removeObsoletePresentationNodes() {
  document.querySelector('.editor-edge-slot')?.remove();
  document.querySelectorAll('.ui-dialog-kicker, .create-toolbar-divider').forEach(node => node.remove());
  document.getElementById('historicalLibraryPreview')?.classList.remove('ui-card');
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
  normalizeCommandRows();
  normalizeMapCreateSurfaceLabels();
  normalizeMapEditingWorkflow();
  normalizeEditingDialogs();
  normalizeLibraryPresentation();
  installVisualStepper({ modalId: 'gisImportModal', indicatorId: 'gisStepIndicator', steps: GIS_IMPORT_STEPS });
  installVisualStepper({ modalId: 'gisExportModal', indicatorId: 'gisExportStepIndicator', steps: GIS_EXPORT_STEPS });
  normalizeGisExportFormat();
  normalizeFileMenuPresentation();
  installMobileSheetController(documentRef);
  removeObsoletePresentationNodes();
  constrainGenericFallbackUi();
  normalizeEmptyConditionalSurfaces();
  const app = documentRef.getElementById('app');
  if (app) app.dataset.uiArchitecture = '2';
}
