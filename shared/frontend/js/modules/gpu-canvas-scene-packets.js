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

  // A Canvas path requires rings, not triangulated GPU meshes. Keep the
  // canonical physical land/water geometry in its existing resource owner and
  // pack only their original coordinates once per geometry object. This allows
  // the Worker to paint a certified physical mask while the optional GPU mesh
  // remains under preparation.
  const physicalGeometryCache = new WeakMap();
  function physicalGeometryPacket(geometry) {
    if (!geometry || (geometry.type !== 'MultiPolygon' && geometry.type !== 'Polygon')) return null;
    let cached = physicalGeometryCache.get(geometry);
    if (cached) return cached;
    const coordinates = [], ringOffsets = [0], polygonOffsets = [0];
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new TypeError('Canvas physical rings must have four points.');
        for (const point of ring) {
          if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
            throw new TypeError('Canvas physical rings contain nonfinite coordinates.');
          coordinates.push(point[0], point[1]);
        }
        ringOffsets.push(coordinates.length / 2);
      }
      polygonOffsets.push(ringOffsets.length - 1);
    }
    cached = Object.freeze({
      ringCoordinates: Float64Array.from(coordinates),
      ringOffsets: Uint32Array.from(ringOffsets),
      polygonOffsets: Uint32Array.from(polygonOffsets),
    });
    physicalGeometryCache.set(geometry, cached);
    return cached;
  }
  function physicalPolygons(context) {
    if (!context?.geometry || !context.revision) return [];
    const packets = [
      { key: 'physical-land', role: 'physical-land', geometry: context.geometry,
        revision: context.revision, order: -20000 },
    ];
    if (context.water && context.waterRevision) packets.push({
      key: 'physical-water', role: 'physical-water', geometry: context.water,
      revision: context.waterRevision, order: -19000,
    });
    return packets.map(({key,role,geometry,revision,order}) => ({
      ...physicalGeometryPacket(geometry),
      key, role, geometryRevision: revision,
      sourceKey: 'canvas-physical:'+key+':'+revision,
      order, style: {color:'#ffffff',fillAlpha:1}, blendMode:'normal',
    }));
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

  return Object.freeze({ delta, scenePolygons, physicalPolygons, sceneStrokes, countryBoundary,
    clear: () => sentGeometry.clear() });
}
