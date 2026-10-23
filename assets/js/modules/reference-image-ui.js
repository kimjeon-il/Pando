const numberText = (value, digits = 0) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function residualText(meters) {
  if (!Number.isFinite(meters)) return '오차 —';
  if (meters < 1) return `오차 ${numberText(meters, 3)} m`;
  if (meters < 1000) return `오차 ${numberText(meters, 1)} m`;
  return `오차 ${numberText(meters / 1000, 1)} km`;
}

function diagnosticResiduals(diagnostics) {
  return new Map((diagnostics?.residuals || []).map(item => [String(item.id), item]));
}

function referencePointRow({
  label,
  error,
  current = false,
  locked = false,
  actions = [],
  className = '',
} = {}) {
  return `<li class="reference-image-point-row ${className}"${current ? ' aria-current="true"' : ''}>
    <div class="reference-image-point-head">
      <span>${label}</span>
      <small class="reference-image-point-error">${error}</small>
    </div>
    <div class="reference-image-point-actions">
      ${actions.map(([action, text, pointId]) => `<button type="button" class="ui-button btn ghost" data-ref-action="${action}"${pointId ? ` data-point-id="${escapeAttribute(pointId)}"` : ''}${locked ? ' disabled' : ''}>${text}</button>`).join('')}
    </div>
  </li>`;
}

export function createReferenceImagePanel() {
  const panel = document.createElement('section');
  panel.id = 'referenceImageSurface';
  panel.className = 'workspace-surface surface-reference ui-sheet reference-image-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '참조 이미지');
  panel.innerHTML = `
    <div class="reference-image-resize-handle" tabindex="0" role="separator" aria-label="참조 이미지 패널 너비 조절" aria-orientation="vertical" aria-valuemin="300" aria-valuemax="480" aria-valuenow="340"></div>
    <header class="surface-header reference-image-panel-header">
      <button type="button" class="ui-button sheet-drag-handle" data-sheet-handle="referenceImageSurface" role="slider" aria-label="참조 이미지 창 높이 조절" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="2" aria-valuenow="1" aria-valuetext="중간 높이"><span></span></button>
      <div class="surface-header-title">
        <strong>참조 이미지</strong>
      </div>
      <div class="surface-header-actions">
        <button type="button" class="ui-button btn ghost reference-image-collapse-button" data-reference-panel-toggle aria-controls="referenceImageSurfaceBody" aria-label="참조 이미지 패널 접기" aria-expanded="true">접기</button>
        <button type="button" class="ui-button icon-btn" data-ref-action="close" aria-label="참조 이미지 닫기"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-close"/></svg></button>
      </div>
    </header>
    <div id="referenceImageSurfaceBody" class="surface-body reference-image-body">
    <section class="reference-image-collection" aria-label="이미지 목록">
      <div class="reference-image-collection-heading">
        <strong>이미지 목록</strong>
        <button type="button" class="ui-button btn ghost reference-image-add" data-ref-action="add"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-plus"/></svg>이미지 추가</button>
      </div>
      <input data-ref-file type="file" accept="image/png,image/jpeg,image/webp" hidden />
      <div class="reference-image-empty" data-ref-storage-status role="status" hidden>
        <span data-ref-storage-message></span>
        <button type="button" class="ui-button btn ghost" data-ref-action="retry-storage">다시 읽기</button>
      </div>
      <div class="reference-image-list" data-ref-list role="list" aria-label="참고 이미지 순서"></div>
      <div class="reference-image-empty" data-ref-empty>PNG, JPG, WebP 이미지를 추가하세요.</div>
      <div class="reference-image-toolbar" aria-label="이미지 편집 이력">
        <span>이미지 편집 이력</span>
        <button type="button" class="ui-button btn ghost" data-ref-action="undo" aria-label="이미지 편집 실행 취소" disabled>실행 취소</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="redo" aria-label="이미지 편집 다시 실행" disabled>다시 실행</button>
      </div>
    </section>
    <div class="reference-image-editor" data-ref-editor hidden></div>
    </div>
    <footer class="surface-footer reference-image-editing-summary" hidden>
      <span class="reference-image-editing-status" role="status"></span>
      <button type="button" class="ui-button btn ghost" data-ref-action="navigation-toggle">지도 이동</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="undo" aria-label="이미지 편집 실행 취소" disabled>실행 취소</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="redo" aria-label="이미지 편집 다시 실행" disabled>다시 실행</button>
      <button type="button" class="ui-button btn" data-ref-action="finish">완료</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="cancel">취소</button>
      <div class="reference-image-workflow-actions" data-ref-workflow-actions hidden></div>
      <div class="reference-image-auxiliary-actions" data-ref-auxiliary-actions hidden>
        <div class="reference-image-calibration-actions reference-image-line-refine-actions" data-ref-line-actions role="group" aria-label="선 보강 작업" hidden></div>
        <div class="reference-image-calibration-actions reference-image-live-wire-actions" data-ref-live-wire-actions role="group" aria-label="자동 추적 작업" hidden></div>
      </div>
    </footer>
  `;
  return panel;
}

