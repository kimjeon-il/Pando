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
