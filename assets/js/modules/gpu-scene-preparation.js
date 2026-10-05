import { INTERACTION_ROLE_PRIORITY } from './layer-presentation.js';
import { countryDrawRangesForFrame } from './gpu-country-ranges.js';

// A scene key identifies a visual; a resource key identifies its immutable GPU
// geometry in one project generation. Uploading B must not overwrite active A.
export function sceneStrokeResourcePacket(packet, projectGeneration) {
  if (!packet.sourceKey) throw new TypeError('Scene strokes require a geometry sourceKey.');
  return Object.freeze({ ...packet, visualKey: packet.key, projectGeneration, key: `scene-stroke:${projectGeneration}:${packet.sourceKey}` });
}

// Called only after the selected base scene was actually presented, never from
// an upload callback or preparation. Retire the old buffers after that frame.
export function commitGpuStrokeDomains(result, frame, presentedStrokeDomains, strokeRenderer) {
  if (!result || result.frameId !== frame.frameId || result.projectGeneration !== frame.projectGeneration) return false;
  const rendered = new Set(result.overlayRenderedKeys), missing = new Set(result.overlayMissingKeys);
  let changed = false;
  for (const { domain, items } of result.strokeDomainReplacements || []) {
    if (!items.every(item => rendered.has(item.packet.key) && !missing.has(item.packet.key))) continue;
    const keep = new Set(items.map(item => item.resourcePacket.key));
    const previous = presentedStrokeDomains.get(domain) || [];
    presentedStrokeDomains.set(domain, items);
    for (const item of previous) if (!keep.has(item.resourcePacket.key)) strokeRenderer.releaseResource(item.resourcePacket.key);
    changed = true;
  }
  return changed;
}

export function prepareGpuBaseScene({ mesh, overrideMesh, frame, scene, budgetBytes, presentedStrokeDomains }, { polygonOverlayPass, strokeRenderer }) {
  if (!(presentedStrokeDomains instanceof Map)) throw new TypeError('Presented stroke domains are required.');
  let overrunCount = 0;
      const overlayItems = [
        ...(scene?.polygons || []).map(packet => ({ kind: 'polygon', packet })),
        ...(scene?.strokes || []).filter(packet => Number(packet.style?.alpha ?? 1) > 0 && Number(packet.style?.width ?? 1) > 0)
          .map(packet => ({ kind: 'stroke', packet, resourcePacket: sceneStrokeResourcePacket(packet, frame.projectGeneration ?? 0) })),
      ].sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));
      const uploadBudget = Math.max(64 * 1024, Number(budgetBytes) || 8 * 1024 * 1024);
      let overlayUploadBytes = 0;
      const deferredOverlayKeys = new Set();
      const failedOverlayKeys = new Set();
      const uploadCandidates = overlayItems.filter(item => {
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        const resourcePacket = item.resourcePacket || item.packet;
        return !(pass.hasPreparedResource?.(resourcePacket) ?? pass.hasResource?.(resourcePacket.key));
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
        const result = pass.ensureResource(item.resourcePacket || item.packet);
        const uploaded = result?.resource;
        if (uploaded) {
          overlayUploadBytes += Number(uploaded.byteLength || byteLength);
          if (overlayUploadBytes > uploadBudget) overrunCount += 1;
        } else if (result?.reason === 'upload-pending') deferredOverlayKeys.add(String(item.packet.key));
        else failedOverlayKeys.add(String(item.packet.key));
      }

  const desiredDomains = new Map();
  for (const item of overlayItems.filter(item => item.kind === 'stroke')) {
    const domain = item.packet.domain || item.packet.key;
    if (!desiredDomains.has(domain)) desiredDomains.set(domain, []);
    desiredDomains.get(domain).push(item);
  }
  const strokeDomainReplacements = [];
  const strokeDomainFallbacks = new Map();
  const selectedStrokes = [];
  for (const domain of new Set([...presentedStrokeDomains.keys(), ...desiredDomains.keys()])) {
    const desired = desiredDomains.get(domain) || [];
    const visualKeys = new Set(desired.map(item => item.packet.key));
    const objects = new Set(desired.map(item => item.packet.objectKey).filter(Boolean));
    const owners = new Set(desired.flatMap(item => item.packet.continuityOwnerIds || []));
    const fallback = (presentedStrokeDomains.get(domain) || []).filter(item =>
      desired.length > 0 && item.resourcePacket.projectGeneration === (frame.projectGeneration ?? 0)
      && (item.packet.continuityOwnerIds || []).every(id => owners.has(id))
      && ((item.packet.continuityOwnerIds || []).length > 0 || visualKeys.has(item.packet.key))
      && (!item.packet.objectKey || (objects.has(item.packet.objectKey) && visualKeys.has(item.packet.key))));
    strokeDomainFallbacks.set(domain, fallback);
    const ready = desired.every(item => !deferredOverlayKeys.has(item.packet.key) && !failedOverlayKeys.has(item.packet.key)
      && strokeRenderer.hasPreparedResource(item.resourcePacket));
    if (ready) {
      selectedStrokes.push(...desired);
      strokeDomainReplacements.push({ domain, items: desired });
    } else {
      selectedStrokes.push(...fallback);
    }
  }
  const selectedItems = [...overlayItems.filter(item => item.kind === 'polygon'), ...selectedStrokes]
    .sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));

  return {
    baseTriangleDraw: countryDrawRangesForFrame(mesh, frame, { kind: 'triangle' }),
    baseBoundaryDraw: countryDrawRangesForFrame(mesh, frame, { kind: 'boundary' }),
    overrideTriangleDraw: countryDrawRangesForFrame(overrideMesh, frame, { kind: 'triangle' }),
    overrideBoundaryDraw: countryDrawRangesForFrame(overrideMesh, frame, { kind: 'boundary' }),
    overlayItems: selectedItems,
    strokeDomainReplacements,
    strokeDomainFallbacks,
    canPreserveStrokeScene: [...presentedStrokeDomains].every(([domain, items]) => {
      const eligible = new Set(strokeDomainFallbacks.get(domain).map(item => item.resourcePacket.key));
      return items.every(item => eligible.has(item.resourcePacket.key));
    }),
    territoryItems: selectedItems.filter(item => item.kind === 'polygon' && item.packet.role === 'territorial-fill')
      .sort((a, b) => b.packet.territoryDepth - a.packet.territoryDepth || b.packet.order - a.packet.order),
    independentItems: selectedItems.filter(item => item.kind !== 'polygon' || item.packet.role !== 'territorial-fill'),
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
  const priorities = [...new Set(Object.values(INTERACTION_ROLE_PRIORITY))].filter(priority => priority > 1).sort((a, b) => b - a).map(priority => {
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
