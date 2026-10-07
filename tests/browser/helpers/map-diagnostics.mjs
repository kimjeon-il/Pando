// Test-log summaries only. Never pass model geometry, DOM trees or render buffers.
export function boundedDiagnostic(value) {
  const seen = new WeakSet();
  const visit = (item, depth) => {
    if (typeof item === 'string') return item.length > 240 ? `${item.slice(0, 240)}… (${item.length} chars)` : item;
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return '[circular]';
    if (depth >= 8) return '[depth limit]';
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      const items = item.slice(0, 8).map(value => visit(value, depth + 1));
      result = item.length > 8 ? { count: item.length, items } : items;
    } else if (item instanceof Error) {
      result = { name: item.name, message: visit(item.message, depth + 1) };
    } else {
      const entries = Object.entries(item);
      result = Object.fromEntries(entries.slice(0, 40).map(([key, value]) => [key, visit(value, depth + 1)]));
      if (entries.length > 40) result.omittedKeys = entries.length - 40;
    }
    seen.delete(item);
    return result;
  };
  return visit(value, 0);
}

// A stalled page must not hold the original assertion/error hostage. Promise.race
// observes late reader rejection; clear the timer on every settled/deadline path.
export async function withDiagnosticDeadline(read, timeoutMs = 1000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Diagnostic read exceeded ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function logMapDiagnostic(boundary, phase, read, write = console.log) {
  let data;
  try { data = boundedDiagnostic(await withDiagnosticDeadline(read)); }
  catch (error) { data = { diagnosticError: boundedDiagnostic(error) }; }
  try {
    let json = JSON.stringify({ boundary, phase, data });
    if (json.length > 23000) json = JSON.stringify({ boundary, phase, truncated: true, preview: json.slice(0, 3000) });
    write(`[map-diagnostic] ${json}`);
  } catch (_) {
    // Diagnostic output must never replace the workflow's original result/error.
  }
}

export async function withMapDiagnostics(boundary, read, action, write = console.log) {
  await logMapDiagnostic(boundary, 'before', read, write);
  try {
    const result = await action();
    await logMapDiagnostic(boundary, 'after', read, write);
    return result;
  } catch (error) {
    await logMapDiagnostic(boundary, 'failed', read, write);
    throw error;
  }
}

// Test-route source instrumentation; retain the native call and acceptance
// expression verbatim, adding only exception-contained observations afterward.
export function instrumentCanvasTransportSource(source) {
  const send = 'worker.postMessage(...args); return true;';
  const accept = 'const current = Number(message.projectGeneration ?? generation) === generation\n'
    + '      && revision >= requestedRevision && revision >= displayedRevision && acceptFrame(message);';
  for (const marker of [send, accept]) {
    if (source.split(marker).length !== 2) throw new Error('Canvas diagnostic source anchor must occur exactly once');
  }
  return source.replace(send, `worker.postMessage(...args);
    try { window.__recordCanvasTransport('send', args[0], { generation, requestedRevision, displayedRevision, inFlightRenderRequestId }); } catch (_) {}
    return true;`).replace(accept, `${accept}
    try { window.__recordCanvasTransport('frame', message, { current, requestedRevision, displayedRevision, generation, inFlightRenderRequestId }); } catch (_) {}`);
}

// Self-contained for addInitScript. Only copied scalar metadata is retained.
export function installCanvasTransportDiagnostics() {
  const probe = { counts: { sent: 0, frames: 0, observerErrors: 0 }, latestStyle: null, latestView: null,
    latestData: null, styleHistory: [], dataHistory: [], frameDecisions: [] };
  const scalar = value => typeof value === 'string' ? value.slice(0, 160)
    : value === null || ['number', 'boolean'].includes(typeof value) ? value : undefined;
  const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, scalar(value?.[key])]));
  const retain = (history, row) => { history.push(row); if (history.length > 8) history.shift(); };
  window.__canvasTransportProbe = probe;
  window.__recordCanvasTransport = (phase, message, context = {}) => {
    try {
      const row = { at: performance.now(), ...pick(message, ['type', 'renderRequestId', 'frameId', 'revision', 'viewRevision',
        'projectionRevision', 'projectGeneration', 'geometryRevision', 'styleRevision']),
        ...pick(context, ['generation', 'requestedRevision', 'displayedRevision', 'inFlightRenderRequestId']) };
      if (phase === 'send') {
        probe.counts.sent++;
        if (message.type === 'init' || message.type === 'style') {
          row.fillPresent = Object.prototype.hasOwnProperty.call(message.fills || {}, 'TUR');
          row.fill = row.fillPresent ? pick(message.fills.TUR, ['color', 'fillAlpha', 'opacity', 'blendMode', 'ownerId', 'parentId']) : null;
          probe.latestStyle = row;
          retain(probe.styleHistory, row);
        } else if (message.type === 'view') probe.latestView = row;
        else if (['data', 'replace-data', 'patch'].includes(message.type)) {
          row.featureCount = Array.isArray(message.features) ? message.features.length : null;
          probe.latestData = row;
          retain(probe.dataHistory, row);
        }
      } else if (phase === 'frame') {
        probe.counts.frames++;
        Object.assign(row, { current: scalar(context.current), hasBitmap: !!message.bitmap });
        retain(probe.frameDecisions, row);
      }
    } catch (_) { probe.counts.observerErrors++; }
  };
}

