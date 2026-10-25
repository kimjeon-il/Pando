import { editingContextPresentation, shouldShowTaskInputInstruction, taskStagePresentation, taskTargetRefs, taskWorkflowPresentation } from './app-task-stage-model.js';
import { lineDistanceKm } from './geometry-metrics.js';
import { timelineMonthLabel } from "../../../../../shared/frontend/js/modules/timeline-controls.js";

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
      && (dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.parentId)
      ? dependencies.projectState.state.selected.id : null;
    const selection = dependencies.projectState.state.territorySelectionSession;
    const buttons = [
      ['annexEntityBtn', selection?.actionButtonId === 'annexEntityBtn' && selection.targetCountryId === selectedId],
      ['editEntityBorderBtn', dependencies.projectState.state.tool === 'territorial-border' && dependencies.projectState.state.boundaryEditEntityIds.includes(String(selectedId))],
      ['editEntityCoastBtn', dependencies.projectState.state.tool === 'country-coast' && dependencies.projectState.state.coastEditCountryId === selectedId],
      ['mergeEntityBtn', dependencies.projectState.state.tool === 'merge-country' && dependencies.projectState.state.mergeSourceCountryId === selectedId],
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
    const feature = id ? dependencies.territorialModel.entityRepository.get(id) : null;
    if (!feature) return null;
    return {
      name: dependencies.objectPresentation.territorialEntityName(feature),
      flagUrl: dependencies.territorialServicesA.effectiveTerritorialFlagUrl(feature, { assetRevision: dependencies.layerPresentation.ASSET_REVISION }),
    };
  }

  function displayObject(ref) {
    const display = dependencies.objectOperationsA.objectDisplayInfo(ref);
    const country = (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId)
      ? countryDisplay(ref.id) : null;
    return { name: display.name, flagUrl: country?.flagUrl || '' };
  }

  function mergeReviewTargets(state) {
    if (!['merge-country', 'merge-territorial-unit'].includes(state.tool)) return null;
    const country = state.tool === 'merge-country';
    const keeperId = String(country ? state.mergeSourceCountryId || '' : state.territorialUnitMergeSourceId || '');
    const selected = country ? state.mergeTargetCountryIds : state.territorialUnitMergeTargetIds;
    const absorbedIds = [...new Set((selected || []).map(id => String(id || '')))]
      .filter(id => id && id !== keeperId);
    return keeperId && absorbedIds.length ? { keeperId, absorbedIds } : null;
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
      if (selection.parentId) rows.push(['상위 객체', names([selection.parentId])]);
      if (selection.sourceCountryIds.length) rows.push([selection.kind === 'annex' ? '넘겨주는 국가' : '원소속 국가', names(selection.sourceCountryIds)]);
      rows.push([['annex', 'new-country'].includes(selection.kind) ? '선택 영토' : '선택 영역', `${dependencies.territorySelectionB.territorySelectionPresentation().count}개`]);
    } else {
      const refs = currentTaskTargets();
      const mergeOperation = state.tool === 'merge-country' ? 'merge' : 'territorial-merge';
      const merge = view?.review && preview.operation === mergeOperation
        ? mergeReviewTargets(state) : null;
      const labels = new Map(refs.map(ref => [String(ref.id), displayObject(ref).name]));
      if (merge && labels.has(merge.keeperId) && merge.absorbedIds.every(id => labels.has(id))) {
        rows.push(['남길 객체', labels.get(merge.keeperId)]);
        rows.push(['합쳐질 객체', merge.absorbedIds.map(id => labels.get(id)).join(', ')]);
      } else if (refs.length) {
        rows.push(['대상', refs.map(ref => displayObject(ref).name).join(', ')]);
      }
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
    return !!(dependencies.domains.editingDomain.snapshot().objectVertexEditing || label || dependencies.projectState.state.territorySelectionSession || (0, dependencies.draftPresentation.hydroToolConfig)(dependencies.projectState.state.tool)
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
    if (!editing) dependencies.projectState.state.modeTaskMinimized = false;
    const context = (0, dependencies.platform.$)('modeEditingContext');
    const content = (0, dependencies.platform.$)('modeTaskWindowContent');
    const minimize = (0, dependencies.platform.$)('modeTaskMinimizeBtn');
    context?.classList.toggle('hidden', !editing);
    const minimized = editing && dependencies.projectState.state.modeTaskMinimized;
    context?.classList.toggle('is-minimized', minimized);
    if (content) content.hidden = minimized;
    if (minimize) {
      minimize.hidden = !editing;
      minimize.setAttribute('aria-expanded', String(!minimized));
      minimize.setAttribute('aria-label', minimized ? '편집 상세 펼치기' : '편집 상세 접기');
    }
    // The expanded heading and role/review details already identify the stage and target.
    // Collapsing the body restores the existing compact context instead of losing it.
    const targetSummary = dependencies.platform.$('modeTaskTargetSummary');
    const roleCards = dependencies.platform.$('modeTaskObjects');
    const previewSummary = dependencies.platform.$('geometryPreviewSummary');
    const targetDetailed = (roleCards && !roleCards.classList.contains('hidden'))
      || (previewSummary && !previewSummary.classList.contains('hidden'));
    targetSummary?.parentElement?.classList.toggle('hidden', !minimized && !!targetDetailed);
    const genericStage = dependencies.platform.$('modeTaskEditingStage');
    genericStage?.classList.toggle('hidden', !minimized);
    genericStage?.setAttribute('aria-live', minimized ? 'polite' : 'off');
    dependencies.platform.$('modeTaskStage')?.setAttribute('aria-live', minimized ? 'off' : 'polite');
    dependencies.workspaceUiB.editorWorkspacePresentation.sync({ active: editing });
    // The map HUD is fallback context only when the inspector itself is not open.
    const editorOpen = dependencies.platform.$('editorSurface')?.classList.contains('surface-open');
    dependencies.platform.$('modeMapSummary')?.classList.toggle('hidden', !editing || !!editorOpen);
    dependencies.domainControllers.syncTerritorialEditorInteraction();
    requestAnimationFrame(syncMapHudBounds);
  }

  function toggleMapTaskWindow() {
    if (!mapModeContextActive()) return;
    dependencies.projectState.state.modeTaskMinimized = !dependencies.projectState.state.modeTaskMinimized;
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
    if (model?.showSetup) {
      const name = dependencies.platform.$('territorialCreateNameInput');
      if (name.value !== selection.name) name.value = selection.name;
      name.closest('.field-group').classList.toggle('hidden', !!selection.editOperation);
      const setupModel = dependencies.territorialEditingB.territorialCreateSetupModel();
      const regional = dependencies.platform.$('territorialCreateRegionalInput');
      regional.checked = selection.entityKind === 'regional';
      regional.disabled = !!selection.editOperation;
      const parent = dependencies.platform.$('territorialCreateParentInput');
      dependencies.propertyEditingB.replaceSelectOptions(parent, setupModel.parentOptions, selection.parentId);
      parent.disabled = regional.checked || !!selection.editOperation;
      const source = dependencies.platform.$('territorialCreateSourceInput');
      const choice = dependencies.propertyEditingB.replaceSelectOptions(source, setupModel.sourceOptions, selection.sourceKey, { autoSelectSingle: true });
      source.disabled = !!setupModel.session.setupSourceCache?.pending;
      dependencies.platform.$('territorialCreateSourceRow').classList.toggle('hidden', !selection.parentId || choice.single);
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
    if (!visible || !list || !summary) {
      section?.classList.add('hidden');
      return;
    }

    const activeComponents = current.activePhase === 'components'
      ? dependencies.territoryComponents.territoryComponentItems().filter(item => item.selected)
      : [];
    const items = [
      ...current.parts.map(part => ({ kind: 'part', id: part.id, geometry: part.geometry })),
      ...activeComponents.map(item => ({ kind: 'component', id: item.key, geometry: item.geometry })),
    ];
    const pending = current.computationPending || current.computationError;
    // Keep the shared result-list UI, but omit an empty zero-area card during
    // annex drawing. Real parts and calculation errors/progress stay visible.
    const showList = current.kind !== 'annex' || items.length > 0 || !!pending;
    section?.classList.toggle('hidden', !showList);
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
      remove.className = 'ui-button icon-btn workflow-result-remove';
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
    if (!unit || (unit.properties?.entityKind === 'general' && !unit.properties?.parentId)) return null;
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
    // Do not reserve an empty results panel before a merge target is selected.
    // The full removable list returns as soon as there is a selected target.
    const showResults = hydro || (merge && !!view?.resultRefs?.length);
    section.classList.toggle('hidden', !showResults);
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
        remove.className = 'ui-button icon-btn workflow-result-remove';
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
    const primaryCommand=modePrimaryCommand();
    const primaryDisabled=primaryCommand.disabled;
    const draftDisabled=!toolbar.complete;
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
      statusNode.classList.toggle('hidden', status !== 'preparing' && status !== 'invalid');
      for (const value of ['preparing', 'needs-target', 'editable', 'invalid']) statusNode.classList.toggle(`is-${value}`, value === status);
    }
    if (taskRoot) taskRoot.dataset.taskState = status;
    const reasonNode = (0, dependencies.platform.$)('modeTaskDisabledReason');
    if (reasonNode) {
      const message=primaryDisabled?primaryCommand.reason:reason;
      if (reasonNode.textContent !== message) reasonNode.textContent = message;
      // The empty annex donor card already conveys the routine selection request.
      // Preserve the message for aria-describedby; never suppress real errors or progress.
      const redundantAnnexPrompt = selection?.kind === 'annex' && selection.stage === 'setup'
        && !selection.sourceCountryIds?.length && status === 'needs-target'
        && message === '대상을 선택하고 필요한 설정을 완료하세요.';
      const redundantAnnexMethodPrompt = selection?.kind === 'annex' && selection.stage === 'selection'
        && !selection.activeMethod && !selection.requestedMethod && status === 'needs-target'
        && message === '다음 단계로 진행할 영역을 선택하세요.';
      reasonNode.classList.toggle('hidden', !message || redundantAnnexPrompt || redundantAnnexMethodPrompt);
    }
    const instruction = dependencies.platform.$('modeTaskInstruction');
    const candidate = !!selectionModel?.candidate && !!selection?.candidates.length;
    const instructionError = instruction?.classList.contains('cut-invalid') && !feedbackVisible;
    instruction?.classList.toggle('hidden', !instructionFeedback && ((!instructionError && !candidate) || feedbackVisible));
    const candidateNode = dependencies.platform.$('modeTaskCandidateFeedback');
    if (candidateNode) {
      candidateNode.textContent = candidate ? selection.candidates.map((_, index) =>
        `조각 ${index + 1} · ${selection.selectedCandidateIds.includes(selection.candidates[index].id) ? '선택됨' : '선택 안 됨'}`).join(' / ') : '';
      candidateNode.classList.toggle('hidden', !candidate || feedbackVisible);
    }
    dependencies.platform.$('modeTaskFeedback')?.classList.toggle('workflow-feedback-idle', !feedbackVisible && !candidate && !instructionError && !instructionFeedback);
    syncTaskActionDescription();
  }

  function syncEditingContext() {
    const state = dependencies.projectState.state;
    const targetRefs = currentTaskTargets();
    const targets = targetRefs.map(displayObject);
    const preview = state.geometryPreview.session;
    const impact = (preview?.affectedIds || []).map(id => ({name: countryDisplay(id)?.name || territorialUnitDisplay(id) || id}));
    const editing=dependencies.domains.editingDomain.snapshot();
    const month = dependencies.domains.projectDomain.state()?.timelineCursor;
    const draft = dependencies.draftPresentation.editingDraftSnapshot();
    const mobile = dependencies.surfaces.isMobile();
    const context = editingContextPresentation({mobile,editing,state,draft,month,targets});
    for (const [id,value] of [['editorTimelineContext',month?`${timelineMonthLabel(month)} 기준 편집`:'시점 확인 중'],['modeTaskTargetSummary',context.targetSummary],['modeTaskEditingStage',context.stage],['modeTaskViewTime','보기: '+context.view],['modeTaskPeriod','변경 기간: '+context.period],['modeTaskInput',context.instruction]]) {
      const element=dependencies.platform.$(id);if(element && element.textContent!==value)element.textContent=value;
    }
    // Annex setup/selection already display the receiver, donor and method.
    // Do not repeat uncalculated time/impact metadata before the review stage.
    const annex = state.territorySelectionSession;
    const annexBeforeReview = annex?.kind === 'annex' && annex.stage !== 'review';
    const mergeChoosingTargets = !preview
      && (state.tool === 'merge-country' && !!state.mergeSourceCountryId
        || state.tool === 'merge-territorial-unit' && !!state.territorialUnitMergeSourceId);
    // A border target-picker also identifies its countries in the existing
    // role cards. Hide only uncalculated metadata, then restore it in edit/review.
    const borderChoosingTargets = !preview && state.tool === 'territorial-border'
      && state.boundaryEditPhase === 'selecting';
    dependencies.platform.$('modeTaskViewTime')?.parentElement?.classList.toggle('hidden',
      annexBeforeReview || mergeChoosingTargets || borderChoosingTargets);
    const taskInput = dependencies.platform.$('modeTaskInput');
    taskInput?.classList.toggle('hidden', !shouldShowTaskInputInstruction({
      state, editing, draft, mobile, draftActive: dependencies.domains.editingDomain?.draftInputActive?.(),
    }));
    const placement=dependencies.platform.$('vertexPlacementBtn');if(placement){placement.hidden=!editing.selectedVertex||!!preview;placement.disabled=editing.gestureActive||state.modeProcessing;placement.textContent=editing.vertexPlacement?'위치 지정 취소':'선택 정점 위치 지정';}
    const mapSummary=dependencies.platform.$('modeMapSummary');
    if(mapSummary)mapSummary.textContent=[dependencies.platform.$('modeTaskName')?.textContent,context.targetSummary,context.stage].filter(Boolean).join(' · ');
    const list=dependencies.platform.$('modeTaskAffectedList');
    const summary=dependencies.platform.$('modeTaskAffectedSummary');
    if (list && summary) {
      const names=impact.map(row=>row.name);
      summary.textContent=preview?'영향 대상 '+names.length+'개':'작업 대상 '+targets.length+'개';
      const value=(preview?names:targets.map(row=>row.name)).join(', ');
      if(list.textContent!==value)list.textContent=value;
      // In a valid annex review, the main result already names the receiver and
      // donor countries. Hide the extra affected list only if it repeats those
      // same identified objects; preserve it for additional impacts or errors.
      const annexReview = annex?.kind === 'annex' && annex.stage === 'review'
        && !!preview && !preview.validation?.blocking;
      const directIds = annexReview
        ? [annex.targetCountryId, ...(annex.sourceCountryIds || [])].filter(Boolean).map(String)
        : [];
      const duplicateImpact = annexReview && (preview.affectedIds || []).length > 0
        && directIds.length > 0 && directIds.every(id => !!countryDisplay(id)?.name)
        && preview.affectedIds.every(id => directIds.includes(String(id)));

      const merge = mergeReviewTargets(state);
      const mergeIds = merge ? [merge.keeperId, ...merge.absorbedIds] : [];
      const mergeSet = new Set(mergeIds);
      const namedRefs = new Set(targetRefs.filter((ref, index) => targets[index]?.name).map(ref => String(ref.id)));
      const affectedIds = (preview?.affectedIds || []).map(String);
      const removedIds = (preview?.removedIds || []).map(String);
      // Only an exact, validated identity match can replace the affected list.
      // Keep it for unselected dependents, references, warnings and ambiguous impacts.
      const duplicateMergeImpact = !!merge && !!preview && preview.validation?.blocking === false
        && preview.operation === (state.tool === 'merge-country' ? 'merge' : 'territorial-merge')
        && !(preview.validation?.issues || []).length
        && mergeIds.every(id => namedRefs.has(id))
        && affectedIds.length === mergeSet.size && affectedIds.every(id => mergeSet.has(id))
        && removedIds.length === merge.absorbedIds.length
        && removedIds.every(id => merge.absorbedIds.includes(id))
        && (preview.temporalImpact || []).every(row => row?.entityId && mergeSet.has(String(row.entityId)))
        && (preview.delta?.objects || []).every(row => row?.ref?.domain === 'territorial' && mergeSet.has(String(row.ref.id)));
      if (summary.parentElement) summary.parentElement.hidden = !!(duplicateImpact || duplicateMergeImpact);
    }
  }

  function currentTaskTargets() {
    const state = dependencies.projectState.state;
    return taskTargetRefs(state, {
      territorialEntityById: id => dependencies.territorialModel.entityRepository.get(id),
    });
  }

  function syncTaskObjectCards(view) {
    const targets = currentTaskTargets();
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

  function modeActionContext() {
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
    const boundarySelectMode = state.tool === 'territorial-border' && state.boundaryEditPhase === 'selecting';
    const boundaryEditMode = state.tool === 'territorial-border' && state.boundaryEditPhase === 'editing';
    const boundaryPreparation = ['territorial-border', 'country-coast'].includes(state.tool) ? state.boundaryPreparation : null;
    const boundaryPending = ['pending', 'moving'].includes(boundaryPreparation?.status);
    const boundaryFailed = boundaryPreparation?.status === 'error';
    const boundaryAnalysis = boundarySelectMode ? (0, dependencies.geometryOperations.boundaryEditSelectionAnalysis)(state.boundaryEditEntityIds) : null;
    const boundaryReady = !boundarySelectMode || boundaryAnalysis.valid;
    const cutLineMode = genericSplitMode || unitSplitMode || selectionModel?.line;
    const cutLineReady = !cutLineMode || draft.cutAssessment?.valid === true;
    const toolbar = draftToolbarStatus({
      state, draft, draftMode, hasDraftTool: dependencies.surfaces.isGenericFeatureDraftTool(state.tool),
      minimumPoints: dependencies.countryEditingA.draftMinimumPoints(), cutLineReady,
    });
    const busy = state.modeProcessing || selection?.previewPending;
    const calculating = boundaryPending || selection?.computationPending || selection?.activePhase === 'preparing';
    const hydroReview = multiDraftReviewActive(state);
    const hydroCount = hydroReview ? (0, dependencies.countryCommitFlow.multiDraftPartCount)() : 0;
    return {state,selectionModel,selection,territoryWorkflow,draft,labelMode,terrainMode,draftMode,previewMode,mergeTargetMode,genericMergeMode,genericSplitMode,unitMergeMode,unitSplitMode,unitRedrawMode,boundarySelectMode,boundaryEditMode,boundaryPreparation,boundaryPending,boundaryFailed,boundaryAnalysis,boundaryReady,cutLineMode,cutLineReady,toolbar,busy,calculating,hydroReview,hydroCount};
  }
  function modePrimaryCommand(context = modeActionContext()) {
    const {state,selectionModel,draft,terrainMode,draftMode,previewMode,mergeTargetMode,genericMergeMode,genericSplitMode,unitMergeMode,unitSplitMode,unitRedrawMode,boundarySelectMode,boundaryEditMode,boundaryPending,boundaryFailed,boundaryReady,cutLineReady,toolbar,busy,calculating,hydroReview,hydroCount} = context;
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
        disabled ||= (boundaryEditMode || state.tool === 'country-coast') && !previewMode && !dependencies.domains.editingDomain.snapshot().boundaryDraft?.moveCount;
        disabled ||= previewMode && state.geometryPreview.session.validation?.blocking === true;
        if (hydroReview) label = '생성';
        else if (previewMode) label = ['territorial-border','country-coast'].includes(state.tool) ? '경계 변경 적용' : '변경 적용';
        else if (boundarySelectMode) label = `국경 편집 (${state.boundaryEditEntityIds.length})`;
        else if (boundaryEditMode || state.tool === 'country-coast') label = state.boundaryPreparation?.calculationFailed ? '다시 계산' : '변경 미리보기';
        else if (terrainMode) label = '그리기 완료';
        else if (mergeTargetMode) label = '합병 미리보기';
        else if (genericMergeMode || unitMergeMode) label = '합병 미리보기';
        else if (genericSplitMode || unitSplitMode) label = '영역 나누기';
        else if (unitRedrawMode) label = '영역 다시 지정';
      }
      if(dependencies.domains.editingDomain.snapshot().objectVertexEditing){label='좌표 편집 완료';disabled=!!busy;}
      if (boundaryFailed && !previewMode) label = '다시 시도';
      if (boundaryPending) label = '경계 준비 중…';
    const stage=taskStagePresentation({...context,primaryDisabled:!!disabled,draftDisabled:!toolbar.complete,operationFeedback});
    const reason=disabled ? stage.reason || (busy||calculating?'계산을 마칠 때까지 기다리세요.':boundaryEditMode||state.tool==='country-coast'?'꼭짓점을 움직인 뒤 변경을 미리보세요.':'필요한 대상을 선택하거나 입력을 완료하세요.') : '';
    return {disabled:!!disabled,label,icon,reason};
  }

  function updateModeButtons() {
    const {state,selectionModel,selection,territoryWorkflow,draft,labelMode,terrainMode,draftMode,previewMode,mergeTargetMode,genericMergeMode,unitMergeMode,unitRedrawMode,boundaryPending,boundaryFailed,boundaryAnalysis,cutLineMode,cutLineReady,toolbar,busy,calculating,hydroReview,hydroCount} = modeActionContext();
    const task = activeModeTaskDescriptor();
    const view = taskWorkflowPresentation(state, selectionModel, draft, {
      territorialEntityById: id => dependencies.territorialModel.entityRepository.get(id),
    });
    const taskName = (0, dependencies.platform.$)('modeTaskName');
    const taskStage = (0, dependencies.platform.$)('modeTaskStage');
    const taskStep = (0, dependencies.platform.$)('modeTaskStep');
    const taskRoot = (0, dependencies.platform.$)('modeEditingHud');
    if (taskName) taskName.textContent = dependencies.domains.editingDomain.snapshot().objectVertexEditing?'수계 좌표 편집':view?.name || task.name;
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

    const specialMode = !!(dependencies.domains.editingDomain.snapshot().objectVertexEditing || selection || labelMode || terrainMode || previewMode || (0, dependencies.toolServices.isSpecialTool)(state.tool) || draftMode);
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

    (0, dependencies.platform.$)('multiDrawnActions')?.classList.toggle('hidden', !terrainMode);
    const add = (0, dependencies.platform.$)('multiDrawnAddBtn');
    if (add) add.disabled = !!busy || draft.strokeActive || !state.multiDraft?.current;
    const undo = (0, dependencies.platform.$)('multiDrawnUndoBtn');
    if (undo) undo.disabled = !!busy || draft.strokeActive || !hydroCount || (!!draftMode && draft.coords.length > 0);

    const primary = (0, dependencies.platform.$)('modePrimaryBtn');
    if (primary) {
      primary.classList.toggle('hidden', labelMode || (!selection && toolbar.editable));
      const {disabled,label,icon} = modePrimaryCommand(modeActionContext());
      primary.disabled = !!disabled;
      setButtonLabel(primary, label);
      (0, dependencies.platform.$)('modePrimaryIcon')?.setAttribute('href', icon);
      primary.setAttribute('aria-label', label === '다음' ? '다음 단계' : label);
      primary.setAttribute('aria-busy', String(!!busy || !!calculating));
    }

    const cancel = (0, dependencies.platform.$)('modeCancelBtn');
    if (cancel) {
      setButtonLabel(cancel, '편집 취소');
      (0, dependencies.platform.$)('modeCancelIcon')?.setAttribute('href', '#icon-close');
      cancel.setAttribute('aria-label', '편집 취소');
      cancel.disabled = !!state.modeProcessing;
    }
    const returnButton = dependencies.platform.$('modeReturnBtn');
    if (returnButton) {
      returnButton.hidden = !(selection ? selection.stage === 'review' : previewMode);
      returnButton.disabled = !!busy;
    }
    syncEditingContext();
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
    if(dependencies.domains.editingDomain.snapshot().objectVertexEditing)return dependencies.domains.editingDomain.handleInteraction({type:'object-edit-end'});
    const selection = dependencies.projectState.state.territorySelectionSession;
    if (selection) return selection.stage === 'review'
      ? (0, dependencies.territorySelectionA.territorySelectionApply)()
      : (0, dependencies.territorySelectionA.territorySelectionAdvance)();
    if (dependencies.projectState.state.geometryPreview.session) return (0, dependencies.geometryOperations.applyActiveGeometryPreview)();
    if (multiDraftReviewActive(dependencies.projectState.state) && !dependencies.domains.editingDomain?.draftInputActive?.()) return (0, dependencies.countryCommitFlow.completeMultiDraftCreation)();
    if (['territorial-border', 'country-coast'].includes(dependencies.projectState.state.tool) && dependencies.projectState.state.boundaryPreparation?.status === 'error') {
      dependencies.projectState.state.boundaryPreparation.retry();
      return true;
    }
    if (dependencies.projectState.state.tool === 'territorial-border' && dependencies.projectState.state.boundaryEditPhase === 'selecting') return (0, dependencies.countryEditingA.beginTerritorialBorderEditing)();
    if (['territorial-border','country-coast'].includes(dependencies.projectState.state.tool)) return dependencies.domains.editingDomain.previewBoundaryDraft();
    if (dependencies.projectState.state.tool === 'merge-generic-feature') return (0, dependencies.genericEditingA.completeGenericFeatureMerge)();
    if (dependencies.projectState.state.tool === 'merge-territorial-unit') return (0, dependencies.territorialEditingA.completeTerritorialUnitMerge)();
    if (dependencies.projectState.state.tool === 'merge-country') return (0, dependencies.countryCommitFlow.completeCountryMerge)();
    if ((0, dependencies.surfaces.isGenericFeatureDraftTool)(dependencies.projectState.state.tool)) return (0, dependencies.countryCommitFlow.finishDraft)();
    return false;
  }

  async function runModePrimaryAction(action = dispatchModePrimaryAction) {
    if (dependencies.projectState.state.modeProcessing) return false;
    if (action === dispatchModePrimaryAction) {const command=modePrimaryCommand();if(command.disabled){dependencies.feedback.setActionStatus(command.reason,'error',3200);return false;}}
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

  async function cancelCurrentEditing() {
    if (dependencies.projectState.state.modeProcessing) return false;
    return await dependencies.genericEditingB.requestDraftDiscard(async () => {
      if (dependencies.projectState.state.geometryPreview.session) await dependencies.geometryOperations.discardActiveGeometryPreview({ announce: false });
      if (dependencies.projectState.state.labelPlacementMode || dependencies.projectState.state.tool === 'label') await dependencies.countryEditingB.exitLabelMode();
      else if (dependencies.surfaces.isGenericFeatureDraftTool(dependencies.projectState.state.tool)) await dependencies.genericEditingA.cancelDraft(true);
      else await dependencies.countryEditingA.cancelActiveMode();
    });
  }

  async function returnToEditing() {
    if (dependencies.projectState.state.modeProcessing) return false;
    const selection = dependencies.projectState.state.territorySelectionSession;
    if (selection?.stage === 'review') {
      return await dependencies.territorySelectionB.territorySelectionBack();
    }
    const restored = await dependencies.geometryOperations.discardActiveGeometryPreview({ announce: false });
    if (restored) {
      updateModeButtons();
      dependencies.feedback.setActionStatus('입력을 유지하고 수정으로 돌아왔습니다.', 'success', 2600);
    }
    return restored;
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
    get syncEditingContext() { return syncEditingContext; },
    get cancelCurrentEditing() { return cancelCurrentEditing; },
    get returnToEditing() { return returnToEditing; },
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
