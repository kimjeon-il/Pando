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
      (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)(
        (0, dependencies.enterTerritorialCreateWorkflow)(dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT), { fromCreate: true },
      ));
    });
    (0, dependencies.$)('addRegionBtn')?.addEventListener('click', () => {
      (0, dependencies.requestDraftDiscard)(() => (0, dependencies.returnToMapAfterMobileAction)(
        (0, dependencies.enterTerritorialCreateWorkflow)(dependencies.TERRITORIAL_UNIT_TYPES.REGION), { fromCreate: true },
      ));
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
    (0, dependencies.$)('territorialCreateNameInput')?.addEventListener('input', event => (0, dependencies.territorySelectionUpdateName)(event.currentTarget.value));
    (0, dependencies.$)('territorialCreateSovereignInput')?.addEventListener('change', event => (0, dependencies.updateTerritorialCreateSovereign)(event.currentTarget.value));
    (0, dependencies.$)('territorialCreateParentInput')?.addEventListener('change', event => (0, dependencies.updateTerritorialCreateParent)(event.currentTarget.value));
    (0, dependencies.$)('territorialCreateSourceInput')?.addEventListener('change', event => (0, dependencies.updateTerritorialCreateSource)(event.currentTarget.value));
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
    (0, dependencies.$)('multiDrawnAddBtn')?.addEventListener('click', () => {
      const action = dependencies.state.territorySelectionSession ? dependencies.territorySelectionAddPart : dependencies.addMultiDraftPart;
      void (0, dependencies.runModePrimaryAction)(action);
    });
    (0, dependencies.$)('multiDrawnUndoBtn')?.addEventListener('click', () => {
      const action = dependencies.state.territorySelectionSession ? dependencies.territorySelectionUndoPart : dependencies.undoMultiDraftPart;
      void (0, dependencies.runModePrimaryAction)(action);
    });
    (0, dependencies.$)('modeTaskMinimizeBtn')?.addEventListener('click', dependencies.toggleMapTaskWindow);
    (0, dependencies.$)('modeDirectLineMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) void (0, dependencies.territorySelectionSelectMethod)('line');
    });
    (0, dependencies.$)('modePolygonMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) void (0, dependencies.territorySelectionSelectMethod)('polygon');
    });
    (0, dependencies.$)('modeComponentsMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) void (0, dependencies.territorySelectionSelectMethod)('components');
    });
    (0, dependencies.$)('territorialReferenceStartBtn')?.addEventListener('click', () => {
      void (0, dependencies.territorySelectionStartReferenceMethod)();
    });
    (0, dependencies.$)('modeMethodChangeKeepBtn')?.addEventListener('click', () => {
      (0, dependencies.territorySelectionCancelMethodChange)();
    });
    (0, dependencies.$)('modeMethodChangeConfirmBtn')?.addEventListener('click', () => {
      void (0, dependencies.territorySelectionConfirmMethodChange)();
    });
    (0, dependencies.$)('modeRiverBoundaryInput')?.addEventListener('change', event => (0, dependencies.territorySelectionToggleRiverBoundaries)(event.currentTarget.checked));
    (0, dependencies.$)('modeDraftInsertBtn')?.addEventListener('click', () => {
      dependencies.editingDomain?.setDraftVertexInsertMode?.(!dependencies.editingDomain.snapshot().draft.vertexInsertMode);
    });
    (0, dependencies.$)('modeDraftDoneBtn')?.addEventListener('click', () => { void dependencies.completeCurrentDraft(); });
    (0, dependencies.$)('modeDraftRedrawBtn')?.addEventListener('click', () => dependencies.redrawCurrentDraft());
    (0, dependencies.$)('modeDraftDeleteBtn')?.addEventListener('click', () => dependencies.editingDomain?.deleteSelectedDraftPoint());
    (0, dependencies.$)('modeCancelBtn')?.addEventListener('click', () => {
      const selection = dependencies.state.territorySelectionSession;
      if (selection) {
        if (selection.stage !== 'setup') (0, dependencies.territorySelectionBack)();
        else (0, dependencies.cancelActiveMode)();
        return;
      }
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
        if (dependencies.state.territorySelectionSession?.kind === 'annex'
          && dependencies.state.territorySelectionSession.targetCountryId === dependencies.state.selected.id) (0, dependencies.cancelActiveMode)();
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
