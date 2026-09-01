function finiteCoordinate(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function normalizedStyle(style = {}) {
  return Object.freeze({
    color: String(style.color || '#f4c766'),
    alpha: Math.max(0, Math.min(1, Number(style.alpha ?? 1))),
    width: Math.max(0.5, Number(style.width || 3)),
    casing: style.casing ? Object.freeze({
      color: String(style.casing.color || '#151b23'),
      alpha: Math.max(0, Math.min(1, Number(style.casing.alpha ?? 0.7))),
      width: Math.max(0.5, Number(style.casing.width || 4.5)),
    }) : null,
    cap: style.cap === 'butt' ? 'butt' : 'round',
    join: ['miter', 'bevel', 'round'].includes(style.join) ? style.join : 'round',
    dash: Object.freeze(Array.isArray(style.dash) ? [Number(style.dash[0] || 0), Number(style.dash[1] || 0)] : [0, 0]),
    miterLimit: Math.max(1, Number(style.miterLimit || 4)),
    blendMode: style.blendMode === 'multiply' ? 'multiply' : 'normal',
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0;
}

export function createEditPreviewController({ now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  let sequence = 0;
  let session = null;
  const updateSamples = [];
  const metrics = {
    sessionCount: 0,
    updateCount: 0,
    clearCount: 0,
    lastUpdateMs: 0,
    maxSegmentCount: 0,
    allocatedBytes: 0,
    reusedBufferCount: 0,
    lastSessionMs: 0,
  };

  function ensureCapacity(segmentCount) {
    const required = Math.max(0, segmentCount * 4);
    if (session.startsEnds.length >= required) {
      metrics.reusedBufferCount += 1;
      return;
    }
    let capacity = Math.max(16, session.startsEnds.length || 0);
    while (capacity < required) capacity *= 2;
    session.startsEnds = new Float32Array(capacity);
    metrics.allocatedBytes += session.startsEnds.byteLength;
  }

  function writeSegments(segments = []) {
    const started = now();
    let validCount = 0;
    for (const segment of segments) {
      const start = segment?.start || segment?.a || segment?.[0];
      const end = segment?.end || segment?.b || segment?.[1];
      if (!finiteCoordinate(start) || !finiteCoordinate(end)) continue;
      if (Math.hypot(Number(end[0]) - Number(start[0]), Number(end[1]) - Number(start[1])) <= 1e-12) continue;
      validCount += 1;
    }
    ensureCapacity(validCount);
    let offset = 0;
    for (const segment of segments) {
      const start = segment?.start || segment?.a || segment?.[0];
      const end = segment?.end || segment?.b || segment?.[1];
      if (!finiteCoordinate(start) || !finiteCoordinate(end)) continue;
      if (Math.hypot(Number(end[0]) - Number(start[0]), Number(end[1]) - Number(start[1])) <= 1e-12) continue;
      session.startsEnds[offset++] = Number(start[0]);
      session.startsEnds[offset++] = Number(start[1]);
      session.startsEnds[offset++] = Number(end[0]);
      session.startsEnds[offset++] = Number(end[1]);
    }
    session.segmentCount = validCount;
    session.revision += 1;
    session.updatedAt = now();
    metrics.updateCount += 1;
    metrics.lastUpdateMs = Math.max(0, session.updatedAt - started);
    updateSamples.push(metrics.lastUpdateMs);
    if (updateSamples.length > 240) updateSamples.shift();
    metrics.maxSegmentCount = Math.max(metrics.maxSegmentCount, validCount);
    return validCount;
  }

  function begin({ key = 'edit-preview', segments = [], style = {}, order = 20_000 } = {}) {
    session = {
      id: ++sequence,
      key: String(key || 'edit-preview'),
      revision: 0,
      startsEnds: new Float32Array(0),
      segmentCount: 0,
      style: normalizedStyle(style),
      order: Number(order || 20_000),
      startedAt: now(),
      updatedAt: 0,
    };
    metrics.sessionCount += 1;
    writeSegments(segments);
    return session.id;
  }

  function update(segments = []) {
    if (!session) return false;
    writeSegments(segments);
    return true;
  }

  function packet() {
    if (!session || !session.segmentCount) return null;
    const startsEnds = session.startsEnds.subarray(0, session.segmentCount * 4);
    return Object.freeze({
      kind: 'stroke',
      packet: Object.freeze({
        key: `edit-preview:${session.key}`,
        geometryRevision: `${session.id}:${session.revision}`,
        order: session.order,
        role: 'edit-preview',
        startsEnds,
        segmentCount: session.segmentCount,
        style: session.style,
        blendMode: session.style.blendMode,
      }),
    });
  }

  function clear() {
    if (!session) return false;
    metrics.lastSessionMs = Math.max(0, now() - session.startedAt);
    session = null;
    metrics.clearCount += 1;
    return true;
  }

  return Object.freeze({
    begin,
    update,
    packet,
    clear,
    isActive: () => !!session,
    revision: () => Number(session?.revision || 0),
    stats: () => Object.freeze({
      ...metrics,
      active: !!session,
      activeSegmentCount: Number(session?.segmentCount || 0),
      activeRevision: Number(session?.revision || 0),
      activeAgeMs: session ? Math.max(0, now() - session.startedAt) : 0,
      updateP95Ms: percentile(updateSamples, 0.95),
      updateP99Ms: percentile(updateSamples, 0.99),
    }),
  });
}
