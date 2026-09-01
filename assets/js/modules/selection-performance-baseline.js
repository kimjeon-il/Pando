const percentile95 = values => {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
};

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function decideSelectionRedrawStrategy(samples, { mobile = false } = {}) {
  const rows = [...(samples || [])];
  if (!rows.length) return Object.freeze({ strategy: 'PENDING', reasons: ['no-samples'] });
  const mainGpuSubmitP95 = percentile95(rows.map(row => row.mainGpuFrameMs));
  const selectionInputToPresentP95 = percentile95(rows.map(row => row.inputToPresentMs));
  const baselineInputToPresentP95 = percentile95(rows.map(row => row.baselineInputToPresentMs || row.inputToPresentMs));
  const longTaskCount = rows.reduce((total, row) => total + finite(row.longTaskCount), 0);
  const worldMeshUploadCount = rows.reduce((total, row) => total + finite(row.worldMeshUploadCount), 0);
  const hydroUploadBytes = rows.reduce((total, row) => total + finite(row.hydroUploadBytes), 0);
  const threshold = mobile ? 16 : 12;
  const reasons = [];
  if (mainGpuSubmitP95 > threshold) reasons.push(`main-gpu-p95>${threshold}ms`);
  if (selectionInputToPresentP95 > baselineInputToPresentP95 * 1.1) reasons.push('selection-input-regression>10%');
  if (longTaskCount > 0) reasons.push('long-task');
  if (worldMeshUploadCount > 0) reasons.push('world-mesh-upload');
  if (hydroUploadBytes > 0) reasons.push('hydro-upload');
  return Object.freeze({
    strategy: reasons.length ? 'SCENE_COLOR_CACHE' : 'FULL_REDRAW',
    reasons: Object.freeze(reasons),
    mainGpuSubmitP95,
    selectionInputToPresentP95,
    baselineInputToPresentP95,
    longTaskCount,
    worldMeshUploadCount,
    hydroUploadBytes,
  });
}

export function createSelectionPerformanceBaseline({ warmupCount = 2, sampleCount = 20, mobile = false } = {}) {
  let observedCount = 0;
  const samples = [];

  function record(sample = {}) {
    observedCount += 1;
    if (observedCount <= warmupCount) return snapshot();
    if (samples.length < sampleCount) {
      samples.push(Object.freeze(Object.fromEntries(Object.entries(sample).map(([key, value]) => [key,
        typeof value === 'number' ? finite(value) : value,
      ]))));
    }
    return snapshot();
  }

  function snapshot() {
    const complete = samples.length >= sampleCount;
    return Object.freeze({
      warmupCount,
      sampleCount,
      observedCount,
      collectedCount: samples.length,
      complete,
      strategy: complete ? decideSelectionRedrawStrategy(samples, { mobile }) : Object.freeze({ strategy: 'PENDING', reasons: ['collecting'] }),
      samples: Object.freeze(samples.map(sample => ({ ...sample }))),
    });
  }

  return Object.freeze({ record, snapshot });
}
