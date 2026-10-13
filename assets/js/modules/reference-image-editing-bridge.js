let installedBridge = null;

export function installReferenceImageEditingBridge(getEditingDomain, reportOperationError) {
  if (typeof getEditingDomain !== 'function') throw new TypeError('editing domain getter is required');
  if (typeof reportOperationError !== 'function') throw new TypeError('reference image command error boundary is required');
  if (installedBridge) return installedBridge;
  const bridge = Object.freeze({
    isDraftActive() {
      return getEditingDomain()?.draftInputActive?.() === true;
    },
    async applyDraftCoordinates(coordinates, { source = 'reference-image-line-refined' } = {}) {
      const editingDomain = getEditingDomain();
      if (!editingDomain?.draftInputActive?.() || !Array.isArray(coordinates) || coordinates.length < 2) return false;
      try {
        return await editingDomain.replaceDraftCoordinates(coordinates, {
          record: true,
          inputPhase: 'refine',
          buildPreview: true,
          reason: source,
        }) === true;
      } catch (error) {
        reportOperationError(error, { source });
        return false;
      }
    },
  });
  installedBridge = bridge;
  globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__ = bridge;
  return bridge;
}
