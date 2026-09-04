import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';
import { installObjectRegistryPresenter } from './object-registry-presenter.js';
import { installMobileSheetController } from './mobile-sheet-controller.js';
import { installRuntimePerformanceMetrics } from './runtime-performance-metrics.js';

let initialized = false;

function bindVisualStepper({ modalId, indicatorId }) {
  const modal = document.getElementById(modalId);
  const stepper = modal?.querySelector('.gis-stepper');
  const indicator = document.getElementById(indicatorId);
  if (stepper?.tagName !== 'OL' || !(indicator instanceof HTMLElement)) return;
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
  if (select?.tagName !== 'SELECT' || !(list instanceof HTMLElement)) return;
  if (list.dataset.bound === 'true') return;
  const EventCtor = select.ownerDocument.defaultView?.Event;
  if (typeof EventCtor !== 'function') return;
  list.dataset.bound = 'true';

  for (const radio of list.querySelectorAll('input[type="radio"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      select.value = radio.value;
      select.dispatchEvent(new EventCtor('change', { bubbles: true }));
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

export function initializeUiRuntime(documentRef = document) {
  if (initialized) return;
  initialized = true;
  installRuntimePerformanceMetrics({ globalObject: window, documentRef });
  installBoundaryGhostingGuard();
  installObjectRegistryPresenter();
  bindVisualStepper({ modalId: 'gisImportModal', indicatorId: 'gisStepIndicator' });
  bindVisualStepper({ modalId: 'gisExportModal', indicatorId: 'gisExportStepIndicator' });
  bindGisExportFormat();
  installMobileSheetController(documentRef);
  constrainGenericFallbackUi();
  const app = documentRef.getElementById('app');
  if (app) app.dataset.uiArchitecture = '2';
}
