/** Restore embedded flags without altering the source package. Shared by both readers. */
export function applyImportedPackageAssets(metadata, entities) {
  const assets = new Map((metadata?.countryAssets || []).map(asset => [String(asset.countryId ?? ''), asset]));
  return entities.map(entity => {
    const asset = (entity.properties.entityKind === 'general' && !entity.properties.parentId) && assets.get(String(entity.id ?? ''));
    if (!asset?.base64) return entity;
    return { ...entity, properties: { ...entity.properties, metadata: { ...entity.properties.metadata,
      flagDataUrl: `data:${asset.mimeType || 'application/octet-stream'};base64,${asset.base64}` } } };
  });
}
