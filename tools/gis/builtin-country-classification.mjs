import {createTerritorialFeature} from '../../src/document/territorial-units.js';
import {builtinSubunitId} from '../../src/document/territorial-display-identity.js';

// Generator-owned display merge. This is not a Viewer document mutation.
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

function appendBuiltinSourceAttribution(notes, sourceId, displayPolicy) {
  const original=String(notes||'');
  const row=displayPolicy?.sourceAttributions?.[sourceId];
  if(!row||original.includes(row.archive))return original;
  return [original,[row.scope,'© OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright',
    '원본·파생 데이터: '+row.archive,'공식 협정: '+row.agreement,row.precision]
    .filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
}

/** Fresh builtin source only; never reclassify an imported project file. */
export function classifyBuiltinCountries(collection,{availableSourceIds=null,displayPolicy}={}) {
  if(!Array.isArray(displayPolicy?.subunits)||!Array.isArray(displayPolicy?.territoryMerges))
    throw new TypeError('Explicit versioned builtin display policy is required');
  const features=collection?.features||[], ids=new Set(features.map(feature=>String(feature.id)));
  const bySource=new Map(displayPolicy.subunits.map(row=>[row.sourceCountryId,row]));
  for(const row of displayPolicy.subunits) {
    if(availableSourceIds&&!ids.has(row.sourceCountryId))continue;
    if(!ids.has(row.sourceCountryId)||!(availableSourceIds||ids).has(row.parentId))
      throw new Error(`기본 하위단위 원본/부모 누락: ${row.sourceCountryId} → ${row.parentId}`);
  }
  const countries=[],subunits=[];
  for(const feature of features) {
    const sourceId=String(feature.id),row=bySource.get(sourceId);
    if(!row){
      const notes=appendBuiltinSourceAttribution(feature.properties?.notes,sourceId,displayPolicy);
      countries.push(notes===String(feature.properties?.notes||'')?feature:{
        ...feature,properties:{...feature.properties,notes}});
      continue;
    }
    subunits.push(createTerritorialFeature({
      id:builtinSubunitId(row.sourceCountryId),entityKind:'general',
      name:feature.properties.name,geometry:feature.geometry,
      parentId:row.parentId,coverageMode:'explicit',
      notes:row.note||'',metadata:{
        builtinSubunit:{revision:displayPolicy.revision,sourceCountryId:row.sourceCountryId,
          relationshipBasis:row.basis||'default-map-belonging',
          ...(row.controllerCountryId?{controllerCountryId:row.controllerCountryId}:{}),
          ...(row.lesseeCountryId?{lesseeCountryId:row.lesseeCountryId}:{})},
        sourceCountryProperties:structuredClone(feature.properties),
      },
    }));
  }
  return {countries:mergeBuiltinTerritories({...collection,features:countries},displayPolicy.territoryMerges,{policyRevision:displayPolicy.revision}),subunits};
}
