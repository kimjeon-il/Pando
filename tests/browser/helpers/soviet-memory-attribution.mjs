import { readFile, readdir } from 'node:fs/promises';

const BYTES_PER_MIB = 1024 * 1024;
const WORKER_TARGET_TYPES = new Set(['worker', 'shared_worker', 'service_worker']);
const CHROMIUM_NAMES = /^(?:chrome|chromium|headless_shell|headless-shell)(?:\s|$)/i;

export function classifyChromiumRole(commandLine) {
  if (commandLine.includes('--type=gpu-process')) return 'gpu';
  if (commandLine.includes('--type=renderer')) return 'renderer';
  if (commandLine.includes('--type=utility')) return 'utility';
  if (commandLine.includes('--type=zygote')) return 'zygote';
  if (commandLine.includes('--type=crashpad-handler')) return 'crashpad';
  return 'browser-other';
}

export function parseSmapsRollup(contents) {
  const value = key => Number(contents.match(new RegExp(`^${key}:\\s*(\\d+)\\s*kB`, 'm'))?.[1] || 0);
  return {
    pssKiB: value('Pss'), rssKiB: value('Rss'), privateDirtyKiB: value('Private_Dirty'),
    privateCleanKiB: value('Private_Clean'), pssAnonKiB: value('Pss_Anon'),
    pssFileKiB: value('Pss_File'), pssShmemKiB: value('Pss_Shmem'), swapPssKiB: value('SwapPss'),
  };
}

export async function chromiumProcessPss({ procRoot = '/proc', platform = process.platform } = {}) {
  if (platform !== 'linux') return { available: false, reason: 'Linux /proc/smaps_rollup only', processes: [] };
  const rows = [];
  for (const pid of (await readdir(procRoot)).filter(name => /^\d+$/.test(name))) {
    try {
      const base = `${procRoot}/${pid}`;
      const comm = (await readFile(base + '/comm', 'utf8')).trim();
      if (!CHROMIUM_NAMES.test(comm)) continue;
      const commandLine = (await readFile(base + '/cmdline', 'utf8')).replaceAll('\0', ' ');
      if (!/(?:chrome|chromium|headless_shell|headless-shell)/i.test(commandLine)) continue;
      const rollup = await readFile(base + '/smaps_rollup', 'utf8');
      const role = classifyChromiumRole(commandLine);
      rows.push({ pid: Number(pid), role, ...parseSmapsRollup(rollup) });
    } catch { /* A detached Chromium target may disappear during sampling. */ }
  }
  rows.sort((a, b) => a.pid - b.pid);
  const summed = (records, key) => records.reduce((sum, row) => sum + row[key], 0);
  const roles = Object.fromEntries(['browser-other', 'renderer', 'gpu', 'utility', 'zygote', 'crashpad'].map(role => {
    const records = rows.filter(row => row.role === role);
    return [role, { count: records.length, pssKiB: summed(records, 'pssKiB'), privateDirtyKiB: summed(records, 'privateDirtyKiB') }];
  }));
  return {
    available: rows.length > 0, accounting: 'process PSS from /proc/smaps_rollup, not per-Worker PSS or VRAM',
    processCount: rows.length, pssKiB: summed(rows, 'pssKiB'),
    pssMiB: Number((summed(rows, 'pssKiB') * 1024 / BYTES_PER_MIB).toFixed(2)),
    privateDirtyKiB: summed(rows, 'privateDirtyKiB'), roles, processes: rows,
  };
}

const errorText = error => String(error?.message || error).slice(0, 220);

