// Shared by the classic Canvas worker and the main-thread fallback.
(function installCanvasSceneComposition(scope) {
  const geometries = new WeakMap();
  function geometryFor(packet) {
    if (geometries.has(packet.ringCoordinates)) return geometries.get(packet.ringCoordinates);
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
    geometries.set(packet.ringCoordinates, geometry);
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
  const emphasisSubstrates = new WeakMap();
  const emphasisWater = new WeakMap();
  function drawEmphasis(context, path, entries, dpr, water = null) {
    const canvas = context.canvas;
    let substrate = emphasisSubstrates.get(canvas);
    if (!substrate) {
      substrate = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(canvas.width, canvas.height)
        : canvas.ownerDocument.createElement('canvas');
      emphasisSubstrates.set(canvas, substrate);
    }
    if (substrate.width !== canvas.width || substrate.height !== canvas.height) {
      substrate.width = canvas.width; substrate.height = canvas.height;
    }
    const target = substrate.getContext('2d');
    target.clearRect(0, 0, canvas.width, canvas.height);
    target.drawImage(canvas, 0, 0);
    // Replace the lower grade with the original substrate before tinting.
    // Clip preserves holes and uses no destructive geometry operations.
    for (const entry of [...entries].sort((a, b) => a.priority - b.priority || Number(b.depth || 0) - Number(a.depth || 0) || String(b.key).localeCompare(String(a.key)))) {
      if (!(entry.style.fillAlpha > 0)) continue;
      context.save();
      context.beginPath(); path(entry.geometry || geometryFor(entry.packet)); context.clip();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      context.drawImage(substrate, 0, 0);
      context.globalAlpha = entry.style.fillAlpha;
      context.fillStyle = entry.style.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
    if (water?.draw && entries.some(entry => entry.style.fillAlpha > 0)) {
      let cached = emphasisWater.get(canvas);
      if (!cached || cached.mask.width !== canvas.width || cached.mask.height !== canvas.height) {
        const make = () => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(canvas.width, canvas.height) : Object.assign(canvas.ownerDocument.createElement('canvas'), { width: canvas.width, height: canvas.height });
        cached = { mask: make(), restored: make(), key: null }; emphasisWater.set(canvas, cached);
      }
      if (water.key == null || cached.key !== water.key) {
        const mask = cached.mask.getContext('2d'); mask.setTransform(1, 0, 0, 1, 0, 0); mask.clearRect(0, 0, canvas.width, canvas.height);
        mask.setTransform(dpr, 0, 0, dpr, 0, 0); water.draw(mask); cached.key = water.key;
      }
      const restore = cached.restored.getContext('2d'); restore.globalCompositeOperation = 'source-over';
      restore.clearRect(0, 0, canvas.width, canvas.height); restore.drawImage(substrate, 0, 0);
      restore.globalCompositeOperation = 'destination-in'; restore.drawImage(cached.mask, 0, 0);
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over'; context.drawImage(cached.restored, 0, 0); context.restore();
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.globalAlpha = 1;
  }
  scope.PandoLabCanvasSceneComposition = Object.freeze({ drawFills, drawEmphasis, geometryFor });
})(globalThis);
