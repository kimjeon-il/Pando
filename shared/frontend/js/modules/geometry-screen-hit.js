// Screen hit testing shared by interactive map surfaces. Cache lifetime belongs to the caller.
export function projectedPointDistance(left, right) {
  return Math.hypot(Number(left?.[0]) - Number(right?.[0]), Number(left?.[1]) - Number(right?.[1]));
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (!dx && !dy) return projectedPointDistance(point, start);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

export function projectedLineDistance(geometry, screenPoint, project) {
  if (!geometry) return Infinity;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates
      : geometry.type === 'Polygon' ? geometry.coordinates
        : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
          : [];
  let minimum = Infinity;
  for (const line of lines) {
    let previous = null;
    for (const coordinate of line || []) {
      const projected = project(coordinate);
      if (previous && projected) minimum = Math.min(minimum, pointSegmentDistance(screenPoint, previous, projected));
      previous = projected;
    }
  }
  return minimum;
}

export function geometryHitsScreenPoint(geometry, coord, screenPoint, tolerance = 8, { project, contains, coordinateBounds, zoom, boundsCache }) {
  if (!geometry) return false;
  let bounds = boundsCache.get(geometry);
  if (!bounds) {
    bounds = coordinateBounds(geometry.coordinates);
    boundsCache.set(geometry, bounds);
  }
  const longitudeSpan = Number(bounds?.[2]) - Number(bounds?.[0]);
  const geographicTolerance = Math.max(0.15, 4 / Math.max(1, zoom));
  if (bounds?.every(Number.isFinite) && longitudeSpan < 350 && (coord[0] < bounds[0] - geographicTolerance || coord[0] > bounds[2] + geographicTolerance || coord[1] < bounds[1] - geographicTolerance || coord[1] > bounds[3] + geographicTolerance)) return false;
  if (geometry.type === 'Point') {
    const projected = project(geometry.coordinates);
    return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
  }
  if (geometry.type === 'MultiPoint') return geometry.coordinates.some(point => {
    const projected = project(point);
    return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
  });
  if (geometry.type.includes('Polygon')) {
    if (contains(coord, { type: 'Feature', properties: {}, geometry })) return true;
  }
  return projectedLineDistance(geometry, screenPoint, project) <= tolerance;
}

