/**
 * P6-2 TEST-ONLY: preserve geometry coordinates and all temporal ownership
 * metadata consumed by the exact pinned shared-boundary Worker.
 * Never call structuredClone/JSON.stringify on the interactive UI path.
 * This is not installed in the production renderer.
 */
export function projectCountryBoundaryMessage(message) {
  if (!message || !['replace','patch'].includes(message.type)
      || !Array.isArray(message.features)) return message;
  return {...message,features:message.features.map(feature=>{
    const properties=feature.properties||{};
    return {
      type:feature.type,id:feature.id,
      // Preserve exact original geometry objects/coordinate precision.
      geometry:feature.geometry,
      properties:{entityKind:properties.entityKind,parentId:properties.parentId},
      ...(Object.hasOwn(feature,'boundaryRootId')
        ?{boundaryRootId:feature.boundaryRootId}:{}),
      ...(Object.hasOwn(feature,'boundaryGeometryRevision')
        ?{boundaryGeometryRevision:feature.boundaryGeometryRevision}:{}),
    };
  })};
}
