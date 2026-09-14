import { connectBoundarySegments } from './boundary-lines.js';

export function highlightedAncestorIds(feature, units, activeIds) {
  if (feature?.properties?.unitType !== 'subunit') return [];
  const byId = new Map(units.map(unit => [String(unit.id), unit]));
  const seen = new Set([String(feature.id)]), result = [];
  let id = String(feature.properties.parentId || feature.properties.sovereignId || '');
  while (id && !seen.has(id)) {
    seen.add(id);
    if (activeIds.has(id)) result.push(id);
    const parent = byId.get(id);
    id = parent ? String(parent.properties?.parentId || parent.properties?.sovereignId || '') : '';
  }
  return result;
}

function lines(value) {
  if (!value) return [];
  if (value.type === 'Feature') return lines(value.geometry);
  if (value.type === 'FeatureCollection') return value.features.flatMap(lines);
  if (value.type === 'GeometryCollection') return value.geometries.flatMap(lines);
  if (value.type === 'Polygon' || value.type === 'MultiLineString') return value.coordinates;
  if (value.type === 'MultiPolygon') return value.coordinates.flat();
  return value.type === 'LineString' ? [value.coordinates] : [];
}

// Remove only overlapping boundary intervals; never clip the highlight fill.
// Index ancestor edges so hovering a small child does not scan its whole country per edge.
export function excludeAncestorHighlightBoundary(feature, ancestors, epsilon = 1e-4) {
  const buckets = new Map(), broad = [];
  const keys = (a, b) => {
    const x0 = Math.floor(Math.min(a[0], b[0]) - epsilon), x1 = Math.floor(Math.max(a[0], b[0]) + epsilon);
    const y0 = Math.floor(Math.min(a[1], b[1]) - epsilon), y1 = Math.floor(Math.max(a[1], b[1]) + epsilon);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
    const result = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}:${y}`);
    return result;
  };
  const edges = ancestors.flatMap(lines).flatMap(line => line.slice(1).map((b, index) => [line[index], b]));
  edges.forEach((edge, index) => {
    const cells = keys(...edge);
    if (!cells) { broad.push(index); return; }
    for (const cell of cells) {
      if (!buckets.has(cell)) buckets.set(cell, []);
      buckets.get(cell).push(index);
    }
  });
  const output = [];
  for (const line of lines(feature)) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const cells = keys(a, b);
    const candidates = cells ? new Set([...broad, ...cells.flatMap(cell => buckets.get(cell) || [])]) : edges.keys();
    const intervals = [];
    for (const index of candidates) {
      const [u, v] = edges[index];
      const distance = p => Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length;
      if (distance(u) > epsilon || distance(v) > epsilon) continue;
      const t = p => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length * length);
      const start = Math.max(0, Math.min(t(u), t(v))), end = Math.min(1, Math.max(t(u), t(v)));
      if (end > start) intervals.push([start, end]);
    }
    intervals.sort((left, right) => left[0] - right[0]);
    const point = t => [a[0] + dx * t, a[1] + dy * t];
    let cursor = 0;
    for (const [start, end] of intervals) {
      if (start > cursor + 1e-9) output.push([point(cursor), point(start)]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < 1 - 1e-9) output.push([point(cursor), b]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: connectBoundarySegments(output) } };
}
