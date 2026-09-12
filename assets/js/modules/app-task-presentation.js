/** TaskPresentation: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTaskPresentation() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('task-presentation already connected');
    dependencies = ports;
  }

  function syncCountryActionButtons() {
    const selectedId = (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) ? dependencies.state.selected.id : null;
    const borderActive = dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditCountryIds.includes(String(selectedId));
    const coastActive = dependencies.state.tool === 'country-coast' && dependencies.state.coastEditCountryId === selectedId;
    const mergeActive = dependencies.state.tool === 'merge-country' && dependencies.state.mergeSourceCountryId === selectedId;
    const annexActive = dependencies.state.tool === 'annex-territory' && dependencies.state.annexTargetCountryId === selectedId;
    const borderBtn = (0, dependencies.$)('editBorderBtn');
    const coastBtn = (0, dependencies.$)('editCoastBtn');
    const mergeBtn = (0, dependencies.$)('mergeCountryBtn');
    const annexBtn = (0, dependencies.$)('annexTerritoryBtn');
    if (borderBtn) borderBtn.classList.toggle('active', borderActive);
    if (coastBtn) {
      coastBtn.classList.toggle('active', coastActive);
    }
    if (mergeBtn) mergeBtn.classList.toggle('active', mergeActive);
    if (annexBtn) annexBtn.classList.toggle('active', annexActive);
  }

  function setModeBanner(text = '') {
    const instruction = (0, dependencies.$)('modeTaskInstruction');
    if (!instruction) return;
    if (instruction.textContent !== text) instruction.textContent = text;
    instruction.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
    instruction.classList.toggle('hidden', !text);
    (0, dependencies.syncStatusBar)();
  }

  function syncCutDraftFeedback(assessment, preview = false) {
    const instruction = (0, dependencies.$)('modeTaskInstruction');
    if (!instruction || !assessment?.line?.length) {
      instruction?.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
      return;
    }
    let message;
    if (assessment.valid) {
      message = preview
        ? '이 위치에 놓으면 유효한 경계가 됩니다. 경계 근처 끝점은 자동으로 연결됩니다.'
        : '유효한 경계입니다. 영역 나누기를 눌러 완료하세요.';
    } else if (assessment.status === 'pending') {
      message = '선택 영역을 가로질러 반대쪽까지 그리세요.';
    } else {
      message = assessment.message;
    }
    const className = `cut-${assessment.status}`;
    if (instruction.textContent === message && instruction.classList.contains(className)) return;
    setModeBanner(message);
    instruction.classList.add(className);
  }

  function activeModeTaskDescriptor() {
    return (0, dependencies.describeTool)(dependencies.state.tool, dependencies.state, { labelPlacement: dependencies.state.labelPlacementMode });
  }

  function syncGeometryPreviewSummary() {
    const element = (0, dependencies.$)('geometryPreviewSummary');
    if (!element) return;
    const session = dependencies.state.geometryPreview.session;
    const blocking = session?.validation?.blocking === true;
    element.classList.toggle('hidden', !session || blocking);
    if (!session || blocking) {
      element.textContent = '';
      element.removeAttribute('aria-label');
      return;
    }
    const metrics = session.metrics || {};
    const fragments = [];
    if (metrics.transferredAreaKm2 > 0) fragments.push(`이동 ${(0, dependencies.formatArea)(metrics.transferredAreaKm2)}`);
    if (metrics.finalAreaKm2 > 0) fragments.push(`최종 ${(0, dependencies.formatArea)(metrics.finalAreaKm2)}`);
    const text = fragments.length ? fragments.join(' · ') : '변경 결과를 확인하세요.';
    element.textContent = text;
    element.setAttribute('aria-label', text);
  }

  function mapModeContextActive() {
    const labelMode = dependencies.state.labelPlacementMode || dependencies.state.tool === 'label';
    return !!(labelMode || (0, dependencies.hydroToolConfig)(dependencies.state.tool) || dependencies.state.geometryPreview.session || (0, dependencies.isSpecialTool)(dependencies.state.tool) || dependencies.editingDomain?.draftInputActive?.());
  }

  function elementHasLayout(element) {
    if (!element || element.classList.contains('hidden')) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  function syncMapHudBounds() {
    if (dependencies.layoutMode === 'wide') return;
    const slot = (0, dependencies.$)('mapTopContextSlot');
    const map = (0, dependencies.$)('map');
    if (!slot || !map) return;
    const bounds = map.getBoundingClientRect();
    if (!bounds.width) return;
    const edge = 12;
    let left = edge;
    let right = bounds.width - edge;
    const view = document.querySelector('.map-view-toolbar');
    if (elementHasLayout(view)) right = Math.min(right, view.getBoundingClientRect().left - bounds.left - 8);
    if (right <= left) {
      left = edge;
      right = bounds.width - edge;
    }
    slot.style.setProperty('--map-context-center', `${Math.round((left + right) / 2)}px`);
    slot.style.setProperty('--map-context-width', `${Math.max(0, Math.floor(right - left))}px`);
  }

  function syncMapContextSurfaces() {
    const editing = mapModeContextActive();
    dependencies.mapModeContextWasActive = editing;
    if (!editing) dependencies.state.modeTaskMinimized = false;
    const context = (0, dependencies.$)('modeEditingContext');
    const content = (0, dependencies.$)('modeTaskWindowContent');
    const minimize = (0, dependencies.$)('modeTaskMinimizeBtn');
    context?.classList.toggle('hidden', !editing);
    context?.classList.toggle('is-minimized', false);
    if (content) content.hidden = false;
    if (minimize) {
      minimize.hidden = true;
      minimize.setAttribute('aria-expanded', 'true');
      minimize.setAttribute('aria-label', '지도 작업창 최소화');
      minimize.dataset.tooltip = '최소화';
      minimize.querySelector('use')?.setAttribute('href', '#icon-minus');
    }
    dependencies.editorWorkspacePresentation.sync({ active: editing });
    requestAnimationFrame(syncMapHudBounds);
  }

  function toggleMapTaskWindow() {
    if (!mapModeContextActive()) return;
    dependencies.state.modeTaskMinimized = false;
    syncMapContextSurfaces();
  }

  function syncMapCursorMode() {
    const map = (0, dependencies.$)('map');
    if (!map) return;
    const mode = (0, dependencies.toolCursorMode)(dependencies.state.tool, dependencies.state, { labelPlacement: dependencies.state.labelPlacementMode });
    map.classList.toggle('country-pick-mode', mode.country);
    map.classList.toggle('generic-feature-mode', mode.generic);
    map.classList.toggle('candidate-pick-mode', mode.candidate);
    map.classList.toggle('select-mode', mode.select);
  }

  function updateModeButtons() {
    const draft = (0, dependencies.editingDraftSnapshot)();
    const annexLineMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'line';
    const annexPolygonMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'polygon';
    const annexPolygonPreviewMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'polygon-preview';
    const annexSideMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'side';
    const annexComponentsMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'components';
    const annexDonorMode = dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'donor';
    const newCountrySourceMode = dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'sources';
    const newCountryLineMode = dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'line';
    const newCountrySideMode = dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'side';
    const newCountryComponentsMode = dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'components';
    const mergeTargetMode = dependencies.state.tool === 'merge-country' && !!dependencies.state.mergeSourceCountryId;
    const genericFeatureMergeMode = dependencies.state.tool === 'merge-generic-feature' && !!dependencies.state.genericFeatureMergeSourceId;
    const genericFeatureSplitMode = dependencies.state.tool === 'split-generic-feature' && !!dependencies.state.genericFeatureSplitSourceId;
    const territorialUnitMergeMode = dependencies.state.tool === 'merge-territorial-unit' && !!dependencies.state.territorialUnitMergeSourceId;
    const territorialUnitSplitMode = dependencies.state.tool === 'split-territorial-unit' && !!(dependencies.state.territorialUnitSplitSourceId || dependencies.state.territorialUnitSplitVirtualSource);
    const territorialUnitRedrawMode = dependencies.state.tool === 'redraw-territorial-unit' && !!dependencies.state.territorialUnitRedrawSourceId;
    const territorialUnitCreateMode = dependencies.state.tool === 'draw-territorial-unit' && !!dependencies.state.territorialCreateContext;
    const boundarySelectMode = dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'selecting';
    const boundaryEditMode = dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'editing';
    const boundarySelectionReady = !boundarySelectMode || (0, dependencies.boundaryEditSelectionAnalysis)(dependencies.state.boundaryEditCountryIds).valid;
    const methodSwitchAvailable = annexDonorMode || annexLineMode || annexPolygonMode || annexPolygonPreviewMode || annexSideMode || annexComponentsMode
      || newCountryLineMode || newCountrySideMode || newCountryComponentsMode;
    const activeMethod = dependencies.state.tool === 'annex-territory'
      ? dependencies.state.annexSelectionMethod
      : dependencies.state.newCountrySelectionMethod;
    const labelMode = dependencies.state.labelPlacementMode || dependencies.state.tool === 'label';
    const terrainMode = !!(0, dependencies.hydroToolConfig)(dependencies.state.tool);
    const draftMode = dependencies.editingDomain?.draftInputActive?.();
    const previewMode = !!dependencies.state.geometryPreview.session;
    const specialMode = labelMode || terrainMode || previewMode || (0, dependencies.isSpecialTool)(dependencies.state.tool) || draftMode;
    const cutLineMode = genericFeatureSplitMode || territorialUnitSplitMode || annexLineMode || newCountryLineMode;
    const cutLineReady = !cutLineMode || draft.cutAssessment?.valid === true;
    const task = activeModeTaskDescriptor();
    const bar = (0, dependencies.$)('modeActionBar');
    const methodSwitch = (0, dependencies.$)('modeMethodSwitch');
    const directLineMethodInput = (0, dependencies.$)('modeDirectLineMethodInput');
    const polygonMethodOption = (0, dependencies.$)('modePolygonMethodOption');
    const polygonMethodInput = (0, dependencies.$)('modePolygonMethodInput');
    const componentsMethodInput = (0, dependencies.$)('modeComponentsMethodInput');
    const riverBoundaryOption = (0, dependencies.$)('modeRiverBoundaryOption');
    const riverBoundaryInput = (0, dependencies.$)('modeRiverBoundaryInput');
    const draftActions = (0, dependencies.$)('modeDraftActions');
    const draftRedraw = (0, dependencies.$)('modeDraftRedrawBtn');
    const draftRemoveLast = (0, dependencies.$)('modeDraftRemoveLastBtn');
    const draftDelete = (0, dependencies.$)('modeDraftDeleteBtn');
    const primary = (0, dependencies.$)('modePrimaryBtn');
    const cancel = (0, dependencies.$)('modeCancelBtn');
    if ((0, dependencies.$)('modeTaskName')) (0, dependencies.$)('modeTaskName').textContent = task.name;
    if ((0, dependencies.$)('modeTaskStage')) (0, dependencies.$)('modeTaskStage').textContent = task.stage;
    const currentTaskIcon = (0, dependencies.$)('modeTaskIcon');
    if (currentTaskIcon && task.icon) {
      const nextTaskIcon = (0, dependencies.createSemanticIcon)(document, task.icon, 'ui-icon mode-task-icon');
      nextTaskIcon.id = 'modeTaskIcon';
      currentTaskIcon.replaceWith(nextTaskIcon);
    }
    if (bar) {
      bar.classList.toggle('hidden', !specialMode);
      bar.classList.toggle('single-action', labelMode || annexDonorMode);
      bar.classList.toggle('is-processing', dependencies.state.modeProcessing);
      bar.setAttribute('aria-busy', String(dependencies.state.modeProcessing));
    }
    methodSwitch?.classList.toggle('hidden', !methodSwitchAvailable);
    methodSwitch?.classList.toggle('annex-methods', dependencies.state.tool === 'annex-territory');
    riverBoundaryOption?.classList.toggle('hidden', !annexComponentsMode);
    riverBoundaryOption?.setAttribute('aria-busy', String(annexComponentsMode && dependencies.state.annexUseRiverBoundaries && dependencies.state.annexRiverPartitionStatus === 'loading'));
    if (riverBoundaryInput) {
      riverBoundaryInput.checked = annexComponentsMode && dependencies.state.annexUseRiverBoundaries;
      riverBoundaryInput.disabled = dependencies.state.modeProcessing;
    }
    const refineSelection = draftMode && draft.inputPhase === 'refine' && Number.isInteger(draft.selectedVertexIndex);
    const draftActionsVisible = draftMode && draft.coords.length > 0;
    draftActions?.classList.toggle('hidden', !draftActionsVisible);
    draftRedraw?.classList.toggle('hidden', refineSelection);
    draftRemoveLast?.classList.toggle('hidden', refineSelection);
    draftDelete?.classList.toggle('hidden', !refineSelection);
    if (draftRedraw) draftRedraw.disabled = dependencies.state.modeProcessing || draft.strokeActive || !draft.coords.length;
    if (draftRemoveLast) draftRemoveLast.disabled = dependencies.state.modeProcessing || draft.strokeActive || !draft.coords.length;
    if (draftDelete) draftDelete.disabled = dependencies.state.modeProcessing || draft.strokeActive || !refineSelection;
    const methodSelectionReady = !annexDonorMode || dependencies.state.annexDonorCountryIds.length > 0;
    if (directLineMethodInput) {
      directLineMethodInput.checked = !annexDonorMode && activeMethod === 'line';
      directLineMethodInput.disabled = dependencies.state.modeProcessing || !methodSelectionReady;
    }
    polygonMethodOption?.classList.toggle('hidden', dependencies.state.tool !== 'annex-territory');
    if (polygonMethodInput) {
      polygonMethodInput.checked = !annexDonorMode && activeMethod === 'polygon';
      polygonMethodInput.disabled = dependencies.state.modeProcessing || !methodSelectionReady;
    }
    if (componentsMethodInput) {
      componentsMethodInput.checked = !annexDonorMode && activeMethod === 'components';
      componentsMethodInput.disabled = dependencies.state.modeProcessing || !methodSelectionReady;
    }
    if (primary) {
      primary.classList.toggle('hidden', labelMode || annexDonorMode);
      primary.disabled = dependencies.state.modeProcessing
        || (draftMode && (draft.strokeActive || draft.coords.length < (0, dependencies.draftMinimumPoints)() || draft.issues.length > 0 || (cutLineMode && !cutLineReady)))
        || (terrainMode && draft.coords.length < ((0, dependencies.isPolygonDraftTool)(dependencies.state.tool) ? 3 : 2))
        || (newCountrySourceMode && !dependencies.state.newCountrySourceIds.length)
        || (annexDonorMode && !dependencies.state.annexDonorCountryIds.length)
        || (annexPolygonMode && draft.coords.length < 3)
        || (annexPolygonPreviewMode && !dependencies.state.annexCandidates[0]?.geometry)
        || (mergeTargetMode && !dependencies.state.mergeTargetCountryIds.length)
        || (genericFeatureMergeMode && !dependencies.state.genericFeatureMergeTargetIds.length)
        || (territorialUnitMergeMode && !dependencies.state.territorialUnitMergeTargetIds.length)
        || ((genericFeatureSplitMode || territorialUnitSplitMode) && !cutLineReady)
        || (territorialUnitRedrawMode && draft.coords.length < 3)
        || (territorialUnitCreateMode && draft.coords.length < 3)
        || (boundarySelectMode && !boundarySelectionReady)
        || ((annexLineMode || newCountryLineMode) && !cutLineReady)
        || (annexSideMode && !dependencies.state.annexCandidates[dependencies.state.annexSelectedCandidateIndex]?.geometry)
        || (newCountrySideMode && !dependencies.state.newCountryCandidates[dependencies.state.newCountrySelectedCandidateIndex]?.geometry)
        || (annexComponentsMode && dependencies.state.annexUseRiverBoundaries && dependencies.state.annexRiverPartitionStatus !== 'ready')
        || (annexComponentsMode && !dependencies.state.annexSelectedComponentKeys.length)
        || (newCountryComponentsMode && !dependencies.state.newCountrySelectedComponentKeys.length)
        || (previewMode && dependencies.state.geometryPreview.session.validation?.blocking === true);
      let primaryLabel = '완료';
      if (previewMode) primaryLabel = '변경 적용';
      else if (boundarySelectMode) primaryLabel = `국경 편집 (${dependencies.state.boundaryEditCountryIds.length})`;
      else if (boundaryEditMode || dependencies.state.tool === 'country-coast') primaryLabel = '수정 완료';
      else if (terrainMode) primaryLabel = '그리기 완료';
      else if (newCountrySourceMode) primaryLabel = `선택 완료 (${dependencies.state.newCountrySourceIds.length})`;
      else if (annexPolygonMode) primaryLabel = '영역 편입';
      else if (annexPolygonPreviewMode) primaryLabel = '영역 편입';
      else if (mergeTargetMode) primaryLabel = `합병 (${dependencies.state.mergeTargetCountryIds.length})`;
      else if (genericFeatureMergeMode) primaryLabel = `영역 합치기 (${dependencies.state.genericFeatureMergeTargetIds.length})`;
      else if (territorialUnitMergeMode) primaryLabel = `영역 합치기 (${dependencies.state.territorialUnitMergeTargetIds.length})`;
      else if (genericFeatureSplitMode) primaryLabel = '영역 나누기';
      else if (territorialUnitSplitMode) primaryLabel = '영역 나누기';
      else if (territorialUnitRedrawMode) primaryLabel = '영역 다시 지정';
      else if (territorialUnitCreateMode) primaryLabel = '영역 만들기';
      else if (newCountryLineMode || annexLineMode) primaryLabel = '나누기';
      else if (newCountryComponentsMode) primaryLabel = `국가 만들기 (${dependencies.state.newCountrySelectedComponentKeys.length})`;
      else if (newCountrySideMode) primaryLabel = '국가 만들기';
      else if (annexComponentsMode) primaryLabel = `편입 (${dependencies.state.annexSelectedComponentKeys.length})`;
      else if (annexSideMode) primaryLabel = '편입';
      const primaryLabelNode = primary.querySelector('.mode-button-label');
      if (primaryLabelNode) primaryLabelNode.textContent = primaryLabel;
      else primary.textContent = primaryLabel;
      primary.setAttribute('aria-label', primaryLabel);
      primary.setAttribute('aria-busy', String(dependencies.state.modeProcessing));
    }
    if (cancel) {
      const cancelLabelNode = cancel.querySelector('.mode-button-label');
      if (cancelLabelNode) cancelLabelNode.textContent = '취소';
      else cancel.textContent = '취소';
      cancel.setAttribute('aria-label', '작업 취소');
      cancel.disabled = dependencies.state.modeProcessing;
    }
    syncGeometryPreviewSummary();
    syncMapContextSurfaces();
    syncMapCursorMode();
    syncCountryActionButtons();
    dependencies.projectUi.syncHistory();
    (0, dependencies.syncStatusBar)();
  }

  function dispatchModePrimaryAction() {
    if (dependencies.state.geometryPreview.session) return (0, dependencies.applyActiveGeometryPreview)();
    if (dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'selecting') return (0, dependencies.beginCountryBorderEditing)();
    if (dependencies.state.tool === 'country-border') return (0, dependencies.finishCountryBorderEdit)();
    if (dependencies.state.tool === 'country-coast') return (0, dependencies.finishCountryCoastEdit)();
    if (dependencies.state.tool === 'merge-generic-feature') return (0, dependencies.completeGenericFeatureMerge)();
    if (dependencies.state.tool === 'merge-territorial-unit') return (0, dependencies.completeTerritorialUnitMerge)();
    if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'sources') return (0, dependencies.beginNewCountryLine)();
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'donor') return (0, dependencies.beginAnnexSelection)();
    if (dependencies.state.tool === 'merge-country') return (0, dependencies.completeCountryMerge)();
    if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'side') return (0, dependencies.completeNewCountryCreation)(dependencies.state.newCountrySelectedCandidateIndex);
    if (dependencies.state.tool === 'new-country' && dependencies.state.newCountryPhase === 'components') return (0, dependencies.completeNewCountryCreation)(null);
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'side') return (0, dependencies.completeLinearAnnexation)(dependencies.state.annexSelectedCandidateIndex);
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'polygon-preview') return (0, dependencies.completeLinearAnnexation)(0);
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexPhase === 'components') return (0, dependencies.completeLinearAnnexation)(null);
    if ((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool) || ['new-country', 'annex-territory'].includes(dependencies.state.tool)) return (0, dependencies.finishDraft)();
    return false;
  }

  async function runModePrimaryAction(action = dispatchModePrimaryAction) {
    if (dependencies.state.modeProcessing) return false;
    dependencies.state.modeProcessing = true;
    updateModeButtons();
    try {
      return await action();
    } catch (error) {
      (0, dependencies.reportOperationError)(error, '지도 작업을 완료하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.', 'PL-MODE-001', 4200);
      return false;
    } finally {
      dependencies.state.modeProcessing = false;
      updateModeButtons();
    }
  }



  return Object.freeze({
    connect,

    get runModePrimaryAction() { return runModePrimaryAction; },
    get setModeBanner() { return setModeBanner; },
    get syncCountryActionButtons() { return syncCountryActionButtons; },
    get syncCutDraftFeedback() { return syncCutDraftFeedback; },
    get syncMapContextSurfaces() { return syncMapContextSurfaces; },
    get syncMapHudBounds() { return syncMapHudBounds; },
    get toggleMapTaskWindow() { return toggleMapTaskWindow; },
    get updateModeButtons() { return updateModeButtons; },
  });
}
