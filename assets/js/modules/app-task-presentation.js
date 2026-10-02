import { taskStagePresentation, taskTargetRefs, taskWorkflowPresentation } from './app-task-stage-model.js';
import { lineDistanceKm } from './geometry-metrics.js';

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
  let operationFeedback = '';

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
      ['annexTerritoryBtn', selection?.actionButtonId === 'annexTerritoryBtn' && selection.targetCountryId === selectedId],
      ['editBorderBtn', dependencies.projectState.state.tool === 'country-border' && dependencies.projectState.state.boundaryEditCountryIds.includes(String(selectedId))],
      ['editCoastBtn', dependencies.projectState.state.tool === 'country-coast' && dependencies.projectState.state.coastEditCountryId === selectedId],
      ['mergeCountryBtn', dependencies.projectState.state.tool === 'merge-country' && dependencies.projectState.state.mergeSourceCountryId === selectedId],
    ];
    for (const [id, active] of buttons) (0, dependencies.platform.$)(id)?.classList.toggle('active', !!active);
  }

  function setModeBanner(text = '', { feedback = false } = {}) {
    operationFeedback = feedback ? text : '';
    const instruction = (0, dependencies.platform.$)('modeTaskInstruction');
    if (!instruction) return;
    if (instruction.textContent !== text) instruction.textContent = text;
    instruction.classList.remove('cut-valid', 'cut-invalid', 'cut-pending');
    instruction.classList.toggle('hidden', !text);
    // Visibility is decided together with validation feedback during the UI sync.
    syncTaskActionDescription();
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
    const feature = id ? dependencies.countries.countryFeatureById(id) : null;
    if (!feature) return null;
    const override = dependencies.projectState.state.countryOverrides?.[id] || {};
    return {
      name: dependencies.presentation.countryName(feature, override),
      flagUrl: dependencies.labelPresentation.effectiveCountryFlagUrl({ countryId: id, override, assetRevision: dependencies.layerPresentation.ASSET_REVISION }),
    };
  }


  function displayObject(ref) {
    const display = dependencies.objectOperationsA.objectDisplayInfo(ref);
    const country = ref.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryDisplay(ref.id) : null;
    return { name: display.name, flagUrl: country?.flagUrl || '' };
  }

  function appendIdentity(parent, display) {
    const document = parent.ownerDocument;
    if (display.flagUrl) {
      const flag = document.createElement('img');
      flag.className = 'workflow-object-flag';
      flag.src = display.flagUrl;
      flag.alt = '';
      parent.append(flag);
    }
    const name = document.createElement('strong');
    name.textContent = display.name;
    parent.append(name);
  }

  function syncGeometryPreviewSummary(view, selection) {
    const element = dependencies.platform.$('geometryPreviewSummary');
    if (!element) return;
    const state = dependencies.projectState.state;
    const preview = state.geometryPreview.session;
    const visible = (view === null || view.review) && !!preview && !preview.validation?.blocking;
    element.classList.toggle('hidden', !visible);
    if (!visible) {
      element.replaceChildren();
      delete element.dataset.signature;
      return;
    }
    const rows = [];
    const names = ids => ids.map(id => countryDisplay(id)?.name || territorialUnitDisplay(id)).filter(Boolean).join(', ');
    if (selection) {
      if (selection.kind === 'annex') rows.push(['넘겨받는 국가', names([selection.targetCountryId])]);
      else rows.push(['이름', selection.name]);
      if (selection.sovereignId) rows.push(['소속 국가', names([selection.sovereignId])]);
      if (selection.parentId && selection.parentId !== selection.sovereignId) rows.push(['상위 단위', names([selection.parentId])]);
      if (selection.sourceCountryIds.length) rows.push([selection.kind === 'annex' ? '넘겨주는 국가' : '원소속 국가', names(selection.sourceCountryIds)]);
      rows.push([['annex', 'new-country'].includes(selection.kind) ? '선택 영토' : '선택 영역', `${dependencies.territorySelectionB.territorySelectionPresentation().count}개`]);
    } else {
      const refs = currentTaskTargets();
      if (refs.length) rows.push(['대상', refs.map(ref => displayObject(ref).name).join(', ')]);
    }
    const metrics = preview.metrics || {};
    for (const [key, label] of [['transferredAreaKm2', '이동 면적'], ['finalAreaKm2', '결과 면적']]) {
      if (Number.isFinite(metrics[key])) rows.push([label, dependencies.applicationServicesA.formatArea(metrics[key], 'ko-KR', { approximate: false })]);
    }
    const signature = JSON.stringify(rows);
    if (element.dataset.signature === signature) return;
    const fragment = element.ownerDocument.createDocumentFragment();
    for (const [label, value] of rows.filter(([, value]) => value !== '')) {
      const row = element.ownerDocument.createElement('div');
      const term = element.ownerDocument.createElement('dt');
      const detail = element.ownerDocument.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      fragment.append(row);
    }
    element.replaceChildren(fragment);
    element.dataset.signature = signature;
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
    const editor = (0, dependencies.platform.$)('editorSurface');
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
    dependencies.domainControllers.syncSelectionToolbarInteraction();
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
      if (nameLabel) nameLabel.textContent = '이름';
      const name = (0, dependencies.platform.$)('territorialCreateNameInput');
      if (name && name.value !== selection.name) name.value = selection.name;
      if (name) name.closest('.field-group')?.classList.toggle('hidden', !!selection.editOperation);
      if (model?.showSubunitFields) {
        const setupModel = (0, dependencies.territorialEditingB.territorialCreateSetupModel)();
        if (setupModel) {
          (0, dependencies.propertyEditingB.replaceSelectOptions)((0, dependencies.platform.$)('territorialCreateSovereignInput'), setupModel.countryOptions, selection.sovereignId, { autoSelectSingle: true });
          (0, dependencies.propertyEditingB.replaceSelectOptions)((0, dependencies.platform.$)('territorialCreateParentInput'), setupModel.parentOptions, selection.parentId, { autoSelectSingle: true });
          (0, dependencies.platform.$)('territorialCreateSovereignInput').disabled = !!selection.editOperation;
          (0, dependencies.platform.$)('territorialCreateParentInput').disabled = !!selection.editOperation;
          const sourceChoice = (0, dependencies.propertyEditingB.replaceSelectOptions)((0, dependencies.platform.$)('territorialCreateSourceInput'), setupModel.sourceOptions, selection.sourceKey, { autoSelectSingle: true });
          (0, dependencies.platform.$)('territorialCreateSovereignRow')?.classList.toggle('hidden', !setupModel.countryOptions.length);
          const flag = dependencies.platform.$('territorialCreateSovereignFlag');
          if (flag) {
            const country = countryDisplay(selection.sovereignId);
            flag.hidden = !country?.flagUrl;
            if (country?.flagUrl) flag.src = country.flagUrl;
            else flag.removeAttribute('src');
          }
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

  function syncTerritorySelectionStack(model) {
    const section = (0, dependencies.platform.$)('territorySelectionStack');
    const list = (0, dependencies.platform.$)('territorySelectionStackList');
    const summary = (0, dependencies.platform.$)('territorySelectionStackSummary');
    const current = model?.current;
    const visible = !!model?.selection;
    section?.classList.toggle('hidden', !visible);
    if (!visible || !list || !summary) return;

    const activeComponents = current.activePhase === 'components'
      ? dependencies.territoryComponents.territoryComponentItems().filter(item => item.selected)
      : [];
    const items = [
      ...current.parts.map(part => ({ kind: 'part', id: part.id, geometry: part.geometry })),
      ...activeComponents.map(item => ({ kind: 'component', id: item.key, geometry: item.geometry })),
    ];
    const pending = current.computationPending || current.computationError;
    const busy = !!(pending || current.previewPending || current.applying || dependencies.projectState.state.modeProcessing);
    const label = ['annex', 'new-country'].includes(current.kind) ? '선택 영토' : '선택 영역';
    section.setAttribute('aria-label', label);
    const aggregate = items.length
      ? current.activePhase === 'components' ? current.combinedGeometry : current.archivedGeometry
      : null;
    const totalArea = pending ? current.computationError ? '계산 실패' : '계산 중…' : dependencies.applicationServicesA.formatArea(
      dependencies.applicationServicesB.sphericalGeometryAreaKm2(aggregate), 'ko-KR', { approximate: false },
    );
    const summaryText = `${label} ${items.length}개 · ${totalArea}`;
    if (summary.textContent !== summaryText) summary.textContent = summaryText;
    const rows = items.map((item, index) => ({
      ...item,
      ordinal: index + 1,
      area: dependencies.applicationServicesA.formatArea(
        dependencies.applicationServicesB.sphericalGeometryAreaKm2(item.geometry), 'ko-KR', { approximate: false },
      ),
    }));
    const signature = JSON.stringify([busy, rows.map(({ kind, id, area }) => [kind, id, area])]);
    if (list.dataset.signature === signature) return;
    const fragment = list.ownerDocument.createDocumentFragment();
    for (const row of rows) {
      const item = list.ownerDocument.createElement('li');
      item.className = 'workflow-result-row';
      const number = list.ownerDocument.createElement('span');
      number.className = 'workflow-result-number';
      number.textContent = row.ordinal <= 9 ? String.fromCodePoint(0x2460 + row.ordinal - 1) : `${row.ordinal}.`;
      const area = list.ownerDocument.createElement('span');
      area.className = 'workflow-result-value';
      area.textContent = row.area;
      const remove = list.ownerDocument.createElement('button');
      remove.className = 'ui-button workflow-result-remove';
      remove.type = 'button';
      remove.dataset.itemKind = row.kind;
      remove.dataset.itemId = row.id;
      remove.setAttribute('aria-label', `${row.ordinal}번째 ${label} 삭제`);
      remove.disabled = busy;
      remove.textContent = '−';
      item.append(number, area, remove);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    list.dataset.signature = signature;
  }

  function territorialUnitDisplay(unitId) {
    const id = String(unitId || '');
    if (!id) return null;
    const unit = dependencies.territorialModel.entityRepository.get(id);
    if (!unit || unit.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) return null;
    const name = String(unit.properties?.name || '').trim();
    return name || null;
  }


  function syncTaskResults(view, draft) {
    const state = dependencies.projectState.state;
    const section = dependencies.platform.$('modeTaskResults');
    const list = dependencies.platform.$('modeTaskResultsList');
    const summary = dependencies.platform.$('modeTaskResultsSummary');
    if (!section || !list || !summary) return;
    const hydro = state.multiDraft?.kind === 'hydro' && ['river', 'lake'].includes(state.tool);
    const merge = ['merge-country', 'merge-territorial-unit'].includes(state.tool) && !view?.review;
    section.classList.toggle('hidden', !hydro && !merge);
    if (!hydro && !merge) return;
    const busy = !!(state.modeProcessing || state.multiDraft?.previewPending || draft.strokeActive);
    const length = geometry => (geometry?.type === 'MultiLineString' ? geometry.coordinates : [geometry?.coordinates || []])
      .reduce((sum, line) => sum + lineDistanceKm(line), 0);
    const measure = geometry => state.tool === 'river'
      ? `${length(geometry).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} km`
      : dependencies.applicationServicesA.formatArea(dependencies.applicationServicesB.sphericalGeometryAreaKm2(geometry), 'ko-KR', { approximate: false });
    const parts = hydro ? [...state.multiDraft.parts, ...(state.multiDraft.current ? [state.multiDraft.current] : [])] : [];
    const rows = hydro
      ? parts.map(part => ({ value: measure(part.geometry) }))
      : (view?.resultRefs || []).map(ref => ({ ref, ...displayObject(ref) }));
    const total = hydro ? state.multiDraft.previewPending ? '계산 중…'
      : state.multiDraft.previewIssues?.length ? '검증 필요'
        : parts.length && !state.multiDraft.previewGeometry ? '계산 중…' : measure(state.multiDraft.previewGeometry) : '';
    summary.textContent = `${view.resultLabel} ${rows.length}개${hydro ? ` · ${total}` : ''}`;
    section.setAttribute('aria-label', view.resultLabel);
    const signature = JSON.stringify([busy, rows]);
    if (list.dataset.signature === signature) return;
    const fragment = list.ownerDocument.createDocumentFragment();
    rows.forEach((row, index) => {
      const item = list.ownerDocument.createElement('li');
      item.className = 'workflow-result-row';
      const number = list.ownerDocument.createElement('span');
      number.className = 'workflow-result-number';
      number.textContent = index < 9 ? String.fromCodePoint(0x2460 + index) : `${index + 1}.`;
      const value = list.ownerDocument.createElement('span');
      value.className = 'workflow-result-value';
      if (row.ref) appendIdentity(value, row);
      else value.textContent = row.value;
      item.append(number, value);
      if (row.ref) {
        const remove = list.ownerDocument.createElement('button');
        remove.className = 'ui-button workflow-result-remove';
        remove.type = 'button';
        remove.dataset.objectId = row.ref.id;
        remove.disabled = busy;
        remove.setAttribute('aria-label', `${row.name} 합병 대상에서 제외`);
        remove.textContent = '−';
        item.append(remove);
      }
      fragment.append(item);
    });
    list.replaceChildren(fragment);
    list.dataset.signature = signature;
  }

  function setButtonLabel(button, label) {
    const node = button?.querySelector('.mode-button-label');
    if (node) node.textContent = label;
    else if (button) button.textContent = label;
  }

  function syncTaskActionDescription() {
    const instruction = (0, dependencies.platform.$)('modeTaskInstruction');
    const reason = (0, dependencies.platform.$)('modeTaskDisabledReason');
    const describedBy = [];
    if (instruction?.textContent?.trim()) describedBy.push('modeTaskInstruction');
    if (reason?.textContent?.trim()) describedBy.push('modeTaskDisabledReason');
    for (const id of ['modePrimaryBtn', 'modeDraftDoneBtn']) {
      const button = (0, dependencies.platform.$)(id);
      if (!button) continue;
      if (describedBy.length) button.setAttribute('aria-describedby', describedBy.join(' '));
      else button.removeAttribute?.('aria-describedby');
    }
  }

  function syncTaskStatus({
    state, selection, selectionModel, draft, toolbar, primary, boundaryAnalysis,
    boundaryPending, boundaryFailed, calculating, busy, cutLineMode, cutLineReady,
    mergeTargetMode, genericMergeMode, unitMergeMode, unitRedrawMode, hydroReview, hydroCount,
  }) {
    const draftDone = (0, dependencies.platform.$)('modeDraftDoneBtn');
    const draftActions = (0, dependencies.platform.$)('modeDraftActions');
    const primaryDisabled = !!primary?.disabled && !primary.classList.contains('hidden');
    const draftDisabled = !!draftDone?.disabled && !draftActions?.classList.contains('hidden');
    const { status, label, reason, feedbackVisible, instructionFeedback } = taskStagePresentation({
      state, selection, selectionModel, draft, toolbar, primaryDisabled, draftDisabled, boundaryAnalysis, operationFeedback,
      boundaryPending, boundaryFailed, calculating, busy, cutLineMode, cutLineReady,
      mergeTargetMode, genericMergeMode, unitMergeMode, unitRedrawMode, hydroReview, hydroCount,
    });
    const statusNode = (0, dependencies.platform.$)('modeTaskStatus');
    const taskRoot = (0, dependencies.platform.$)('modeEditingHud');
    if (statusNode) {
      statusNode.dataset.taskState = status;
      if (statusNode.textContent !== label) statusNode.textContent = label;
      statusNode.classList.add('hidden');
      for (const value of ['preparing', 'needs-target', 'editable', 'invalid']) statusNode.classList.toggle(`is-${value}`, value === status);
    }
    if (taskRoot) taskRoot.dataset.taskState = status;
    const reasonNode = (0, dependencies.platform.$)('modeTaskDisabledReason');
    if (reasonNode) {
      if (reasonNode.textContent !== reason) reasonNode.textContent = reason;
      reasonNode.classList.toggle('hidden', !reason || !feedbackVisible);
    }
    const instruction = dependencies.platform.$('modeTaskInstruction');
    const candidate = !!selectionModel?.candidate && !!selection?.candidates.length;
    const instructionError = instruction?.classList.contains('cut-invalid') && !feedbackVisible;
    instruction?.classList.toggle('hidden', !instructionFeedback && ((!instructionError && !candidate) || feedbackVisible));
    const candidateNode = dependencies.platform.$('modeTaskCandidateFeedback');
    if (candidateNode) {
      candidateNode.textContent = candidate ? selection.candidates.map((_, index) =>
        `${String.fromCharCode(65 + index)} · ${index === selection.selectedCandidateIndex ? '선택됨' : '선택 안 됨'}`).join(' / ') : '';
      candidateNode.classList.toggle('hidden', !candidate || feedbackVisible);
    }
    dependencies.platform.$('modeTaskFeedback')?.classList.toggle('workflow-feedback-idle', !feedbackVisible && !candidate && !instructionError && !instructionFeedback);
    syncTaskActionDescription();
  }

  function currentTaskTargets() {
    const state = dependencies.projectState.state;
    return taskTargetRefs(state, {
      countryType: dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY,
      countryFeatureById: dependencies.countries.countryFeatureById,
    });
  }


  function syncTaskObjectCards(view) {
    const targets = currentTaskTargets();
    const focus = dependencies.platform.$('modeTaskTargetsFocusBtn');
    if (focus) {
      focus.disabled = targets.length === 0;
      focus.classList.toggle('hidden', targets.length === 0);
      focus.setAttribute('aria-label', targets.length > 1 ? `선택한 ${targets.length}개 대상으로 이동` : '대상으로 이동');
    }
    const root = dependencies.platform.$('modeTaskObjects');
    if (!root) return;
    const targetKeys = new Set(targets.map(ref => ref.key));
    const cards = (view?.cards || []).map(card => ({
      ...card, objects: card.refs.filter(ref => targetKeys.has(ref.key)).map(displayObject),
    }));
    if (dependencies.projectState.state.distributionDraft && view) {
      const { layerId, value } = dependencies.projectState.state.distributionDraft;
      const layer = dependencies.projectState.state.distributionLayers.find(layer => layer.id === layerId);
      cards.push({ role: '분포', objects: [{ name: layer.name }] }, { role: '값', objects: [{ name: String(value) }] });
    }
    root.classList.toggle('hidden', !cards.length);
    const signature = JSON.stringify([cards, view?.relation]);
    if (root.dataset.signature === signature) return;
    const fragment = root.ownerDocument.createDocumentFragment();
    cards.forEach((card, index) => {
      if (index && view?.relation) {
        const arrow = root.ownerDocument.createElement('span');
        arrow.className = 'workflow-object-relation';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = view.relation;
        fragment.append(arrow);
      }
      const element = root.ownerDocument.createElement('section');
      element.className = 'workflow-object-card';
      element.setAttribute('aria-label', card.role);
      const role = root.ownerDocument.createElement('span');
      role.className = 'workflow-object-role';
      role.textContent = card.role;
      element.append(role);
      const objects = card.objects.length ? card.objects : [{ name: card.placeholder }];
      for (const display of objects) {
        const identity = root.ownerDocument.createElement('span');
        identity.className = 'workflow-object-identity';
        appendIdentity(identity, display);
        element.append(identity);
      }
      fragment.append(element);
    });
    root.replaceChildren(fragment);
    root.dataset.signature = signature;
  }

  function focusTaskTargets() {
    const targets = currentTaskTargets();
    if (!targets.length) return false;
    if (targets.length === 1) return !!(0, dependencies.objectOperationsA.focusObjectRef)(targets[0]);
    const features = targets.flatMap(ref => {
      const feature = (0, dependencies.gpuRenderingA.mapFeatureForObjectRef)(ref);
      if (feature?.type === 'FeatureCollection') return feature.features.filter(item => item?.geometry);
      return feature?.geometry ? [feature] : [];
    });
    if (!features.length) return false;
    (0, dependencies.navigation.focusCountry)({ type: 'FeatureCollection', features }, {
      maxZoom: (0, dependencies.surfaces.isMobile)() ? 12 : 10,
    });
    return true;
  }

  function updateModeButtons() {
    const state = dependencies.projectState.state;
    const selectionModel = (0, dependencies.territorySelectionB.territorySelectionPresentation)();
    const selection = selectionModel?.current || null;
    const territoryWorkflow = !!selection;
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
    const boundaryAnalysis = boundarySelectMode ? (0, dependencies.geometryOperations.boundaryEditSelectionAnalysis)(state.boundaryEditCountryIds) : null;
    const boundaryReady = !boundarySelectMode || boundaryAnalysis.valid;
    const cutLineMode = genericSplitMode || unitSplitMode || selectionModel?.line;
    const cutLineReady = !cutLineMode || draft.cutAssessment?.valid === true;
    const toolbar = draftToolbarStatus({
      state, draft, draftMode, hasDraftTool: dependencies.surfaces.isGenericFeatureDraftTool(state.tool),
      minimumPoints: dependencies.countryEditingA.draftMinimumPoints(), cutLineReady,
    });
    const task = activeModeTaskDescriptor();
    const view = taskWorkflowPresentation(state, selectionModel, draft);
    const taskName = (0, dependencies.platform.$)('modeTaskName');
    const taskStage = (0, dependencies.platform.$)('modeTaskStage');
    const taskStep = (0, dependencies.platform.$)('modeTaskStep');
    const taskRoot = (0, dependencies.platform.$)('modeEditingHud');
    if (taskName) taskName.textContent = view?.name || task.name;
    if (taskStage) taskStage.textContent = view?.stage || task.stage;
    const taskSeparator = taskRoot?.querySelector('.mode-task-separator');
    if (taskSeparator) taskSeparator.textContent = '·';
    if (taskStep) {
      taskStep.textContent = view ? `${view.step} / ${view.total}` : '';
      taskStep.classList.toggle('hidden', !view);
      if (view) taskStep.setAttribute('aria-label', `${view.name} ${view.total}단계 중 ${view.step}단계`);
      else taskStep.removeAttribute('aria-label');
    }
    syncTaskObjectCards(view);
    syncTerritorySetup(selectionModel);
    syncTerritorySelectionStack(selectionModel);
    syncTaskResults(view, draft);

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

    const scopedDraw = territoryWorkflow && selectionModel?.selection
      && ['line', 'polygon'].includes(selection?.activeMethod);
    const showDraftActions = territoryWorkflow && selectionModel?.selection
      ? scopedDraw && (toolbar.visible || selectionModel.candidate || selectionModel.result)
      : toolbar.visible;
    const canConfirmDraw = scopedDraw && ['candidate', 'result'].includes(selection.activePhase)
      ? selectionModel.canAddPart : toolbar.complete;
    (0, dependencies.platform.$)('modeDraftActions')?.classList.toggle('hidden', !showDraftActions);
    const controls = { modeDraftRedrawBtn: !toolbar.redraw, modeDraftDeleteBtn: !toolbar.remove, modeDraftInsertBtn: !toolbar.insert, modeDraftDoneBtn: !canConfirmDraw };
    for (const [id, disabled] of Object.entries(controls)) {
      const button = (0, dependencies.platform.$)(id);
      if (button) button.disabled = disabled;
    }
    (0, dependencies.platform.$)('modeDraftDeleteBtn')?.classList.toggle('hidden', !toolbar.remove);
    const done = (0, dependencies.platform.$)('modeDraftDoneBtn');
    if (done) {
      const label = scopedDraw && ['candidate', 'result'].includes(selection.activePhase) ? '현재 영역 확정' : '그리기 완료';
      done.setAttribute('aria-label', label);
      done.setAttribute('data-tooltip', label);
    }
    (0, dependencies.platform.$)('modeDraftInsertBtn')?.setAttribute('aria-pressed', String(toolbar.editable && !!draft.vertexInsertMode));
    (0, dependencies.platform.$)('modeDraftDoneBtn')?.setAttribute('aria-busy', String(state.modeProcessing));

    const hydroReview = multiDraftReviewActive(state);
    const hydroCount = hydroReview ? (0, dependencies.countryCommitFlow.multiDraftPartCount)() : 0;
    (0, dependencies.platform.$)('multiDrawnActions')?.classList.toggle('hidden', !terrainMode);
    const add = (0, dependencies.platform.$)('multiDrawnAddBtn');
    if (add) add.disabled = !!busy || draft.strokeActive || !state.multiDraft?.current;
    const undo = (0, dependencies.platform.$)('multiDrawnUndoBtn');
    if (undo) undo.disabled = !!busy || draft.strokeActive || !hydroCount || (!!draftMode && draft.coords.length > 0);

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
    syncTaskStatus({
      state, selection, selectionModel, draft, toolbar, primary, boundaryAnalysis,
      boundaryPending, boundaryFailed, calculating, busy, cutLineMode, cutLineReady,
      mergeTargetMode, genericMergeMode, unitMergeMode, unitRedrawMode, hydroReview, hydroCount,
    });
    syncGeometryPreviewSummary(view, selection);
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
    operationFeedback = '';
    dependencies.projectState.state.modeProcessing = true;
    updateModeButtons();
    try {
      return await action();
    } catch (error) {
      const message = (0, dependencies.feedback.reportOperationError)(error, '지도 작업을 완료하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도하세요.', 'PL-MODE-001', 4200);
      setModeBanner(message, { feedback: true });
      return false;
    } finally {
      dependencies.projectState.state.modeProcessing = false;
      updateModeButtons();
    }
  }

  function completeCurrentDraft() {
    if ((0, dependencies.platform.$)('modeDraftDoneBtn')?.disabled) return false;
    const current = dependencies.projectState.state.territorySelectionSession;
    if (current) {
      if (current.stage !== 'selection' || !['line', 'polygon'].includes(current.activeMethod)) return false;
      if (current.activePhase === 'candidate' || current.activePhase === 'result') {
        return runModePrimaryAction(dependencies.territorySelectionA.territorySelectionAddPart);
      }
      if (current.activePhase === 'drawing'
        && (dependencies.domains.editingDomain?.draftInputActive?.() || current.parts.length)) {
        return runModePrimaryAction(dependencies.territorySelectionA.finishTerritorySelectionDraft);
      }
      return false;
    }
    if (!dependencies.domains.editingDomain?.draftInputActive?.()
      || dependencies.projectState.state.geometryPreview.session) return false;
    return runModePrimaryAction(dependencies.countryCommitFlow.finishDraft);
  }

  return Object.freeze({
    connect,
    get runModePrimaryAction() { return runModePrimaryAction; },
    get completeCurrentDraft() { return completeCurrentDraft; },
    get focusTaskTargets() { return focusTaskTargets; },
    get setModeBanner() { return setModeBanner; },
    get syncCountryActionButtons() { return syncCountryActionButtons; },
    get syncCutDraftFeedback() { return syncCutDraftFeedback; },
    get syncMapContextSurfaces() { return syncMapContextSurfaces; },
    get syncMapHudBounds() { return syncMapHudBounds; },
    get toggleMapTaskWindow() { return toggleMapTaskWindow; },
    get updateModeButtons() { return updateModeButtons; },
  });
}
