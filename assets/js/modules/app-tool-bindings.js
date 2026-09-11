/** ToolBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createToolBindings() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('tool-bindings already connected');
    dependencies = ports;
  }

  function bindToolUI() {
    (0, dependencies.$)('addCountryBtn')?.addEventListener('click', () => {
      (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterNewCountryMode)(), { fromCreate: true }));
    });
    (0, dependencies.$)('addSubunitBtn')?.addEventListener('click', () => {
      (0, dependencies.openTerritorialCreateModal)(dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT);
    });
    (0, dependencies.$)('addRegionBtn')?.addEventListener('click', () => {
      (0, dependencies.openTerritorialCreateModal)(dependencies.TERRITORIAL_UNIT_TYPES.REGION);
    });
    const closeDistributionTypeModal = () => {
      (0, dependencies.$)('distributionTypeModal')?.classList.add('hidden');
      (0, dependencies.$)('addDistributionBtn')?.focus();
    };
    (0, dependencies.$)('addDistributionBtn')?.addEventListener('click', () => {
      (0, dependencies.$)('distributionTypeModal')?.classList.remove('hidden');
      requestAnimationFrame(() => (0, dependencies.$)('distributionTypeInput')?.focus());
    });
    (0, dependencies.$)('distributionTypeCancelBtn')?.addEventListener('click', closeDistributionTypeModal);
    (0, dependencies.$)('distributionTypeModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', closeDistributionTypeModal);
    (0, dependencies.$)('distributionTypeConfirmBtn')?.addEventListener('click', () => {
      const type = (0, dependencies.$)('distributionTypeInput')?.value || dependencies.DISTRIBUTION_TYPES.LANGUAGE;
      closeDistributionTypeModal();
      (0, dependencies.requestDraftDiscard)(() => {
        (0, dependencies.discardActiveDraftSilently)();
        const created = (0, dependencies.createDistributionLayerFromPrompt)(type);
        if (!created) return;
        (0, dependencies.closeCreateMenu)();
        if (dependencies.layoutMode !== 'wide') (0, dependencies.openSurface)('editor');
      });
    });
    (0, dependencies.$)('territorialCreateCancelBtn')?.addEventListener('click', dependencies.closeTerritorialCreateModal);
    (0, dependencies.$)('territorialCreateModal')?.querySelector('.confirm-modal-dim')?.addEventListener('click', dependencies.closeTerritorialCreateModal);
    (0, dependencies.$)('territorialCreateConfirmBtn')?.addEventListener('click', () => {
      const unitType = dependencies.pendingTerritorialCreateType;
      const method = (0, dependencies.$)('territorialCreateMethod').value;
      (0, dependencies.closeTerritorialCreateModal)();
      if (!unitType) return;
      if (method === 'geojson') {
        (0, dependencies.requestDraftDiscard)(() => {
          (0, dependencies.discardActiveDraftSilently)();
          const target = unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
            ? 'subunits'
            : unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION
              ? 'region'
              : 'subunit';
          const trigger = (0, dependencies.$)(unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT
            ? 'addSubunitBtn'
            : unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION
              ? 'addRegionBtn'
              : 'addSubunitBtn');
          void (0, dependencies.getGisFileController)().then(controller => controller.openPicker({ target, trigger }));
        });
        return;
      }
      (0, dependencies.requestDraftDiscard)(() => {
        const started = method === 'draw' ? (0, dependencies.enterTerritorialUnitDirectCreate)(unitType) : (0, dependencies.startTerritorialUnitCreate)(unitType);
        (0, dependencies.returnToMapAfterMobileAction)(started, { fromCreate: true });
      });
    });
    (0, dependencies.$)('addLabelBtn')?.addEventListener('click', () => {
      (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterLabelMode)(), { fromCreate: true }));
    });
    (0, dependencies.$)('addRiverBtn')?.addEventListener('click', () => {
      (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterTerrainGenericFeatureMode)('river'), { fromCreate: true }));
    });
    (0, dependencies.$)('addLakeBtn')?.addEventListener('click', () => {
      (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterTerrainGenericFeatureMode)('lake'), { fromCreate: true }));
    });
    (0, dependencies.$)('modePrimaryBtn')?.addEventListener('click', () => { void (0, dependencies.runModePrimaryAction)(); });
    (0, dependencies.$)('modeTaskMinimizeBtn')?.addEventListener('click', dependencies.toggleMapTaskWindow);
    (0, dependencies.$)('modeTaskCloseBtn')?.addEventListener('click', () => (0, dependencies.$)('modeCancelBtn')?.click());
    const selectTerritoryMethod = method => {
      (0, dependencies.requestDraftDiscard)(() => {
        const annexDonorMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'donor';
        if (annexDonorMode) (0, dependencies.beginAnnexSelection)();
        if (!annexDonorMode || method !== 'line') (0, dependencies.switchTerritorySelectionMethod)(method);
      });
    };
    (0, dependencies.$)('modeDirectLineMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) selectTerritoryMethod('line');
    });
    (0, dependencies.$)('modePolygonMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) selectTerritoryMethod('polygon');
    });
    (0, dependencies.$)('modeComponentsMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) selectTerritoryMethod('components');
    });
    (0, dependencies.$)('modeRiverBoundaryInput')?.addEventListener('change', event => (0, dependencies.toggleAnnexRiverBoundaries)(event.currentTarget.checked));
    (0, dependencies.$)('modeDraftRedrawBtn')?.addEventListener('click', () => dependencies.editingDomain?.redrawDraft?.());
    (0, dependencies.$)('modeDraftRemoveLastBtn')?.addEventListener('click', () => dependencies.editingDomain?.removeLastDraftPoint());
    (0, dependencies.$)('modeDraftDeleteBtn')?.addEventListener('click', () => dependencies.editingDomain?.deleteSelectedDraftPoint());
    (0, dependencies.$)('modeCancelBtn')?.addEventListener('click', () => {
      (0, dependencies.requestDraftDiscard)(() => {
        if (dependencies.state.geometryPreview.session) (0, dependencies.discardActiveGeometryPreview)();
        else if (dependencies.state.labelPlacementMode || dependencies.state.tool === 'label') (0, dependencies.exitLabelMode)();
        else if ((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool)) (0, dependencies.cancelDraft)(true);
        else (0, dependencies.cancelActiveMode)();
      });
    });
    (0, dependencies.$)('annexTerritoryBtn')?.addEventListener('click', () => {
      if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      (0, dependencies.requestDraftDiscard)(() => {
        if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexTargetCountryId === dependencies.state.selected.id) (0, dependencies.cancelActiveMode)();
        else (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterAnnexTerritoryMode)(dependencies.state.selected.id));
      });
    });
    (0, dependencies.$)('editBorderBtn')?.addEventListener('click', () => {
      if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      (0, dependencies.requestDraftDiscard)(() => {
        if (dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'editing') (0, dependencies.finishCountryBorderEdit)();
        else (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterCountryBorderSelection)(dependencies.state.selected.id));
      });
    });
    (0, dependencies.$)('editCoastBtn')?.addEventListener('click', () => {
      if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      (0, dependencies.requestDraftDiscard)(() => {
        if (dependencies.state.tool === 'country-coast' && dependencies.state.coastEditCountryId === dependencies.state.selected.id) (0, dependencies.finishCountryCoastEdit)();
        else (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterCountryCoastEdit)(dependencies.state.selected.id));
      });
    });
    (0, dependencies.$)('mergeCountryBtn')?.addEventListener('click', () => {
      if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)((0, dependencies.enterMergeCountryMode)(dependencies.state.selected.id)));
    });
    (0, dependencies.bindHoldZoom)((0, dependencies.$)('zoomInBtn'), 1.25);
    (0, dependencies.bindHoldZoom)((0, dependencies.$)('zoomOutBtn'), 0.8);
    (0, dependencies.$)('resetViewBtn').addEventListener('click', dependencies.resetView);
  }



  return Object.freeze({
    connect,

    get bindToolUI() { return bindToolUI; },
  });
}
