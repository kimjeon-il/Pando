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
    (0, dependencies.platform.$)('addCountryBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingB.enterNewCountryMode)(), { destination: 'editor' }));
    });
    (0, dependencies.platform.$)('addSubunitBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)(
        (0, dependencies.territorialEditingA.enterTerritorialCreateWorkflow)(dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT), { destination: 'editor' },
      ));
    });
    (0, dependencies.platform.$)('addRegionBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)(
        (0, dependencies.territorialEditingA.enterTerritorialCreateWorkflow)(dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION), { destination: 'editor' },
      ));
    });
    (0, dependencies.platform.$)('addDistributionBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => {
        (0, dependencies.workspaceUiA.closeSurface)('create');
        const created = (0, dependencies.propertyEditingA.createDistributionLayerFromPrompt)({
          beforeCreate: dependencies.genericEditingA.discardActiveDraftSilently,
        });
        if (created) (0, dependencies.workspaceUiA.completeToolStart)(true, { destination: 'editor' });
        else (0, dependencies.workspaceUiB.openSurface)('create');
      });
    });
    (0, dependencies.platform.$)('territorialCreateNameInput')?.addEventListener('input', event => (0, dependencies.territorySelectionB.territorySelectionUpdateName)(event.currentTarget.value));
    (0, dependencies.platform.$)('territorialCreateSovereignInput')?.addEventListener('change', event => (0, dependencies.territorialEditingB.updateTerritorialCreateSovereign)(event.currentTarget.value));
    (0, dependencies.platform.$)('territorialCreateParentInput')?.addEventListener('change', event => (0, dependencies.territorialEditingB.updateTerritorialCreateParent)(event.currentTarget.value));
    (0, dependencies.platform.$)('territorialCreateSourceInput')?.addEventListener('change', event => (0, dependencies.territorialEditingB.updateTerritorialCreateSource)(event.currentTarget.value));
    (0, dependencies.platform.$)('addLabelBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingA.enterLabelMode)()));
    });
    (0, dependencies.platform.$)('addRiverBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingB.enterTerrainGenericFeatureMode)('river')));
    });
    (0, dependencies.platform.$)('addLakeBtn')?.addEventListener('click', () => {
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingB.enterTerrainGenericFeatureMode)('lake')));
    });
    (0, dependencies.platform.$)('modePrimaryBtn')?.addEventListener('click', () => { void (0, dependencies.taskPresentation.runModePrimaryAction)(); });
    (0, dependencies.platform.$)('modeTaskTargetsFocusBtn')?.addEventListener('click', dependencies.taskPresentation.focusTaskTargets);
    for (const [id, command] of [['multiDrawnAddBtn', dependencies.countryCommitFlow.addMultiDraftPart], ['multiDrawnUndoBtn', dependencies.countryCommitFlow.undoMultiDraftPart]]) {
      dependencies.platform.$(id)?.addEventListener('click', event => {
        if (event.currentTarget.disabled || dependencies.projectState.state.modeProcessing) return;
        // These synchronous commands own the idle guard; do not mark them busy before calling.
        try { command(); }
        catch (error) { dependencies.feedback.reportOperationError(error, '그리기 목록을 변경하지 못했습니다.', 'PL-MULTI-DRAFT-UI-001', 4200); }
      });
    }
    (0, dependencies.platform.$)('territorySelectionStackList')?.addEventListener('click', event => {
      const button = event.target.closest('button[data-item-kind]');
      if (!button || !event.currentTarget.contains(button)) return;
      const action = button.dataset.itemKind === 'part'
        ? () => dependencies.territorySelectionA.removeTerritorySelectionPart(button.dataset.itemId)
        : () => dependencies.territorySelectionC.toggleTerritorySelectionComponent(button.dataset.itemId);
      void (0, dependencies.taskPresentation.runModePrimaryAction)(action);
    });
    (0, dependencies.platform.$)('modeTaskResultsList')?.addEventListener('click', event => {
      const button = event.target.closest('button[data-object-id]');
      if (!button || button.disabled || !event.currentTarget.contains(button)) return;
      const tool = dependencies.projectState.state.tool;
      if (!['merge-country', 'merge-territorial-unit'].includes(tool)) return;
      const action = tool === 'merge-country'
        ? () => dependencies.countryEditingC.toggleMergeTarget(button.dataset.objectId)
        : () => dependencies.territorialEditingB.toggleTerritorialUnitMergeTarget(button.dataset.objectId);
      void (0, dependencies.taskPresentation.runModePrimaryAction)(action);
    });
    (0, dependencies.platform.$)('modeTaskMinimizeBtn')?.addEventListener('click', dependencies.taskPresentation.toggleMapTaskWindow);
    (0, dependencies.platform.$)('modeDirectLineMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) void (0, dependencies.taskPresentation.runModePrimaryAction)(
        () => (0, dependencies.territorySelectionB.territorySelectionSelectMethod)('line'));
    });
    (0, dependencies.platform.$)('modePolygonMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) void (0, dependencies.taskPresentation.runModePrimaryAction)(
        () => (0, dependencies.territorySelectionB.territorySelectionSelectMethod)('polygon'));
    });
    (0, dependencies.platform.$)('modeComponentsMethodInput')?.addEventListener('change', event => {
      if (event.currentTarget.checked) void (0, dependencies.taskPresentation.runModePrimaryAction)(
        () => (0, dependencies.territorySelectionB.territorySelectionSelectMethod)('components'));
    });
    (0, dependencies.platform.$)('territorialReferenceStartBtn')?.addEventListener('click', () => {
      void (0, dependencies.taskPresentation.runModePrimaryAction)(
        dependencies.territorySelectionB.territorySelectionStartReferenceMethod);
    });
    (0, dependencies.platform.$)('modeMethodChangeKeepBtn')?.addEventListener('click', () => {
      (0, dependencies.territorySelectionB.territorySelectionCancelMethodChange)();
    });
    (0, dependencies.platform.$)('modeMethodChangeConfirmBtn')?.addEventListener('click', () => {
      void (0, dependencies.taskPresentation.runModePrimaryAction)(
        dependencies.territorySelectionB.territorySelectionConfirmMethodChange);
    });
    (0, dependencies.platform.$)('modeRiverBoundaryInput')?.addEventListener('change', event => (0, dependencies.territorySelectionB.territorySelectionToggleRiverBoundaries)(event.currentTarget.checked));
    (0, dependencies.platform.$)('modeDraftInsertBtn')?.addEventListener('click', () => {
      dependencies.domains.editingDomain?.setDraftVertexInsertMode?.(!dependencies.domains.editingDomain.snapshot().draft.vertexInsertMode);
    });
    (0, dependencies.platform.$)('modeDraftDoneBtn')?.addEventListener('click', () => { void dependencies.taskPresentation.completeCurrentDraft(); });
    (0, dependencies.platform.$)('modeDraftRedrawBtn')?.addEventListener('click', () => dependencies.countryCommitFlow.redrawCurrentDraft());
    (0, dependencies.platform.$)('modeDraftDeleteBtn')?.addEventListener('click', () => dependencies.domains.editingDomain?.deleteSelectedDraftPoint());
    (0, dependencies.platform.$)('modeCancelBtn')?.addEventListener('click', () => {
      const selection = dependencies.projectState.state.territorySelectionSession;
      if (selection) {
        if (selection.stage !== 'setup') (0, dependencies.territorySelectionB.territorySelectionBack)();
        else (0, dependencies.countryEditingA.cancelActiveMode)();
        return;
      }
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => {
        if (dependencies.projectState.state.geometryPreview.session) (0, dependencies.geometryOperations.discardActiveGeometryPreview)();
        else if (dependencies.projectState.state.labelPlacementMode || dependencies.projectState.state.tool === 'label') (0, dependencies.countryEditingB.exitLabelMode)();
        else if ((0, dependencies.surfaces.isGenericFeatureDraftTool)(dependencies.projectState.state.tool)) (0, dependencies.genericEditingA.cancelDraft)(true);
        else (0, dependencies.countryEditingA.cancelActiveMode)();
      });
    });
    (0, dependencies.platform.$)('annexTerritoryBtn')?.addEventListener('click', () => {
      if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => {
        if (dependencies.projectState.state.territorySelectionSession?.kind === 'annex'
          && dependencies.projectState.state.territorySelectionSession.targetCountryId === dependencies.projectState.state.selected.id) (0, dependencies.countryEditingA.cancelActiveMode)();
        else (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingA.enterAnnexTerritoryMode)(dependencies.projectState.state.selected.id));
      });
    });
    (0, dependencies.platform.$)('editBorderBtn')?.addEventListener('click', () => {
      if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => {
        if (dependencies.projectState.state.tool === 'country-border' && dependencies.projectState.state.boundaryEditPhase === 'editing') (0, dependencies.countryEditingB.finishCountryBorderEdit)();
        else (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingA.enterCountryBorderSelection)(dependencies.projectState.state.selected.id));
      });
    });
    (0, dependencies.platform.$)('editCoastBtn')?.addEventListener('click', () => {
      if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return;
      (0, dependencies.genericEditingB.requestDraftDiscard)(() => {
        if (dependencies.projectState.state.tool === 'country-coast' && dependencies.projectState.state.coastEditCountryId === dependencies.projectState.state.selected.id) (0, dependencies.countryEditingB.finishCountryCoastEdit)();
        else (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingA.enterCountryCoastEdit)(dependencies.projectState.state.selected.id));
      });
    });
    (0, dependencies.platform.$)('mergeCountryBtn')?.addEventListener('click', () => {
      if ((dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.workspaceUiA.completeToolStart)((0, dependencies.countryEditingA.enterMergeCountryMode)(dependencies.projectState.state.selected.id)));
    });
    (0, dependencies.platform.$)('resetViewBtn').addEventListener('click', dependencies.navigation.resetView);
  }



  return Object.freeze({
    connect,

    get bindToolUI() { return bindToolUI; },
  });
}
