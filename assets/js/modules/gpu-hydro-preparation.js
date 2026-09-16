import { createGpuResourceLifecycle } from './gpu-resource-lifecycle.js';
import { createHydroTileWindow, hydroTileSpecsForWindow } from './hydro-tile-window.js';
import { createHydroViewRequests } from './hydro-view-requests.js';

// Owns hydro transport, revision gates, RPC settlement, pack cache and upload
// lifetimes. Application feature registration and UI presentation are callbacks.
export function createGpuHydroPreparation({ createWorker, getMode, getView, getCacheBudget, getProtectedPackIds,
  isMobile, DATA_REVISION, ASSET_REVISION, registerHydroFragments, registerHydroDescriptors, unregisterHydroFragments,
  queueHydroRender, reportOperationError, setActionStatus, onReset, onConnect, onLoadState }) {
  const lifecycle = createGpuResourceLifecycle();
  const metrics = { hydroUploadBytes: 0, hydroTileWindowRecomputeCount: 0, hydroTileWindowCacheHitCount: 0, hydroViewRequestCount: 0 };
  const loadState = {};
  let disposed = false, gl = null, glVersion = 0, projectGeneration = 0, renderDeviceContextRevision = 0, uploadScheduler = null, stagingSequence = 0, uploadEpoch = 0;
  const isWebGlRenderer = () => !!gl;
    let hydroManifest = null;
    let hydroManifestUrl = null;
    let hydroWorker = null;
    let hydroWorkerReady = false;
    let hydroWorkerGeneration = 0;
    let hydroWorkerIncludesGeometry = false;
    let hydroWorkerReadyPromise = Promise.resolve(false);
    let hydroWorkerReadyResolve = null;
    let hydroWorkerReadyTimer = 0;
    let hydroViewRequestedRevision = 0;
    const hydroViewRequests = createHydroViewRequests({
      retry: () => requestHydroView(),
      onSuppressed: () => {
        metrics.hydroExhaustedRequestSuppressedCount = Number(metrics.hydroExhaustedRequestSuppressedCount || 0) + 1;
      },
      notify: message => {
        metrics.hydroLastError = message.diagnostic || null;
        const error = Object.assign(new Error(message.message || ''), { diagnostic: message.diagnostic });
        reportOperationError(error, '현재 화면의 강·호수 데이터를 처리하지 못했습니다. 다시 시도하세요.', 'PL-WATER-003', 4200);
      },
    });
    let hydroRequestRevision = 0;
    let hydroVisibleTileCache = { signature: '', tiles: [], key: '', window: null };
    let hydroAcceptedRevision = 0;
    let hydroActivePackIds = new Set();
    const hydroPacks = new Map();
    let hydroEditEntries = [];
    let hydroEditRevision = -1;
    const hydroFeatureRequests = new Map();
    const hydroLogicalQueryRequests = new Map();
    let hydroFeatureRequestId = 0;
    let hydroCacheCompletionNotified = false;
    function uploadHydroPack(entry, sharedByteBudget = 256 * 1024) {
      if (!gl || !isWebGlRenderer() || entry.resources) return;
      const meshData = entry.mesh;
      if (!entry.uploadState) {
        entry.uploadState = {
          resources: {
            riverSegmentCount: meshData.riverFeatureIds.length,
            borderRiverSegmentCount: meshData.borderRiverFeatureIds.length,
            lakeIndexCount: meshData.lakeIndices.length,
            lakeBoundarySegmentCount: meshData.lakeBoundaryFeatureIds.length,
          },
          tasks: [
            ['riverStartBuffer', meshData.riverStarts, gl.ARRAY_BUFFER, true], ['riverEndBuffer', meshData.riverEnds, gl.ARRAY_BUFFER, true],
            ['riverFeatureBuffer', meshData.riverFeatureIds, gl.ARRAY_BUFFER, true], ['riverStartWidthBuffer', meshData.riverStartWidths, gl.ARRAY_BUFFER],
            ['riverEndWidthBuffer', meshData.riverEndWidths, gl.ARRAY_BUFFER], ['borderRiverStartBuffer', meshData.borderRiverStarts, gl.ARRAY_BUFFER, true],
            ['borderRiverEndBuffer', meshData.borderRiverEnds, gl.ARRAY_BUFFER, true], ['borderRiverFeatureBuffer', meshData.borderRiverFeatureIds, gl.ARRAY_BUFFER, true],
            ['borderRiverStartWidthBuffer', meshData.borderRiverStartWidths, gl.ARRAY_BUFFER], ['borderRiverEndWidthBuffer', meshData.borderRiverEndWidths, gl.ARRAY_BUFFER],
            ['lakePositionBuffer', meshData.lakePositions, gl.ARRAY_BUFFER, true], ['lakeFeatureBuffer', meshData.lakeFeatureIds, gl.ARRAY_BUFFER, true],
            ['lakeIndexBuffer', meshData.lakeIndices, gl.ELEMENT_ARRAY_BUFFER],
            ['lakeBoundaryStartBuffer', meshData.lakeBoundaryStarts, gl.ARRAY_BUFFER, true], ['lakeBoundaryEndBuffer', meshData.lakeBoundaryEnds, gl.ARRAY_BUFFER, true],
            ['lakeBoundaryFeatureBuffer', meshData.lakeBoundaryFeatureIds, gl.ARRAY_BUFFER, true], ['lakeBoundaryStartWidthBuffer', meshData.lakeBoundaryWidths, gl.ARRAY_BUFFER],
            ['lakeBoundaryEndWidthBuffer', meshData.lakeBoundaryWidths, gl.ARRAY_BUFFER],
          ].map(([key, data, target, webGl1Float]) => ({ key, data, target, webGl1Float, offset: 0, buffer: null })),
        };
      }
      const task = entry.uploadState.tasks[0];
      if (task) {
        const convertToFloat = task.webGl1Float && glVersion === 1 && !(task.data instanceof Float32Array);
        const outputBytes = convertToFloat ? task.data.length * 4 : task.data.byteLength;
        if (!task.buffer) {
          task.buffer = lifecycle.create(gl, 'Buffer');
          gl.bindBuffer(task.target, task.buffer);
          gl.bufferData(task.target, outputBytes, gl.STATIC_DRAW);
          entry.uploadState.resources[task.key] = task.buffer;
          return;
        } else {
          gl.bindBuffer(task.target, task.buffer);
        }
        const byteBudget = sharedByteBudget;
        if (convertToFloat) {
          const start = Math.floor(task.offset / 4);
          const count = Math.min(task.data.length - start, Math.floor(byteBudget / 4));
          const chunk = Float32Array.from(task.data.subarray(start, start + count));
          gl.bufferSubData(task.target, task.offset, chunk);
          task.offset += chunk.byteLength;
          metrics.hydroUploadBytes += chunk.byteLength;
        } else {
          const count = Math.min(outputBytes - task.offset, byteBudget);
          const chunk = new Uint8Array(task.data.buffer, task.data.byteOffset + task.offset, count);
          gl.bufferSubData(task.target, task.offset, chunk);
          task.offset += count;
          metrics.hydroUploadBytes += count;
        }
        if (task.offset >= outputBytes) entry.uploadState.tasks.shift();
      }
      if (!entry.uploadState.tasks.length) {
        entry.resources = entry.uploadState.resources;
        entry.uploadState = null;
      }
    }

    function deleteHydroPackResources(entry) {
      if (!entry) return;
      if (entry.uploadKey) { const key = entry.uploadKey; entry.uploadKey = null; uploadScheduler?.cancelKey(key); }
      entry.uploadQueued = false;
      if (!gl) return;
      if (entry.uploadState?.resources) {
        for (const buffer of Object.values(entry.uploadState.resources)) {
          if (buffer && gl.isBuffer(buffer)) lifecycle.release(buffer);
        }
      }
      entry.uploadState = null;
      if (!entry.resources) return;
      for (const key of [
        'riverStartBuffer', 'riverEndBuffer', 'riverFeatureBuffer', 'riverStartWidthBuffer', 'riverEndWidthBuffer',
        'borderRiverStartBuffer', 'borderRiverEndBuffer', 'borderRiverFeatureBuffer', 'borderRiverStartWidthBuffer', 'borderRiverEndWidthBuffer',
        'lakePositionBuffer', 'lakeFeatureBuffer', 'lakeIndexBuffer',
        'lakeBoundaryStartBuffer', 'lakeBoundaryEndBuffer', 'lakeBoundaryFeatureBuffer', 'lakeBoundaryStartWidthBuffer', 'lakeBoundaryEndWidthBuffer',
      ]) {
        if (entry.resources[key]) lifecycle.release(entry.resources[key]);
      }
      entry.resources = null;
    }

    function scheduleHydroUpload(entry) {
      if (disposed || !gl || !entry || entry.resources || entry.uploadQueued || !uploadScheduler) return;
      entry.uploadQueued = true;
      const generation = projectGeneration, contextGeneration = renderDeviceContextRevision;
      const epoch = uploadEpoch;
      const key = 'hydro:' + (++stagingSequence); entry.uploadKey = key;
      void uploadScheduler.enqueueUpload({
        key, projectGeneration: generation, contextGeneration, priority: 40,
        dispose: () => { entry.uploadKey = null; entry.uploadQueued = false; deleteHydroPackResources(entry); },
        step: ({ byteBudget }) => {
          if (disposed || epoch !== uploadEpoch || generation !== projectGeneration || contextGeneration !== renderDeviceContextRevision) throw Object.assign(new Error('Stale hydro upload'), { name: 'AbortError' });
          const before = metrics.hydroUploadBytes;
          uploadHydroPack(entry, byteBudget);
          if (entry.resources) { entry.uploadKey = null; entry.uploadQueued = false; queueHydroRender('hydro-upload-ready'); }
          return { bytes: metrics.hydroUploadBytes - before, done: !!entry.resources };
        },
      }).catch(error => { if (error.name !== 'AbortError') console.warn('Hydro upload failed', error); });
    }

    function requestHydroView(viewState = getView()) {
      if (!hydroWorker || !hydroWorkerReady || !hydroManifest) return;
      const tileWindow = createHydroTileWindow({ manifest: hydroManifest, ...viewState });
      if (hydroVisibleTileCache.signature !== tileWindow.signature) {
        const tiles = hydroTileSpecsForWindow(tileWindow);
        hydroVisibleTileCache = {
          signature: tileWindow.signature,
          tiles,
          key: tiles.map(spec => `${spec.stage}/${spec.x}-${spec.y}`).join('|'),
          window: tileWindow,
        };
        metrics.hydroTileWindowRecomputeCount += 1;
      } else {
        metrics.hydroTileWindowCacheHitCount += 1;
      }
      const { tiles, key } = hydroVisibleTileCache;
      if (!hydroViewRequests.start(key, hydroRequestRevision + 1)) return;
      hydroViewRequestedRevision = ++hydroRequestRevision;
      loadState.hydroView = 'loading'; onLoadState({ ...loadState });
      metrics.hydroViewRequestCount += 1;
      hydroWorker.postMessage({
        type: 'view',
        revision: hydroViewRequestedRevision,
        tiles,
        mobile: isMobile(),
      });
    }

    function loadHydroLogicalFeature(logicalFid) {
      if (!hydroWorker || !hydroWorkerReady) return Promise.reject(new Error('강·호수 로더가 준비되지 않았습니다.'));
      const requestId = ++hydroFeatureRequestId;
      return new Promise((resolve, reject) => {
        hydroFeatureRequests.set(requestId, { resolve, reject });
        hydroWorker.postMessage({ type: 'load-feature', requestId, logicalFid });
      });
    }

    function queryHydroLogicalFeatures(bounds, { category = 'river' } = {}) {
      if (!hydroWorker || !hydroWorkerReady) return Promise.reject(new Error('강·호수 로더가 준비되지 않았습니다.'));
      const requestId = ++hydroFeatureRequestId;
      return new Promise((resolve, reject) => {
        hydroLogicalQueryRequests.set(requestId, { resolve, reject });
        hydroWorker.postMessage({ type: 'query-logical-features', requestId, bounds, category });
      });
    }

    function retryHydroCache() {
      if (!hydroViewRequests.retryCurrent()) return;
      hydroWorker?.postMessage({ type: 'retry-cache' });
      requestHydroView();
    }

    function receiveHydroWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        hydroWorkerReady = true;
        hydroViewRequests.reset();
        loadState.hydroWorker = 'ready';
        if (hydroWorkerReadyTimer) lifecycle.cancelTimeout(hydroWorkerReadyTimer);
        hydroWorkerReadyTimer = 0;
        hydroWorkerReadyResolve?.(true);
        hydroWorkerReadyResolve = null;
        requestHydroView();
        return;
      }
      if (message.type === 'init-error') {
        hydroWorkerReady = false;
        loadState.hydroWorker = 'error';
        if (hydroWorkerReadyTimer) lifecycle.cancelTimeout(hydroWorkerReadyTimer);
        hydroWorkerReadyTimer = 0;
        hydroWorkerReadyResolve?.(false);
        hydroWorkerReadyResolve = null;
        hydroWorker?.terminate();
        hydroWorker = null;
        console.warn('Hydro worker initialization failed', message.message);
        return;
      }
      if (message.type === 'view-ready') {
        const revision = Number(message.revision || 0);
        if (!hydroViewRequests.ready(revision)) return;
        loadState.hydroView = 'ready';
        return;
      }
      if (message.type === 'view-error') {
        const revision = Number(message.revision || 0);
        const phase = hydroViewRequests.fail(revision, message);
        if (!phase) return;
        loadState.hydroView = phase === 'retry-wait' ? 'retrying' : 'error';
        return;
      }
      if (message.type === 'active') {
        if (Number(message.revision || 0) < hydroAcceptedRevision) return;
        hydroAcceptedRevision = Number(message.revision || hydroAcceptedRevision);
        hydroActivePackIds = new Set(message.packIds || []);
        pruneHydroCache();
        queueHydroRender();
        return;
      }
      if (message.type === 'pack') {
        if (Number(message.revision || 0) < hydroAcceptedRevision) return;
        const meshData = message.mesh || {};
        const features = message.features || [];
        const descriptors = message.descriptors || [];
        const entry = {
          id: Number(message.packId), features, descriptors, resources: null, uploadQueued: false, lastUsed: performance.now(),
          mesh: {
            riverStarts: new Int32Array(meshData.riverStarts || 0),
            riverEnds: new Int32Array(meshData.riverEnds || 0),
            riverFeatureIds: new Uint32Array(meshData.riverFeatureIds || 0),
            riverStartWidths: new Float32Array(meshData.riverStartWidths || 0),
            riverEndWidths: new Float32Array(meshData.riverEndWidths || 0),
            borderRiverStarts: new Int32Array(meshData.borderRiverStarts || 0),
            borderRiverEnds: new Int32Array(meshData.borderRiverEnds || 0),
            borderRiverFeatureIds: new Uint32Array(meshData.borderRiverFeatureIds || 0),
            borderRiverStartWidths: new Float32Array(meshData.borderRiverStartWidths || 0),
            borderRiverEndWidths: new Float32Array(meshData.borderRiverEndWidths || 0),
            lakePositions: new Int32Array(meshData.lakePositions || 0),
            lakeFeatureIds: new Uint32Array(meshData.lakeFeatureIds || 0),
            lakeIndices: new Uint32Array(meshData.lakeIndices || 0),
            lakeBoundaryStarts: new Int32Array(meshData.lakeBoundaryStarts || 0),
            lakeBoundaryEnds: new Int32Array(meshData.lakeBoundaryEnds || 0),
            lakeBoundaryFeatureIds: new Uint32Array(meshData.lakeBoundaryFeatureIds || 0),
            lakeBoundaryWidths: new Float32Array(meshData.lakeBoundaryWidths || 0),
          },
        };
        entry.byteLength = Object.values(entry.mesh).reduce((sum, value) => sum + value.byteLength, 0);
        const previous = hydroPacks.get(entry.id);
        if (previous) deleteHydroPackResources(previous);
        hydroPacks.set(entry.id, entry);
        if (features.length) registerHydroFragments(features);
        else registerHydroDescriptors(descriptors);
        if (isWebGlRenderer()) scheduleHydroUpload(entry);
        pruneHydroCache();
        return;
      }
      if (message.type === 'feature' || message.type === 'feature-error') {
        const pending = hydroFeatureRequests.get(Number(message.requestId));
        if (!pending) return;
        hydroFeatureRequests.delete(Number(message.requestId));
        if (message.type === 'feature-error') pending.reject(new Error(message.message || '강·호수 전체 형상을 불러오지 못했습니다.'));
        else pending.resolve(message.feature || null);
        return;
      }
      if (message.type === 'logical-features' || message.type === 'logical-features-error') {
        const pending = hydroLogicalQueryRequests.get(Number(message.requestId));
        if (!pending) return;
        hydroLogicalQueryRequests.delete(Number(message.requestId));
        if (message.type === 'logical-features-error') pending.reject(new Error(message.message || '수계 후보를 찾지 못했습니다.'));
        else pending.resolve((message.logicalFids || []).map(Number).filter(Number.isFinite));
        return;
      }
      if (message.type === 'cache-progress') {
        loadState.hydroCache = 'loading';
        loadState.hydroCachePercent = Number(message.percent || 0);
        return;
      }
      if (message.type === 'cache-complete') {
        loadState.hydroCache = 'ready';
        loadState.hydroCachePercent = 100;
        if (!hydroCacheCompletionNotified) {
          hydroCacheCompletionNotified = true;
          setActionStatus('전 세계 강·호수 데이터를 오프라인 저장소에 준비했습니다.', 'success', 3200);
        }
        return;
      }
      if (message.type === 'cache-unavailable') {
        loadState.hydroCache = 'unavailable';
        console.warn('Hydro persistent cache unavailable', message.message);
        return;
      }
      if (message.type === 'error') {
        console.warn('Hydro tile worker failed', message.message);
        if (!hydroWorkerReady) {
          loadState.hydroWorker = 'error';
          if (hydroWorkerReadyTimer) lifecycle.cancelTimeout(hydroWorkerReadyTimer);
          hydroWorkerReadyTimer = 0;
          hydroWorkerReadyResolve?.(false);
          hydroWorkerReadyResolve = null;
          hydroWorker?.terminate();
          hydroWorker = null;
        } else {
          reportOperationError(new Error(message.message || ''), '강·호수 처리 중 오류가 발생했습니다. 현재 지도는 계속 사용할 수 있습니다.', 'PL-WATER-003', 4200);
        }
      }
    }

    function pruneHydroCache() {
      const limit = Math.max(8 * 1024 * 1024, Number(getCacheBudget()) || (isMobile() ? 48 : 96) * 1024 * 1024);
      let total = [...hydroPacks.values()].reduce((sum, entry) => sum + entry.byteLength, 0);
      if (total <= limit) return;
      const selectedPacks = new Set(getProtectedPackIds());
      const candidates = [...hydroPacks.values()]
        .filter(entry => !hydroActivePackIds.has(entry.id) && !selectedPacks.has(entry.id))
        .sort((left, right) => left.lastUsed - right.lastUsed);
      const released = [];
      for (const entry of candidates) {
        if (total <= limit) break;
        deleteHydroPackResources(entry);
        hydroPacks.delete(entry.id);
        unregisterHydroFragments(entry.features);
        total -= entry.byteLength;
        released.push(entry.id);
      }
      if (released.length) hydroWorker?.postMessage({ type: 'release', packIds: released });
    }

    function setHydroManifest(nextManifest, sourceUrl) {
      if (disposed) return Promise.resolve(false);
      const normalizedManifest = nextManifest?.stages?.length ? nextManifest : null;
      const normalizedUrl = sourceUrl ? new URL(sourceUrl) : null;
      const wantedIncludeGeometry = getMode() === 'canvas2d';
      const sameManifest = hydroManifest === normalizedManifest
        && String(hydroManifestUrl || '') === String(normalizedUrl || '');

      if (sameManifest && hydroWorker && hydroWorkerIncludesGeometry === wantedIncludeGeometry) {
        onConnect();
        return hydroWorkerReady ? Promise.resolve(true) : hydroWorkerReadyPromise;
      }

      hydroManifest = normalizedManifest;
      hydroManifestUrl = normalizedUrl;
      hydroWorkerGeneration += 1;
      const generation = hydroWorkerGeneration;
      hydroWorker?.terminate();
      hydroWorker = null;
      hydroWorkerReady = false;
      hydroWorkerIncludesGeometry = wantedIncludeGeometry;
      hydroViewRequestedRevision = 0;
      hydroViewRequests.reset();
      hydroVisibleTileCache = { signature: '', tiles: [], key: '', window: null };
      hydroAcceptedRevision = 0;
      hydroActivePackIds.clear();
      queueHydroRender('hydro-manifest');
      for (const entry of hydroPacks.values()) deleteHydroPackResources(entry);
      hydroPacks.clear();
      for (const entry of hydroEditEntries) deleteHydroPackResources(entry);
      hydroEditEntries = [];
      hydroEditRevision = -1;
      onReset();
      for (const pending of hydroFeatureRequests.values()) pending.reject(new Error('강·호수 로더가 다시 시작되었습니다.'));
      hydroFeatureRequests.clear();
      for (const pending of hydroLogicalQueryRequests.values()) pending.reject(new Error('강·호수 로더가 다시 시작되었습니다.'));
      hydroLogicalQueryRequests.clear();

      if (hydroWorkerReadyTimer) lifecycle.cancelTimeout(hydroWorkerReadyTimer);
      hydroWorkerReadyTimer = 0;
      hydroWorkerReadyResolve?.(false);
      hydroWorkerReadyResolve = null;

      if (!hydroManifest || !hydroManifestUrl || typeof Worker !== 'function') {
        hydroWorkerReadyPromise = Promise.resolve(false);
        return hydroWorkerReadyPromise;
      }

      loadState.hydroWorker = 'starting';
      hydroWorkerReadyPromise = new Promise(resolve => { hydroWorkerReadyResolve = resolve; });
      hydroWorker = createWorker();
      hydroWorker.onmessage = event => {
        if (generation !== hydroWorkerGeneration) return;
        receiveHydroWorkerMessage(event); onLoadState({ ...loadState });
      };
      hydroWorker.onerror = event => {
        if (generation !== hydroWorkerGeneration) return;
        receiveHydroWorkerMessage({ data: { type: 'error', message: event.message || '강·호수 Worker 실행 오류' } }); onLoadState({ ...loadState });
      };
      const hydroRevision = `${DATA_REVISION || ASSET_REVISION}-${String(hydroManifest.index?.sha256 || '').slice(0, 12)}`;
      hydroWorker.postMessage({
        type: 'init',
        manifest: hydroManifest,
        baseUrl: new URL('./', hydroManifestUrl).href,
        assetRevision: hydroRevision,
        dataRevision: DATA_REVISION || hydroRevision,
        includeGeometry: wantedIncludeGeometry,
      });
      hydroWorkerReadyTimer = lifecycle.timeout(() => {
        if (generation !== hydroWorkerGeneration || hydroWorkerReady) return;
        loadState.hydroWorker = 'error';
        hydroWorker?.terminate();
        hydroWorker = null;
        hydroWorkerGeneration += 1;
        hydroWorkerReadyResolve?.(false);
        hydroWorkerReadyResolve = null; onLoadState({ ...loadState });
      }, 30000);
      onConnect(); onLoadState({ ...loadState });
      return hydroWorkerReadyPromise;
    }


  function resetGpu() {
    uploadEpoch++;
    for (const entry of [...hydroPacks.values(), ...hydroEditEntries]) deleteHydroPackResources(entry);
    lifecycle.releaseContext(gl);
    gl = null;
  }
  function setContext(context) {
    resetGpu();
    ({ gl, version: glVersion, projectGeneration, contextGeneration: renderDeviceContextRevision, scheduler: uploadScheduler } = context);
    for (const entry of [...hydroPacks.values(), ...hydroEditEntries]) scheduleHydroUpload(entry);
  }
  function replaceEdits(entries, revision) {
    for (const entry of hydroEditEntries) deleteHydroPackResources(entry);
    hydroEditEntries = entries;
    hydroEditRevision = revision;
    if (gl) for (const entry of entries) scheduleHydroUpload(entry);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; hydroWorkerGeneration++;
    hydroWorker?.terminate(); hydroWorker = null; hydroWorkerReady = false;
    hydroWorkerReadyResolve?.(false); hydroWorkerReadyResolve = null;
    hydroViewRequests.reset();
    const error = new DOMException('Renderer disposed', 'AbortError');
    for (const pending of [...hydroFeatureRequests.values(), ...hydroLogicalQueryRequests.values()]) pending.reject(error);
    hydroFeatureRequests.clear(); hydroLogicalQueryRequests.clear();
    resetGpu(); lifecycle.dispose(); hydroPacks.clear(); hydroEditEntries = []; hydroActivePackIds.clear();
  }
  return Object.freeze({
    setManifest: setHydroManifest, requestView: requestHydroView, loadFeature: loadHydroLogicalFeature, queryFeatures: queryHydroLogicalFeatures,
    retry: retryHydroCache, setContext, resetGpu, replaceEdits, dispose,
    restart() { hydroWorker?.terminate(); hydroWorker = null; return setHydroManifest(hydroManifest, hydroManifestUrl); },
    connectPort(port) { hydroWorker?.postMessage({ type: 'hydro-port', port }, [port]); },
    setInteraction(active) { hydroWorker?.postMessage({ type: 'interaction', active }); },
    hasWorker: () => !!hydroWorker,
    get manifest() { return hydroManifest; }, get sourceUrl() { return hydroManifestUrl; },
    get editRevision() { return hydroEditRevision; }, get acceptedRevision() { return hydroAcceptedRevision; },
    activeIds: () => [...hydroActivePackIds], pack: id => hydroPacks.get(id), entries: () => [...hydroPacks.values()], editEntries: () => [...hydroEditEntries],
    metrics: () => ({ ...metrics, hydroTileWindowSignature: hydroVisibleTileCache.signature }),
    stats: () => ({ ...metrics, hydroTileWindowSignature: hydroVisibleTileCache.signature, hydroPacksLoaded: hydroPacks.size,
      hydroPacksActive: hydroActivePackIds.size, hydroEditRevision, hydroEditBatchCount: hydroEditEntries.length,
      hydroCacheBytes: [...hydroPacks.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0) }),
  });
}
