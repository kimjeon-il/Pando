export const MAP_HOST_KINDS = Object.freeze({
  LEGACY: 'legacy',
});

const MAP_PROJECTION_KINDS = Object.freeze({
  FLAT: 'flat',
  GLOBE: 'globe',
});

export function normalizeMapProjectionKind(value) {
  return value === MAP_PROJECTION_KINDS.GLOBE
    ? MAP_PROJECTION_KINDS.GLOBE
    : MAP_PROJECTION_KINDS.FLAT;
}

export function normalizeMapSurfaceDragDelta(dx, dy) {
  const normalize = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  return Object.freeze([normalize(dx), normalize(dy)]);
}
