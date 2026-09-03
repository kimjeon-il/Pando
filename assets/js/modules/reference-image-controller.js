import {
  buildReferenceImageMesh,
  buildReferenceImageWarp,
  REFERENCE_IMAGE_WARP_MODES,
} from './reference-image-georef.js';
import {
  deleteStoredReferenceImage,
  listStoredReferenceImages,
  putStoredReferenceImage,
} from './reference-image-store.js';

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DEFAULT_OPACITY = 0.55;
const DEFAULT_BLEND_MODE = 'source-over';
const MESH_QUALITY = Object.freeze({ columns: 24, rows: 16 });
const BLEND_OPTIONS = Object.freeze([
  ['source-over', '일반'],
  ['multiply', '곱하기'],
  ['screen', '스크린'],
  ['difference', '차이'],
]);
const WARP_OPTIONS = Object.freeze([
  [REFERENCE_IMAGE_WARP_MODES.AUTO, '자동'],
  [REFERENCE_IMAGE_WARP_MODES.SIMILARITY, '단순 변형'],
  [REFERENCE_IMAGE_WARP_MODES.AFFINE, 'Affine'],
  [REFERENCE_IMAGE_WARP_MODES.PROJECTIVE, 'Projective'],
  [REFERENCE_IMAGE_WARP_MODES.TPS, 'TPS 비선형'],
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberText = (value, digits = 0) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';

function createId() {
  if (globalThis.crypto?.randomUUID) return `ref-${globalThis.crypto.randomUUID()}`;
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function mapHost() {
  return globalThis.__PANDOLAB_MAP_HOST__ || null;
}

function angularDistanceDegrees(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radians = Math.PI / 180;
  const lonA = a[0] * radians;
  const latA = a[1] * radians;
  const lonB = b[0] * radians;
  const latB = b[1] * radians;
  const dot = Math.sin(latA) * Math.sin(latB) + Math.cos(latA) * Math.cos(latB) * Math.cos(lonA - lonB);
  return Math.acos(clamp(dot, -1, 1)) / radians;
}

function projectVisible(host, coordinate) {
  const projected = host?.project?.(coordinate);
  if (!projected || !projected.every(Number.isFinite)) return null;
  if (host.getProjectionKind?.() !== 'globe') return projected;
  const roundTrip = host.unproject?.(projected);
  return angularDistanceDegrees(coordinate, roundTrip) <= 0.25 ? projected : null;
}

function canvasPoint(event, mapElement) {
  const rect = mapElement.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function createImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 파일을 읽을 수 없습니다.'));
    };
    image.src = url;
  });
}

function defaultScreenRect(image, mapElement) {
  const bounds = mapElement.getBoundingClientRect();
  const maxWidth = Math.max(180, bounds.width * 0.62);
  const maxHeight = Math.max(140, bounds.height * 0.62);
  const scale = Math.min(maxWidth / Math.max(1, image.naturalWidth), maxHeight / Math.max(1, image.naturalHeight), 1);
  const width = Math.max(80, image.naturalWidth * scale);
  const height = Math.max(60, image.naturalHeight * scale);
  return Object.freeze({
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  });
}

function normalizePersistedRecord(record) {
  return {
    id: String(record?.id || createId()),
    name: String(record?.name || '참조 이미지'),
    opacity: clamp(Number(record?.opacity ?? DEFAULT_OPACITY), 0, 1),
    blendMode: BLEND_OPTIONS.some(([value]) => value === record?.blendMode) ? record.blendMode : DEFAULT_BLEND_MODE,
    warpMode: WARP_OPTIONS.some(([value]) => value === record?.warpMode) ? record.warpMode : REFERENCE_IMAGE_WARP_MODES.AUTO,
    visible: record?.visible !== false,
    locked: record?.locked === true,
    flipX: record?.flipX === true,
    flipY: record?.flipY === true,
    controlPoints: Array.isArray(record?.controlPoints) ? record.controlPoints : [],
    blob: record?.blob instanceof Blob ? record.blob : null,
    screenRect: record?.screenRect && typeof record.screenRect === 'object' ? record.screenRect : null,
    order: Number.isFinite(Number(record?.order)) ? Number(record.order) : 0,
  };
}