export function summarizeStrokeUploadState(resources, pendingUploads, key, expectedSignature) {
  const jobInfo = job => {
    const instancesBytes = Number(job.geometry.instances.byteLength), nodesBytes = Number(job.geometry.nodes.byteLength);
    const totalBytes = instancesBytes + nodesBytes;
    const uploadedBytes = job.part === 0 ? job.offset : job.part === 1 ? instancesBytes + job.offset : totalBytes;
    return { signature: job.signature, part: job.part, offset: job.offset, instancesBytes, nodesBytes,
      totalBytes, uploadedBytes, remainingBytes: Math.max(0, totalBytes - uploadedBytes) };
  };
  const resident = resources.get(key), pending = pendingUploads.get(key);
  const queueOrder = [];
  let position = 0, queuePosition = -1, remainingBytesAhead = 0;
  for (const [queuedKey, job] of pendingUploads) {
    if (queueOrder.length < 8) queueOrder.push(queuedKey);
    if (queuedKey === key) queuePosition = position;
    else if (queuePosition < 0) remainingBytesAhead += jobInfo(job).remainingBytes;
    position++;
  }
  return { key, expectedSignature, hasResource: !!resident, storedSignature: resident?.signature,
    residentBytes: resident?.byteLength || 0, matchesExpected: !!resident && resident.signature === expectedSignature,
    pending: pending ? { ...jobInfo(pending), matchesExpected: pending.signature === expectedSignature } : null,
    queueCount: pendingUploads.size, queueOrder, queuePosition,
    remainingBytesAhead: queuePosition < 0 ? null : remainingBytesAhead };
}

function replaceGpuAnchor(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`GPU diagnostic source anchor must occur exactly once: ${marker.slice(0, 80)}`);
  return source.replace(marker, replacement);
}

export function instrumentSelectionPassSource(source) {
  const marker = 'const result = strokeRenderer.drawBatches([batch], frameContext, { preparedOnly });';
  return replaceGpuAnchor(source, marker, `${marker}
      try { window.__recordGpuStroke('draw', { channel: name, frameId: frameContext?.frameId, viewRevision: frameContext?.viewRevision,
        objectKeys: group.items.slice(0, 8).map(item => item.key), objectCount: group.items.length,
        resourceKey: batch.key, geometryRevision: batch.geometryRevision, lod: batch.lod || 'high',
        ownerIds: batch.ownerIds?.slice(0, 8), ownerCount: batch.ownerIds?.length,
        ownerSegmentCount: batch.ownerIds?.reduce((sum, id) => sum + Number(batch.ownerRanges?.[id]?.count || 0), 0),
        packetSegmentCount: batch.segmentCount, preparedOnly,
        result: { succeeded: result?.succeeded, renderedKeys: result?.renderedKeys?.slice(0, 8),
          missingKeys: result?.missingKeys?.slice(0, 8), failures: result?.failures?.slice(0, 8).map(row => ({ key: row.key, reason: row.reason })) }
      }); } catch (_) {}`);
}