// Nested CDP sessions measure each Worker JS heap and live WebAssembly.Memory.
// WASM allocation is linear memory size, not used C++ heap and not process PSS.
// No application code, Worker bootstrap or generated WASM bundle is modified.
export async function createWorkerMemoryProbe(cdp, { origin = 'http://127.0.0.1:4173', timeoutMs = 12_000 } = {}) {
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const attached = new Map();
  const pending = new Map();
  let commandId = 0;
  let closed = false;
  const onNestedMessage = packet => {
    try {
      const message = JSON.parse(packet.message);
      const key = `${packet.sessionId}:${message.id}`;
      const item = pending.get(key);
      if (!item) return;
      pending.delete(key);
      clearTimeout(item.timeout);
      if (message.error) item.reject(new Error(`CDP ${item.method}: ${message.error.message}`));
      else item.resolve(message.result);
    } catch { /* A detached Chromium target may disappear during sampling. */ }
  };
  cdp.on('Target.receivedMessageFromTarget', onNestedMessage);

  async function call(sessionId, method, params = {}) {
    if (closed) throw new Error('Worker CDP probe disposed');
    const id = ++commandId;
    const key = `${sessionId}:${id}`;
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`Timed out in Worker ${method}`));
      }, timeoutMs);
      pending.set(key, { resolve, reject, timeout: timer, method });
    });
    try {
      await cdp.send('Target.sendMessageToTarget', {
        sessionId, message: JSON.stringify({ id, method, params }),
      });
      return await response;
    } catch (error) {
      clearTimeout(timer);
      pending.delete(key);
      response.catch(() => {});
      throw error;
    }
  }

  async function connect(target) {
    const prior = attached.get(target.targetId);
    if (prior) return prior;
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    attached.set(target.targetId, sessionId);
    return sessionId;
  }

  async function wasmLinearMemory(sessionId) {
    // WeakRefs retain observability, NOT the memory itself. Avoid repeatedly
    // scanning a 300+ MiB V8 heap when the current-world Worker is busy.
    const cached = await call(sessionId, 'Runtime.evaluate', {
      expression: '(() => { const refs = globalThis.__PANDOLAB_TEST_WASM_MEMORIES__; if (!Array.isArray(refs) || !refs.length) return null; const memories = refs.map(ref => ref.deref()); return memories.some(memory => !memory) ? null : memories.map(memory => memory.buffer.byteLength); })()',
      returnByValue: true,
    });
    const cachedValues = cached?.result?.value;
    if (Array.isArray(cachedValues)) return {
      available: true, basis: 'previously-observed live WASM memories (WeakRef)',
      instanceCount: cachedValues.length, instanceBytes: cachedValues,
      allocatedBytes: cachedValues.reduce((sum, value) => sum + value, 0),
    };
    const proto = await call(sessionId, 'Runtime.evaluate', {
      expression: 'WebAssembly.Memory.prototype', returnByValue: false,
    });
    const protoId = proto?.result?.objectId;
    if (!protoId) return { available: false, reason: 'WebAssembly.Memory prototype inaccessible' };
    let instancesId = null;
    try {
      const instances = await call(sessionId, 'Runtime.queryObjects', { prototypeObjectId: protoId });
      instancesId = instances?.objects?.objectId;
      if (!instancesId) return { available: false, reason: 'Live WebAssembly.Memory query unavailable' };
      const response = await call(sessionId, 'Runtime.callFunctionOn', {
        objectId: instancesId,
        functionDeclaration: 'function () { const sizes = this.map(memory => memory.buffer.byteLength); if (sizes.length) globalThis.__PANDOLAB_TEST_WASM_MEMORIES__ = this.map(memory => new WeakRef(memory)); return sizes; }',
        returnByValue: true,
      });
      const values = response?.result?.value;
      if (!Array.isArray(values) || values.some(value => !Number.isSafeInteger(value) || value < 0))
        return { available: false, reason: 'WASM memory lengths not representable' };
      return { available: true, instanceCount: values.length,
        instanceBytes: values, allocatedBytes: values.reduce((sum, value) => sum + value, 0) };
    } finally {
      if (instancesId) await call(sessionId, 'Runtime.releaseObject', { objectId: instancesId }).catch(() => {});
      await call(sessionId, 'Runtime.releaseObject', { objectId: protoId }).catch(() => {});
    }
  }


  async function workerDiagnostics(sessionId, path) {
    // Read-only CDP expressions against Worker lexical bindings: no product API or retained objects.
    const expression = path.endsWith('/country-shared-boundary-worker.js')
      ? '(() => { const message = typeof latestMessage === "undefined" ? null : latestMessage; const waiting = typeof queued === "undefined" ? null : queued; const state = typeof boundaryState === "undefined" ? null : boundaryState; return { available: true, kind: "shared-boundary", draining: typeof draining === "undefined" ? null : draining, queued: !!waiting, queuedFeatureCount: waiting?.features?.length ?? null, latestMessageFeatureCount: message?.features?.length ?? null, latestMessageType: message?.type ?? null, latestSequence: typeof latestSequence === "undefined" ? null : latestSequence, stateStats: state?.stats?.() ?? null, pendingCacheSegmentCount: typeof pendingCache === "undefined" ? null : pendingCache?.segments?.length ?? null }; })()'
      : path.endsWith('/map-edit-worker.js')
        ? '(() => ({ available: true, kind: "map-edit", editSourceCount: typeof editSources === "undefined" ? null : editSources.size, boundaryFeatureCount: typeof boundaryFeatures === "undefined" ? null : boundaryFeatures.size, pendingResultCount: typeof pendingResults === "undefined" ? null : pendingResults.size, cutSourceCount: typeof cutSources === "undefined" ? null : cutSources.size, validatedPreviewCount: typeof validatedPreviews === "undefined" ? null : validatedPreviews.size, coastTopologyGeometryCount: typeof coastTopologyCache === "undefined" ? null : coastTopologyCache?.geometries?.length ?? null, dataRevision: typeof currentDataRevision === "undefined" ? null : currentDataRevision }))()'
        : null;
    if (!expression) return null;
    try {
      const response = await call(sessionId, 'Runtime.evaluate', { expression, returnByValue: true });
      return response?.result?.value || { available: false, reason: response?.exceptionDetails?.text || 'Worker lexical binding unavailable' };
    } catch (error) {
      return { available: false, reason: errorText(error) };
    }
  }

  async function sample({ collectGarbage = true } = {}) {
    const targetInfos = (await cdp.send('Target.getTargets')).targetInfos || [];
    const live = targetInfos.filter(target => WORKER_TARGET_TYPES.has(target.type) && target.url.startsWith(origin));
    for (const targetId of [...attached.keys()]) if (!live.some(target => target.targetId === targetId)) {
      const sessionId = attached.get(targetId);
      attached.delete(targetId);
      await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    const workers = [];
    for (const target of live.sort((a, b) => a.url.localeCompare(b.url) || a.targetId.localeCompare(b.targetId))) {
      const info = { targetId: target.targetId, type: target.type, url: new URL(target.url).pathname };
      try {
        const sessionId = await connect(target);
        if (collectGarbage) await call(sessionId, 'HeapProfiler.collectGarbage');
        const js = await call(sessionId, 'Runtime.getHeapUsage');
        info.jsHeap = { available: true, usedBytes: js.usedSize,
          totalBytes: js.totalSize, embedderUsedBytes: js.embedderHeapUsedSize ?? null,
          backingStorageBytes: js.backingStorageSize ?? null };
        info.wasmLinearMemory = await wasmLinearMemory(sessionId);
        info.diagnostics = await workerDiagnostics(sessionId, info.url);
      } catch (error) {
        info.error = errorText(error);
        info.jsHeap ||= { available: false };
        info.wasmLinearMemory ||= { available: false, reason: errorText(error) };
      }
      workers.push(info);
    }
    const sum = key => workers.reduce((total, worker) => total + (worker[key]?.available ? worker[key].usedBytes ?? worker[key].allocatedBytes : 0), 0);
    const jsComplete = workers.every(worker => worker.jsHeap?.available);
    const wasmComplete = workers.every(worker => worker.wasmLinearMemory?.available);
    return {
      count: workers.length, jsComplete, wasmComplete,
      jsUsedBytes: jsComplete ? sum('jsHeap') : null,
      wasmAllocatedBytes: wasmComplete ? sum('wasmLinearMemory') : null,
      workers,
    };
  }

  async function dispose() {
    if (closed) return;
    closed = true;
    cdp.removeListener('Target.receivedMessageFromTarget', onNestedMessage);
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Worker target closed'));
    }
    pending.clear();
    for (const sessionId of attached.values()) await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    attached.clear();
    await cdp.send('Target.setDiscoverTargets', { discover: false }).catch(() => {});
  }
  return { sample, dispose };
}

