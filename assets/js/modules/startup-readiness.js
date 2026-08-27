export const DATA_READINESS = Object.freeze({
  PREVIEW: 'preview',
  CANONICAL: 'canonical',
  ERROR: 'error',
});

const READINESS_EVENTS = Object.freeze({
  PREVIEW_READY: 'preview-ready',
  CANONICAL_READY: 'canonical-ready',
  CANONICAL_ERROR: 'canonical-error',
  RETRY: 'retry',
});

export function transitionDataReadiness(current, event) {
  const state = Object.values(DATA_READINESS).includes(current) ? current : DATA_READINESS.PREVIEW;
  if (event === READINESS_EVENTS.CANONICAL_READY) return DATA_READINESS.CANONICAL;
  if (event === READINESS_EVENTS.CANONICAL_ERROR) return DATA_READINESS.ERROR;
  if (event === READINESS_EVENTS.PREVIEW_READY || event === READINESS_EVENTS.RETRY) return DATA_READINESS.PREVIEW;
  return state;
}

export function canMutateProject(readiness) {
  return readiness === DATA_READINESS.CANONICAL;
}

export { READINESS_EVENTS };
