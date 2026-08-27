export const LABEL_PRIORITIES = Object.freeze({ country: 100, capital: 90, majorCity: 70, administrative: 60, place: 40 });

function normalizedBox(candidate) {
  const width = Math.max(1, Number(candidate.width || 1));
  const height = Math.max(1, Number(candidate.height || 1));
  return {
    left: candidate.point[0] - width / 2,
    right: candidate.point[0] + width / 2,
    top: candidate.point[1] - height / 2,
    bottom: candidate.point[1] + height / 2,
  };
}

function collides(left, right, padding) {
  return !(left.right + padding < right.left || left.left - padding > right.right
    || left.bottom + padding < right.top || left.top - padding > right.bottom);
}

export function normalizeLabelSettings(raw = {}) {
  const manualPosition = Array.isArray(raw.manualPosition) && raw.manualPosition.length >= 2
    ? [Number(raw.manualPosition[0]), Number(raw.manualPosition[1])]
    : null;
  return {
    priority: raw.priority != null && raw.priority !== '' && Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : null,
    minZoom: raw.minZoom != null && raw.minZoom !== '' && Number.isFinite(Number(raw.minZoom)) ? Number(raw.minZoom) : 0,
    maxZoom: raw.maxZoom != null && raw.maxZoom !== '' && Number.isFinite(Number(raw.maxZoom)) ? Number(raw.maxZoom) : Infinity,
    manualPosition,
    pinned: raw.pinned === true,
    collisionGroup: String(raw.collisionGroup || 'map'),
  };
}

export function layoutLabels(candidates = [], { zoom = 1, padding = 3 } = {}) {
  const visible = candidates
    .filter(candidate => candidate?.point && zoom >= Number(candidate.minZoom ?? 0) && zoom <= Number(candidate.maxZoom ?? Infinity))
    .map(candidate => ({ ...candidate, box: normalizedBox(candidate), collisionGroup: String(candidate.collisionGroup || 'map') }))
    .sort((left, right) => Number(!!right.selected) - Number(!!left.selected)
      || Number(!!right.pinned) - Number(!!left.pinned)
      || Number(right.priority || 0) - Number(left.priority || 0)
      || String(left.key).localeCompare(String(right.key)));
  const placedByGroup = new Map();
  const output = [];
  for (const candidate of visible) {
    const placed = placedByGroup.get(candidate.collisionGroup) || [];
    const blocked = !candidate.selected && !candidate.pinned && placed.some(item => !item.pinned || collides(candidate.box, item.box, padding))
      && placed.some(item => collides(candidate.box, item.box, padding));
    if (blocked) continue;
    output.push(candidate);
    placed.push(candidate);
    placedByGroup.set(candidate.collisionGroup, placed);
  }
  return output;
}

export function labelKey(sourceType, sourceId) {
  return `${String(sourceType)}:${String(sourceId)}`;
}
