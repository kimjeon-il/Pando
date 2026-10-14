/** Read-only operation inputs and presentation after accepted Core history. */
export function createProjectSnapshots() {
  let dependencies;
  function connect(ports) {
    if(dependencies)throw new Error('project-snapshots already connected');dependencies=ports;
  }
  function configureDatasetSession(project) {
    dependencies.projectState.state.autosaveMode=project.baseDataset!==dependencies.platformConfigurationA.BASE_DATASET ? 'full':'delta';
  }
  function snapshotEditable() {
    return dependencies.domains.projectDomain.snapshot();
  }
  async function finishHistoryTravel() {
    dependencies.rendering.gpuMapRenderer.invalidateHydroVisibility();dependencies.hydroModel.syncPhysicalControls();
    // History travel runs inside ProjectDomain's command queue; the builtin catalog is unchanged.
    await dependencies.layerTree.pruneLayerItemVisibility({ catalogAlreadyAdmitted: true });
    dependencies.countries.scheduleCountryLabelAnchors(null,10);dependencies.layers.markLayerTreeDirty();
    dependencies.domains.layerTreeController.cancelSearch();dependencies.domains.layerTreeController.render(true);
    const state=dependencies.projectState.state;
    state.coastEditCountryId=null;state.coastEditScopeGenericFeatureId=null;state.coastEditReturnSelection=null;
    dependencies.countryEditingB.resetBoundaryEditState();dependencies.countryEditingB.resetMergeState();
    dependencies.countryEditingB.resetGenericFeatureMergeState();await dependencies.countryEditingB.resetTerritorialUnitEditState();
    state.genericFeatureSplitSourceId=null;await dependencies.countryEditingB.resetTerritoryEditingState(true);
    dependencies.domainControllers.objectPropertyController.show(null);dependencies.platform.$('selectionStatus').textContent='';
    state.boundaryPreparation?.cancel();state.boundaryPreparation=null;dependencies.spatialQuery.mapEditClient?.invalidateBoundaryCache();
    await dependencies.domains.editingDomain.setTool('select',{ announce: false });
    dependencies.taskUi.updateModeButtons();dependencies.lifecycleUi.projectUi.syncHistory();
  }
  return Object.freeze({ connect,configureDatasetSession,snapshotEditable,finishHistoryTravel });
}
