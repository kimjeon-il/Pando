/**
 * Loads the canonical built-in mesh through the same data-loader worker used
 * at startup.  It intentionally owns no decoded mesh or Cache Storage entry:
 * the renderer owns those resources and the worker owns validation/caching.
 */
export function createBuiltinMeshResourceLoader({ runtimeAssetUrl, WorkerClass = Worker } = {}) {
  if (typeof runtimeAssetUrl !== 'function') throw new TypeError('runtimeAssetUrl is required for the built-in mesh loader.');
  let pending = null;
  let cancelPending = null;
  let disposed = false;
  const cancellation = () => Object.assign(new Error('Built-in mesh loader disposed'), { name: 'AbortError' });

  function load(countryIds = []) {
    if (disposed) return Promise.reject(cancellation());
    if (pending) return pending;
    const ids = [...countryIds].map(String).filter(Boolean);
    if (!ids.length) return Promise.reject(new Error('내장 메시 국가 ID가 준비되지 않았습니다.'));
    pending = new Promise((resolve, reject) => {
      const worker = new WorkerClass(runtimeAssetUrl('workers/data-loader-worker.js?mode=builtin-mesh-only'), {
        type: 'module',
        name: 'pandolab-builtin-mesh-resource',
      });
      let live = true;
      const dispose = () => {
        if (!live) return;
        live = false; worker.terminate(); cancelPending = null;
      };
      cancelPending = () => { dispose(); reject(cancellation()); };
      worker.onmessage = event => {
        if (!live || disposed) return;
        const message = event.data || {};
        if (message.type === 'builtin-mesh-loader-ready') {
          worker.postMessage({ type: 'load-builtin-mesh', countryIds: ids });
          return;
        }
        if (message.type === 'builtin-mesh-ready') {
          dispose();
          resolve(Object.freeze({
            meshBuffer: message.meshBuffer,
            preparedStroke: message.preparedStroke,
            spatialBlocks: message.spatialBlocks,
            identity: message.identity || null,
          }));
          return;
        }
        if (message.type === 'builtin-mesh-error') {
          dispose();
          reject(new Error(message.message || '내장 기본 메시를 준비하지 못했습니다.'));
        }
      };
      worker.onerror = event => {
        if (!live || disposed) return;
        dispose();
        reject(new Error(event.message || '내장 기본 메시 Worker 오류'));
      };
    });
    pending = pending.catch(error => {
      pending = null;
      throw error;
    });
    return pending;
  }

  return Object.freeze({ load, dispose() {
    if (disposed) return;
    disposed = true;
    cancelPending?.(); cancelPending = null; pending = null;
  } });
}
