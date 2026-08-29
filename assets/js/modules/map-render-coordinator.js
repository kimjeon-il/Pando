export function createMapRenderCoordinator({
  requestFrame,
  prepareView,
  renderers,
}) {
  let renderRevision = 0;
  let fullQueued = false;
  let viewQueued = false;

  function render({ viewOnly = false } = {}) {
    renderRevision += 1;
    const viewRevision = prepareView();
    renderers.base();
    renderers.countries(viewRevision);
    if (viewOnly) renderers.hydroSelectionPosition();
    else renderers.hydro();
    renderers.hydroEdits();
    renderers.boundaryEdit();
    renderers.territorialUnits();
    renderers.distributions();
    renderers.drawings();
    renderers.stackOverlays();
    renderers.geometryPreview();
    renderers.hover();
    renderers.selection();
    renderers.validation();
    if (viewOnly) {
      renderers.countryLabelPositions();
      renderers.userLabelPositions();
    } else {
      renderers.countryLabels();
      renderers.userLabels();
    }
    renderers.vertices();
    renderers.draft();
    renderers.snapIndicator();
    renderers.debug();
    if (!viewOnly) renderers.layerTree();
    return { renderRevision, viewRevision, viewOnly };
  }

  function scheduleFull() {
    if (fullQueued) return false;
    fullQueued = true;
    requestFrame(() => {
      fullQueued = false;
      render();
    });
    return true;
  }

  function scheduleView() {
    if (viewQueued) return false;
    viewQueued = true;
    requestFrame(() => {
      viewQueued = false;
      render({ viewOnly: true });
    });
    return true;
  }

  function advanceRevision() {
    renderRevision += 1;
    return renderRevision;
  }

  return Object.freeze({
    renderFull: () => render(),
    renderView: () => render({ viewOnly: true }),
    scheduleFull,
    scheduleView,
    advanceRevision,
    revision: () => renderRevision,
  });
}
