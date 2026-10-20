export const DATA_READINESS = Object.freeze({
  RESTORING: 'restoring',
  PREVIEW: 'preview',
  EDITABLE: 'editable',
  ENHANCED: 'enhanced',
  ERROR: 'error',
});

// Read-only presentation of renderer-owned resources. This does not grant editing rights.
export function mapPresentationReadiness({ boundaryReady, boundaryFailed = false, terrainVisible,
  terrain = {}, targetKey, presentedKey, band = 'high' }) {
  if (boundaryFailed) return { status: 'error', label: '정밀 경계 준비 실패', retry: true };
  if (!boundaryReady) return { status: 'boundaries', label: '정밀 경계 준비 중', retry: false };
  if (terrainVisible && terrain.terrainFailed) return { status: 'error', label: '현재 화면 지형 준비 실패', retry: true };
  if (terrainVisible && !terrain.terrainReady) return { status: 'terrain', label: '정밀 경계 사용 가능 · 현재 화면 지형 준비 중', retry: false };
  if (!targetKey || targetKey !== presentedKey) return { status: 'presenting', label: '현재 화면 표시 중', retry: false };
  if (terrainVisible && terrain.terrainResolutionLimited) return { status: 'limited', label: '제공 자료의 최고 해상도로 표시 중', retry: false };
  return { status: 'ready', label: `현재 화면 준비 완료 · ${band === 'low' ? '저배율' : '상세'} 표시`, retry: false };
}

const READINESS_EVENTS = Object.freeze({
  RESTORE_STARTED: 'restore-started',
  PREVIEW_READY: 'preview-ready',
  GEOMETRY_READY: 'geometry-ready',
  MESH_READY: 'mesh-ready',
  GEOMETRY_ERROR: 'geometry-error',
  RETRY_GEOMETRY: 'retry-geometry',
});

export function transitionDataReadiness(current, event) {
  const state = Object.values(DATA_READINESS).includes(current) ? current : DATA_READINESS.PREVIEW;
  if (event === READINESS_EVENTS.RESTORE_STARTED) return DATA_READINESS.RESTORING;
  if (event === READINESS_EVENTS.GEOMETRY_READY) return DATA_READINESS.EDITABLE;
  if (event === READINESS_EVENTS.MESH_READY && state === DATA_READINESS.EDITABLE) return DATA_READINESS.ENHANCED;
  if (event === READINESS_EVENTS.GEOMETRY_ERROR) return DATA_READINESS.ERROR;
  if (event === READINESS_EVENTS.PREVIEW_READY || event === READINESS_EVENTS.RETRY_GEOMETRY) return DATA_READINESS.PREVIEW;
  return state;
}

export function canMutateProject(readiness) {
  return readiness === DATA_READINESS.EDITABLE || readiness === DATA_READINESS.ENHANCED;
}

const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g']);

export function resolveStartupLoadPolicy({
  layout = 'wide',
  deviceMemory = null,
  hardwareConcurrency = null,
  effectiveType = '',
  saveData = false,
} = {}) {
  const memory = Number(deviceMemory);
  const cores = Number(hardwareConcurrency);
  const memoryKnown = Number.isFinite(memory) && memory > 0;
  const coresKnown = Number.isFinite(cores) && cores > 0;
  const connection = String(effectiveType || '').toLowerCase();
  const slowConnection = SLOW_EFFECTIVE_TYPES.has(connection);
  const mobileFallback = String(layout || '').toLowerCase() === 'mobile';
  const constrained = !!saveData
    || slowConnection
    || (memoryKnown && memory <= 4)
    || (coresKnown && cores <= 4)
    || (!memoryKnown && mobileFallback)
    || (!memoryKnown && !mobileFallback && (!coresKnown || cores <= 4));
  return Object.freeze({
    mode: 'sequential',
    reason: 'interaction-first-v1',
    constrained,
    signals: Object.freeze({
      layout: mobileFallback ? 'mobile' : String(layout || 'wide'),
      deviceMemory: memoryKnown ? memory : null,
      hardwareConcurrency: coresKnown ? cores : null,
      effectiveType: connection || null,
      saveData: !!saveData,
    }),
  });
}

export { READINESS_EVENTS };
