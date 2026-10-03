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
  panel.className = 'reference-image-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '참조 이미지');
  panel.innerHTML = `
    <header class="reference-image-panel-header">
      <div>
        <strong>참조 이미지</strong>
      </div>
      <button type="button" class="ui-button icon-btn" data-ref-action="close" aria-label="참조 이미지 닫기"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-close"/></svg></button>
    </header>
    <div class="reference-image-toolbar">
      <button type="button" class="ui-button btn" data-ref-action="add">이미지 추가</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="undo" disabled>실행 취소</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="redo" disabled>다시 실행</button>
      <input data-ref-file type="file" accept="image/png,image/jpeg,image/webp" hidden />
    </div>
    <div class="reference-image-empty" data-ref-storage-status role="status" hidden>
      <span data-ref-storage-message></span>
      <button type="button" class="ui-button btn ghost" data-ref-action="retry-storage">다시 읽기</button>
    </div>
    <div class="reference-image-list" data-ref-list></div>
    <div class="reference-image-empty" data-ref-empty>PNG, JPG, WebP를 불러와 지도 위에서 기준점을 맞출 수 있습니다.</div>
    <div class="reference-image-editor" data-ref-editor hidden></div>
  `;
  return panel;
}

export function renderReferenceImageList(listElement, records, selectedId) {
  listElement.replaceChildren();
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'reference-image-list-row';
    row.dataset.referenceImageId = record.id;
    if (record.id === selectedId) row.classList.add('is-selected');
    const calibrationText = record.anchor
      ? `📌 · ${record.controlPoints.length}점`
      : `${record.controlPoints.length}점`;
    row.innerHTML = `<span class="reference-image-visibility" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><use href="#${record.visible ? 'icon-eye' : 'icon-eye-off'}"/></svg></span><strong></strong><small>${calibrationText}</small>`;
    row.querySelector('strong').textContent = record.name;
    listElement.appendChild(row);
  }
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
} = {}) {
  const diagnostics = warp?.ok ? warp.diagnostics : null;
  const residuals = diagnosticResiduals(diagnostics);
  const warnings = diagnostics?.warnings || [];
  const warningText = warnings.includes('control-points-concentrated')
    ? '기준점이 이미지의 한쪽에 몰려 있습니다.'
    : warnings.includes('high-residual')
      ? '기준점 오차가 큽니다. 점 배치를 다시 확인하세요.'
      : warnings.includes('hard-constraint-residual')
        ? '고정점 또는 Corner Pin 제약을 정확히 만족하지 못했습니다.'
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

  const modeHint = anchorState
    ? (anchorState.step === 'image'
      ? '1/2 · 이미지에서 고정할 지점을 선택하세요.'
      : '2/2 · 같은 지점의 실제 지도 위치를 선택하세요.')
    : controlPointEditing
      ? '지도 위 기준점을 드래그해 위치를 옮기고, 선택한 점은 Delete로 삭제합니다.'
      : freeTransformEditing
        ? (record.anchor || record.controlPoints.length
          ? '자유 변형 중 · 네 모서리와 고정점을 hard constraint로 유지하고 TPS rubber-sheet로 보정합니다.'
          : '자유 변형 중 · 네 모서리를 각각 드래그해 Projective Corner Pin을 조정합니다.')
        : warp?.ok
          ? `${warp.mode} 보정 적용 중 · 배치 편집 대신 기준점으로 위치를 조정합니다.`
          : placementEditing
            ? (record.anchor
              ? '📌 고정점 유지 중 · 이동은 잠기고 8방향 크기·회전만 조정됩니다.'
              : '배치 편집 중 · 드래그로 이동, 8방향 핸들로 크기, 위 핸들로 회전합니다.')
            : record.anchor
              ? '📌 고정점이 설정되어 있습니다. 배치 편집에서 크기·회전 시 이 지점이 유지됩니다.'
              : `기준점 ${warp?.minimumPoints || 2}개부터 보정할 수 있습니다. 평소에는 클릭이 지도 도구로 통과합니다.`;

  return `
    <div class="reference-image-editor-title">
      <input type="text" data-ref-field="name" value="${escapeAttribute(record.name)}" aria-label="참조 이미지 이름" />
      <button type="button" class="ui-button icon-btn" data-ref-action="delete" aria-label="참조 이미지 삭제"${record.locked ? ' disabled' : ''}><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"/></svg></button>
    </div>

    <section class="reference-image-section" aria-labelledby="reference-image-appearance-title">
      <div class="reference-image-section-header">
        <strong id="reference-image-appearance-title">표시</strong>
      </div>
      <label class="reference-image-field">
        <span>불투명도</span>
        <input data-ref-field="opacity" type="range" min="0" max="1" step="0.01" value="${record.opacity}" />
        <output>${Math.round(record.opacity * 100)}%</output>
      </label>
      <label class="reference-image-field">
        <span>혼합</span>
        <select class="ui-select" data-ref-field="blend">${blendOptions.map(([value, label]) => `<option value="${value}"${record.blendMode === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <output></output>
      </label>
      <div class="reference-image-toggle-row">
        <label><input data-ref-field="visible" type="checkbox"${record.visible ? ' checked' : ''} /> 표시</label>
        <label><input data-ref-field="locked" type="checkbox"${record.locked ? ' checked' : ''} /> 잠금</label>
        <button type="button" class="ui-button btn ghost" data-ref-action="bring-forward"${index >= count - 1 ? ' disabled' : ''}>앞으로</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="send-backward"${index <= 0 ? ' disabled' : ''}>뒤로</button>
      </div>
    </section>

    <section class="reference-image-section" aria-labelledby="reference-image-transform-title">
      <div class="reference-image-section-header">
        <strong id="reference-image-transform-title">편집</strong>
        <span>${record.cornerPinEnabled ? 'Corner Pin 적용' : '기본 배치'}</span>
      </div>
      <div class="reference-image-mode-switch" role="group" aria-label="참조 이미지 편집 모드">
        <button type="button" class="ui-button btn ghost${placementEditing ? ' active' : ''}" data-ref-action="placement" aria-pressed="${placementEditing}"${placementDisabled ? ' disabled' : ''}>배치</button>
        <button type="button" class="ui-button btn ghost${freeTransformEditing ? ' active' : ''}" data-ref-action="free-transform" aria-pressed="${freeTransformEditing}"${freeTransformDisabled ? ' disabled' : ''}>자유 변형</button>
        <button type="button" class="ui-button btn ghost${calibrationEditing ? ' active' : ''}" data-ref-action="gcp" aria-pressed="${calibrationEditing}"${gcpDisabled ? ' disabled' : ''}>기준점</button>
      </div>
      <label class="reference-image-field">
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

    <section class="reference-image-section reference-image-calibration" aria-labelledby="reference-image-calibration-title">
      <div class="reference-image-section-header">
        <strong id="reference-image-calibration-title">보정</strong>
        <span>${rubberSheetActive ? 'TPS rubber-sheet' : warp?.ok ? warp.mode : '미적용'}</span>
      </div>
      <label class="reference-image-field">
        <span>방식</span>
        <select class="ui-select" data-ref-field="warp"${warpDisabled ? ' disabled' : ''}>${options(warpOptions)}</select>
        <output></output>
      </label>
      <div class="reference-image-calibration-actions">
        <button type="button" class="ui-button btn ghost${anchorState ? ' active' : ''}" data-ref-action="anchor" aria-pressed="${!!anchorState}"${anchorDisabled ? ' disabled' : ''}>${record.anchor ? '고정점 다시 지정' : '📌 고정점 지정'}</button>
        <button type="button" class="ui-button btn ghost${controlPointEditing ? ' active' : ''}" data-ref-action="gcp-edit" aria-pressed="${controlPointEditing}"${gcpDisabled || !record.controlPoints.length ? ' disabled' : ''}>지도에서 점 편집</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="undo-gcp"${record.controlPoints.length && !gcpDisabled ? '' : ' disabled'}>마지막 점 삭제</button>
        <button type="button" class="ui-button btn ghost" data-ref-action="clear-gcp"${record.controlPoints.length && !gcpDisabled ? '' : ' disabled'}>전체 삭제</button>
      </div>

      <div class="reference-image-diagnostics" aria-label="보정 진단">
        <span><small>일반점</small><strong>${record.controlPoints.length}</strong></span>
        <span><small>고정점</small><strong>${record.anchor ? 1 : 0}</strong></span>
        <span><small>RMS</small><strong>${diagnostics ? `${numberText(diagnostics.rmsMeters / 1000, 1)} km` : '—'}</strong></span>
        <span><small>최대</small><strong>${diagnostics ? `${numberText(diagnostics.maxMeters / 1000, 1)} km` : '—'}</strong></span>
        <span><small>고정 오차</small><strong>${diagnostics && record.anchor ? residualText(diagnostics.hardMaxMeters).replace('오차 ', '') : '—'}</strong></span>
      </div>

      ${pointRows.length
        ? `<ol class="reference-image-points" aria-label="기준점 편집">${pointRows.join('')}</ol>`
        : '<div class="reference-image-empty reference-image-points-empty">기준점이 없습니다. 위의 ‘기준점’ 모드에서 이미지와 지도 위치를 차례로 선택하세요.</div>'}
    </section>

    ${warningText ? `<p class="reference-image-warning">${warningText}</p>` : ''}
    ${diagnostics && record.controlPoints.length <= 2 ? '<p class="reference-image-warning">최소 기준점으로 계산한 오차입니다. 0이어도 전체 이미지 정렬의 정확성을 보장하지 않습니다.</p>' : ''}
    <p class="reference-image-hint" data-ref-hint>${modeHint}</p>
  `;
}