export function instrumentStrokeRendererSource(source) {
  const observe = (type, fields) => `try { window.__recordGpuStroke('${type}', { ${fields} }); } catch (_) {}`;
  let marker = '  const pendingUploads = new Map();';
  source = replaceGpuAnchor(source, marker, `${marker}
  const __strokeDiagnosticSummary = ${summarizeStrokeUploadState.toString()};
  try { window.__readStrokeUploadDiagnostics = requests => ({ at: performance.now(),
    hidden: globalThis.document?.hidden, inputActive: 'unavailable: not re-read', inputPending: 'unavailable: not re-read',
    resources: requests.slice(0, 8).map(({ key, signature }) => __strokeDiagnosticSummary(resources, pendingUploads, key, signature)) }); } catch (_) {}`);
  marker = 'const cancelUploads = () => {';
  source = replaceGpuAnchor(source, marker, `${marker}
    try { for (const [key, job] of [...pendingUploads].slice(0, 8)) window.__recordGpuStroke('cancel-before-clear', {
      reason: 'unknown', ...__strokeDiagnosticSummary(resources, pendingUploads, key, job.signature) }); } catch (_) {}`);
  marker = "}).catch(error => { if (error.name !== 'AbortError') onError?.({ stage: 'stroke-upload', error }); });";
  source = replaceGpuAnchor(source, marker, `}).catch(error => { ${observe('error', "stage: 'stroke-upload', name: error.name, message: error.message")}
      if (error.name !== 'AbortError') onError?.({ stage: 'stroke-upload', error }); });`);
  marker = "    } catch (error) {\n      cancelUploads();\n      onError?.({ stage: 'stroke-staging-upload', error });";
  source = replaceGpuAnchor(source, marker, `    } catch (error) {
      ${observe('error', "stage: 'stroke-staging-upload', name: error.name, message: error.message")}
      cancelUploads();
      onError?.({ stage: 'stroke-staging-upload', error });`);
  marker = 'pendingUploads.set(key, { signature, geometry, priority: packet.priority, part: 0, offset: 0, buffers: [null, null] });';
  source = replaceGpuAnchor(source, marker, `${marker}
        ${observe('enqueue', "replacedSignature: pending?.signature, ...__strokeDiagnosticSummary(resources, pendingUploads, key, signature)")}`);
  marker = 'pendingUploads.delete(key);\n          buildCount += 1;';
  source = replaceGpuAnchor(source, marker, `pendingUploads.delete(key);
          ${observe('complete', 'key, signature: job.signature, totalBytes: resource.byteLength, uploadedBytes: resource.byteLength')}
          buildCount += 1;`);
  marker = 'resources.set(key, resource);\n      resourceBudget.track(key, resource.byteLength, packet?.priority);';
  source = replaceGpuAnchor(source, marker, `resources.set(key, resource);
      ${observe('complete-sync', 'key, signature, totalBytes: resource.byteLength, uploadedBytes: resource.byteLength')}
      resourceBudget.track(key, resource.byteLength, packet?.priority);`);
  marker = "if (!gl || !programs || contextLost || gpuHealth !== 'healthy' || gl.isContextLost?.() || !frameContext) {";
  source = replaceGpuAnchor(source, marker, `${marker}
      ${observe('unavailable', "keys: batches.slice(0, 8).map(batch => batch?.key), hasGl: !!gl, hasPrograms: !!programs, contextLost, gpuHealth, hasFrame: !!frameContext")}`);
  marker = '        : ensureResource(batch);';
  source = replaceGpuAnchor(source, marker, `${marker}
      ${observe('lookup', 'frameId: frameContext?.frameId, viewRevision: frameContext?.viewRevision, preparedOnly, resolved: !!resource, reason, ...__strokeDiagnosticSummary(resources, pendingUploads, key, resourceSignature(batch))')}`);
  marker = 'pendingUploads.delete(key);\n    }\n    const evicted = resourceBudget.reconcile';
  source = replaceGpuAnchor(source, marker, `pendingUploads.delete(key);
      ${observe('not-retained', 'key, signature: job.signature, part: job.part, offset: job.offset, instancesBytes: job.geometry.instances.byteLength, nodesBytes: job.geometry.nodes.byteLength')}
    }
    const evicted = resourceBudget.reconcile`);
  return source;
}

export function installGpuStrokeDiagnostics() {
  const probe = { counts: {}, draws: [], lookups: [], lifecycle: [], required: [], observerErrors: 0 };
  const copy = (value, depth = 0) => {
    if (typeof value === 'string') return value.slice(0, 240);
    if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return value;
    if (depth > 6) return '[depth limit]';
    if (Array.isArray(value)) return value.slice(0, 8).map(item => copy(item, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, copy(item, depth + 1)]));
  };
  window.__gpuStrokeProbe = probe;
  window.__recordGpuStroke = (type, value) => {
    try {
      const row = { at: performance.now(), type, ...copy(value) };
      probe.counts[type] = (probe.counts[type] || 0) + 1;
      const rows = type === 'draw' ? probe.draws : type === 'lookup' ? probe.lookups : probe.lifecycle;
      rows.push(row); if (rows.length > 8) rows.shift();
      if (type === 'draw') {
        const key = String(row.resourceKey || '');
        const signature = `${key}:${String(row.geometryRevision ?? 0)}:${String(row.lod || 'high')}`;
        probe.required = probe.required.filter(item => item.key !== key);
        probe.required.push({ key, signature });
        if (probe.required.length > 8) probe.required.shift();
      }
    } catch (_) { probe.observerErrors++; }
  };
}
