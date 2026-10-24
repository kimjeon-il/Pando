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

  function listen(element, type, action) {
    element?.addEventListener(type, async event => {
      try { await action(event); }
      catch (error) { dependencies.feedback.reportOperationError(error, '편집 도구 동작을 완료하지 못했습니다.', 'PL-TOOL-UI-001', 4200); }
    });
  }

  function bindToolUI() {
    listen(dependencies.platform.$('addEntityBtn'), 'click', async () => {
      await dependencies.genericEditingB.requestDraftDiscard(async () => dependencies.workspaceUiA.completeToolStart(
        await dependencies.territorialEditingA.enterTerritorialCreateWorkflow(), { destination: 'editor' }));
    });
    listen((0, dependencies.platform.$)('addDistributionBtn'), 'click', async () => {
      await dependencies.genericEditingB.requestDraftDiscard(async () => {
        const generation = dependencies.domains.projectDomain.getGeneration();
        try {
          (0, dependencies.workspaceUiA.closeSurface)('create');
          const created = await (0, dependencies.propertyEditingA.createDistributionLayerFromPrompt)({
            beforeCreate: dependencies.genericEditingA.discardActiveDraftSilently,
          });
          if (dependencies.projectState.state.projectReplacing || generation !== dependencies.domains.projectDomain.getGeneration()) return;
          if (created) (0, dependencies.workspaceUiA.completeToolStart)(true, { destination: 'editor' });
          else (0, dependencies.workspaceUiB.openSurface)('create');
        } catch (error) { dependencies.feedback.reportOperationError(error, '분포를 만들지 못했습니다.', 'PL-DISTRIBUTION-CREATE-001', 4200); }
      });
    });
    listen((0, dependencies.platform.$)('territorialCreateNameInput'), 'input', event => (0, dependencies.territorySelectionB.territorySelectionUpdateName)(event.currentTarget.value));
    listen(dependencies.platform.$('territorialCreateRegionalInput'), 'change', event => dependencies.territorialEditingB.updateTerritorialCreateKind(event.currentTarget.checked));
    listen((0, dependencies.platform.$)('territorialCreateParentInput'), 'change', event => (0, dependencies.territorialEditingB.updateTerritorialCreateParent)(event.currentTarget.value));
    listen((0, dependencies.platform.$)('territorialCreateSourceInput'), 'change', event => (0, dependencies.territorialEditingB.updateTerritorialCreateSource)(event.currentTarget.value));
    listen((0, dependencies.platform.$)('addLabelBtn'), 'click', async () => {
      await dependencies.genericEditingB.requestDraftDiscard(async () => dependencies.workspaceUiA.completeToolStart(await dependencies.countryEditingA.enterLabelMode()));
    });
    listen((0, dependencies.platform.$)('addRiverBtn'), 'click', async () => {
      await dependencies.genericEditingB.requestDraftDiscard(async () => dependencies.workspaceUiA.completeToolStart(await dependencies.countryEditingB.enterTerrainGenericFeatureMode('river')));
    });
    listen((0, dependencies.platform.$)('addLakeBtn'), 'click', async () => {
      await dependencies.genericEditingB.requestDraftDiscard(async () => dependencies.workspaceUiA.completeToolStart(await dependencies.countryEditingB.enterTerrainGenericFeatureMode('lake')));
    });
    listen(dependencies.platform.$('hydroVerticesBtn'),'click',async()=>{
      try { await dependencies.domains.editingDomain.handleInteraction({type:'object-edit-start',targetRef:dependencies.projectState.state.selected}); }
      catch(error) { dependencies.feedback.reportOperationError(error,'좌표 편집을 시작하지 못했습니다.','PL-HYDRO-EDIT-001',3200); }
    });
    listen(dependencies.platform.$('vertexPlacementBtn'),'click',()=>{const editing=dependencies.domains.editingDomain;Promise.resolve(editing.handleInteraction({type:editing.snapshot().vertexPlacement?'vertex-placement-cancel':'vertex-placement-start',projectGeneration:editing.snapshot().projectGeneration})).catch(error=>dependencies.feedback.reportOperationError(error,'위치 지정을 시작하지 못했습니다.','PL-VERTEX-PLACE',3200));});
    listen((0, dependencies.platform.$)('modePrimaryBtn'), 'click', () => { void (0, dependencies.taskPresentation.runModePrimaryAction)(); });
    for (const [id, command] of [['multiDrawnAddBtn', dependencies.countryCommitFlow.addMultiDraftPart], ['multiDrawnUndoBtn', dependencies.countryCommitFlow.undoMultiDraftPart]]) {
      dependencies.platform.$(id)?.addEventListener('click', async event => {
        if (event.currentTarget.disabled || dependencies.projectState.state.modeProcessing) return;
        // The command retains its idle guard while awaiting the Core draft ACK.
        try { await command(); }
        catch (error) { dependencies.feedback.reportOperationError(error, '그리기 목록을 변경하지 못했습니다.', 'PL-MULTI-DRAFT-UI-001', 4200); }
      });
    }
    listen((0, dependencies.platform.$)('territorySelectionStackList'), 'click', event => {
      const button = event.target.closest('button[data-item-kind]');
      if (!button || !event.currentTarget.contains(button)) return;
      const action = button.dataset.itemKind === 'part'
        ? () => dependencies.territorySelectionA.removeTerritorySelectionPart(button.dataset.itemId)
        : () => dependencies.territorySelectionC.toggleTerritorySelectionComponent(button.dataset.itemId);
      void (0, dependencies.taskPresentation.runModePrimaryAction)(action);
    });
    listen((0, dependencies.platform.$)('modeTaskResultsList'), 'click', event => {
      const button = event.target.closest('button[data-object-id]');
      if (!button || button.disabled || !event.currentTarget.contains(button)) return;
      const tool = dependencies.projectState.state.tool;
      if (!['merge-country', 'merge-territorial-unit'].includes(tool)) return;
      const action = tool === 'merge-country'
        ? () => dependencies.countryEditingC.toggleMergeTarget(button.dataset.objectId)
        : () => dependencies.territorialEditingB.toggleTerritorialUnitMergeTarget(button.dataset.objectId);
      void (0, dependencies.taskPresentation.runModePrimaryAction)(action);
    });
    listen((0, dependencies.platform.$)('modeTaskMinimizeBtn'), 'click', dependencies.taskPresentation.toggleMapTaskWindow);
    listen((0, dependencies.platform.$)('modeDirectLineMethodInput'), 'change', event => {
      if (event.currentTarget.checked) void (0, dependencies.taskPresentation.runModePrimaryAction)(
        () => (0, dependencies.territorySelectionB.territorySelectionSelectMethod)('line'));
    });
    listen((0, dependencies.platform.$)('modePolygonMethodInput'), 'change', event => {
      if (event.currentTarget.checked) void (0, dependencies.taskPresentation.runModePrimaryAction)(
        () => (0, dependencies.territorySelectionB.territorySelectionSelectMethod)('polygon'));
    });
    listen((0, dependencies.platform.$)('modeComponentsMethodInput'), 'change', event => {
      if (event.currentTarget.checked) void (0, dependencies.taskPresentation.runModePrimaryAction)(
        () => (0, dependencies.territorySelectionB.territorySelectionSelectMethod)('components'));
    });
    listen((0, dependencies.platform.$)('territorialReferenceStartBtn'), 'click', () => {
      void (0, dependencies.taskPresentation.runModePrimaryAction)(
        dependencies.territorySelectionB.territorySelectionStartReferenceMethod);
    });
    listen((0, dependencies.platform.$)('modeMethodChangeKeepBtn'), 'click', () => {
      (0, dependencies.territorySelectionB.territorySelectionCancelMethodChange)();
    });
    listen((0, dependencies.platform.$)('modeMethodChangeConfirmBtn'), 'click', () => {
      void (0, dependencies.taskPresentation.runModePrimaryAction)(
        dependencies.territorySelectionB.territorySelectionConfirmMethodChange);
    });
    listen((0, dependencies.platform.$)('modeRiverBoundaryInput'), 'change', event => (0, dependencies.territorySelectionB.territorySelectionToggleRiverBoundaries)(event.currentTarget.checked));
    listen((0, dependencies.platform.$)('modeDraftInsertBtn'), 'click', async () => {
      try { await dependencies.domains.editingDomain.setDraftVertexInsertMode(!dependencies.domains.editingDomain.snapshot().draft.vertexInsertMode); }
      catch (error) { dependencies.feedback.reportOperationError(error,'꼭짓점 삽입 모드를 변경하지 못했습니다.','PL-DRAFT-INSERT-001',4200); }
    });
    listen((0, dependencies.platform.$)('modeDraftDoneBtn'), 'click', () => { void dependencies.taskPresentation.completeCurrentDraft(); });
    listen((0, dependencies.platform.$)('modeDraftRedrawBtn'), 'click', async () => {
      try { await dependencies.countryCommitFlow.redrawCurrentDraft(); }
      catch(error) { dependencies.feedback.reportOperationError(error,'초안을 다시 그리지 못했습니다.','PL-DRAFT-REDRAW-001',4200); }
    });
    listen((0, dependencies.platform.$)('modeDraftDeleteBtn'), 'click', async () => {
      try { await dependencies.domains.editingDomain.deleteSelectedDraftPoint(); }
      catch (error) { dependencies.feedback.reportOperationError(error,'작성 중인 꼭짓점을 삭제하지 못했습니다.','PL-DRAFT-DELETE-001',4200); }
    });
    listen((0, dependencies.platform.$)('modeReturnBtn'), 'click', async () => {
      try { await dependencies.taskPresentation.returnToEditing(); }
      catch (error) { dependencies.feedback.reportOperationError(error,'수정 단계로 돌아가지 못했습니다.','PL-EDIT-RETURN',4200); }
    });
    listen((0, dependencies.platform.$)('modeCancelBtn'), 'click', async () => {
      try { await dependencies.taskPresentation.cancelCurrentEditing(); }
      catch (error) { dependencies.feedback.reportOperationError(error,'편집을 취소하지 못했습니다.','PL-EDIT-CANCEL',4200); }
    });
    listen((0, dependencies.platform.$)('resetViewBtn'), 'click', dependencies.navigation.resetView);
  }

  return Object.freeze({
    connect,

    get bindToolUI() { return bindToolUI; },
  });
}
