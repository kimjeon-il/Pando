import { createTerritorialFeature } from './territorial-units.js';
import { mergeBuiltinTerritories } from './builtin-territory-policy.js';

// Deterministic identity is stable across generated and saved projects.
// The relationship itself is stored in the compiled project metadata.
export const builtinSubunitId = sourceId => `d34b00a1-9b13-8000-8000-000000${[...sourceId].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;

export function builtinSubunitSourceId(feature) {
  const sourceId=feature?.properties?.metadata?.builtinSubunit?.sourceCountryId;
  return typeof sourceId==='string'&&sourceId
    &&feature?.properties?.entityKind==='general'
    &&!!feature.properties.parentId
    &&feature.id===builtinSubunitId(sourceId)?sourceId:'';
}
export function territorialSceneDisplayId(feature,countryIds) {
  if (feature.properties?.entityKind==='general'&&!feature.properties.parentId) return String(feature.id);
  const sourceId=builtinSubunitSourceId(feature);
  return sourceId&&!countryIds.has(sourceId)?sourceId:`territorial:entity:${feature.id}`;
}

export function appendBuiltinSourceAttribution(notes, sourceId, displayPolicy) {
  const original=String(notes||'');
  const row=displayPolicy?.sourceAttributions?.[sourceId];
  if(!row||original.includes(row.archive))return original;
  return [original,[row.scope,'© OpenStreetMap contributors · ODbL 1.0',
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
  return {countries:mergeBuiltinTerritories({...collection,features:countries},displayPolicy.territoryMerges),subunits};
}
