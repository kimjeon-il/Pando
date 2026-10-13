import { buildRenderableBoundarySegments, densifyBoundarySegmentsForProjection } from './geographic-boundary.js';

export function buildSelectionBoundarySegments(geometry, { densify = false } = {}) {
  const segments = buildRenderableBoundarySegments(geometry);
  return densify ? densifyBoundarySegmentsForProjection(segments) : segments;
}

export function buildSelectionChannelSignature(name, nextItems = []) {
  const itemSignature = item => [
    String(item?.key || ''),
    String(item?.boundaryOwnerId || ''),
    String(item?.geometryRevision ?? item?.revision ?? 0),
    String(item?.ribbonRevision ?? ''),
    item?.missing ? 'missing' : 'ready',
  ].join('@');
  return `${String(name || '')}:${nextItems.map(itemSignature).join('|')}`;
}
