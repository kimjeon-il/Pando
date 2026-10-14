import { geometryRevision } from './geometry-versions.js';
import { connectBoundarySegments } from './boundary-lines.js';
import { buildRenderableBoundarySegments, buildRefinedBoundarySegments } from './geographic-boundary.js';

const ancestorIndexes = new WeakMap();

// Remove only overlapping boundary intervals; never clip the highlight fill.
// Index ancestor edges so hovering a small child does not scan its whole country per edge.
export function excludeAncestorHighlightBoundary(feature, ancestors, epsilon = 1e-4) {
  const keys = (a, b) => {
    const x0 = Math.floor(Math.min(a[0], b[0]) - epsilon), x1 = Math.floor(Math.max(a[0], b[0]) + epsilon);
    const y0 = Math.floor(Math.min(a[1], b[1]) - epsilon), y1 = Math.floor(Math.max(a[1], b[1]) + epsilon);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
    const result = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}:${y}`);
    return result;
  };
  const prepared = ancestors.map(ancestor => {
    const geometry = ancestor.type === 'Feature' ? ancestor.geometry : ancestor;
    let record = ancestorIndexes.get(geometry);
    if (!record || record.revision !== geometryRevision(geometry)) { record = { revision: geometryRevision(geometry), versions: new Map() }; ancestorIndexes.set(geometry, record); }
    const versions = record.versions;
    if (versions.has(epsilon)) return versions.get(epsilon);
    const edges = buildRenderableBoundarySegments(geometry);
    const buckets = new Map(), broad = [];
    edges.forEach((edge, index) => {
      const cells = keys(...edge);
      if (!cells) { broad.push(index); return; }
      for (const cell of cells) {
        if (!buckets.has(cell)) buckets.set(cell, []);
        buckets.get(cell).push(index);
      }
    });
    const result = { edges, buckets, broad };
    versions.set(epsilon, result);
    return result;
  });
  const output = [];
  // Match the renderer's short, seam-split edges on both sides of the overlap.
  for (const [a, b] of buildRenderableBoundarySegments(feature)) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const cells = keys(a, b);
    const candidates = prepared.flatMap(({ edges, buckets, broad }) => [...(cells ? new Set([...broad, ...cells.flatMap(cell => buckets.get(cell) || [])]) : edges.keys())].map(index => edges[index]));
    const intervals = [];
    for (const [u, v] of candidates) {
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
  // Remove ancestor-owned intervals in source topology space, then refine
  // only the visible display remainder without modifying either polygon.
  const visible = buildRefinedBoundarySegments({ type: 'MultiLineString', coordinates: output });
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: connectBoundarySegments(visible) } };
}
