/** Task surface presentation. Territory selection is rendered from one shared model. */
export function draftToolbarStatus({ state, draft, draftMode, hasDraftTool, minimumPoints, cutLineReady }) {
  const territory = state.territorySelectionSession;
  const territoryOutsideSelection = !!territory && territory.stage !== 'selection';
  const territoryDrawing = territory?.stage === 'selection' && territory.activePhase === 'drawing'
    && ['line', 'polygon'].includes(territory.activeMethod);
  const preview = !!state.geometryPreview.session;
  const multiDraft = state.multiDraft;
  const hydroReview = !!multiDraft && multiDraft.kind === 'hydro'
    && ((multiDraft.parts?.length || 0) > 0 || !!multiDraft.current);
  const territoryReview = territory?.stage === 'selection'
    && (territory.activePhase === 'candidate' || territory.activePhase === 'result'
      || (territory.activePhase === 'drawing' && !!territory.parts.length && !draft.coords.length));
  const review = !territoryOutsideSelection && (territoryReview || (hasDraftTool && preview) || hydroReview);
  const editable = !territoryOutsideSelection && !!draftMode && !preview && (!territory || territoryDrawing);
  const busy = state.modeProcessing || draft.strokeActive || draft.dragging || territory?.previewPending;
  const accumulatedOnly = (!!territoryDrawing && territory.parts.length > 0 && !draft.coords.length && !draft.strokeActive)
    || (hydroReview && (multiDraft.parts?.length || 0) > 0 && !draft.coords.length && !draft.strokeActive);
  return {
    visible: editable || review,
    editable,
    insert: editable && !busy && draft.coords.length >= 2,
    remove: editable && !busy && draft.inputPhase === 'refine' && Number.isInteger(draft.selectedVertexIndex),
    redraw: !territoryOutsideSelection && !busy && (!!draft.coords.length || review),
    complete: editable && !busy
      && (accumulatedOnly || (draft.coords.length >= minimumPoints && !draft.issues.length && cutLineReady)),
  };
}

export function multiDraftReviewActive(state) {
  const draft = state?.multiDraft;
  return !!draft && draft.kind === 'hydro' && ((draft.parts?.length || 0) > 0 || !!draft.current);
}

