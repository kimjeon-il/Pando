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
    const selectedId = dependencies.projectState.state.selected?.domain === 'territorial'
      && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? dependencies.projectState.state.selected.id : null;
    const selection = dependencies.projectState.state.territorySelectionSession;
    const buttons = [
      ['editBorderBtn', dependencies.projectState.state.tool === 'country-border' && dependencies.projectState.state.boundaryEditCountryIds.includes(String(selectedId))],
      ['editCoastBtn', dependencies.projectState.state.tool === 'country-coast' && dependencies.projectState.state.coastEditCountryId === selectedId],
      ['mergeCountryBtn', dependencies.projectState.state.tool === 'merge-country' && dependencies.projectState.state.mergeSourceCountryId === selectedId],
    ];
    if (selection?.actionButtonId) buttons.push([selection.actionButtonId, selection.targetCountryId === selectedId]);
    for (const [id, active] of buttons) (0, dependencies.platform.$)(id)?.classList.toggle('active', !!active);
  }

  function setModeBanner(text = '') {
    const instruction = (0, dependencies.platform.$)('modeTaskInstruction');
    if (!instruction) return;
    if (instruction.textContent !== text) instruction.textContent = text;
    instruction.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
    instruction.classList.toggle('hidden', !text);
    (0, dependencies.readinessUi.syncStatusBar)();
  }

  function syncCutDraftFeedback(assessment, preview = false) {
    const instruction = (0, dependencies.platform.$)('modeTaskInstruction');
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
    return (0, dependencies.toolServices.describeTool)(dependencies.projectState.state.tool, dependencies.projectState.state, { labelPlacement: dependencies.projectState.state.labelPlacementMode });
  }

  function countryDisplay(countryId) {
    const id = String(countryId || '');
    const feature = id ? dependencies.countries.countryFeatureById?.(id) : null;
    if (!feature) return null;
    const override = dependencies.projectState.state.countryOverrides?.[id] || {};
    return {
      name: dependencies.presentation.countryName(feature, override),
      flagUrl: dependencies.labelPresentation.effectiveCountryFlagUrl({ countryId: id, override, assetRevision: dependencies.layerPresentation.ASSET_REVISION }),
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
    const flow = (0, dependencies.platform.$)('annexCountryFlow');
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
    setCountryDisplay({ flag: (0, dependencies.platform.$)('annexTargetCountryFlag'), name: (0, dependencies.platform.$)('annexTargetCountryName') }, target, '국가');
    setCountryDisplay({ flag: (0, dependencies.platform.$)('annexDonorCountryFlag'), name: (0, dependencies.platform.$)('annexDonorCountryName') }, donor ? { ...donor, name: donorLabel } : null, '국가 선택');
    flow.setAttribute('aria-label', donor
      ? `${donorLabel}의 영토를 ${target?.name || '국가'}에 편입`
      : `${target?.name || '국가'}에 편입할 국가를 선택`);
  }

  function syncGeometryPreviewSummary(selection) {
    const element = (0, dependencies.platform.$)('geometryPreviewSummary');
    if (!element) return;
    const preview = dependencies.projectState.state.geometryPreview.session;
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
    if (metrics.transferredAreaKm2 > 0) fragments.push(`이동 ${(0, dependencies.applicationServicesA.formatArea)(metrics.transferredAreaKm2)}`);
    if (metrics.finalAreaKm2 > 0) fragments.push(`최종 ${(0, dependencies.applicationServicesA.formatArea)(metrics.finalAreaKm2)}`);
    const value = fragments.length ? fragments.join(' · ') : '변경 결과를 확인하세요.';
    element.textContent = value;
    element.setAttribute('aria-label', value);
  }

  function mapModeContextActive() {
    const label = dependencies.projectState.state.labelPlacementMode || dependencies.projectState.state.tool === 'label';
    return !!(label || dependencies.projectState.state.territorySelectionSession || (0, dependencies.draftPresentation.hydroToolConfig)(dependencies.projectState.state.tool)
      || dependencies.projectState.state.geometryPreview.session || (0, dependencies.toolServices.isSpecialTool)(dependencies.projectState.state.tool)
      || dependencies.domains.editingDomain?.draftInputActive?.());
  }

  function elementHasLayout(element) {
    if (!element || element.classList.contains('hidden')) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  function syncMapHudBounds() {
    const slot = (0, dependencies.platform.$)('mapTopContextSlot');
    const map = (0, dependencies.platform.$)('map');
    if (!slot || !map) return;
    const bounds = map.getBoundingClientRect();
    if (!bounds.width) return;
    const edge = 12;
    let left = edge;
    let right = bounds.width - edge;
    const view = document.querySelector('.map-view-toolbar');
    if (elementHasLayout(view)) right = Math.min(right, view.getBoundingClientRect().left - bounds.left - 8);
    const editor = (0, dependencies.platform.$)('rightPanel');
    if (elementHasLayout(editor) && editor.classList.contains('surface-open')) {
      const editorBounds = editor.getBoundingClientRect();
      const mapCenter = bounds.left + (bounds.width / 2);
      if (editorBounds.left >= mapCenter) right = Math.min(right, editorBounds.left - bounds.left - 8);
      else if (editorBounds.right <= mapCenter) left = Math.max(left, editorBounds.right - bounds.left + 8);
    }
    if (right <= left) {
      left = edge;
      right = bounds.width - edge;
    }
    slot.style.setProperty('--map-context-center', `${Math.round((left + right) / 2)}px`);
    slot.style.setProperty('--map-context-width', `${Math.max(0, Math.floor(right - left))}px`);
  }

  function syncMapContextSurfaces() {
    const editing = mapModeContextActive();
    dependencies.surfaceCommands.setMapModeContextActive(editing);
    if (!editing) dependencies.projectState.state.modeTaskMinimized = false;
    const context = (0, dependencies.platform.$)('modeEditingContext');
    const content = (0, dependencies.platform.$)('modeTaskWindowContent');
    const minimize = (0, dependencies.platform.$)('modeTaskMinimizeBtn');
    context?.classList.toggle('hidden', !editing);
    context?.classList.toggle('is-minimized', false);
    if (content) content.hidden = false;
    if (minimize) {
      minimize.hidden = true;
      minimize.setAttribute('aria-expanded', 'true');
    }
    dependencies.workspaceUiB.editorWorkspacePresentation.sync({ active: editing });
    dependencies.domainControllers.syncSelectionToolbarInteraction?.();
    requestAnimationFrame(syncMapHudBounds);
  }

  function toggleMapTaskWindow() {
    if (!mapModeContextActive()) return;
    dependencies.projectState.state.modeTaskMinimized = false;
    syncMapContextSurfaces();
  }

  function syncMapCursorMode() {
    const map = (0, dependencies.platform.$)('map');
    if (!map) return;
    const mode = (0, dependencies.toolServices.toolCursorMode)(dependencies.projectState.state.tool, dependencies.projectState.state, { labelPlacement: dependencies.projectState.state.labelPlacementMode });
    map.classList.toggle('country-pick-mode', !!mode.country);
    map.classList.toggle('generic-feature-mode', !!mode.generic);
    map.classList.toggle('candidate-pick-mode', !!mode.candidate);
    map.classList.toggle('select-mode', !!mode.select);
  }

  function syncTerritorySetup(model) {
    const selection = model?.current;
    const setup = (0, dependencies.platform.$)('territorialCreateSetup');
    setup?.classList.toggle('hidden', !model?.showSetup);
    for (const id of ['territorialCreateSovereignRow', 'territorialCreateParentRow', 'territorialCreateSourceRow']) {
      (0, dependencies.platform.$)(id)?.classList.toggle('hidden', !model?.showSetup || !model?.showSubunitFields);
    }
    if (model?.showSetup) {
      const nameLabel = (0, dependencies.platform.$)('territorialCreateNameLabel');
      if (nameLabel) nameLabel.textContent = model.nameLabel || '이름';
      const name = (0, dependencies.platform.$)('territorialCreateNameInput');
      if (name && name.value !== selection.name) name.value = selection.name;
      if (name) name.closest('.field-group')?.classList.toggle('hidden', !!selection.editOperation);
      if (model?.showSubunitFields) {
        const setupModel = (0, dependencies.territorialEditingB.territorialCreateSetupModel)();
        if (setupModel) {
          const countryChoice = (0, dependencies.propertyEditingB.replaceSelectOptions)((0, dependencies.platform.$)('territorialCreateSovereignInput'), setupModel.countryOptions, selection.sovereignId, { autoSelectSingle: true });
          (0, dependencies.propertyEditingB.replaceSelectOptions)((0, dependencies.platform.$)('territorialCreateParentInput'), setupModel.parentOptions, selection.parentId, { autoSelectSingle: true });
          (0, dependencies.platform.$)('territorialCreateSovereignInput').disabled = !!selection.editOperation;
          (0, dependencies.platform.$)('territorialCreateParentInput').disabled = !!selection.editOperation;
          const sourceChoice = (0, dependencies.propertyEditingB.replaceSelectOptions)((0, dependencies.platform.$)('territorialCreateSourceInput'), setupModel.sourceOptions, selection.sourceKey, { autoSelectSingle: true });
          (0, dependencies.platform.$)('territorialCreateSovereignRow')?.classList.toggle('hidden', countryChoice.single);
          (0, dependencies.platform.$)('territorialCreateParentRow')?.classList.toggle('hidden', !(0, dependencies.territorialServicesA.shouldShowTerritorialParentChoice)({
            sovereignId: selection.sovereignId,
            parentId: selection.parentId,
            options: setupModel.parentOptions,
          }));
          (0, dependencies.platform.$)('territorialCreateSourceRow')?.classList.toggle('hidden', sourceChoice.single);
        }
      }
    }
    const reference = (0, dependencies.platform.$)('territorialCreateReference');
    reference?.classList.toggle('hidden', !model?.showReference);
    if (model?.showReference) {
      const countries = selection.sourceCountryIds.map(countryDisplay).filter(Boolean);
      const referenceLabel = model.referenceLabel || '기준 국가';
      const label = (0, dependencies.platform.$)('territorialCreateReferenceLabel');
      const count = (0, dependencies.platform.$)('territorialCreateReferenceCount');
      const list = (0, dependencies.platform.$)('territorialCreateReferenceList');
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
    const unit = (dependencies.projectState.state.territorialUnits || []).find(item => String(item?.id || '') === id);
    const name = String(unit?.properties?.name || '').trim();
    return name || null;
  }

  function syncTerritoryReviewSummary(model) {
    const summary = (0, dependencies.platform.$)('territorialReviewSummary');
    const visible = !!model?.showReviewSummary;
    summary?.classList.toggle('hidden', !visible);
    if (!summary) return;
    const name = (0, dependencies.platform.$)('territorialReviewName');
    const detail = (0, dependencies.platform.$)('territorialReviewDetail');
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
    const state = dependencies.projectState.state;
    const selectionModel = (0, dependencies.territorySelectionB.territorySelectionPresentation)();
    const selection = selectionModel?.current || null;
    const draft = (0, dependencies.draftPresentation.editingDraftSnapshot)();
    const labelMode = state.labelPlacementMode || state.tool === 'label';
    const terrainMode = !!(0, dependencies.draftPresentation.hydroToolConfig)(state.tool);
    const draftMode = dependencies.domains.editingDomain?.draftInputActive?.();
    const previewMode = !!state.geometryPreview.session;
    const mergeTargetMode = state.tool === 'merge-country' && !!state.mergeSourceCountryId;
    const genericMergeMode = state.tool === 'merge-generic-feature' && !!state.genericFeatureMergeSourceId;
    const genericSplitMode = state.tool === 'split-generic-feature' && !!state.genericFeatureSplitSourceId;
    const unitMergeMode = state.tool === 'merge-territorial-unit' && !!state.territorialUnitMergeSourceId;
    const unitSplitMode = state.tool === 'split-territorial-unit' && !!(state.territorialUnitSplitSourceId || state.territorialUnitSplitVirtualSource);
    const unitRedrawMode = state.tool === 'redraw-territorial-unit' && !!state.territorialUnitRedrawSourceId;
    const boundarySelectMode = state.tool === 'country-border' && state.boundaryEditPhase === 'selecting';
    const boundaryEditMode = state.tool === 'country-border' && state.boundaryEditPhase === 'editing';
    const boundaryPreparation = ['country-border', 'country-coast'].includes(state.tool) ? state.boundaryPreparation : null;
    const boundaryPending = ['pending', 'moving'].includes(boundaryPreparation?.status);
    const boundaryFailed = boundaryPreparation?.status === 'error';
    const boundaryReady = !boundarySelectMode || (0, dependencies.geometryOperations.boundaryEditSelectionAnalysis)(state.boundaryEditCountryIds).valid;
    const cutLineMode = genericSplitMode || unitSplitMode || selectionModel?.line;
    const cutLineReady = !cutLineMode || draft.cutAssessment?.valid === true;
    const toolbar = draftToolbarStatus({
      state, draft, draftMode, hasDraftTool: dependencies.surfaces.isGenericFeatureDraftTool(state.tool),
      minimumPoints: dependencies.countryEditingA.draftMinimumPoints(), cutLineReady,
    });
    const task = activeModeTaskDescriptor();
    const taskName = (0, dependencies.platform.$)('modeTaskName');
    const taskStage = (0, dependencies.platform.$)('modeTaskStage');
    if (taskName) taskName.textContent = selectionModel?.taskName || task.name;
    if (taskStage) taskStage.textContent = boundaryPending ? '경계 준비 중…' : boundaryFailed ? boundaryPreparation.message : selectionModel?.stageLabel || task.stage;
    syncTerritoryTransferFlow(selectionModel);
    syncTerritorySetup(selectionModel);
    syncTerritoryReviewSummary(selectionModel);
    const instruction = (0, dependencies.platform.$)('modeTaskInstruction');
    let legend = instruction?.parentElement?.querySelector('[data-interaction-legend]');
    if (!legend && instruction) {
      legend = instruction.ownerDocument.createElement('small');
      legend.dataset.interactionLegend = '';
      instruction.insertAdjacentElement('afterend', legend);
    }
    if (legend) {
      const candidates = state.territorySelectionSession?.candidates || [];
      const chosen = state.territorySelectionSession?.selectedCandidateIndex;
      legend.textContent = candidates.length
        ? candidates.map((_, index) => `${String.fromCharCode(65 + index)} · ${index === chosen ? '선택됨' : '선택 안 됨'}`).join(' / ')
        : mergeTargetMode || genericMergeMode || unitMergeMode ? '굵은 선: 남길 대상 · 가는 선: 합칠 대상'
          : state.territorySelectionSession?.kind === 'annex' ? '굵은 선: 편입받는 대상 · 가는 선: 제공 영역'
            : selection ? '옅은 선: 기준 영역 · 굵은 선: 새 영역 · 가는 선: 선택한 조각' : '';
      legend.hidden = !legend.textContent;
    }

    const specialMode = !!(selection || labelMode || terrainMode || previewMode || (0, dependencies.toolServices.isSpecialTool)(state.tool) || draftMode);
    const busy = state.modeProcessing || selection?.previewPending;
    const calculating = boundaryPending || selection?.computationPending || selection?.activePhase === 'preparing';
    const bar = (0, dependencies.platform.$)('modeActionBar');
    bar?.classList.toggle('hidden', !specialMode);
    bar?.classList.toggle('single-action', labelMode);
    bar?.classList.toggle('is-processing', !!busy);
    bar?.setAttribute('aria-busy', String(!!busy || !!calculating));

    const methodSwitch = (0, dependencies.platform.$)('modeMethodSwitch');
    methodSwitch?.classList.toggle('hidden', !selectionModel?.showMethods);
    const activeMethod = selectionModel?.activeMethod;
    for (const [id, method] of [['modeDirectLineMethodInput', 'line'], ['modePolygonMethodInput', 'polygon'], ['modeComponentsMethodInput', 'components']]) {
      const input = (0, dependencies.platform.$)(id);
      if (!input) continue;
      input.checked = activeMethod === method;
      input.disabled = !!busy || !selectionModel?.selection || !!selectionModel?.showMethodChangeConfirmation;
    }
    (0, dependencies.platform.$)('modePolygonMethodOption')?.classList.toggle('hidden', !selectionModel?.showMethods);

    const methodChangeConfirm = (0, dependencies.platform.$)('modeMethodChangeConfirm');
    methodChangeConfirm?.classList.toggle('hidden', !selectionModel?.showMethodChangeConfirmation);
    const methodChangeMessage = (0, dependencies.platform.$)('modeMethodChangeConfirmMessage');
    if (methodChangeMessage) methodChangeMessage.textContent = selectionModel?.methodChangeConfirmationMessage || '';
    (0, dependencies.platform.$)('modeMethodChangeKeepBtn')?.toggleAttribute('disabled', !!busy);
    (0, dependencies.platform.$)('modeMethodChangeConfirmBtn')?.toggleAttribute('disabled', !!busy);

    const riverOption = (0, dependencies.platform.$)('modeRiverBoundaryOption');
    const riverInput = (0, dependencies.platform.$)('modeRiverBoundaryInput');
    riverOption?.classList.toggle('hidden', !selectionModel?.showRiver);
    riverOption?.setAttribute('aria-busy', String(selection?.useRiverBoundaries && selection?.riverPartitionStatus === 'loading'));
    if (riverInput) {
      riverInput.checked = !!selection?.useRiverBoundaries;
      riverInput.disabled = !!busy;
    }
    const referenceStart = (0, dependencies.platform.$)('territorialReferenceStartBtn');
    referenceStart?.classList.toggle('hidden', !selectionModel?.showReferenceStart);
    if (referenceStart) referenceStart.disabled = !!busy || !selection?.sourceCountryIds?.length;

    (0, dependencies.platform.$)('modeDraftActions')?.classList.toggle('hidden', !toolbar.visible);
    const controls = { modeDraftRedrawBtn: !toolbar.redraw, modeDraftDeleteBtn: !toolbar.remove, modeDraftInsertBtn: !toolbar.insert, modeDraftDoneBtn: !toolbar.complete };
    for (const [id, disabled] of Object.entries(controls)) {
      const button = (0, dependencies.platform.$)(id);
      if (button) button.disabled = disabled;
    }
    (0, dependencies.platform.$)('modeDraftInsertBtn')?.setAttribute('aria-pressed', String(toolbar.editable && !!draft.vertexInsertMode));
    (0, dependencies.platform.$)('modeDraftDoneBtn')?.setAttribute('aria-busy', String(state.modeProcessing));

    const hydroReview = multiDraftReviewActive(state);
    const hydroCount = hydroReview ? (0, dependencies.countryCommitFlow.multiDraftPartCount)() : 0;
    const showSelectionActions = !!selectionModel?.selection && !!selectionModel.showDrawnActions;
    (0, dependencies.platform.$)('multiDrawnActions')?.classList.toggle('hidden', !showSelectionActions && !hydroReview);
    const count = showSelectionActions ? selectionModel.count : hydroCount;
    const countNode = (0, dependencies.platform.$)('multiDrawnCount');
    if (countNode) countNode.textContent = `${hydroReview && state.multiDraft?.shape === 'line' ? '경로' : '영역'} ${count}개`;
    const add = (0, dependencies.platform.$)('multiDrawnAddBtn');
    if (add) add.disabled = showSelectionActions
      ? !!busy || draft.strokeActive || !selectionModel.canAddPart
      : !!busy || draft.strokeActive || !state.multiDraft?.current;
    const undo = (0, dependencies.platform.$)('multiDrawnUndoBtn');
    if (undo) undo.disabled = showSelectionActions
      ? !!busy || draft.strokeActive || !selectionModel.canUndoPart
      : !!busy || draft.strokeActive || !count || (!!draftMode && draft.coords.length > 0);

    const primary = (0, dependencies.platform.$)('modePrimaryBtn');
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
        disabled ||= draftMode && (draft.strokeActive || draft.coords.length < (0, dependencies.countryEditingA.draftMinimumPoints)() || draft.issues.length > 0 || !cutLineReady);
        disabled ||= mergeTargetMode && !state.mergeTargetCountryIds.length;
        disabled ||= genericMergeMode && !state.genericFeatureMergeTargetIds.length;
        disabled ||= unitMergeMode && !state.territorialUnitMergeTargetIds.length;
        disabled ||= (genericSplitMode || unitSplitMode) && !hydroReview && !cutLineReady;
        disabled ||= unitRedrawMode && draft.coords.length < 3;
        disabled ||= boundaryPending || (boundarySelectMode && !boundaryReady && !boundaryFailed);
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
      if (boundaryFailed && !previewMode) label = '다시 시도';
      if (boundaryPending) label = '경계 준비 중…';
      primary.disabled = !!disabled;
      setButtonLabel(primary, label);
      (0, dependencies.platform.$)('modePrimaryIcon')?.setAttribute('href', icon);
      primary.setAttribute('aria-label', label === '다음' ? '다음 단계' : label);
      primary.setAttribute('aria-busy', String(!!busy || !!calculating));
    }

    const cancel = (0, dependencies.platform.$)('modeCancelBtn');
    if (cancel) {
      const back = !!selection && selection.stage !== 'setup';
      setButtonLabel(cancel, back ? '뒤로' : '취소');
      (0, dependencies.platform.$)('modeCancelIcon')?.setAttribute('href', back ? '#icon-chevron-left' : '#icon-close');
      cancel.setAttribute('aria-label', back ? '이전 단계' : '작업 취소');
      cancel.disabled = !!state.modeProcessing;
    }
    syncGeometryPreviewSummary(selection);
    syncMapContextSurfaces();
    syncMapCursorMode();
    syncCountryActionButtons();
    dependencies.lifecycleUi.projectUi.syncHistory();
    (0, dependencies.readinessUi.syncStatusBar)();
  }

  function dispatchModePrimaryAction() {
    const selection = dependencies.projectState.state.territorySelectionSession;
    if (selection) return selection.stage === 'review'
      ? (0, dependencies.territorySelectionA.territorySelectionApply)()
      : (0, dependencies.territorySelectionA.territorySelectionAdvance)();
    if (dependencies.projectState.state.geometryPreview.session) return (0, dependencies.geometryOperations.applyActiveGeometryPreview)();
    if (multiDraftReviewActive(dependencies.projectState.state) && !dependencies.domains.editingDomain?.draftInputActive?.()) return (0, dependencies.countryCommitFlow.completeMultiDraftCreation)();
    if (['country-border', 'country-coast'].includes(dependencies.projectState.state.tool) && dependencies.projectState.state.boundaryPreparation?.status === 'error') {
      dependencies.projectState.state.boundaryPreparation.retry();
      return true;
    }
    if (dependencies.projectState.state.tool === 'country-border' && dependencies.projectState.state.boundaryEditPhase === 'selecting') return (0, dependencies.countryEditingA.beginCountryBorderEditing)();
    if (dependencies.projectState.state.tool === 'country-border') return (0, dependencies.countryEditingB.finishCountryBorderEdit)();
    if (dependencies.projectState.state.tool === 'country-coast') return (0, dependencies.countryEditingB.finishCountryCoastEdit)();
    if (dependencies.projectState.state.tool === 'merge-generic-feature') return (0, dependencies.genericEditingA.completeGenericFeatureMerge)();
    if (dependencies.projectState.state.tool === 'merge-territorial-unit') return (0, dependencies.territorialEditingA.completeTerritorialUnitMerge)();
    if (dependencies.projectState.state.tool === 'merge-country') return (0, dependencies.countryCommitFlow.completeCountryMerge)();
    if ((0, dependencies.surfaces.isGenericFeatureDraftTool)(dependencies.projectState.state.tool)) return (0, dependencies.countryCommitFlow.finishDraft)();
    return false;
  }

  async function runModePrimaryAction(action = dispatchModePrimaryAction) {
    if (dependencies.projectState.state.modeProcessing) return false;
    if (action === dispatchModePrimaryAction && (0, dependencies.platform.$)('modePrimaryBtn')?.disabled) return false;
    dependencies.projectState.state.modeProcessing = true;
    updateModeButtons();
    try {
      return await action();
    } catch (error) {
      (0, dependencies.feedback.reportOperationError)(error, '지도 작업을 완료하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.', 'PL-MODE-001', 4200);
      return false;
    } finally {
      dependencies.projectState.state.modeProcessing = false;
      updateModeButtons();
    }
  }

  function completeCurrentDraft() {
    if ((0, dependencies.platform.$)('modeDraftDoneBtn')?.disabled || !dependencies.domains.editingDomain?.draftInputActive?.()
      || dependencies.projectState.state.geometryPreview.session) return false;
    return runModePrimaryAction(dependencies.countryCommitFlow.finishDraft);
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
