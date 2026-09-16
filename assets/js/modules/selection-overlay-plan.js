import { interactionChannel, mapInteractionEntries } from './interaction-roles.js';
import { resolveInteractionEntries, interactionRoleStyle } from './map-interaction-style.js';

/** Selection policy only: callers resolve geometry/cache entries before planning. */
export function selectionEntries(snapshot, state, options, toolEntries = []) {
  return resolveInteractionEntries([...mapInteractionEntries(snapshot, state, options), ...toolEntries]);
}

/** Plan ownership from the already resolved priority/hierarchy order, without resolving geometry. */
export function selectionDisplayPlan({ entries, hoverKey, hoverHasGeometry = false, mobile = false,
  mapMoving = false, draftDragging = false, outlineVisible = true, style }) {
  const entryByKey = new Map(entries.map(entry => [entry.key, entry]));
  const hoverActive = !mobile && !!hoverHasGeometry && !mapMoving && !draftDragging
    && entryByKey.get(hoverKey)?.role === 'hover';
  const items = entries.filter(entry => entry.role !== 'hover' || entry.ref.domain === 'interaction').map(entry => {
    const channel = interactionChannel(entry);
    return { entry, channel, outlineVisible: channel === 'candidate' || channel === 'hover' || outlineVisible };
  });
  const boundaryEntries = entries.filter(entry => ['territorial', 'generic', 'interaction', 'hydro'].includes(entry.ref.domain)
    && (entry.priority <= 2 || outlineVisible)
    && (entry.role !== 'hover' || entry.ref.domain === 'interaction' || hoverActive));
  const boundaryOwnersByKey = new Map(boundaryEntries.map((entry, rank) => [entry.key, boundaryEntries.slice(0, rank)]));
  const labelEntriesByKey = new Map(entries.filter(entry => !(entry.role === 'hover' && (mobile || mapMoving)))
    .map(entry => [entry.key, entry]));
  const fillMasks = entries.map(entry => ({ key: entry.key, ref: entry.ref, priority: entry.priority,
    depth: entry.depth, fillAlpha: interactionRoleStyle(style, entry.role).fillAlpha }));
  return { hoverActive, items, boundaryOwnersByKey, labelEntriesByKey, fillMasks };
}

export function orderSelectionFillMasks(entries) {
  return [...entries].sort((a, b) => b.priority - a.priority || Number(a.depth || 0) - Number(b.depth || 0)
    || String(a.key).localeCompare(String(b.key)));
}

export function selectionFrameOwnership({ gpuFrameResult, renderer, lastFillOwner }) {
  const result = gpuFrameResult?.selection || gpuFrameResult?.interactionResult?.selection || null;
  const canvas = renderer === 'canvas-worker' || renderer === 'canvas2d';
  const failed = !canvas && !!gpuFrameResult && (gpuFrameResult.succeeded === false || result?.succeeded === false || result?.contextLost === true);
  const fillOwner = gpuFrameResult?.interactionResult?.fillOwner || lastFillOwner;
  return { result, fillOwner, reuseView: !failed && fillOwner === lastFillOwner };
}

export function selectionGeometryKinds(feature) {
  const geometries = feature?.type === 'FeatureCollection' ? (feature.features || []).map(item => item.geometry) : [feature?.geometry];
  return { polygon: geometries.some(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type)),
    boundary: geometries.some(geometry => ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry?.type)) };
}

export function planSelectionEntry({ ref, entry, channel = interactionChannel(entry), countryType, feature, boundary,
  pendingCountry = false, outlineVisible = true, selectionStyle = {} }) {
  const plan = { channel, fill: null, fillRequest: null, generic: null, countryId: null, fallback: null };
  if (!feature?.geometry && feature?.type !== 'FeatureCollection') return plan;
  const country = ref.domain === 'territorial' && ref.type === countryType;
  const key = country ? `country:${ref.id}` : ref.key;
  const primary = channel === 'primary', candidate = channel === 'candidate';
  const kind = selectionGeometryKinds(feature);
  const fillAlpha = candidate ? 0 : primary ? selectionStyle.primary?.fillAlpha : selectionStyle.secondary?.fillAlpha;
  if ((country ? pendingCountry : ref.domain !== 'interaction' && kind.polygon) && fillAlpha > 0) {
    plan.fill = { color: selectionStyle.color, fillAlpha };
    if (!country) plan.fillRequest = { objectKey: ref.key, priority: entry?.priority, depth: entry?.depth, style: plan.fill };
  }
  if (!outlineVisible) return plan;
  if (country && !candidate && !boundary?.owned) {
    plan.fallback = { kind: 'country', key };
    if (!pendingCountry) plan.countryId = ref.id;
  } else {
    plan.fallback = { kind: 'geometry', key, feature: boundary?.feature, cacheKey: boundary?.revision };
    if (country || kind.boundary) plan.generic = { key, geometry: boundary?.feature, geometryRevision: boundary?.revision };
  }
  return plan;
}

export function planHoverEntry({ ref, countryType, feature, boundary, pendingCountry = false, hoverStyle = {} }) {
  const country = ref.domain === 'territorial' && ref.type === countryType;
  const key = country ? `country:${String(ref.id || '')}` : ref.key;
  const polygon = selectionGeometryKinds(feature).polygon;
  const fill = (!country || pendingCountry) && polygon ? { color: hoverStyle.color, fillAlpha: hoverStyle.fillAlpha } : null;
  return {
    fill,
    fillRequest: !country && ref.key && polygon ? { objectKey: ref.key, singleResourceOnly: true, style: fill } : null,
    fallback: country && !boundary.owned ? { kind: 'country', key }
      : { kind: 'geometry', key, feature: boundary.feature, cacheKey: boundary.revision },
    generic: !country || boundary.owned ? { key, geometry: boundary.feature, geometryRevision: boundary.revision } : null,
    countryId: country && !boundary.owned && !pendingCountry ? String(ref.id || '') : null,
  };
}

// succeeded means complete coverage, not frame health: missing resources may
// coexist with confirmed rendered keys. Hard failures invalidate all coverage.
export function selectionCoverageAvailable(result) {
  return !!result && !result.contextLost && !result.error
    && !['unhealthy', 'unavailable'].includes(result.gpuHealth);
}

export function selectionCoverage(result, fillResult, fillResourcesByObject) {
  const healthy = selectionCoverageAvailable(result);
  const renderedKeys = Object.fromEntries(['candidate', 'hover', 'primary', 'secondary'].map(channel =>
    [channel, new Set(healthy ? result.channels?.[channel]?.renderedKeys || [] : [])]));
  const renderedFillKeys = new Set(selectionCoverageAvailable(fillResult) ? fillResult.renderedKeys || [] : []);
  const gpuFilledObjectKeys = new Set();
  for (const [objectKey, resourceKeys] of fillResourcesByObject) {
    if (resourceKeys.length && resourceKeys.every(key => renderedFillKeys.has(key))) gpuFilledObjectKeys.add(objectKey);
  }
  return { renderedKeys, gpuFilledObjectKeys };
}
