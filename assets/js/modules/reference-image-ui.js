const numberText = (value, digits = 0) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
        <span>지도 보정 · 트레이싱</span>
      </div>
      <button type="button" class="ui-button icon-btn" data-ref-action="close" aria-label="참조 이미지 닫기"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-close"/></svg></button>
    </header>
    <div class="reference-image-toolbar">
      <button type="button" class="ui-button btn" data-ref-action="add">이미지 추가</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="undo" disabled>실행 취소</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="redo" disabled>다시 실행</button>
      <input data-ref-file type="file" accept="image/png,image/jpeg,image/webp" hidden />
    </div>
    <div class="reference-image-list" data-ref-list></div>
    <div class="reference-image-empty" data-ref-empty>PNG, JPG, WebP를 불러와 지도 위에서 기준점을 맞출 수 있습니다.</div>
    <div class="reference-image-editor" data-ref-editor hidden></div>
  `;
  return panel;
}

export function createReferenceImageLauncher() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-button ui-floating-surface reference-image-launcher';
  button.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-map"/></svg><span>참조 이미지</span>';
  button.setAttribute('aria-expanded', 'false');
  return button;
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
    row.innerHTML = `<span class="reference-image-visibility" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24"><use href="#${record.visible ? 'icon-eye' : 'icon-eye-off'}"/></svg></span><strong></strong><small>${record.controlPoints.length}점</small>`;
    row.querySelector('strong').textContent = record.name;
    listElement.appendChild(row);
  }
}

export function referenceImageEditorMarkup({
  record,
  warp,
  placementEditing,
  index,
  count,
  blendOptions,
  warpOptions,
  gcpState = null,
  controlPointEditing = false,
  selectedControlPointId = '',
} = {}) {
  const diagnostics = warp?.ok ? warp.diagnostics : null;
  const warnings = diagnostics?.warnings || [];
  const warningText = warnings.includes('control-points-concentrated')
    ? '기준점이 이미지의 한쪽에 몰려 있습니다.'
    : warnings.includes('high-residual')
      ? '기준점 오차가 큽니다. 점 배치를 다시 확인하세요.'
      : '';
  const options = values => values.map(([value, label]) => `<option value="${value}"${record.warpMode === value ? ' selected' : ''}>${label}</option>`).join('');
  const placementDisabled = record.locked || warp?.ok;
  return `
    <div class="reference-image-editor-title">
      <input type="text" data-ref-field="name" value="${escapeAttribute(record.name)}" aria-label="참조 이미지 이름" />
      <button type="button" class="ui-button icon-btn" data-ref-action="delete" aria-label="참조 이미지 삭제"${record.locked ? ' disabled' : ''}><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"/></svg></button>
    </div>
    <label class="reference-image-field"><span>불투명도</span><input data-ref-field="opacity" type="range" min="0" max="1" step="0.01" value="${record.opacity}" /><output>${Math.round(record.opacity * 100)}%</output></label>
    <label class="reference-image-field"><span>회전</span><input class="ui-input reference-image-number-input" data-ref-field="rotation" type="number" min="-180" max="180" step="0.1" value="${numberText(record.rotation, 1)}"${placementDisabled ? ' disabled' : ''} /><output>°</output></label>
    <label class="reference-image-field"><span>혼합</span><select class="ui-select" data-ref-field="blend">${blendOptions.map(([value, label]) => `<option value="${value}"${record.blendMode === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="reference-image-field"><span>보정</span><select class="ui-select" data-ref-field="warp"${record.locked ? ' disabled' : ''}>${options(warpOptions)}</select></label>
    <div class="reference-image-toggle-row">
      <label><input data-ref-field="visible" type="checkbox"${record.visible ? ' checked' : ''} /> 표시</label>
      <label><input data-ref-field="locked" type="checkbox"${record.locked ? ' checked' : ''} /> 잠금</label>
      <button type="button" class="ui-button btn ghost" data-ref-action="flip-x"${record.locked || record.controlPoints.length ? ' disabled' : ''}>좌우 반전</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="flip-y"${record.locked || record.controlPoints.length ? ' disabled' : ''}>상하 반전</button>
    </div>
    <div class="reference-image-placement-actions">
      <button type="button" class="ui-button btn ghost${placementEditing ? ' active' : ''}" data-ref-action="placement" aria-pressed="${placementEditing}"${placementDisabled ? ' disabled' : ''}>배치 편집</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="reset-placement"${placementDisabled ? ' disabled' : ''}>배치 초기화</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="bring-forward"${index >= count - 1 ? ' disabled' : ''}>앞으로</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="send-backward"${index <= 0 ? ' disabled' : ''}>뒤로</button>
    </div>
    <div class="reference-image-gcp-actions">
      <button type="button" class="ui-button btn" data-ref-action="gcp" aria-pressed="${!!gcpState}"${record.locked ? ' disabled' : ''}>기준점 추가</button>
      <button type="button" class="ui-button btn ghost${controlPointEditing ? ' active' : ''}" data-ref-action="gcp-edit" aria-pressed="${controlPointEditing}"${record.locked || !record.controlPoints.length ? ' disabled' : ''}>지도에서 점 편집</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="undo-gcp"${record.controlPoints.length && !record.locked ? '' : ' disabled'}>마지막 점 삭제</button>
      <button type="button" class="ui-button btn ghost" data-ref-action="clear-gcp"${record.controlPoints.length && !record.locked ? '' : ' disabled'}>전체 삭제</button>
    </div>
    <ol class="reference-image-points" aria-label="기준점 편집">
      ${record.controlPoints.map((point, i) => `<li${(gcpState?.pointId === point.id || selectedControlPointId === point.id) ? ' aria-current="true"' : ''}>
        <span>기준점 ${i + 1}</span>
        ${[['edit-image', '이미지 위치 다시 지정'], ['edit-coordinate', '지도 위치 다시 지정'], ['delete-gcp', '삭제']].map(([action, label]) => `<button type="button" class="ui-button btn ghost" data-ref-action="${action}" data-point-id="${escapeAttribute(point.id)}"${record.locked ? ' disabled' : ''}>${label}</button>`).join('')}
      </li>`).join('')}
    </ol>
    <div class="reference-image-diagnostics">
      <span>기준점 <strong>${record.controlPoints.length}</strong></span>
      <span>RMS <strong>${diagnostics ? `${numberText(diagnostics.rmsMeters / 1000, 1)} km` : '—'}</strong></span>
      <span>최대 <strong>${diagnostics ? `${numberText(diagnostics.maxMeters / 1000, 1)} km` : '—'}</strong></span>
    </div>
    ${warningText ? `<p class="reference-image-warning">${warningText}</p>` : ''}
    ${diagnostics && record.controlPoints.length <= 2 ? '<p class="reference-image-warning">최소 기준점으로 계산한 오차입니다. 0이어도 전체 이미지 정렬의 정확성을 보장하지 않습니다.</p>' : ''}
    <p class="reference-image-hint" data-ref-hint>${controlPointEditing ? '지도 위 번호를 드래그해 위치를 옮기고, 선택한 점은 Delete로 삭제합니다.' : warp?.ok ? `${warp.mode} 보정 적용 중 · 배치 편집 대신 기준점으로 위치를 조정합니다.` : placementEditing ? '배치 편집 중 · 드래그로 이동, 모서리로 크기, 위 핸들로 회전합니다.' : `기준점 ${warp?.minimumPoints || 2}개부터 보정할 수 있습니다. 평소에는 클릭이 지도 도구로 통과합니다.`}</p>
  `;
}
