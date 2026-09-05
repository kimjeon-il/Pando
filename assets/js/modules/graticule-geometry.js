/* Pure graticule stroke packet builder.
 * Graticules are reference geometry, not an editable polygon.  They must not
 * go through the generic boundary sanitizer (which intentionally drops date
 * line and pole edges) or the adaptive overlay LOD path.
 */

const MAX_EDGE_DEGREES = 0.5;

function finiteCoordinate(value) {
  return Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function unwrapLongitude(previous, longitude) {
  let next = Number(longitude);
  while (next - previous > 180) next -= 360;
  while (next - previous < -180) next += 360;
  return next;
}

function appendLine(startsEnds, coordinates, maxEdgeDegrees) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return;
  let previous = null;
  for (const coordinate of coordinates) {
    if (!finiteCoordinate(coordinate)) {
      previous = null;
      continue;
    }
    const current = [
      previous ? unwrapLongitude(previous[0], Number(coordinate[0])) : Number(coordinate[0]),
      Number(coordinate[1]),
    ];
    if (previous) {
      const deltaLon = current[0] - previous[0];
      const deltaLat = current[1] - previous[1];
      const distance = Math.hypot(deltaLon, deltaLat);
      if (distance > 1e-9) {
        const steps = Math.max(1, Math.ceil(distance / maxEdgeDegrees));
        let start = previous;
        for (let index = 1; index <= steps; index += 1) {
          const end = [
            previous[0] + deltaLon * index / steps,
            previous[1] + deltaLat * index / steps,
          ];
          startsEnds.push(start[0], start[1], end[0], end[1]);
          start = end;
        }
      }
    }
    previous = current;
  }
}

export function buildGraticuleStrokeGeometryPacket(geometry, { maxEdgeDegrees = MAX_EDGE_DEGREES } = {}) {
  const startsEnds = [];
  const safeStep = Number.isFinite(Number(maxEdgeDegrees)) && Number(maxEdgeDegrees) > 0
    ? Number(maxEdgeDegrees) : MAX_EDGE_DEGREES;
  if (geometry?.type === 'MultiLineString') {
    for (const line of geometry.coordinates || []) appendLine(startsEnds, line, safeStep);
  } else if (geometry?.type === 'LineString') {
    appendLine(startsEnds, geometry.coordinates, safeStep);
  }
  return {
    startsEnds: Float32Array.from(startsEnds),
    segmentCount: Math.floor(startsEnds.length / 4),
  };
}
