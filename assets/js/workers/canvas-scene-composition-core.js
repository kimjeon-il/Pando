// Shared by the classic Canvas worker and the main-thread fallback.
(function installCanvasSceneComposition(scope) {
  const geometries = new WeakMap();
  function geometryFor(packet) {
    if (geometries.has(packet)) return geometries.get(packet);
    const coordinates = [];
    for (let p = 0; p < packet.polygonOffsets.length - 1; p += 1) {
      const polygon = [];
      for (let r = packet.polygonOffsets[p]; r < packet.polygonOffsets[p + 1]; r += 1) {
        const ring = [];
        for (let i = packet.ringOffsets[r]; i < packet.ringOffsets[r + 1]; i += 1) ring.push([packet.ringCoordinates[i * 2], packet.ringCoordinates[i * 2 + 1]]);
        polygon.push(ring);
      }
      coordinates.push(polygon);
    }
    const geometry = { type: 'MultiPolygon', coordinates };
    geometries.set(packet, geometry);
    return geometry;
  }
  function drawPolygon(context, path, packet) {
    context.beginPath();
    path(geometryFor(packet));
    context.globalAlpha = packet.style.fillAlpha;
    context.globalCompositeOperation = packet.blendMode === 'multiply' ? 'multiply' : 'source-over';
    context.fillStyle = packet.style.color;
    context.fill();
  }
  function drawFills(context, path, packets, substrate, dpr) {
    const territories = packets.filter(packet => packet.role === 'territorial-fill')
      .sort((a, b) => a.territoryDepth - b.territoryDepth || a.order - b.order);
    for (const packet of territories) {
      context.save();
      context.beginPath();
      path(geometryFor(packet));
      context.clip();
      // Replace the parent's contribution, including when child alpha is zero.
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, substrate.width, substrate.height);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.drawImage(substrate, 0, 0);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPolygon(context, path, packet);
      context.restore();
    }
    for (const packet of packets.filter(packet => packet.role !== 'territorial-fill').sort((a, b) => a.order - b.order)) {
      context.save();
      drawPolygon(context, path, packet);
      context.restore();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }
  scope.PandoLabCanvasSceneComposition = Object.freeze({ drawFills });
})(globalThis);
