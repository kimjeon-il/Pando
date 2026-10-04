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
  function drawGeneralLand(context, path, packets, features = []) {
    context.beginPath();
    for (const feature of features) path(feature);
    for (const packet of packets) {
      if (packet.role !== 'territorial-fill') continue;
      path(geometryFor(packet));
    }
    context.fill();
  }
  function drawTerritorialFills(context, path, packets, substrate, dpr) {
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
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }
  const emphasisSubstrates = new WeakMap();
  const protectedPixels = new WeakMap();
  function protectionFor(context, dpr, protection) {
    if (!protection?.draw) return null;
    const canvas = context.canvas;
    let cached = protectedPixels.get(canvas);
    if (!cached || cached.mask.width !== canvas.width || cached.mask.height !== canvas.height) {
      const make = () => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(canvas.width, canvas.height)
        : Object.assign(canvas.ownerDocument.createElement('canvas'), { width: canvas.width, height: canvas.height });
      cached = { mask: make(), restored: make(), key: null }; protectedPixels.set(canvas, cached);
    }
    if (protection.key == null || cached.key !== protection.key) {
      const mask = cached.mask.getContext('2d');
      mask.setTransform(1, 0, 0, 1, 0, 0); mask.clearRect(0, 0, canvas.width, canvas.height);
      mask.setTransform(dpr, 0, 0, dpr, 0, 0); protection.draw(mask); cached.key = protection.key;
    }
    return cached;
  }
  function drawOverlays(context, path, polygons, strokes, dpr, protection = null) {
    const items = [...polygons.filter(packet => packet.role !== 'territorial-fill').map(packet => ({ packet, polygon: true })),
      ...strokes.map(packet => ({ packet, polygon: false }))].sort((a, b) => Number(a.packet.order || 0) - Number(b.packet.order || 0));
    const protectedArea = items.some(item => item.polygon) ? protectionFor(context, dpr, protection) : null;
    for (const { packet, polygon } of items) {
      if (!polygon) { drawStrokes(context, path, [packet]); continue; }
      context.save();
      try {
        if (!protectedArea) { drawPolygon(context, path, packet); continue; }
        const scratch = protectedArea.restored, target = scratch.getContext('2d');
        target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha = 1; target.globalCompositeOperation = 'source-over';
        target.clearRect(0, 0, scratch.width, scratch.height);
        target.setTransform(dpr, 0, 0, dpr, 0, 0);
        const previous = path.context();
        try { path.context(target); drawPolygon(target, path, { ...packet, blendMode: 'normal' }); }
        finally { path.context(previous); }
        target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha = 1; target.globalCompositeOperation = 'destination-out';
        target.drawImage(protectedArea.mask, 0, 0);
        context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
        context.globalCompositeOperation = packet.blendMode === 'multiply' ? 'multiply' : 'source-over';
        context.drawImage(scratch, 0, 0);
      } finally { context.restore(); }
    }
  }
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
      const cached = protectionFor(context, dpr, water);
      const restore = cached.restored.getContext('2d'); restore.globalCompositeOperation = 'source-over';
      restore.clearRect(0, 0, canvas.width, canvas.height); restore.drawImage(substrate, 0, 0);
      restore.globalCompositeOperation = 'destination-in'; restore.drawImage(cached.mask, 0, 0);
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over'; context.drawImage(cached.restored, 0, 0); context.restore();
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.globalAlpha = 1;
  }
  function countryBoundaryBatches(packet, theme, sharedOnly, styleForOwner) {
    if (!packet) return [];
    const solid = { color: theme.border, alpha: theme.borderAlpha,
      width: 0.72 * Math.max(0.5, Number(theme.borderWidth) || 1), cap: 'butt', join: 'round' };
    const batches = [];
    const groups = new Map();
    const add = (source, owners, dash = false) => {
      for (const owner of owners) {
        const ids = dash ? packet.internalOwners[owner] : owner.split('|');
        const opacity = Math.max(0, ...ids.map(id => styleForOwner(id)?.opacity || 0));
        if (!opacity) continue;
        const key = `${dash}:${opacity}:${source === packet}`;
        if (!groups.has(key)) groups.set(key, { ...source, ownerIds: [], style: { ...solid, alpha: solid.alpha * opacity,
          ...(dash ? { width: 1.1, dash: [3, 2], join: 'miter' } : {}) } });
        groups.get(key).ownerIds.push(owner);
      }
    };
    if (sharedOnly) {
      add(packet, Object.keys(packet.ownerRanges).filter(key => !packet.internalOwners[key]));
    } else {
      add(packet.outlineOverrides, packet.outlineOverrides.ownerIds);
    }
    add(packet, Object.keys(packet.internalOwners), true);
    batches.push(...groups.values());
    return batches;
  }
  function drawStrokes(context, path, packets) {
    for (const packet of [...packets].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))) {
      const ranges = packet.ownerIds && packet.ownerRanges
        ? packet.ownerIds.map(id => packet.ownerRanges[id]).filter(Boolean)
        : [{ first: 0, count: packet.startsEnds.length / 4 }];
      const coordinates = [];
      for (const range of ranges) for (let index = range.first; index < range.first + range.count; index++) {
        const offset = index * 4;
        const start = [packet.startsEnds[offset], packet.startsEnds[offset + 1]];
        const end = [packet.startsEnds[offset + 2], packet.startsEnds[offset + 3]];
        const previous = coordinates[coordinates.length - 1];
        const last = previous?.[previous.length - 1];
        if (last && last[0] === start[0] && last[1] === start[1]) previous.push(end);
        else coordinates.push([start, end]);
      }
      context.save();
      context.globalAlpha = packet.style.alpha;
      context.globalCompositeOperation = packet.blendMode === 'multiply' ? 'multiply' : 'source-over';
      context.strokeStyle = packet.style.color;
      context.lineWidth = packet.style.width;
      context.lineJoin = packet.style.join || 'round';
      context.lineCap = packet.style.cap || 'butt';
      context.setLineDash(packet.style.dash || []);
      context.beginPath(); path({ type: 'MultiLineString', coordinates }); context.stroke();
      context.restore();
    }
  }
  scope.PandoLabCanvasSceneComposition = Object.freeze({ drawTerritorialFills, drawOverlays, drawGeneralLand, drawEmphasis, geometryFor,
    countryBoundaryBatches, drawStrokes });
})(globalThis);
