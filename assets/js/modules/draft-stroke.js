const POINTER_GROUPS = Object.freeze({
  mouse: 'fine',
  pen: 'fine',
  touch: 'coarse',
});

export const DRAFT_STROKE_PROFILES = Object.freeze({
  boundary: Object.freeze({
    sampleDistance: Object.freeze({ fine: 4, coarse: 8 }),
    simplifyTolerance: Object.freeze({ fine: 2.5, coarse: 4 }),
  }),
  river: Object.freeze({
    sampleDistance: Object.freeze({ fine: 4, coarse: 8 }),
    simplifyTolerance: Object.freeze({ fine: 1.5, coarse: 3 }),
  }),
  area: Object.freeze({
    sampleDistance: Object.freeze({ fine: 4, coarse: 8 }),
    simplifyTolerance: Object.freeze({ fine: 2.5, coarse: 4 }),
  }),
});

const clonePair = value => [Number(value?.[0]), Number(value?.[1])];
const cloneSample = sample => ({
  screen: clonePair(sample.screen),
  coordinate: clonePair(sample.coordinate),
});
const squaredDistance = (left, right) => {
  const dx = Number(left?.[0]) - Number(right?.[0]);
  const dy = Number(left?.[1]) - Number(right?.[1]);
  return dx * dx + dy * dy;
};

export function draftPointerGroup(pointerType) {
  return POINTER_GROUPS[pointerType] || 'fine';
}

export function draftStrokeProfile(profile = 'area', pointerType = 'mouse') {
  const definition = DRAFT_STROKE_PROFILES[profile] || DRAFT_STROKE_PROFILES.area;
  const group = draftPointerGroup(pointerType);
  return Object.freeze({
    profile: DRAFT_STROKE_PROFILES[profile] ? profile : 'area',
    pointerGroup: group,
    sampleDistance: definition.sampleDistance[group],
    simplifyTolerance: definition.simplifyTolerance[group],
  });
}

export function createDraftStrokeState() {
  return {
    active: false,
    pointerId: null,
    pointerType: 'mouse',
    profile: 'area',
    samples: [],
    acceptingSamples: true,
  };
}

export function resetDraftStrokeState(state) {
  state.active = false;
  state.pointerId = null;
  state.pointerType = 'mouse';
  state.profile = 'area';
  state.samples = [];
  state.acceptingSamples = true;
  return state;
}

export function beginDraftStroke(state, {
  pointerId,
  pointerType = 'mouse',
  profile = 'area',
  sample,
}) {
  resetDraftStrokeState(state);
  if (!sample?.screen || !sample?.coordinate) return false;
  state.active = true;
  state.pointerId = pointerId;
  state.pointerType = pointerType;
  state.profile = DRAFT_STROKE_PROFILES[profile] ? profile : 'area';
  state.samples = [cloneSample(sample)];
  state.acceptingSamples = true;
  return true;
}

export function appendDraftStrokeSamples(state, samples) {
  if (!state.active) return 0;
  const { sampleDistance } = draftStrokeProfile(state.profile, state.pointerType);
  const minimumDistance2 = sampleDistance * sampleDistance;
  let added = 0;
  for (const sample of samples || []) {
    if (!sample?.screen || !sample?.coordinate) continue;
    const next = cloneSample(sample);
    const previous = state.samples[state.samples.length - 1];
    if (previous && squaredDistance(previous.screen, next.screen) < minimumDistance2) continue;
    state.samples.push(next);
    added += 1;
  }
  return added;
}

export function cancelDraftStroke(state) {
  const sampleCount = state.samples.length;
  resetDraftStrokeState(state);
  return sampleCount;
}

function pointSegmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return squaredDistance(point, start);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return squaredDistance(point, [start[0] + dx * t, start[1] + dy * t]);
}

export function simplifyDraftStrokeSamples(samples, tolerance) {
  const source = (samples || []).filter(sample => sample?.screen && sample?.coordinate).map(cloneSample);
  if (source.length <= 2 || !(tolerance > 0)) return source;
  const tolerance2 = tolerance * tolerance;
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack = [[0, source.length - 1]];
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    const start = source[startIndex].screen;
    const end = source[endIndex].screen;
    let farthestIndex = -1;
    let farthestDistance2 = tolerance2;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance2 = pointSegmentDistanceSquared(source[index].screen, start, end);
      if (distance2 <= farthestDistance2) continue;
      farthestDistance2 = distance2;
      farthestIndex = index;
    }
    if (farthestIndex < 0) continue;
    keep[farthestIndex] = 1;
    stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
  }
  return source.filter((_, index) => keep[index]);
}

function removeDuplicateCoordinates(samples) {
  const result = [];
  for (const sample of samples) {
    const previous = result[result.length - 1];
    if (previous && squaredDistance(previous.coordinate, sample.coordinate) <= 1e-18) continue;
    result.push(sample);
  }
  return result;
}

export function finalizeDraftStroke(state, {
  shape = 'line',
  closeTargetScreen = null,
  closeSnapDistance = null,
} = {}) {
  if (!state.active) return null;
  const pointerType = state.pointerType;
  const profile = draftStrokeProfile(state.profile, pointerType);
  const rawSampleCount = state.samples.length;
  let simplified = simplifyDraftStrokeSamples(state.samples, profile.simplifyTolerance);
  simplified = removeDuplicateCoordinates(simplified);
  const polygon = shape === 'polygon';
  const target = closeTargetScreen || simplified[0]?.screen || null;
  const defaultCloseDistance = draftPointerGroup(pointerType) === 'coarse' ? 24 : 12;
  const snapDistance = Number.isFinite(closeSnapDistance) ? closeSnapDistance : defaultCloseDistance;
  let autoClosed = false;
  let closureDistance = null;
  if (polygon && target && simplified.length > 1) {
    closureDistance = Math.sqrt(squaredDistance(simplified[simplified.length - 1].screen, target));
    if (closureDistance <= snapDistance) {
      simplified = simplified.slice(0, -1);
      autoClosed = true;
    }
  }
  const result = {
    coords: simplified.map(sample => clonePair(sample.coordinate)),
    screenPoints: simplified.map(sample => clonePair(sample.screen)),
    pointerType,
    profile: profile.profile,
    rawSampleCount,
    autoClosed,
    closureDistance,
  };
  resetDraftStrokeState(state);
  return result;
}
