// Pure geometry operation: the source-controlled policy arrives as validated
// data from the build compiler. No country IDs or ownership rules live here.
const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

export function mergeBuiltinTerritories(collection, merges, {policyRevision=null}={}) {
  if(!Array.isArray(merges))throw new TypeError('Explicit builtin territory policy is required');
  const byId = new Map(collection.features.map(feature => [String(feature.id), feature]));
  const removed = new Set();
  for (const policy of merges) {
    const source = byId.get(policy.sourceId);
    if (!source) continue;
    const destination = byId.get(policy.controller);
    if (!destination) throw new Error(`기본 영토 대상 누락: ${policy.sourceId} → ${policy.controller}`);
    const previous=destination.properties?.metadata?.builtinTerritoryDisplay?.mergedSources||[];
    byId.set(policy.controller, { ...destination,
      properties: { ...destination.properties, metadata: {
        ...destination.properties?.metadata,
        builtinTerritoryDisplay: {
          policyRevision,
          mergedSources: [...previous, structuredClone(policy)],
        },
      }},
      geometry: {
        type: 'MultiPolygon', coordinates: [...polygons(destination.geometry), ...polygons(source.geometry)],
      } });
    removed.add(policy.sourceId);
  }
  return { ...collection, features: collection.features.filter(feature => !removed.has(String(feature.id)))
    .map(feature => byId.get(String(feature.id))) };
}