export function createTaskPresentation() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('task-presentation already connected');
    dependencies = ports;
  }

  function syncCountryActionButtons() {
    const selectedId = dependencies.state.selected?.domain === 'territorial'
      && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? dependencies.state.selected.id : null;
    const selection = dependencies.state.territorySelectionSession;
    const buttons = [
      ['editBorderBtn', dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditCountryIds.includes(String(selectedId))],
      ['editCoastBtn', dependencies.state.tool === 'country-coast' && dependencies.state.coastEditCountryId === selectedId],
      ['mergeCountryBtn', dependencies.state.tool === 'merge-country' && dependencies.state.mergeSourceCountryId === selectedId],
    ];
    if (selection?.actionButtonId) buttons.push([selection.actionButtonId, selection.targetCountryId === selectedId]);
    for (const [id, active] of buttons) (0, dependencies.$)(id)?.classList.toggle('active', !!active);
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
    const message = assessment.valid
      ? preview ? '이 위치에 놓으면 유효한 경계가 됩니다. 경계 근처 끝점은 자동으로 연결됩니다.' : '유효한 경계입니다. 완료를 눌러 그리기를 마치세요.'
      : assessment.status === 'pending' ? '선택 영역을 가로질러 반대쪽까지 그리세요.' : assessment.message;
    const className = `cut-${assessment.status}`;
    if (instruction.textContent === message && instruction.classList.contains(className)) return;
    setModeBanner(message);
    instruction.classList.add(className);
  }

  function activeModeTaskDescriptor() {
    return (0, dependencies.describeTool)(dependencies.state.tool, dependencies.state, { labelPlacement: dependencies.state.labelPlacementMode });
  }

  function countryDisplay(countryId) {
    const id = String(countryId || '');
    const feature = id ? dependencies.countryFeatureById?.(id) : null;
    if (!feature) return null;
    const override = dependencies.state.countryOverrides?.[id] || {};
    return {
      name: dependencies.countryName(feature, override),
      flagUrl: dependencies.effectiveCountryFlagUrl({ countryId: id, override, assetRevision: dependencies.ASSET_REVISION }),
    };
  }

  function setCountryDisplay({ flag, name }, display, fallback) {
    const label = display?.name || fallback;
    if (name) {
      name.textContent = label;
      name.classList.toggle('annex-country-flow-placeholder', !display);
    }
    if (!flag) return;
    flag.hidden = !display?.flagUrl;
    if (display?.flagUrl) flag.src = display.flagUrl;
    else flag.removeAttribute('src');
  }

  function syncTerritoryTransferFlow(model) {
    const selection = model?.current;
    const flow = (0, dependencies.$)('annexCountryFlow');
    if (!flow) return;
    const active = !!model?.showCountryFlow;
    flow.classList.toggle('hidden', !active);
    if (!active) {
      flow.removeAttribute('aria-label');
      return;
    }
    const target = countryDisplay(selection.targetCountryId);
    const donors = selection.sourceCountryIds.map(countryDisplay).filter(Boolean);
    const donor = donors[0] || null;
    const donorLabel = donor ? `${donor.name}${donors.length > 1 ? ` 외 ${donors.length - 1}개` : ''}` : '국가 선택';
    setCountryDisplay({ flag: (0, dependencies.$)('annexTargetCountryFlag'), name: (0, dependencies.$)('annexTargetCountryName') }, target, '국가');
    setCountryDisplay({ flag: (0, dependencies.$)('annexDonorCountryFlag'), name: (0, dependencies.$)('annexDonorCountryName') }, donor ? { ...donor, name: donorLabel } : null, '국가 선택');
    flow.setAttribute('aria-label', donor
      ? `${donorLabel}의 영토를 ${target?.name || '국가'}에 편입`
      : `${target?.name || '국가'}에 편입할 국가를 선택`);
  }

  function syncGeometryPreviewSummary(selection) {
    const element = (0, dependencies.$)('geometryPreviewSummary');
    if (!element) return;
    const preview = dependencies.state.geometryPreview.session;
    const suspended = !!selection && selection.stage !== 'review';
    const blocking = preview?.validation?.blocking === true;
    element.classList.toggle('hidden', !preview || blocking || suspended);
    if (!preview || blocking || suspended) {
      element.textContent = '';
      element.removeAttribute('aria-label');
      return;
    }
    const metrics = preview.metrics || {};
    const fragments = [];
    if (metrics.transferredAreaKm2 > 0) fragments.push(`이동 ${(0, dependencies.formatArea)(metrics.transferredAreaKm2)}`);
    if (metrics.finalAreaKm2 > 0) fragments.push(`최종 ${(0, dependencies.formatArea)(metrics.finalAreaKm2)}`);
    const value = fragments.length ? fragments.join(' · ') : '변경 결과를 확인하세요.';
    element.textContent = value;
    element.setAttribute('aria-label', value);
  }

  function mapModeContextActive() {
    const label = dependencies.state.labelPlacementMode || dependencies.state.tool === 'label';
    return !!(label || dependencies.state.territorySelectionSession || (0, dependencies.hydroToolConfig)(dependencies.state.tool)
      || dependencies.state.geometryPreview.session || (0, dependencies.isSpecialTool)(dependencies.state.tool)
      || dependencies.editingDomain?.draftInputActive?.());
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
    map.classList.toggle('country-pick-mode', !!mode.country);
    map.classList.toggle('generic-feature-mode', !!mode.generic);
    map.classList.toggle('candidate-pick-mode', !!mode.candidate);
    map.classList.toggle('select-mode', !!mode.select);
  }

  function syncTerritorySetup(model) {
    const selection = model?.current;
    const setup = (0, dependencies.$)('territorialCreateSetup');
    setup?.classList.toggle('hidden', !model?.showSetup);
    for (const id of ['territorialCreateSovereignRow', 'territorialCreateParentRow', 'territorialCreateSourceRow']) {
      (0, dependencies.$)(id)?.classList.toggle('hidden', !model?.showSetup || !model?.showSubunitFields);
    }
    if (model?.showSetup) {
      const nameLabel = (0, dependencies.$)('territorialCreateNameLabel');
      if (nameLabel) nameLabel.textContent = model.nameLabel || '이름';
      const name = (0, dependencies.$)('territorialCreateNameInput');
      if (name && name.value !== selection.name) name.value = selection.name;
      if (model?.showSubunitFields) {
        const setupModel = (0, dependencies.territorialCreateSetupModel)();
        if (setupModel) {
          (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialCreateSovereignInput'), setupModel.countryOptions, selection.sovereignId);
          (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialCreateParentInput'), setupModel.parentOptions, selection.parentId);
          (0, dependencies.replaceSelectOptions)((0, dependencies.$)('territorialCreateSourceInput'), setupModel.sourceOptions, selection.sourceKey);
        }
      }
    }
    const reference = (0, dependencies.$)('territorialCreateReference');
    reference?.classList.toggle('hidden', !model?.showReference);
    if (model?.showReference) {
      const countries = selection.sourceCountryIds.map(countryDisplay).filter(Boolean);
      const referenceLabel = model.referenceLabel || '기준 국가';
      const label = (0, dependencies.$)('territorialCreateReferenceLabel');
      const count = (0, dependencies.$)('territorialCreateReferenceCount');
      const list = (0, dependencies.$)('territorialCreateReferenceList');
      if (label) label.textContent = referenceLabel;
      if (count) count.textContent = `${model.referenceCount}개`;
      if (list) {
        const signature = JSON.stringify(countries.map(country => [country.name, country.flagUrl]));
        if (list.dataset.signature !== signature) {
          const fragment = document.createDocumentFragment();
          for (const country of countries) {
            const chip = document.createElement('span');
            chip.className = 'territorial-create-reference-chip';
            chip.setAttribute('role', 'listitem');
            if (country.flagUrl) {
              const flag = document.createElement('img');
              flag.className = 'territorial-create-reference-flag';
              flag.src = country.flagUrl;
              flag.alt = '';
              chip.append(flag);
            }
            const name = document.createElement('strong');
            name.textContent = country.name;
            chip.append(name);
            fragment.append(chip);
          }
          list.replaceChildren(fragment);
          list.dataset.signature = signature;
        }
        list.setAttribute('aria-label', `${referenceLabel} 목록`);
      }
      reference?.setAttribute('aria-label', countries.length
        ? `${referenceLabel} ${model.referenceCount}개: ${countries.map(country => country.name).join(', ')}`
        : `${referenceLabel} 0개`);
    }
  }

  function territorialUnitDisplay(unitId) {
    const id = String(unitId || '');
    if (!id) return null;
    const unit = (dependencies.state.territorialUnits || []).find(item => String(item?.id || '') === id);
    const name = String(unit?.properties?.name || '').trim();
    return name || null;
  }

  function syncTerritoryReviewSummary(model) {
    const summary = (0, dependencies.$)('territorialReviewSummary');
    const visible = !!model?.showReviewSummary;
    summary?.classList.toggle('hidden', !visible);
    if (!summary) return;
    const name = (0, dependencies.$)('territorialReviewName');
    const detail = (0, dependencies.$)('territorialReviewDetail');
    if (!visible) {
      if (name) name.textContent = '';
      if (detail) detail.textContent = '';
      summary.removeAttribute('aria-label');
      return;
    }
    const label = model.reviewName || '새 항목';
    if (name) name.textContent = label;
    const current = model.current;
    const sovereign = countryDisplay(model.reviewSovereignId);
    const parent = model.reviewParentId && model.reviewParentId !== model.reviewSovereignId
      ? territorialUnitDisplay(model.reviewParentId)
      : null;
    const detailText = current?.kind === 'subunit'
      ? [sovereign?.name, parent].filter(Boolean).join(' · ')
      : '';
    if (detail) detail.textContent = detailText;
    summary.setAttribute('aria-label', detailText ? `${label}, ${detailText}` : label);
  }

  function setButtonLabel(button, label) {
    const node = button?.querySelector('.mode-button-label');
    if (node) node.textContent = label;
    else if (button) button.textContent = label;
  }

  function updateModeButtons() {
    const state = dependencies.state;
    const selectionModel = (0, dependencies.territorySelectionPresentation)();
    const selection = selectionModel?.current || null;
    const draft = (0, dependencies.editingDraftSnapshot)();
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    const terrainMode = !!(0, dependencies.hydroToolConfig)(state.tool);
    const draftMode = dependencies.editingDomain?.draftInputActive?.();
    const previewMode = !!state.geometryPreview.session;
    const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
    const genericMergeMode = state.tool === 'merge-generic-feature' && !!state.genericFeatureMergeSourceId;
    const genericSplitMode = state.tool === 'split-generic-feature' && !!state.genericFeatureSplitSourceId;
    const unitMergeMode = state.tool === 'merge-territorial-unit' && !!state.territorialUnitMergeSourceId;
    const unitSplitMode = state.tool === 'split-territorial-unit' && !!(state.territorialUnitSplitSourceId || state.territorialUnitSplitVirtualSource);
    const unitRedrawMode = state.tool === 'redraw-territorial-unit' && !!state.territorialUnitRedrawSourceId;
    const boundarySelectMode = state.tool === 'country-border' && state.boundaryEditPhase === 'selecting';
    const boundaryEditMode = state.tool === 'country-border' && state.boundaryEditPhase === 'editing';
    const boundaryReady = !boundarySelectMode || (0, dependencies.boundaryEditSelectionAnalysis)(state.boundaryEditCountryIds).valid;
    const cutLineMode = genericSplitMode || unitSplitMode || selectionModel?.line;
    const cutLineReady = !cutLineMode || draft.cutAssessment?.valid === true;
    const toolbar = draftToolbarStatus({
      state, draft, draftMode, hasDraftTool: dependencies.isGenericFeatureDraftTool(state.tool),
      minimumPoints: dependencies.draftMinimumPoints(), cutLineReady,
    });
    const task = activeModeTaskDescriptor();
    const taskName = (0, dependencies.$)('modeTaskName');
    const taskStage = (0, dependencies.$)('modeTaskStage');
    if (taskName) taskName.textContent = selectionModel?.taskName || task.name;
    if (taskStage) taskStage.textContent = selectionModel?.stageLabel || task.stage;
    syncTerritoryTransferFlow(selectionModel);
    syncTerritorySetup(selectionModel);
    syncTerritoryReviewSummary(selectionModel);

    const specialMode = !!(selection || labelMode || terrainMode || previewMode || (0, dependencies.isSpecialTool)(state.tool) || draftMode);
    const busy = state.modeProcessing || selection?.previewPending;
    const bar = (0, dependencies.$)('modeActionBar');
    bar?.classList.toggle('hidden', !specialMode);
    bar?.classList.toggle('single-action', labelMode);
    bar?.classList.toggle('is-processing', !!busy);
    bar?.setAttribute('aria-busy', String(!!busy));

    const methodSwitch = (0, dependencies.$)('modeMethodSwitch');
    methodSwitch?.classList.toggle('hidden', !selectionModel?.showMethods);
    const activeMethod = selectionModel?.activeMethod;
    for (const [id, method] of [['modeDirectLineMethodInput', 'line'], ['modePolygonMethodInput', 'polygon'], ['modeComponentsMethodInput', 'components']]) {
      const input = (0, dependencies.$)(id);
      if (!input) continue;
      input.checked = activeMethod === method;
      input.disabled = !!busy || !selectionModel?.selection || !!selectionModel?.showMethodChangeConfirmation;
    }
    (0, dependencies.$)('modePolygonMethodOption')?.classList.toggle('hidden', !selectionModel?.showMethods);

    const methodChangeConfirm = (0, dependencies.$)('modeMethodChangeConfirm');
    methodChangeConfirm?.classList.toggle('hidden', !selectionModel?.showMethodChangeConfirmation);
    const methodChangeMessage = (0, dependencies.$)('modeMethodChangeConfirmMessage');
    if (methodChangeMessage) methodChangeMessage.textContent = selectionModel?.methodChangeConfirmationMessage || '';
    (0, dependencies.$)('modeMethodChangeKeepBtn')?.toggleAttribute('disabled', !!busy);
    (0, dependencies.$)('modeMethodChangeConfirmBtn')?.toggleAttribute('disabled', !!busy);

    const riverOption = (0, dependencies.$)('modeRiverBoundaryOption');
    const riverInput = (0, dependencies.$)('modeRiverBoundaryInput');
    riverOption?.classList.toggle('hidden', !selectionModel?.showRiver);
    riverOption?.setAttribute('aria-busy', String(selection?.useRiverBoundaries && selection?.riverPartitionStatus === 'loading'));
    if (riverInput) {
      riverInput.checked = !!selection?.useRiverBoundaries;
      riverInput.disabled = !!busy;
    }
    const referenceStart = (0, dependencies.$)('territorialReferenceStartBtn');
    referenceStart?.classList.toggle('hidden', !selectionModel?.showReferenceStart);
    if (referenceStart) referenceStart.disabled = !!busy || !selection?.sourceCountryIds?.length;

    (0, dependencies.$)('modeDraftActions')?.classList.toggle('hidden', !toolbar.visible);
    const controls = { modeDraftRedrawBtn: !toolbar.redraw, modeDraftDeleteBtn: !toolbar.remove, modeDraftInsertBtn: !toolbar.insert, modeDraftDoneBtn: !toolbar.complete };
    for (const [id, disabled] of Object.entries(controls)) {
      const button = (0, dependencies.$)(id);
      if (button) button.disabled = disabled;
    }
    (0, dependencies.$)('modeDraftInsertBtn')?.setAttribute('aria-pressed', String(toolbar.editable && !!draft.vertexInsertMode));
    (0, dependencies.$)('modeDraftDoneBtn')?.setAttribute('aria-busy', String(state.modeProcessing));

    const hydroReview = multiDraftReviewActive(state);
    const hydroCount = hydroReview ? (0, dependencies.multiDraftPartCount)() : 0;
    const showSelectionActions = !!selectionModel?.selection && !!selectionModel.showDrawnActions;
    (0, dependencies.$)('multiDrawnActions')?.classList.toggle('hidden', !showSelectionActions && !hydroReview);
    const count = showSelectionActions ? selectionModel.count : hydroCount;
    const countNode = (0, dependencies.$)('multiDrawnCount');
    if (countNode) countNode.textContent = `${hydroReview && state.multiDraft?.shape === 'line' ? '경로' : '영역'} ${count}개`;
    const add = (0, dependencies.$)('multiDrawnAddBtn');
    if (add) add.disabled = showSelectionActions
      ? !!busy || draft.strokeActive || !selectionModel.canAddPart
      : !!busy || draft.strokeActive || !state.multiDraft?.current;
    const undo = (0, dependencies.$)('multiDrawnUndoBtn');
    if (undo) undo.disabled = showSelectionActions
      ? !!busy || draft.strokeActive || !selectionModel.canUndoPart
      : !!busy || draft.strokeActive || !count || (!!draftMode && draft.coords.length > 0);

    const primary = (0, dependencies.$)('modePrimaryBtn');
    if (primary) {
      primary.classList.toggle('hidden', labelMode || (!selection && toolbar.editable));
      let disabled = !!busy;
      let label = '완료';
      let icon = '#icon-check';
      if (selectionModel) {
        disabled ||= selectionModel.primaryDisabled;
        label = selectionModel.primaryLabel;
        icon = selectionModel.primaryIcon;
      } else {
        disabled ||= hydroReview && (!hydroCount || draftMode || !!state.multiDraft?.previewPending || !!state.multiDraft?.previewIssues?.length);
        disabled ||= draftMode && (draft.strokeActive || draft.coords.length < (0, dependencies.draftMinimumPoints)() || draft.issues.length > 0 || !cutLineReady);
        disabled ||= mergeTargetMode && !state.mergeTargetCountryIds.length;
        disabled ||= genericMergeMode && !state.genericFeatureMergeTargetIds.length;
        disabled ||= unitMergeMode && !state.territorialUnitMergeTargetIds.length;
        disabled ||= (genericSplitMode || unitSplitMode) && !hydroReview && !cutLineReady;
        disabled ||= unitRedrawMode && draft.coords.length < 3;
        disabled ||= boundarySelectMode && !boundaryReady;
        disabled ||= previewMode && state.geometryPreview.session.validation?.blocking === true;
        if (hydroReview) label = '생성';
        else if (previewMode) label = '변경 적용';
        else if (boundarySelectMode) label = `국경 편집 (${state.boundaryEditCountryIds.length})`;
        else if (boundaryEditMode || state.tool === 'country-coast') label = '수정 완료';
        else if (terrainMode) label = '그리기 완료';
        else if (mergeTargetMode) label = `합병 (${state.mergeTargetCountryIds.length})`;
        else if (genericMergeMode || unitMergeMode) label = '영역 합치기';
        else if (genericSplitMode || unitSplitMode) label = '영역 나누기';
        else if (unitRedrawMode) label = '영역 다시 지정';
      }
      primary.disabled = !!disabled;
      setButtonLabel(primary, label);
      (0, dependencies.$)('modePrimaryIcon')?.setAttribute('href', icon);
      primary.setAttribute('aria-label', label === '다음' ? '다음 단계' : label);
      primary.setAttribute('aria-busy', String(!!busy));
    }

    const cancel = (0, dependencies.$)('modeCancelBtn');
    if (cancel) {
      const back = !!selection && selection.stage !== 'setup';
      setButtonLabel(cancel, back ? '뒤로' : '취소');
      (0, dependencies.$)('modeCancelIcon')?.setAttribute('href', back ? '#icon-chevron-left' : '#icon-close');
      cancel.setAttribute('aria-label', back ? '이전 단계' : '작업 취소');
      cancel.disabled = !!state.modeProcessing;
    }
    syncGeometryPreviewSummary(selection);
    syncMapContextSurfaces();
    syncMapCursorMode();
    syncCountryActionButtons();
    dependencies.projectUi.syncHistory();
    (0, dependencies.syncStatusBar)();
  }

  function dispatchModePrimaryAction() {
    const selection = dependencies.state.territorySelectionSession;
    if (selection) return selection.stage === 'review'
      ? (0, dependencies.territorySelectionApply)()
      : (0, dependencies.territorySelectionAdvance)();
    if (dependencies.state.geometryPreview.session) return (0, dependencies.applyActiveGeometryPreview)();
    if (multiDraftReviewActive(dependencies.state) && !dependencies.editingDomain?.draftInputActive?.()) return (0, dependencies.completeMultiDraftCreation)();
    if (dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'selecting') return (0, dependencies.beginCountryBorderEditing)();
    if (dependencies.state.tool === 'country-border') return (0, dependencies.finishCountryBorderEdit)();
    if (dependencies.state.tool === 'country-coast') return (0, dependencies.finishCountryCoastEdit)();
    if (dependencies.state.tool === 'merge-generic-feature') return (0, dependencies.completeGenericFeatureMerge)();
    if (dependencies.state.tool === 'merge-territorial-unit') return (0, dependencies.completeTerritorialUnitMerge)();
    if (dependencies.state.tool === 'merge-country') return (0, dependencies.completeCountryMerge)();
    if ((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool)) return (0, dependencies.finishDraft)();
    return false;
  }

  async function runModePrimaryAction(action = dispatchModePrimaryAction) {
    if (dependencies.state.modeProcessing) return false;
    if (action === dispatchModePrimaryAction && (0, dependencies.$)('modePrimaryBtn')?.disabled) return false;
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

  function completeCurrentDraft() {
    if ((0, dependencies.$)('modeDraftDoneBtn')?.disabled || !dependencies.editingDomain?.draftInputActive?.()
      || dependencies.state.geometryPreview.session) return false;
    return runModePrimaryAction(dependencies.finishDraft);
  }

  return Object.freeze({
    connect,
    get runModePrimaryAction() { return runModePrimaryAction; },
    get completeCurrentDraft() { return completeCurrentDraft; },
    get setModeBanner() { return setModeBanner; },
    get syncCountryActionButtons() { return syncCountryActionButtons; },
    get syncCutDraftFeedback() { return syncCutDraftFeedback; },
    get syncMapContextSurfaces() { return syncMapContextSurfaces; },
    get syncMapHudBounds() { return syncMapHudBounds; },
    get toggleMapTaskWindow() { return toggleMapTaskWindow; },
    get updateModeButtons() { return updateModeButtons; },
  });
}
