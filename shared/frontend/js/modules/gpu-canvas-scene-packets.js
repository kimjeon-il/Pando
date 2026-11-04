export function createCanvasScenePackets() {
  const sentGeometry = new Map();

  function delta(packets, channel) {
    const next = new Set();
    const result = packets.map(packet => {
      const key = `${channel}:${packet.key}`;
      next.add(key);
      const geometry = packet.ringCoordinates || packet.startsEnds;
      const previous = sentGeometry.get(key);
      sentGeometry.set(key, geometry);
      if (previous !== geometry) return packet;
      const { ringCoordinates: _coordinates, ringOffsets: _rings, polygonOffsets: _polygons, startsEnds: _segments, ...metadata } = packet;
      return metadata;
    });
    for (const key of sentGeometry.keys()) if (key.startsWith(`${channel}:`) && !next.has(key)) sentGeometry.delete(key);
    return result;
  }

  function scenePolygons(polygons) {
    return polygons.filter(packet => packet.ringCoordinates).map(packet => ({
      key: packet.key, sourceKey: packet.sourceKey, ringCoordinates: packet.ringCoordinates,
      ringOffsets: packet.ringOffsets, polygonOffsets: packet.polygonOffsets,
      role: packet.role, geometryRevision: packet.geometryRevision, territoryDepth: packet.territoryDepth,
      order: packet.order, style: packet.style, blendMode: packet.blendMode,
    }));
  }

  function sceneStrokes(scene) {
    return (scene?.strokes || []).map(packet => ({
      key: packet.key, startsEnds: packet.startsEnds, ownerRanges: packet.ownerRanges, ownerIds: packet.ownerIds,
      order: packet.order, style: packet.style, blendMode: packet.blendMode,
    }));
  }

  function countryBoundary(boundary) {
    if (!boundary) return null;
    const { segments, startsEnds, ownerRanges, internalOwners, outlineOwnerIds, outlineOverrides, geometryRevision, sourceQuality } = boundary;
    return { segments, startsEnds, ownerRanges, internalOwners, outlineOwnerIds, geometryRevision, sourceQuality,
      outlineOverrides: { startsEnds: outlineOverrides.startsEnds, ownerRanges: outlineOverrides.ownerRanges,
        ownerIds: outlineOverrides.ownerIds, internalOwners: outlineOverrides.internalOwners } };
  }

  return Object.freeze({ delta, scenePolygons, sceneStrokes, countryBoundary,
    clear: () => sentGeometry.clear() });
}
