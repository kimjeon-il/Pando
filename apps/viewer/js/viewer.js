import { loadVerifiedCore } from '../../../shared/frontend/js/modules/core-wasm-loader.js';
import { isRecoverableLoadError } from '../../../shared/frontend/js/modules/reliability-core.js';

// Preflight owns no map/document. Only after a verified engine exists may the
// application graph evaluate temporal.js and hand startup to its lifecycle.
const status = document.getElementById('viewerStatus');
const controller = new AbortController();
let pending = null, retryPending = false, handedOff = false, coreReady = false, wakeRevision = 0;
const available = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
const wake = () => {
  if (controller.signal.aborted || handedOff || !available()) return;
  wakeRevision++;
  if (retryPending && !pending) start();
};
const pagehide = event => {
  if (!event.persisted) { controller.abort(); detach(); }
};
function detach() {
  for (const type of ['focus', 'online', 'pageshow']) window.removeEventListener(type, wake);
  document.removeEventListener('visibilitychange', wake);
  window.removeEventListener('pagehide', pagehide);
}
function start() {
  if (pending || handedOff || controller.signal.aborted) return pending;
  retryPending = false;
  status.hidden = false;
  status.dataset.ready = 'false';
  status.setAttribute('role', 'status');
  status.textContent = '지도 불러오는 중…';
  const attemptWakeRevision = wakeRevision;
  let importing = false;
  pending = Promise.resolve().then(async () => {
    if (!coreReady) {
      const core = await loadVerifiedCore({ baseUrl: new URL('../wasm/', import.meta.url), signal: controller.signal });
      controller.signal.throwIfAborted();
      globalThis.PandoLabSphericalCore = core;
      coreReady = true;
    }
    importing = true;
    const { composeViewer } = await import('./modules/viewer-composition.js');
    controller.signal.throwIfAborted();
    importing = false;
    handedOff = true;
    detach();
    await composeViewer({ productMode: 'viewer', meta: globalThis.PANDOLAB_BUILD_META });
  }).catch(error => {
    if (controller.signal.aborted) return;
    console.error('[PL-VIEWER-START]', error);
    const importTransportError = importing && error?.name === 'TypeError'
      && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message);
    retryPending = !handedOff && (isRecoverableLoadError(error) || importTransportError);
    status.hidden = false;
    status.setAttribute('role', 'alert');
    status.textContent = retryPending ? '연결이 복구되면 지도를 다시 불러옵니다. ' : '지도를 열지 못했습니다. 새로고침해 다시 시도하세요.';
    if (retryPending) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ui-button btn'; button.textContent = '다시 시도';
      // start contains its error boundary and never replays composed UI.
      button.addEventListener('click', start);
      status.appendChild(button);
    } else detach();
  }).finally(() => {
    pending = null;
    if (retryPending && available() && wakeRevision > attemptWakeRevision) start();
  });
  return pending;
}
for (const type of ['focus', 'online', 'pageshow']) window.addEventListener(type, wake);
document.addEventListener('visibilitychange', wake);
window.addEventListener('pagehide', pagehide);
start();