function serializableRecord(record, order) {
  return {
    id: record.id,
    name: record.name,
    opacity: record.opacity,
    blendMode: record.blendMode,
    warpMode: record.warpMode,
    visible: record.visible,
    locked: record.locked,
    flipX: record.flipX,
    flipY: record.flipY,
    controlPoints: record.controlPoints.map(point => ({
      id: point.id,
      image: [...point.image],
      coordinate: [...point.coordinate],
    })),
    screenRect: record.screenRect ? { ...record.screenRect } : null,
    order,
    blob: record.blob,
  };
}

function affineForTriangles(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const coefficient = values => [
    (values[0] * (s1[1] - s2[1]) + values[1] * (s2[1] - s0[1]) + values[2] * (s0[1] - s1[1])) / denominator,
    (values[0] * (s2[0] - s1[0]) + values[1] * (s0[0] - s2[0]) + values[2] * (s1[0] - s0[0])) / denominator,
    (values[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + values[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + values[2] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator,
  ];
  const x = coefficient(destination.map(point => point[0]));
  const y = coefficient(destination.map(point => point[1]));
  return [x[0], y[0], x[1], y[1], x[2], y[2]];
}

function barycentric(point, triangle) {
  const [p0, p1, p2] = triangle;
  const denominator = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const a = ((p1[1] - p2[1]) * (point[0] - p2[0]) + (p2[0] - p1[0]) * (point[1] - p2[1])) / denominator;
  const b = ((p2[1] - p0[1]) * (point[0] - p2[0]) + (p0[0] - p2[0]) * (point[1] - p2[1])) / denominator;
  const c = 1 - a - b;
  return a >= -0.002 && b >= -0.002 && c >= -0.002 ? [a, b, c] : null;
}

function makePanel() {
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
      <button type="button" class="ui-button ui-icon-button" data-ref-action="close" aria-label="참조 이미지 닫기"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-close"/></svg></button>
    </header>
    <div class="reference-image-toolbar">
      <button type="button" class="ui-button ui-button--primary" data-ref-action="add">이미지 추가</button>
      <input data-ref-file type="file" accept="image/png,image/jpeg,image/webp" hidden />
    </div>
    <div class="reference-image-list" data-ref-list></div>
    <div class="reference-image-empty" data-ref-empty>PNG, JPG, WebP를 불러와 지도 위에서 기준점을 맞출 수 있습니다.</div>
    <div class="reference-image-editor" data-ref-editor hidden></div>
  `;
  return panel;
}

function makeLauncher() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-button reference-image-launcher';
  button.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-map"/></svg><span>참조 이미지</span>';
  button.setAttribute('aria-expanded', 'false');
  return button;
}

function editorMarkup(record, warp) {
  const diagnostics = warp?.ok ? warp.diagnostics : null;
  const warnings = diagnostics?.warnings || [];
  const warningText = warnings.includes('control-points-concentrated')
    ? '기준점이 이미지의 한쪽에 몰려 있습니다.'
    : warnings.includes('high-residual')
      ? '기준점 오차가 큽니다. 점 배치를 다시 확인하세요.'
      : '';
  const options = values => values.map(([value, label]) => `<option value="${value}"${record.warpMode === value ? ' selected' : ''}>${label}</option>`).join('');
  return `
    <div class="reference-image-editor-title">
      <input class="ui-input" data-ref-field="name" value="${record.name.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" aria-label="참조 이미지 이름" />
      <button type="button" class="ui-button ui-icon-button" data-ref-action="delete" aria-label="참조 이미지 삭제"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"/></svg></button>
    </div>
    <label class="reference-image-field"><span>불투명도</span><input data-ref-field="opacity" type="range" min="0" max="1" step="0.01" value="${record.opacity}" /><output>${Math.round(record.opacity * 100)}%</output></label>
    <label class="reference-image-field"><span>혼합</span><select class="ui-select" data-ref-field="blend">${BLEND_OPTIONS.map(([value, label]) => `<option value="${value}"${record.blendMode === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="reference-image-field"><span>보정</span><select class="ui-select" data-ref-field="warp">${options(WARP_OPTIONS)}</select></label>
    <div class="reference-image-toggle-row">
      <label><input data-ref-field="visible" type="checkbox"${record.visible ? ' checked' : ''} /> 표시</label>
      <label><input data-ref-field="locked" type="checkbox"${record.locked ? ' checked' : ''} /> 잠금</label>
      <button type="button" class="ui-button" data-ref-action="flip-x">좌우 반전</button>
      <button type="button" class="ui-button" data-ref-action="flip-y">상하 반전</button>
    </div>
    <div class="reference-image-gcp-actions">
      <button type="button" class="ui-button ui-button--primary" data-ref-action="gcp"${record.locked ? ' disabled' : ''}>기준점 추가</button>
      <button type="button" class="ui-button" data-ref-action="undo-gcp"${record.controlPoints.length ? '' : ' disabled'}>마지막 점 삭제</button>
      <button type="button" class="ui-button" data-ref-action="clear-gcp"${record.controlPoints.length ? '' : ' disabled'}>전체 삭제</button>
    </div>
    <div class="reference-image-diagnostics">
      <span>기준점 <strong>${record.controlPoints.length}</strong></span>
      <span>RMS <strong>${diagnostics ? `${numberText(diagnostics.rmsMeters / 1000, 1)} km` : '—'}</strong></span>
      <span>최대 <strong>${diagnostics ? `${numberText(diagnostics.maxMeters / 1000, 1)} km` : '—'}</strong></span>
    </div>
    ${warningText ? `<p class="reference-image-warning">${warningText}</p>` : ''}
    <p class="reference-image-hint" data-ref-hint>${warp?.ok ? `${warp.mode} 보정 적용 중` : `기준점 ${warp?.minimumPoints || 2}개부터 보정할 수 있습니다.`}</p>
  `;
}

export function installReferenceImageController() {
  if (document.documentElement.dataset.referenceImageController === 'installed') return null;
  const mapElement = document.getElementById('map');
  if (!mapElement) return null;
  document.documentElement.dataset.referenceImageController = 'installed';

  const canvas = document.createElement('canvas');
  canvas.className = 'reference-image-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const overlay = mapElement.querySelector('.map-overlay-svg');
  if (overlay) mapElement.insertBefore(canvas, overlay);
  else mapElement.appendChild(canvas);
  const context = canvas.getContext('2d');

  const launcher = makeLauncher();
  const panel = makePanel();
  mapElement.append(launcher, panel);

  const fileInput = panel.querySelector('[data-ref-file]');
  const listElement = panel.querySelector('[data-ref-list]');
  const emptyElement = panel.querySelector('[data-ref-empty]');
  const editorElement = panel.querySelector('[data-ref-editor]');
  const records = [];
  let selectedId = '';
  let gcpState = null;
  let renderScheduled = false;
  let lastHostFingerprint = '';
  let disposed = false;

  const selected = () => records.find(record => record.id === selectedId) || null;

  function rebuildWarp(record) {
    record.warp = buildReferenceImageWarp(record.controlPoints, { mode: record.warpMode });
    record.mesh = record.warp.ok ? buildReferenceImageMesh(record.warp, MESH_QUALITY) : null;
    record.projectedMesh = null;
  }

  function persist(record) {
    const index = records.indexOf(record);
    if (index < 0 || !record.blob) return;
    putStoredReferenceImage(serializableRecord(record, index)).catch(error => console.warn('[reference-image-store]', error));
  }

  function requestRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function resizeCanvas() {
    const rect = mapElement.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width === width && canvas.height === height) return dpr;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    return dpr;
  }

  function projectedMesh(record, host) {
    if (!record.mesh) return null;
    const points = record.mesh.vertices.map(vertex => vertex.coordinate ? projectVisible(host, vertex.coordinate) : null);
    record.projectedMesh = points;
    return points;
  }

  function drawTriangle(record, destination, uv, dpr) {
    const source = uv.map(pair => {
      const u = record.flipX ? 1 - pair[0] : pair[0];
      const v = record.flipY ? 1 - pair[1] : pair[1];
      return [u * record.image.naturalWidth, v * record.image.naturalHeight];
    });
    const transform = affineForTriangles(source, destination);
    if (!transform) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.beginPath();
    context.moveTo(destination[0][0], destination[0][1]);
    context.lineTo(destination[1][0], destination[1][1]);
    context.lineTo(destination[2][0], destination[2][1]);
    context.closePath();
    context.clip();
    context.transform(...transform);
    context.drawImage(record.image, 0, 0);
    context.restore();
  }

  function drawWarped(record, host, dpr) {
    const projected = projectedMesh(record, host);
    if (!projected) return;
    context.save();
    context.globalAlpha = record.opacity;
    context.globalCompositeOperation = record.blendMode;
    for (const triangle of record.mesh.triangles) {
      const destination = triangle.map(index => projected[index]);
      if (destination.some(point => !point || !point.every(Number.isFinite))) continue;
      const uv = triangle.map(index => record.mesh.vertices[index].uv);
      drawTriangle(record, destination, uv, dpr);
    }
    context.restore();
  }

  function drawUnreferenced(record, dpr) {
    if (!record.screenRect) record.screenRect = defaultScreenRect(record.image, mapElement);
    const { x, y, width, height } = record.screenRect;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.globalAlpha = record.opacity;
    context.globalCompositeOperation = record.blendMode;
    context.translate(x + width / 2, y + height / 2);
    context.scale(record.flipX ? -1 : 1, record.flipY ? -1 : 1);
    context.drawImage(record.image, -width / 2, -height / 2, width, height);
    context.restore();
  }

  function drawControlPoints(record, host, dpr) {
    if (record.id !== selectedId || panel.hidden) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.lineWidth = 1.5;
    for (let index = 0; index < record.controlPoints.length; index += 1) {
      const point = record.controlPoints[index];
      const target = projectVisible(host, point.coordinate);
      const predictedCoordinate = record.warp?.ok ? record.warp.project(point.image) : null;
      const predicted = predictedCoordinate ? projectVisible(host, predictedCoordinate) : null;
      if (target && predicted && target.every(Number.isFinite) && predicted.every(Number.isFinite)) {
        context.beginPath();
        context.moveTo(predicted[0], predicted[1]);
        context.lineTo(target[0], target[1]);
        context.strokeStyle = 'rgba(255,255,255,.72)';
        context.stroke();
      }
      if (!target || !target.every(Number.isFinite)) continue;
      context.beginPath();
      context.arc(target[0], target[1], 4.5, 0, Math.PI * 2);
      context.fillStyle = 'rgba(79,140,255,.95)';
      context.fill();
      context.strokeStyle = 'rgba(255,255,255,.95)';
      context.stroke();
      context.fillStyle = 'rgba(255,255,255,.96)';
      context.font = '600 10px sans-serif';
      context.fillText(String(index + 1), target[0] + 7, target[1] - 7);
    }
    context.restore();
  }

  function render() {
    const dpr = resizeCanvas();
    context.clearRect(0, 0, canvas.width, canvas.height);
    const host = mapHost();
    for (const record of records) {
      if (!record.visible || !record.image) continue;
      if (record.warp?.ok && host) drawWarped(record, host, dpr);
      else drawUnreferenced(record, dpr);
    }
    if (host) {
      const record = selected();
      if (record) drawControlPoints(record, host, dpr);
    }
  }

  function hitTestUv(record, point) {
    if (!record.warp?.ok || !record.mesh || !record.projectedMesh) {
      const rect = record.screenRect;
      if (!rect || point[0] < rect.x || point[0] > rect.x + rect.width || point[1] < rect.y || point[1] > rect.y + rect.height) return null;
      return [clamp((point[0] - rect.x) / rect.width, 0, 1), clamp((point[1] - rect.y) / rect.height, 0, 1)];
    }
    for (const triangle of record.mesh.triangles) {
      const destination = triangle.map(index => record.projectedMesh[index]);
      if (destination.some(candidate => !candidate)) continue;
      const weights = barycentric(point, destination);
      if (!weights) continue;
      const uv = triangle.map(index => record.mesh.vertices[index].uv);
      return [
        weights[0] * uv[0][0] + weights[1] * uv[1][0] + weights[2] * uv[2][0],
        weights[0] * uv[0][1] + weights[1] * uv[1][1] + weights[2] * uv[2][1],
      ];
    }
    return null;
  }

  function setHint(text, tone = '') {
    const hint = editorElement.querySelector('[data-ref-hint]');
    if (!hint) return;
    hint.textContent = text;
    hint.dataset.tone = tone;
  }

  function renderList() {
    listElement.replaceChildren();
    emptyElement.hidden = records.length > 0;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'reference-image-list-row';
      row.dataset.referenceImageId = record.id;
      if (record.id === selectedId) row.classList.add('is-selected');
      row.innerHTML = `<span>${record.visible ? '◉' : '○'}</span><strong></strong><small>${record.controlPoints.length}점</small>`;
      row.querySelector('strong').textContent = record.name;
      listElement.appendChild(row);
    }
  }

  function renderEditor() {
    const record = selected();
    editorElement.hidden = !record;
    if (!record) {
      editorElement.replaceChildren();
      return;
    }
    editorElement.innerHTML = editorMarkup(record, record.warp);
  }

  function refreshUi() {
    renderList();
    renderEditor();
    requestRender();
  }

  async function addBlob(blob, name, persisted = null) {
    if (!(blob instanceof Blob) || !ACCEPTED_IMAGE_TYPES.has(blob.type)) throw new Error('PNG, JPG, WebP 이미지만 사용할 수 있습니다.');
    const decoded = await createImageFromBlob(blob);
    const source = normalizePersistedRecord(persisted || {});
    const record = {
      ...source,
      id: persisted?.id || createId(),
      name: String(persisted?.name || name || '참조 이미지'),
      blob,
      image: decoded.image,
      objectUrl: decoded.url,
      screenRect: source.screenRect || defaultScreenRect(decoded.image, mapElement),
      warp: null,
      mesh: null,
      projectedMesh: null,
    };
    rebuildWarp(record);
    records.push(record);
    selectedId = record.id;
    persist(record);
    refreshUi();
    return record;
  }

  async function removeRecord(record) {
    const index = records.indexOf(record);
    if (index < 0) return;
    records.splice(index, 1);
    if (record.objectUrl) URL.revokeObjectURL(record.objectUrl);
    await deleteStoredReferenceImage(record.id).catch(error => console.warn('[reference-image-store]', error));
    selectedId = records.at(-1)?.id || '';
    gcpState = null;
    refreshUi();
  }

  function reorderPersisted() {
    records.forEach(record => persist(record));
  }

  function armGcp(record) {
    if (!record || record.locked) return;
    gcpState = { recordId: record.id, step: 'image', image: null };
    mapElement.classList.add('is-reference-gcp-mode');
    setHint('1/2 · 이미지에서 맞출 지점을 선택하세요.', 'working');
  }

  function cancelGcp() {
    gcpState = null;
    mapElement.classList.remove('is-reference-gcp-mode');
    const record = selected();
    if (record) renderEditor();
  }

  function onMapPointerDown(event) {
    if (!gcpState || event.button !== 0) return;
    const record = records.find(candidate => candidate.id === gcpState.recordId);
    if (!record || record.locked) {
      cancelGcp();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = canvasPoint(event, mapElement);
    if (gcpState.step === 'image') {
      const uv = hitTestUv(record, point);
      if (!uv) {
        setHint('이미지가 보이는 영역 안을 선택하세요.', 'error');
        return;
      }
      gcpState.image = uv;
      gcpState.step = 'map';
      setHint('2/2 · 같은 지점의 실제 지도 위치를 선택하세요.', 'working');
      return;
    }
    const host = mapHost();
    const coordinate = host?.unproject(point);
    if (!coordinate || !coordinate.every(Number.isFinite)) {
      setHint('이 위치에서는 지도 좌표를 계산할 수 없습니다.', 'error');
      return;
    }
    record.controlPoints.push({
      id: `gcp-${Date.now().toString(36)}`,
      image: [...gcpState.image],
      coordinate: [coordinate[0], coordinate[1]],
    });
    rebuildWarp(record);
    persist(record);
    gcpState = { recordId: record.id, step: 'image', image: null };
    refreshUi();
    setHint('기준점을 추가했습니다. 계속 추가하거나 Esc로 종료하세요.', 'success');
  }

  function onEditorInput(event) {
    const record = selected();
    if (!record) return;
    const field = event.target?.dataset?.refField;
    if (!field) return;
    if (field === 'name') record.name = event.target.value || '참조 이미지';
    if (field === 'opacity') record.opacity = clamp(Number(event.target.value), 0, 1);
    if (field === 'blend') record.blendMode = event.target.value;
    if (field === 'warp') {
      record.warpMode = event.target.value;
      rebuildWarp(record);
    }
    if (field === 'visible') record.visible = event.target.checked;
    if (field === 'locked') {
      record.locked = event.target.checked;
      if (record.locked) cancelGcp();
    }
    persist(record);
    if (field === 'name' || field === 'visible') renderList();
    if (field === 'opacity') {
      const output = event.target.parentElement?.querySelector('output');
      if (output) output.textContent = `${Math.round(record.opacity * 100)}%`;
    }
    requestRender();
  }

  async function onPanelClick(event) {
    const action = event.target.closest('[data-ref-action]')?.dataset.refAction;
    if (!action) {
      const row = event.target.closest('[data-reference-image-id]');
      if (row) {
        selectedId = row.dataset.referenceImageId;
        refreshUi();
      }
      return;
    }
    const record = selected();
    if (action === 'close') {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      cancelGcp();
      requestRender();
      return;
    }
    if (action === 'add') {
      fileInput.click();
      return;
    }
    if (!record) return;
    if (action === 'delete') await removeRecord(record);
    if (action === 'gcp') armGcp(record);
    if (action === 'undo-gcp' && record.controlPoints.length) {
      record.controlPoints.pop();
      rebuildWarp(record);
      persist(record);
      refreshUi();
    }
    if (action === 'clear-gcp' && record.controlPoints.length) {
      record.controlPoints = [];
      rebuildWarp(record);
      persist(record);
      refreshUi();
    }
    if (action === 'flip-x' || action === 'flip-y') {
      if (action === 'flip-x') record.flipX = !record.flipX;
      else record.flipY = !record.flipY;
      if (record.controlPoints.length) {
        record.controlPoints = [];
        rebuildWarp(record);
      }
      persist(record);
      refreshUi();
    }
  }

  launcher.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) cancelGcp();
    requestRender();
  });
  panel.addEventListener('click', event => void onPanelClick(event));
  editorElement.addEventListener('input', onEditorInput);
  editorElement.addEventListener('change', onEditorInput);
  mapElement.addEventListener('pointerdown', onMapPointerDown, true);
  globalThis.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gcpState) cancelGcp();
  });
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    for (const file of files) {
      try {
        await addBlob(file, file.name);
      } catch (error) {
        console.warn('[reference-image-add]', error);
      }
    }
  });

  new ResizeObserver(requestRender).observe(mapElement);

  function monitorHost() {
    if (disposed) return;
    const host = mapHost();
    if (host && records.some(record => record.visible && record.warp?.ok)) {
      const fingerprint = `${host.getProjectionKind?.() || ''}|${JSON.stringify(host.getViewState?.() || null)}`;
      if (fingerprint !== lastHostFingerprint) {
        lastHostFingerprint = fingerprint;
        requestRender();
      }
    }
    requestAnimationFrame(monitorHost);
  }
  requestAnimationFrame(monitorHost);

  listStoredReferenceImages()
    .then(async values => {
      const ordered = [...values].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      for (const value of ordered) {
        if (!value?.blob) continue;
        try {
          await addBlob(value.blob, value.name, value);
        } catch (error) {
          console.warn('[reference-image-restore]', error);
        }
      }
      reorderPersisted();
      refreshUi();
    })
    .catch(error => console.warn('[reference-image-store]', error));

  const api = Object.freeze({
    list: () => records.map(record => ({
      id: record.id,
      name: record.name,
      visible: record.visible,
      warpMode: record.warp?.mode || record.warpMode,
      controlPointCount: record.controlPoints.length,
      diagnostics: record.warp?.ok ? record.warp.diagnostics : null,
    })),
    open: () => {
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
    },
    close: () => {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      cancelGcp();
    },
    requestRender,
    destroy: () => {
      disposed = true;
      records.forEach(record => record.objectUrl && URL.revokeObjectURL(record.objectUrl));
      canvas.remove();
      panel.remove();
      launcher.remove();
      document.documentElement.dataset.referenceImageController = '';
    },
  });
  globalThis.__PANDOLAB_REFERENCE_IMAGES__ = api;
  refreshUi();
  return api;
}
