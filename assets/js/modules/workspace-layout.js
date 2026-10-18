export function isMobileWorkspaceLayout(layout) {
  return layout === 'mobile' || layout === 'phone-landscape';
}

// Layout dimensions choose the mode; the visual viewport only sizes visible panels.
export function createWorkspaceLayoutDetector() {
  let previousWidth = 0;
  let layoutHeight = 0;
  return ({ width, height, coarse, editingText = false }) => {
    if (width !== previousWidth || !editingText || height > layoutHeight) layoutHeight = height;
    previousWidth = width;
    if (coarse && width > layoutHeight && layoutHeight < 600) return 'phone-landscape';
    return width < 800 ? 'mobile' : width < 1360 ? 'compact' : 'wide';
  };
}