export function renderReferenceImageList(listElement, records, selectedId) {
  listElement.replaceChildren();
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const item = document.createElement('div');
    item.className = 'reference-image-list-item';
    item.setAttribute('role', 'listitem');
    if (record.id === selectedId) item.classList.add('is-selected');

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'reference-image-list-row';
    row.dataset.referenceImageId = record.id;
    if (record.id === selectedId) {
      row.classList.add('is-selected');
      row.setAttribute('aria-current', 'true');
    }
    row.innerHTML = '<span class="reference-image-visibility" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><use href="#'
      + (record.visible ? 'icon-eye' : 'icon-eye-off')
      + '"/></svg></span><strong></strong><small></small>';
    row.querySelector('strong').textContent = record.name;
    row.querySelector('small').textContent =
      (record.locked ? '잠김 · ' : '') + (record.anchor ? '📌 · ' : '') + record.controlPoints.length + '점';

    const actions = document.createElement('div');
    actions.className = 'reference-image-list-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', record.name + ' 관리');
    const makeAction = (action, label, icon, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-button icon-btn reference-image-list-action';
      button.dataset.refListAction = action;
      button.dataset.refRecordId = record.id;
      button.setAttribute('aria-label', record.name + ' · ' + label);
      button.disabled = disabled;
      if (action === 'visible') button.setAttribute('aria-pressed', String(record.visible));
      if (action === 'locked') button.setAttribute('aria-pressed', String(record.locked));
      button.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + icon + '"/></svg>';
      return button;
    };
    actions.append(
      makeAction('visible', record.visible ? '숨기기' : '표시', record.visible ? 'icon-eye' : 'icon-eye-off'),
      makeAction('locked', record.locked ? '잠금 해제' : '잠금', record.locked ? 'icon-lock-closed' : 'icon-lock-open'),
      makeAction('forward', '앞으로', 'icon-chevron-down', index === records.length - 1),
      makeAction('backward', '뒤로', 'icon-chevron-down', index === 0),
    );
    item.append(row, actions);
    listElement.appendChild(item);
  }
}

function referenceImageTabMarkup(activeTab) {
  const tabs = [['placement', '배치'], ['match', '맞추기'], ['display', '표시']];
  return '<div class="reference-image-task-tabs" role="tablist" aria-label="참고 이미지 작업">'
    + tabs.map(([key, label]) => {
      const selected = activeTab === key;
      return '<button type="button" class="ui-button reference-image-task-tab'
        + (selected ? ' is-active' : '') + '" role="tab" id="reference-image-tab-' + key
        + '" data-ref-tab="' + key + '" aria-controls="reference-image-panel-' + key
        + '" aria-selected="' + selected + '" tabindex="' + (selected ? '0' : '-1')
        + '">' + label + '</button>';
    }).join('')
    + '</div>';
}

