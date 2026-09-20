let installedBridge = null;

export function installReferenceImageEditingBridge(getEditingDomain) {
  if (installedBridge) return installedBridge;
  if (typeof getEditingDomain !== 'function') throw new TypeError('editing domain getter is required');
  const bridge = Object.freeze({
    isDraftActive() {
      return getEditingDomain()?.draftInputActive?.() === true;
    },
    applyDraftCoordinates(coordinates, { source = 'reference-image-line-refined' } = {}) {
      const editingDomain = getEditingDomain();
      if (!editingDomain?.draftInputActive?.() || !Array.isArray(coordinates) || coordinates.length < 2) return false;
      return editingDomain.replaceDraftCoordinates?.(coordinates, {
        record: true,
        inputPhase: 'refine',
        buildPreview: true,
        reason: source,
      }) === true;
    },
  });
  installedBridge = bridge;
  globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__ = bridge;
  return bridge;
}
