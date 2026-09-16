import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';
import { installObjectRegistryPresenter } from './object-registry-presenter.js';
import { installMobileSheetController } from './mobile-sheet-controller.js';
import { installRuntimePerformanceMetrics } from './runtime-performance-metrics.js';
import { installSurfaceMetrics } from './surface-metrics.js';
// Carry the runtime revision into this dependency; otherwise Pages can reuse a
// cached scrollbar implementation after the versioned UI runtime has updated.
const scrollbarModuleUrl = new URL('./overlay-scrollbars.js', import.meta.url);
scrollbarModuleUrl.search = new URL(import.meta.url).search;
const { installOverlayScrollbars } = await import(scrollbarModuleUrl.href);

let initialized = false;

function constrainGenericFallbackUi() {
  const form = document.getElementById('genericFeatureProperties');
  if (form) form.dataset.genericFeatureMode = 'conversion-only';
}

export function initializeUiRuntime(documentRef = document) {
  if (initialized) return;
  initialized = true;
  installRuntimePerformanceMetrics({ globalObject: window, documentRef });
  installBoundaryGhostingGuard();
  installObjectRegistryPresenter();
  installMobileSheetController(documentRef);
  installSurfaceMetrics(documentRef);
  installOverlayScrollbars(documentRef);
  constrainGenericFallbackUi();
  const app = documentRef.getElementById('app');
  if (app) app.dataset.uiArchitecture = '2';
}