/** Presentation derived from the existing editing state; never stores a second workflow. */
export function referenceImageWorkflow({ record, anchorState = null, gcpState = null, controlPointEditing = false, linearDraft = null } = {}) {
  if (!record || record.locked) return null;
  if (linearDraft) {
    const { phase, anchors, image, coordinates } = linearDraft;
    const instruction = phase === 'image'
      ? '이미지에서 맞출 선을 따라 두 지점 이상 선택하세요.'
      : phase === 'map'
        ? '지도에서 같은 선을 같은 방향으로 두 지점 이상 선택하세요.'
        : '지도 위 변형 이미지를 확인하고 적용하거나 선을 다시 지정하세요.';
    return {
      id: 'linear', title: linearDraft.kind === 'river' ? '강 선 보정' : '해안선 보정',
      steps: ['이미지 선', '지도 선', '미리보기', '적용'],
      step: phase === 'image' ? 0 : phase === 'map' ? 1 : 2,
      instruction: linearDraft.error || instruction,
      detail: phase === 'preview'
        ? '아직 적용하지 않은 미리보기입니다. 취소하면 이전 이미지로 돌아갑니다.'
        : phase === 'image'
          ? `선택한 지점 ${anchors.length}개 · 선 지정이 끝나면 지도 선 단계로 이동하세요.`
          : `지도 지점 ${coordinates.length}개 · 미리보기에서 정렬을 확인한 뒤 적용합니다.`,
      actions: [
        ...(phase === 'image' ? [
          { action: 'linear-image-undo', label: '마지막 점 취소', disabled: !anchors.length },
          { action: 'linear-image-finish', label: '이미지 선 완료', primary: true, disabled: image.length < 2 },
        ] : phase === 'map' ? [
          { action: 'linear-map-undo', label: '지도 점 취소', disabled: !coordinates.length },
          { action: 'linear-preview', label: '미리보기', primary: true, disabled: coordinates.length < 2 },
        ] : [
          { action: 'linear-map-redraw', label: '지도 선 다시 지정' },
          { action: 'linear-apply', label: '선 보정 적용', primary: true },
        ]),
        { action: 'linear-cancel', label: '선 보정 취소' },
      ],
    };
  }
  const analysis = record.analysis;
  if (analysis?.stage === 'layout') {
    return { id: 'layout', title: '지도 영역 분석', steps: ['분석', '영역 확인', '자동 맞춤'], step: analysis.busy ? 0 : 1,
      instruction: analysis.busy ? '도곽과 삽입도 후보를 찾고 있습니다.' : '분리해서 맞출 본 지도 또는 삽입도를 선택하세요.',
      detail: '원본과 수동 기준점은 유지됩니다. 선택한 영역은 별도 이미지 항목으로 생성합니다.',
      actions: [{ action: 'auto-georef', label: '전체 이미지 맞춤', disabled: analysis.busy },
        { action: 'cancel-auto-georef', label: analysis.busy ? '분석 취소' : '검토 닫기' }] };
  }
  if (analysis?.editingChainId != null) return null;
  if (analysis?.reviewing || (analysis?.busy && analysis.stage === 'boundaries')) {
    const graph = analysis.boundaries?.graph;
    return { id: 'boundaries', title: '경계 자동 추출', steps: ['분석', '경계 검토', '적용'], step: analysis.busy ? 0 : 1,
      instruction: analysis.busy ? (analysis.stage === 'edit' ? '수정한 경계망에서 영역을 다시 구성하고 있습니다.' : analysis.stage === 'apply' ? '선택한 객체를 생성하고 있습니다.' : '지도 전체의 경계를 분석하고 있습니다.')
        : analysis.pointAction ? '지도에서 선택한 선을 끊을 위치를 누르세요.' : analysis.connectFrom ? '연결할 다른 시작점 또는 끝점을 선택하세요.'
          : `선 ${graph.chains.length}개 · 영역 ${graph.faces.length}개 · 미해결 ${graph.unresolved.length}곳`,
      detail: '지도 위 후보를 확인하고 생성할 선·영역을 선택하세요. 이름·귀속·연대는 자동 확정하지 않습니다.',
      actions: [...(analysis.busy ? [] : [
        { action: 'boundary-undo', label: '경계 수정 취소', disabled: !analysis.graphHistory?.past.length },
        { action: 'boundary-redo', label: '경계 수정 다시 실행', disabled: !analysis.graphHistory?.future.length },
        { action: 'apply-boundaries', label: '선택한 객체 생성', primary: true, disabled: !analysis.selectedIds.size },
      ]), { action: 'cancel-boundaries', label: analysis.busy ? '분석 취소' : '검토 닫기', disabled: analysis.busy && analysis.stage === 'apply' }] };
  }
  const preview = analysis?.georef?.ok ? analysis.georef : null;
  if (analysis?.busy || preview) {
    return {
      id: 'auto', title: '자동 맞춤', steps: ['분석', '결과 확인', '적용'],
      step: preview ? 1 : 0,
      instruction: preview
        ? `분석 결과 · ${preview.georef?.inlierCount ?? 0}개 채택, ${preview.georef?.rejectedCount ?? 0}개 제외 · ${residualText(preview.georef?.diagnostics?.rmsMeters)}. 적용 여부를 선택하세요.`
        : '이미지의 도시 기호와 지명을 분석하고 있습니다.',
      detail: preview
        ? '‘결과 적용’을 누르면 기준점과 이미지 보정에 반영됩니다.'
        : '분석 중에도 취소할 수 있습니다. 취소한 분석 결과는 반영하지 않습니다.',
      actions: preview ? [
          { action: 'apply-auto-georef', label: '결과 적용', primary: true, disabled: !!preview.requiresLocationChoice },
          { action: 'cancel-auto-georef', label: '결과 취소' },
        ] : [{ action: 'cancel-auto-georef', label: '분석 취소' }],
    };
  }
  const pointState = anchorState || gcpState;
  if (pointState) {
    const anchor = !!anchorState;
    const replacement = !anchor && !!pointState.pointId;
    const mapStep = pointState.step === 'map';
    return {
      id: anchor ? 'anchor' : 'gcp',
      title: anchor ? '고정점 지정' : replacement ? '기준점 수정' : '기준점 추가',
      steps: replacement ? [mapStep ? '지도 위치 수정' : '이미지 위치 수정'] : ['이미지 위치', '지도 위치'],
      step: replacement ? 0 : mapStep ? 1 : 0,
      instruction: mapStep
        ? '같은 지점의 실제 지도 위치를 선택하세요.'
        : anchor ? '이미지에서 고정할 지점을 선택하세요.' : '이미지에서 맞출 지점을 선택하세요.',
      detail: replacement
        ? '위치를 선택하면 즉시 반영됩니다. 취소하면 기존 점을 유지합니다.'
        : anchor
          ? '두 위치를 선택하면 고정점이 적용됩니다. 취소하면 기존 고정점을 유지합니다.'
          : '두 위치를 선택하면 기준점이 추가됩니다. 취소해도 이미 추가한 기준점은 유지합니다.',
      actions: [{ action: 'cancel', label: replacement || mapStep ? '현재 선택 취소' : anchor ? '고정점 지정 취소' : '기준점 추가 종료' }],
    };
  }
  if (controlPointEditing) {
    return {
      id: 'gcp-edit', title: '기준점 편집', steps: ['지도에서 점 편집'], step: 0,
      instruction: '기준점을 드래그해 이동하거나 선택한 점을 Delete로 삭제하세요.',
      detail: '변경은 즉시 반영됩니다. 이미지 편집 실행 취소로 되돌릴 수 있습니다.',
      actions: [{ action: 'finish', label: '점 편집 종료' }],
    };
  }
  return null;
}