export function summarizeMemoryPhases(phases) {
  const first = phases[0];
  const last = phases.at(-1);
  const value = (phase, key) => phase?.[key] ?? null;
  const subtract = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
  const delta = (a, b) => ({
    chromiumPssMiB: subtract(value(b.chromium, 'pssMiB'), value(a.chromium, 'pssMiB')),
    mainJsUsedBytes: subtract(value(b.mainJsHeap, 'usedBytes'), value(a.mainJsHeap, 'usedBytes')),
    workerJsUsedBytes: subtract(value(b.workerMemory, 'jsUsedBytes'), value(a.workerMemory, 'jsUsedBytes')),
    workerWasmLinearBytes: subtract(value(b.workerMemory, 'wasmAllocatedBytes'), value(a.workerMemory, 'wasmAllocatedBytes')),
    gpuTrackedBytes: subtract(value(b.gpu, 'trackedBytes'), value(a.gpu, 'trackedBytes')),
  });
  const returns = phases.filter(phase => /^returned-modern-\d+$/.test(phase.label));
  const idle30 = phases.filter(phase => /^idle-modern-\d+-30s$/.test(phase.label));
  return {
    initialToFinal: first && last ? delta(first, last) : null,
    returnToReturn: returns.length > 1 ? delta(returns[0], returns.at(-1)) : null,
    returnedModernPssMiB: returns.map(phase => ({ label: phase.label, value: phase.chromium?.pssMiB ?? null })),
    idle30PssMiB: idle30.map(phase => ({ label: phase.label, value: phase.chromium?.pssMiB ?? null })),
    idle30Trend: idle30.length > 1 ? delta(idle30[0], idle30.at(-1)) : null,
    lastReturnToIdle30: returns.length && idle30.length ? delta(returns.at(-1), idle30.at(-1)) : null,
  };
}
