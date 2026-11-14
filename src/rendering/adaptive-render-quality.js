const RENDER_QUALITY_TIERS = Object.freeze({
  COARSE: 'coarse',
  MEDIUM: 'medium',
  HIGH: 'high',
});

const TIER_ORDER = Object.freeze([
  RENDER_QUALITY_TIERS.COARSE,
  RENDER_QUALITY_TIERS.MEDIUM,
  RENDER_QUALITY_TIERS.HIGH,
]);

const MIB = 1024 * 1024;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0;
}

function normalizedTier(value) {
  return TIER_ORDER.includes(value) ? value : RENDER_QUALITY_TIERS.MEDIUM;
}

export function resolveInitialRenderQuality({
  mobile = false,
  deviceMemory = null,
  hardwareConcurrency = null,
  saveData = false,
} = {}) {
  const memory = Number(deviceMemory);
  const cores = Number(hardwareConcurrency);
  const knownMemory = Number.isFinite(memory) && memory > 0;
  const knownCores = Number.isFinite(cores) && cores > 0;
  if (saveData || mobile || (knownMemory && memory <= 4) || (knownCores && cores <= 4)) return RENDER_QUALITY_TIERS.COARSE;
  return RENDER_QUALITY_TIERS.MEDIUM;
}

export function renderQualityProfile(tier, {
  mobile = false,
  phase = 'settle',
  revision = 0,
  metrics = {},
  reason = '',
} = {}) {
  const normalized = normalizedTier(tier);
  const interaction = phase === 'interaction';
  const definitions = {
    coarse: {dprCap:0.75, geometryErrorPx:2, terrainResolutionScale:0.5,labelCandidateLimit:128,gpuCacheBudgetBytes:64*MIB,cpuCacheBudgetBytes:96*MIB},
    medium: {dprCap:1.25,geometryErrorPx:1,terrainResolutionScale:0.75,labelCandidateLimit:256,gpuCacheBudgetBytes:128*MIB,cpuCacheBudgetBytes:192*MIB},
    high: {dprCap:2,geometryErrorPx:0.5,terrainResolutionScale:1,labelCandidateLimit:512,gpuCacheBudgetBytes:256*MIB,cpuCacheBudgetBytes:256*MIB},
  };
  const selected = definitions[normalized];
  return Object.freeze({
    tier: normalized,
    phase: interaction ? 'interaction' : 'settle',
    revision: Number(revision || 0),
    activeEditLod: normalized,
    selectedLod: normalized,
    backgroundLod: normalized,
    ...selected,
    terrainCacheBudgetBytes:selected.gpuCacheBudgetBytes/4,
    hydroCacheBudgetBytes:selected.gpuCacheBudgetBytes/8,
    overlayGpuBudgetBytes:selected.gpuCacheBudgetBytes/4,
    geometryGpuBudgetBytes:selected.gpuCacheBudgetBytes*3/8,
    renderPacketCacheBudgetBytes:selected.cpuCacheBudgetBytes/2,
    interactionUploadBudgetBytes:256*1024,
    settleUploadBudgetBytes:2*MIB,
    uploadBudgetBytes: interaction ? 256*1024 : 2*MIB,
    targetFrameMs: 33,
    p95FrameMs: Number(metrics.p95FrameMs || 0),
    p99FrameMs: Number(metrics.p99FrameMs || 0),
    longFrameCount: Number(metrics.longFrameCount || 0),
    reason: String(reason || ''),
  });
}

