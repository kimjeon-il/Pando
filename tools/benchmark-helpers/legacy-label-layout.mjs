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

function sortedVisibleCandidates(candidates, zoom) {
  return candidates
    .filter(candidate => candidate?.point && zoom >= Number(candidate.minZoom ?? 0) && zoom <= Number(candidate.maxZoom ?? Infinity))
    .map(candidate => ({ ...candidate, box: normalizedBox(candidate), collisionGroup: String(candidate.collisionGroup || 'map') }))
    .sort((left, right) => Number(!!right.selected) - Number(!!left.selected)
      || Number(!!right.pinned) - Number(!!left.pinned)
      || Number(right.priority || 0) - Number(left.priority || 0)
      || String(left.key).localeCompare(String(right.key)));
}

export function layoutLabelsLegacy(candidates = [], { zoom = 1, padding = 3, metrics = null } = {}) {
  const started = performance.now();
  const visible = sortedVisibleCandidates(candidates, zoom);
  let collisionCheckCount = 0;
  const placedByGroup = new Map();
  const output = [];
  for (const candidate of visible) {
    const placed = placedByGroup.get(candidate.collisionGroup) || [];
    const first = !candidate.selected && !candidate.pinned && placed.some(item => {
      collisionCheckCount += 1;
      return !item.pinned || collides(candidate.box, item.box, padding);
    });
    const blocked = first && placed.some(item => {
      collisionCheckCount += 1;
      return collides(candidate.box, item.box, padding);
    });
    if (blocked) continue;
    output.push(candidate);
    placed.push(candidate);
    placedByGroup.set(candidate.collisionGroup, placed);
  }
  if (metrics) Object.assign(metrics, {
    candidateCount: candidates.length,
    visibleByZoomCount: visible.length,
    placedCount: output.length,
    collisionCheckCount,
    gridCellCount: 0,
    averageCandidatesPerCollisionQuery: visible.length ? collisionCheckCount / visible.length : 0,
    maxCandidatesPerCollisionQuery: Math.max(0, ...[...placedByGroup.values()].map(items => items.length)),
    layoutMs: performance.now() - started,
    algorithm: 'legacy',
  });
  return output;
}
