import { countryDrawRangesForFrame } from './gpu-country-ranges.js';

export function prepareGpuBaseScene({ mesh, overrideMesh, frame, scene, budgetBytes }, { polygonOverlayPass, strokeRenderer }) {
  let overrunCount = 0;
      const overlayItems = [
        ...(scene?.polygons || []).map(packet => ({ kind: 'polygon', packet })),
        ...(scene?.strokes || []).map(packet => ({ kind: 'stroke', packet })),
      ].sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));
      const uploadBudget = Math.max(64 * 1024, Number(budgetBytes) || 8 * 1024 * 1024);
      let overlayUploadBytes = 0;
      const deferredOverlayKeys = new Set();
      const failedOverlayKeys = new Set();
      const uploadCandidates = overlayItems.filter(item => {
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        return !(pass.hasPreparedResource?.(item.packet) ?? pass.hasResource?.(item.packet.key));
      }).sort((left, right) => Number(right.packet.protected === true) - Number(left.packet.protected === true)
        || Number(right.packet.priority || 0) - Number(left.packet.priority || 0)
        || Number(left.packet.order || 0) - Number(right.packet.order || 0));
      for (const item of uploadCandidates) {
        const byteLength = Math.max(0, Number(item.packet.byteLength
          || item.packet.positions?.byteLength + item.packet.indices?.byteLength
          || item.packet.startsEnds?.byteLength || 0));
        const protectedUpload = item.packet.protected === true;
        if (!protectedUpload && overlayUploadBytes > 0 && overlayUploadBytes + byteLength > uploadBudget) {
          deferredOverlayKeys.add(String(item.packet.key));
          continue;
        }
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        const uploaded = pass.ensureResource?.(item.packet)?.resource;
        if (uploaded) {
          overlayUploadBytes += Number(uploaded.byteLength || byteLength);
          if (overlayUploadBytes > uploadBudget) overrunCount += 1;
        } else failedOverlayKeys.add(String(item.packet.key));
      }

  return {
    baseTriangleDraw: countryDrawRangesForFrame(mesh, frame, { kind: 'triangle' }),
    baseBoundaryDraw: countryDrawRangesForFrame(mesh, frame, { kind: 'boundary' }),
    overrideTriangleDraw: countryDrawRangesForFrame(overrideMesh, frame, { kind: 'triangle' }),
    overrideBoundaryDraw: countryDrawRangesForFrame(overrideMesh, frame, { kind: 'boundary' }),
    overlayItems,
    territoryItems: overlayItems.filter(item => item.kind === 'polygon' && item.packet.role === 'territorial-fill')
      .sort((a, b) => b.packet.territoryDepth - a.packet.territoryDepth || b.packet.order - a.packet.order),
    polygonItems: overlayItems.filter(item => item.kind === 'polygon' && item.packet.role !== 'territorial-fill'),
    strokeItems: overlayItems.filter(item => item.kind === 'stroke'),
    deferredOverlayKeys, failedOverlayKeys, overlayUploadBytes, overrunCount,
  };
}

export function prepareGpuInteraction({ previewPackets = [], draftPackets = [] }, { polygonOverlayPass, strokeRenderer, selectionPass }) {
  for (const item of [...previewPackets, ...draftPackets]) {
    const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
    pass.ensureResource(item.packet);
  }
  selectionPass?.prepare?.();
}

export function prepareGpuInteractionPlan({ interaction, emphasis, mesh, overrideMesh, overrideIds, countriesVisible, blocked, isPending, isVisible }, polygonOverlayPass) {
  const preview = (interaction.previewPackets || []).filter(item => item.kind === 'polygon').map(item => item.packet);
  const draft = (interaction.draftPackets || []).filter(item => item.kind === 'polygon').map(item => item.packet);
  const generic = interaction.genericFillItems || [];
  const emphasizedIds = [...new Set([...emphasis.selectedIds, emphasis.primaryId, emphasis.hoverId].map(String).filter(Boolean))];
  const priorities = [5, 4, 3, 2].map(priority => {
    const ids = countriesVisible && !blocked ? emphasizedIds.filter(id => Number(emphasis.priorities[id] || (emphasis.primaryIds.has(id) ? 4 : emphasis.selectedIds.has(id) ? 3 : 2)) === priority && !isPending(id) && isVisible(id)) : [];
    return {
      priority,
      preview: preview.filter(packet => Number(packet.interactionPriority || 5) === priority),
      draft: draft.filter(packet => Number(packet.interactionPriority || 5) === priority),
      generic: generic.filter(item => Number(item.priority || 2) === priority)
        .sort((a, b) => Number(a.depth || 0) - Number(b.depth || 0) || String(a.objectKey || a.key).localeCompare(String(b.objectKey || b.key))),
      country: {
        base: ids.filter(id => !overrideIds.has(id)).flatMap(id => mesh?.triangleRangesByCountryId?.get(id) || []),
        override: ids.filter(id => overrideIds.has(id)).flatMap(id => overrideMesh?.triangleRangesByCountryId?.get(id) || []),
      },
    };
  });
  return {
    priorities, genericKeys: generic.map(item => item.key), previewFillKeys: preview.map(packet => packet.key), draftFillKeys: draft.map(packet => packet.key),
    previewStrokes: (interaction.previewPackets || []).filter(item => item.kind !== 'polygon').map(item => item.packet),
    draftStrokes: (interaction.draftPackets || []).filter(item => item.kind !== 'polygon').map(item => item.packet),
    fillReady: generic.every(item => polygonOverlayPass.hasResource(item.key))
      && [...preview, ...draft].every(packet => polygonOverlayPass.hasPreparedResource?.(packet) ?? polygonOverlayPass.hasResource(packet.key))
      && emphasizedIds.every(id => !isPending(id)),
  };
}