export function createAdaptiveRenderQualityController({
  mobile = false,
  deviceMemory = null,
  hardwareConcurrency = null,
  saveData = false,
  evaluationWindow = 20,
  degradeWindows = 2,
  upgradeWindows = 6,
  changeCooldownMs = 0,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let tier = resolveInitialRenderQuality({ mobile, deviceMemory, hardwareConcurrency, saveData });
  let phase = 'settle';
  let revision = 1;
  let lastReason = 'device-hints';
  let lastChangeAt = -Infinity;
  let overBudgetWindows = 0;
  let underBudgetWindows = 0;
  let samplesSinceEvaluation = 0;
  let qualityChangeCount = 0;
  let longFrameCount = 0;
  const frameSamples = [];
  const maximumTierIndex = 2;
  let memoryPressure=false, stableActiveMs=0, windowActiveMs=0;

  function metrics() {
    return {
      p95FrameMs: percentile(frameSamples, 0.95),
      p99FrameMs: percentile(frameSamples, 0.99),
      longFrameCount,
    };
  }

  function profile() {
    return renderQualityProfile(tier, { mobile, phase, revision, metrics: metrics(), reason: lastReason });
  }

  function changeTier(nextTier, reason) {
    const nextIndex = Math.min(maximumTierIndex, Math.max(0, TIER_ORDER.indexOf(normalizedTier(nextTier))));
    const normalized = TIER_ORDER[nextIndex];
    if (normalized === tier) return false;
    tier = normalized;
    revision += 1;
    qualityChangeCount += 1;
    lastChangeAt = now();
    lastReason = String(reason || 'runtime-frame-budget');
    overBudgetWindows = 0;
    underBudgetWindows = 0;
    stableActiveMs=0; windowActiveMs=0;
    return true;
  }

  function setPhase(nextPhase, reason) {
    const normalized = nextPhase === 'interaction' ? 'interaction' : 'settle';
    if (normalized === phase) return false;
    phase = normalized;
    revision += 1;
    lastReason = String(reason || normalized);
    if(phase==='settle')promoteIfStable();
    return true;
  }

  function evaluate() {
    const current = metrics();
    const expensive = memoryPressure || current.p95FrameMs > 40;
    const comfortable = !memoryPressure && current.p95FrameMs > 0 && current.p95FrameMs < 25;
    if (expensive) {
      overBudgetWindows += 1;
      underBudgetWindows = 0;
    } else if (comfortable) {
      underBudgetWindows += 1;
      overBudgetWindows = 0;
    } else {
      overBudgetWindows = 0;
      underBudgetWindows = 0;
    }
    if (now() - lastChangeAt < changeCooldownMs) return false;
    stableActiveMs = comfortable ? stableActiveMs + windowActiveMs : 0;
    windowActiveMs = 0;
    const index = TIER_ORDER.indexOf(tier);
    if (overBudgetWindows >= degradeWindows && index > 0) return changeTier(TIER_ORDER[index - 1], 'frame-p95-over-budget');
    return promoteIfStable();
  }

  function promoteIfStable() {
    const index=TIER_ORDER.indexOf(tier);
    if (phase === 'settle' && !memoryPressure && underBudgetWindows >= upgradeWindows
      && index < maximumTierIndex && stableActiveMs >= 15000) {
      return changeTier(TIER_ORDER[index + 1], 'frame-budget-stable');
    }
    return false;
  }

  function recordFrame(durationMs, { interaction = phase === 'interaction',frameIntervalMs=0,suspended=false,waiting=false,memoryPressure:pressure=false } = {}) {
    if(suspended||waiting){stableActiveMs=0;windowActiveMs=0;underBudgetWindows=0;return false;}
    memoryPressure=pressure;
    const duration = Math.max(0, Number(durationMs) || 0,Number(frameIntervalMs)||0);
    if (!duration) return false;
    windowActiveMs += duration;
    frameSamples.push(duration);
    if (frameSamples.length > 60) frameSamples.splice(0, frameSamples.length - 60);
    if (duration >= 45) longFrameCount += 1;
    samplesSinceEvaluation += 1;
    if (samplesSinceEvaluation < Math.max(4, Number(evaluationWindow) || 20)) return false;
    samplesSinceEvaluation = 0;
    // Interaction ownership belongs to beginInteraction/endInteraction. A frame
    // sample must not silently mutate the phase without a matching revision.
    void interaction;
    return evaluate();
  }

  return Object.freeze({
    beginInteraction: reason => setPhase('interaction', reason || 'interaction'),
    endInteraction: reason => setPhase('settle', reason || 'settle'),
    recordFrame,
    setTier: (nextTier, reason = 'manual') => changeTier(nextTier, reason),
    profile,
    stats: () => Object.freeze({
      ...profile(),
      sampleCount: frameSamples.length,
      overBudgetWindows,
      underBudgetWindows,
      qualityChangeCount,
      maximumTier: TIER_ORDER[maximumTierIndex],
    }),
  });
}