function referenceImageWorkflowMarkup(workflow) {
  if (!workflow) return '';
  return `<section class="reference-image-workflow" data-ref-workflow="${workflow.id}" aria-label="현재 이미지 작업">
    <div class="reference-image-section-header"><strong>${workflow.title}</strong><span>${workflow.step + 1}/${workflow.steps.length}</span></div>
    <ol class="reference-image-workflow-steps" aria-label="${workflow.title} 단계">
      ${workflow.steps.map((label, index) => `<li${index === workflow.step ? ' aria-current="step"' : ''}${index < workflow.step ? ' class="is-complete"' : ''}>${index + 1}. ${label}</li>`).join('')}
    </ol>
    <p class="reference-image-workflow-instruction" role="status">${escapeAttribute(workflow.instruction)}</p>
    <p class="reference-image-workflow-detail">${escapeAttribute(workflow.detail)}</p>
    <div class="reference-image-section-actions">
      ${workflow.actions.map(({ action, label, primary, disabled }) => `<button type="button" class="ui-button btn${primary ? '' : ' ghost'}" data-ref-action="${action}"${disabled ? ' disabled' : ''}>${label}</button>`).join('')}
    </div>
  </section>`;
}

export function referenceImageEditorMarkup({
  record,
  warp,
  placementEditing,
  freeTransformEditing = false,
  index,
  count,
  blendOptions,
  warpOptions,
  anchorState = null,
  gcpState = null,
  controlPointEditing = false,
  selectedControlPointId = '',
  placementRotation = 0,
  linearDraft = null,
  activeTab = 'placement',
  navigationOverride = false,
  workflow = referenceImageWorkflow({ record, anchorState, gcpState, controlPointEditing, linearDraft }),
} = {}) {
  const diagnostics = warp?.ok ? warp.diagnostics : null;
  const residuals = diagnosticResiduals(diagnostics);
  const warnings = diagnostics?.warnings || [];
  const warningText = warnings.includes('control-points-concentrated')
    ? '기준점이 이미지의 한쪽에 몰려 있습니다.'
    : warnings.includes('high-residual')
      ? '기준점 오차가 큽니다. 점 배치를 다시 확인하세요.'
      : warnings.includes('hard-constraint-residual')
        ? '고정점 또는 이미지 모서리를 지정한 위치에 정확히 맞추지 못했습니다.'
        : '';

  const rubberSheetActive = !!record.cornerPinEnabled && !!(record.anchor || record.controlPoints.length);
  const selectedWarpMode = rubberSheetActive ? 'tps' : record.warpMode;
  const options = values => values.map(([value, label]) => `<option value="${value}"${selectedWarpMode === value ? ' selected' : ''}>${label}</option>`).join('');

  const placementDisabled = record.locked || warp?.ok;
  const freeTransformDisabled = record.locked;
  const anchorDisabled = record.locked;
  const gcpDisabled = record.locked;
  const warpDisabled = record.locked || rubberSheetActive;
  const calibrationEditing = !!gcpState || controlPointEditing;
  const autoGeorefBusy = record.analysis?.busy === true;
  const autoGeorefPreview = record.analysis?.georef?.ok ? record.analysis.georef : null;
  const autoGeorefDiagnostics = autoGeorefPreview?.georef?.diagnostics || null;
  const autoGeorefIsOcr = autoGeorefPreview?.source === 'place-ocr';
  const autoGeorefMethod = autoGeorefIsOcr ? 'OCR 도시명' : '도시 기호';
  const autoGeorefExamined = autoGeorefIsOcr
    ? (autoGeorefPreview?.ocr?.detections?.length ?? autoGeorefPreview?.matching?.detectionCount ?? 0)
    : (autoGeorefPreview?.seedCount ?? 0);
  const autoGeorefCandidates = autoGeorefIsOcr
    ? (autoGeorefPreview?.matching?.matchCount ?? 0)
    : (autoGeorefPreview?.symbolCandidateCount ?? 0);
  const linearReady = record.controlPoints.length >= 2 && !!warp?.ok;
  const linearRows = (record.linearConstraints || []).map((constraint, index) => `
    <li class="reference-image-point-row">
      <span>${escapeAttribute(({ river: '강', coastline: '해안선', border: '경계선', other: '기타 선' })[constraint.kind] || '기타 선')} ${index + 1}${constraint.enabled === false ? ' · 비활성' : ''}</span>
      <button type="button" class="ui-button btn ghost" data-ref-action="linear-remove" data-constraint-id="${escapeAttribute(constraint.id)}"${record.locked || linearDraft ? ' disabled' : ''}>삭제</button>
    </li>`).join('');

  const anchorResidual = residuals.get('anchor');
  const pointRows = [];
  if (record.anchor) {
    pointRows.push(referencePointRow({
      label: '📌 고정점',
      error: residualText(anchorResidual?.meters ?? diagnostics?.hardMaxMeters),
      current: anchorState?.recordId === record.id,
      locked: record.locked,
      className: 'is-anchor',
      actions: [
        ['anchor', '다시 지정', ''],
        ['clear-anchor', '고정 해제', ''],
      ],
    }));
  }
  for (let i = 0; i < record.controlPoints.length; i += 1) {
    const point = record.controlPoints[i];
    pointRows.push(referencePointRow({
      label: `기준점 ${i + 1}`,
      error: residualText(residuals.get(String(point.id))?.meters),
      current: gcpState?.pointId === point.id || selectedControlPointId === point.id,
      locked: record.locked,
      actions: [
        ['edit-image', '이미지점', point.id],
        ['edit-coordinate', '지도점', point.id],
        ['delete-gcp', '삭제', point.id],
      ],
    }));
  }

  const modeHint = workflow
    ? `${workflow.title} · ${workflow.step + 1}/${workflow.steps.length} · ${escapeAttribute(workflow.instruction)}`
    : controlPointEditing
      ? '지도 위 기준점을 드래그해 위치를 옮기고, 선택한 점은 Delete로 삭제합니다.'
      : freeTransformEditing
        ? (record.anchor || record.controlPoints.length
          ? '자유 변형 중 · 고정점을 유지하면서 네 모서리를 각각 드래그해 이미지를 맞춥니다.'
          : '자유 변형 중 · 네 모서리를 각각 드래그해 이미지를 맞춥니다.')
        : warp?.ok
          ? '보정 적용 중 · 기준점으로 이미지 위치를 조정합니다.'
          : placementEditing
            ? (record.anchor
              ? '📌 고정점 유지 중 · 이동은 잠기고 8방향 크기·회전만 조정됩니다.'
              : '배치 편집 중 · 드래그로 이동, 8방향 핸들로 크기, 위 핸들로 회전합니다.')
            : record.anchor
              ? '📌 고정점이 설정되어 있습니다. 배치 편집에서 크기·회전 시 이 지점이 유지됩니다.'
              : `기준점 ${warp?.minimumPoints || 2}개부터 보정할 수 있습니다. 평소에는 클릭이 지도 도구로 통과합니다.`;

  return `
    <div class="reference-image-selected-card" aria-label="선택한 참고 이미지">
    <div class="ui-field field-group reference-image-editor-title">
      <input type="text" data-ref-field="name" value="${escapeAttribute(record.name)}" aria-label="참조 이미지 이름" />
      <button type="button" class="ui-button icon-btn" data-ref-action="delete" aria-label="참조 이미지 삭제"${record.locked ? ' disabled' : ''}><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"/></svg></button>
    </div>

      <div class="reference-image-toggle-row">
        <label><input data-ref-field="visible" type="checkbox"${record.visible ? ' checked' : ''} /> 표시</label>
        <label><input data-ref-field="locked" type="checkbox"${record.locked ? ' checked' : ''} /> 잠금</label>
        <button type="button" class="ui-button btn ghost" data-ref-action="bring-forward"${index >= count - 1 ? ' disabled' : ''}>앞으로</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="send-backward"${index <= 0 ? ' disabled' : ''}>뒤로</button>
      </div>
      <label class="ui-field field-group reference-image-field">
        <span>불투명도</span>
        <input data-ref-field="opacity" type="range" min="0" max="1" step="0.01" value="${record.opacity}" />
        <output>${Math.round(record.opacity * 100)}%</output>
      </label>
      <div class="reference-image-navigation-control" role="group" aria-label="지도와 이미지 조작 구분">
        <button type="button" class="ui-button btn ghost reference-image-navigation-button"
          data-ref-action="navigation-toggle" aria-pressed="${navigationOverride}">
          ${navigationOverride ? '이미지 조작으로 복귀' : '지도 이동'}
        </button>
        <small>${navigationOverride
          ? '이미지 편집을 유지하고 지도를 이동합니다.'
          : '이미지 편집 중 Space를 누르면 지도를 이동합니다.'}</small>
      </div>
      ${record.locked
        ? '<p class="reference-image-input-explanation">잠금이 설정되어 이미지 편집이 제한됩니다.</p>'
        : warp?.ok
          ? '<p class="reference-image-input-explanation">기준점 보정이 적용되어 기본 위치 이동 대신 기준점으로 조정합니다.</p>'
          : record.anchor
            ? '<p class="reference-image-input-explanation">고정점이 있어 이미지 본문 이동이 제한됩니다. 크기와 회전은 가능합니다.</p>'
            : ''}
    </div>
    ${referenceImageWorkflowMarkup(workflow)}
    ${referenceImageTabMarkup(activeTab)}
    <div class="reference-image-tabpanels">
    <section id="reference-image-panel-placement" data-ref-section="placement" role="tabpanel" class="reference-image-section" aria-labelledby="reference-image-tab-placement"${activeTab === 'placement' ? '' : ' hidden'}>
      <div class="reference-image-section-header">
        <strong id="reference-image-transform-title">배치 도구</strong>
        <span>${record.cornerPinEnabled ? '자유 변형 적용' : '기본 배치'}</span>
      </div>
      <div class="reference-image-mode-switch" role="group" aria-label="참조 이미지 편집 모드">
        <button type="button" class="ui-button btn ghost${placementEditing ? ' active' : ''}" data-ref-action="placement" aria-pressed="${placementEditing}"${placementDisabled ? ' disabled' : ''}>배치</button>
        <button type="button" class="ui-button btn ghost${freeTransformEditing ? ' active' : ''}" data-ref-action="free-transform" aria-pressed="${freeTransformEditing}"${freeTransformDisabled ? ' disabled' : ''}>자유 변형</button>
      </div>
      <label class="ui-field field-group reference-image-field">
        <span>회전</span>
        <input class="ui-input reference-image-number-input" data-ref-field="rotation" type="number" min="-180" max="180" step="0.1" value="${numberText(placementRotation, 1)}"${placementDisabled ? ' disabled' : ''} />
        <output>°</output>
      </label>
      <div class="reference-image-section-actions">
        <button type="button" class="ui-button btn ghost" data-ref-action="flip-x"${record.locked || record.controlPoints.length || record.anchor ? ' disabled' : ''}>좌우 반전</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="flip-y"${record.locked || record.controlPoints.length || record.anchor ? ' disabled' : ''}>상하 반전</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="reset-placement"${placementDisabled ? ' disabled' : ''}>배치 초기화</button>
      </div>
    </section>

    <section id="reference-image-panel-match" data-ref-section="match" role="tabpanel" class="reference-image-section reference-image-calibration" aria-labelledby="reference-image-tab-match"${activeTab === 'match' ? '' : ' hidden'}>
      <div class="reference-image-section-header">
        <strong id="reference-image-calibration-title">맞추기 도구</strong>
        <span>${warp?.ok ? '보정 적용 중' : '미적용'}</span>
      </div>

      <details class="reference-image-advanced">
        <summary>고급 보정 방식 및 상세 오차</summary>
      <p class="reference-image-hint">자유 변형은 Projective Corner Pin으로 계산합니다. 기준점·고정점과 함께 사용하면 모서리와 고정점을 hard constraint로 유지하고 TPS rubber-sheet로 보정합니다.</p>
      <label class="ui-field field-group reference-image-field">
        <span>방식</span>
        <select class="ui-select" data-ref-field="warp"${warpDisabled ? ' disabled' : ''}>${options(warpOptions)}</select>
        <output></output>
      </label>
      <div class="reference-image-diagnostics" aria-label="보정 진단">
        <span><small>일반점</small><strong>${record.controlPoints.length}</strong></span>
        <span><small>고정점</small><strong>${record.anchor ? 1 : 0}</strong></span>
        <span><small>RMS</small><strong>${diagnostics ? `${numberText(diagnostics.rmsMeters / 1000, 1)} km` : '—'}</strong></span>
        <span><small>최대</small><strong>${diagnostics ? `${numberText(diagnostics.maxMeters / 1000, 1)} km` : '—'}</strong></span>
        <span><small>고정 오차</small><strong>${diagnostics && record.anchor ? residualText(diagnostics.hardMaxMeters).replace('오차 ', '') : '—'}</strong></span>
      </div>
      </details>
      <div class="reference-image-calibration-actions">
        <button type="button" class="ui-button btn" data-ref-action="auto-analysis"${record.locked || autoGeorefBusy ? ' disabled' : ''}>자동 분석</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="analyze-layout"${record.locked || autoGeorefBusy ? ' disabled' : ''}>본 지도·삽입도 분리</button>
        <button type="button" class="ui-button btn ghost${calibrationEditing ? ' active' : ''}" data-ref-action="gcp" aria-pressed="${calibrationEditing}"${gcpDisabled ? ' disabled' : ''}>기준점</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="auto-georef"${record.locked || autoGeorefBusy ? ' disabled' : ''}>${autoGeorefBusy ? '자동 분석 중…' : '자동 맞춤'}</button>
        <button type="button" class="ui-button btn ghost${anchorState ? ' active' : ''}" data-ref-action="anchor" aria-pressed="${!!anchorState}"${anchorDisabled ? ' disabled' : ''}>${record.anchor ? '고정점 다시 지정' : '📌 고정점 지정'}</button>
        <button type="button" class="ui-button btn ghost${controlPointEditing ? ' active' : ''}" data-ref-action="gcp-edit" aria-pressed="${controlPointEditing}"${gcpDisabled || !record.controlPoints.length ? ' disabled' : ''}>지도에서 점 편집</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="undo-gcp"${record.controlPoints.length && !gcpDisabled ? '' : ' disabled'}>마지막 점 삭제</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="clear-gcp"${record.controlPoints.length && !gcpDisabled ? '' : ' disabled'}>전체 삭제</button>
      </div>

      ${record.analysis?.layout ? `<fieldset class="reference-image-advanced"${record.locked || autoGeorefBusy ? ' disabled' : ''}>
        <legend>지도 영역 후보</legend><p class="reference-image-hint">도곽으로 찾은 후보입니다. 범례나 장식 테두리가 포함됐는지 확인하세요.</p>
        ${record.analysis.layout.panels.map((panel, index) => `<div class="reference-image-point-row"><span>${panel.kind === 'main' ? '본 지도' : panel.kind === 'legend' ? '범례' : '삽입도'} 후보 ${index + 1} · ${panel.sourceRect.width} × ${panel.sourceRect.height} px · 원본 (${panel.sourceRect.x}, ${panel.sourceRect.y})</span>
        <button type="button" class="ui-button btn ghost" data-ref-action="use-layout-panel" data-panel-id="${escapeAttribute(panel.id)}"${panel.kind === 'legend' ? ' disabled' : ''}>이 영역 맞춤</button></div>`).join('')}
        ${record.analysis.layout.grid?.points.length ? `<p class="reference-image-hint">경위도 격자점 ${record.analysis.layout.grid.points.length}개 후보. 원본의 기준 자오선이 그리니치이고 측지 기준이 WGS84인지 확인한 경우에만 추가하세요. 알 수 없거나 다른 기준이면 사용할 수 없습니다.</p>
        <details><summary>인식한 좌표 표기</summary>${record.analysis.layout.grid.labels.map(label => `<p>${escapeAttribute(label.originalText)} → ${label.value}°</p>`).join('')}</details>
        <button type="button" class="ui-button btn ghost" data-ref-action="use-grid-points"${record.analysis.layout.grid.independentLongitudeLabels < 2 || record.analysis.layout.grid.independentLatitudeLabels < 2 ? ' disabled' : ''}>그리니치·WGS84 확인: 격자점 추가</button>` : ''}
      </fieldset>` : ''}

      ${autoGeorefPreview ? `
        ${autoGeorefPreview.requiresLocationChoice ? `<p class="reference-image-hint">위치를 하나로 확정하지 못했습니다. 지역 후보를 선택하세요.</p>
        <div class="reference-image-calibration-actions">${autoGeorefPreview.locations.map((location, index) => `<button type="button" class="ui-button btn ghost" data-ref-action="choose-location" data-location="${index}">후보 ${index + 1} · ${escapeAttribute((location.matching?.matches || []).filter(row => location.georef.inlierIds.includes(row.id)).slice(0, 3).map(row => row.name || row.text || row.placeId).join(', '))}</button>`).join('')}</div>` : ''}
        <p class="reference-image-hint">분석 결과 · 기준점 ${autoGeorefPreview.georef?.inlierCount ?? 0}개 채택, ${autoGeorefPreview.georef?.rejectedCount ?? 0}개 제외. 적용 전 결과를 확인하세요.</p>
        <details class="reference-image-advanced">
        <summary>자동 맞춤 분석 상세</summary>
        <div class="reference-image-diagnostics" aria-label="자동 맞춤 분석 결과">
          <span><small>방식</small><strong>${autoGeorefMethod}</strong></span>
          <span><small>${autoGeorefIsOcr ? '인식 문자' : '탐색 도시'}</small><strong>${autoGeorefExamined}</strong></span>
          <span><small>${autoGeorefIsOcr ? '지명 매칭' : '기호 후보'}</small><strong>${autoGeorefCandidates}</strong></span>
          <span><small>채택</small><strong>${autoGeorefPreview.georef?.inlierCount ?? 0}</strong></span>
          <span><small>제외</small><strong>${autoGeorefPreview.georef?.rejectedCount ?? 0}</strong></span>
          <span><small>RMS</small><strong>${autoGeorefDiagnostics ? `${numberText(autoGeorefDiagnostics.rmsMeters / 1000, 1)} km` : '—'}</strong></span>
          <span><small>검증 P95</small><strong>${numberText(autoGeorefDiagnostics?.quality?.crossValidationP95Pixels, 1)} px</strong></span>
          <span><small>검증점 분포</small><strong>${numberText((autoGeorefDiagnostics?.quality?.imageCoverage || 0) * 100, 0)}%</strong></span>
        </div>
        </details>
      ` : ''}

      <div class="reference-image-calibration-actions"><button type="button" class="ui-button btn ghost" data-ref-action="extract-boundaries"${record.locked || autoGeorefBusy || !warp?.ok ? ' disabled' : ''}>경계 자동 추출</button></div>
      ${record.analysis?.reviewing ? `<fieldset class="reference-image-advanced"${record.locked || autoGeorefBusy || record.analysis.editingChainId != null ? ' disabled' : ''}>
        <legend>생성할 경계 후보</legend>
        <p class="reference-image-hint">미해결 구간은 임의로 잇지 않습니다. 가장자리에서 잘린 영역은 생성할 수 없습니다.</p>
        <details open><summary>선 ${record.analysis.boundaries.graph.chains.length}개</summary>${record.analysis.boundaries.graph.chains.map(chain => `<div class="reference-image-point-row">
          <label class="reference-image-field"><input type="checkbox" data-ref-candidate="line:${chain.id}"${record.analysis.selectedIds.has('line:' + chain.id) ? ' checked' : ''} />선 ${chain.id + 1} · ${chain.semanticBits & 1 ? '국경' : chain.semanticBits & 2 ? '행정경계' : '해안'}</label>
          <div class="reference-image-point-actions">${[['boundary-exclude', '경계 제외'], ['boundary-cut', '위치 선택해 끊기'], ['boundary-retrace', '다시 추적']].map(([action, text]) => `<button type="button" class="ui-button btn ghost" data-ref-action="${action}" data-chain-id="${chain.id}">${text}</button>`).join('')}
          ${['start', 'end'].map(end => `<button type="button" class="ui-button btn ghost" data-ref-action="boundary-endpoint" data-chain-id="${chain.id}" data-end="${end}" aria-pressed="${record.analysis.connectFrom?.chainId === chain.id && record.analysis.connectFrom?.end === end}">${end === 'start' ? '시작점' : '끝점'} 연결</button>`).join('')}</div></div>`).join('')}</details>
        <details><summary>영역 ${record.analysis.boundaries.graph.faces.length}개</summary>${record.analysis.boundaries.graph.faces.map(face => `<label class="reference-image-field"><input type="checkbox" data-ref-candidate="face:${face.id}"${face.touchesImageEdge ? ' disabled' : ''}${record.analysis.selectedIds.has('face:' + face.id) ? ' checked' : ''} />영역 ${face.id + 1}${face.touchesImageEdge ? ' · 가장자리 불완전' : ''}</label>`).join('')}</details>
      </fieldset>` : ''}

      <div class="reference-image-calibration-actions">
        <button type="button" class="ui-button btn ghost" data-ref-action="linear-coastline"${record.locked || !linearReady || linearDraft ? ' disabled' : ''}>해안선 맞추기</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="linear-river"${record.locked || !linearReady || linearDraft ? ' disabled' : ''}>강 맞추기</button>
      </div>
      ${!linearReady ? '<p class="reference-image-hint">선 보정은 기준점 두 개 이상으로 이미지를 먼저 맞춘 뒤 사용할 수 있습니다.</p>' : ''}
      ${linearRows ? `<ol class="reference-image-points" aria-label="선 제약 목록">${linearRows}</ol>` : ''}



      ${pointRows.length
        ? `<ol class="reference-image-points" aria-label="기준점 편집">${pointRows.join('')}</ol>`
        : '<div class="reference-image-empty reference-image-points-empty">기준점이 없습니다. 위의 ‘기준점’ 모드에서 이미지와 지도 위치를 차례로 선택하세요.</div>'}
    </section>

    <section id="reference-image-panel-display" data-ref-section="display" role="tabpanel" class="reference-image-section" aria-labelledby="reference-image-tab-display"${activeTab === 'display' ? '' : ' hidden'}>
      <div class="reference-image-section-header">
        <strong id="reference-image-appearance-title">표시</strong>
      </div>

      <label class="ui-field field-group reference-image-field">
        <span>혼합</span>
        <select class="ui-select" data-ref-field="blend">${blendOptions.map(([value, label]) => `<option value="${value}"${record.blendMode === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <output></output>
      </label>

    </section>

    </div>

    ${warningText ? `<p class="reference-image-warning">${warningText}</p>` : ''}
    ${diagnostics && record.controlPoints.length <= 2 ? '<p class="reference-image-warning">최소 기준점으로 계산한 오차입니다. 0이어도 전체 이미지 정렬의 정확성을 보장하지 않습니다.</p>' : ''}
    <p class="reference-image-hint" data-ref-hint role="status">${modeHint}</p>
  `;
}
