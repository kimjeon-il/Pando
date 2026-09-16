import { referenceImageKeyBlocked } from './reference-image-input.js';
import {
  buildReferenceImageMesh,
  buildReferenceImageWarp,
} from './reference-image-georef.js';
import {
  getReferenceImageGradientField,
  referenceImagePixelsToCoordinates,
  refineReferenceImageLine,
} from './reference-image-line-refiner.js';
import { listStoredReferenceImages } from './reference-image-store.js';

const MESH_QUALITY = Object.freeze({ columns: 24, rows: 16 });
const HOST_ACTIVE_POLL_MS = 34;
const HOST_IDLE_POLL_MS = 240;
const SAMPLE_DISTANCE_SQUARED = 4;
const LINE_REFINER_OPTIONS = Object.freeze({
  maxDimension: 1024,
  corridorRadius: 12,
  simplifyTolerance: 1.5,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const squaredDistance = (left, right) => {
  const dx = Number(left[0]) - Number(right[0]);
  const dy = Number(left[1]) - Number(right[1]);
  return dx * dx + dy * dy;
};

function mapHost() {
  return globalThis.__PANDOLAB_MAP_HOST__ || null;
}

function angularDistanceDegrees(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const factor = Math.PI / 180;
  const lonA = a[0] * factor;
  const latA = a[1] * factor;
  const lonB = b[0] * factor;
  const latB = b[1] * factor;
  const dot = Math.sin(latA) * Math.sin(latB) + Math.cos(latA) * Math.cos(latB) * Math.cos(lonA - lonB);
  return Math.acos(clamp(dot, -1, 1)) / factor;
}

function projectVisible(host, coordinate) {
  const projected = host?.project?.(coordinate);
  if (!projected || !projected.every(Number.isFinite)) return null;
  if (host.getProjectionKind?.() !== 'globe') return projected;
  const roundTrip = host.unproject?.(projected);
  return angularDistanceDegrees(coordinate, roundTrip) <= 0.25 ? projected : null;
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

function createImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('참조 이미지를 분석용으로 읽을 수 없습니다.'));
    };
    image.src = objectUrl;
  });
}

function publicRecordMeta(recordId) {
  return globalThis.__PANDOLAB_REFERENCE_IMAGES__?.list?.()
    ?.find(record => String(record.id) === String(recordId)) || null;
}

function selectedRecordId(panel) {
  return panel.querySelector('.reference-image-list-row.is-selected')?.dataset.referenceImageId || '';
}

function canvasPoint(event, mapElement) {
  const rect = mapElement.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function failureMessage(reason) {
  if (reason === 'insufficient-edge-strength') return '주변 경계가 충분히 선명하지 않습니다. 경계에 더 가깝게 다시 그려주세요.';
  if (reason === 'too-few-points') return '보강할 선을 조금 더 길게 그려주세요.';
  if (reason === 'path-not-found') return '대략 선 주변에서 이어지는 경계를 찾지 못했습니다. 탐색 범위 안에 들도록 다시 그려주세요.';
  return '선 보강에 실패했습니다. 대략 선을 다시 그려주세요.';
}

export function installReferenceImageLineRefiner() {
  if (document.documentElement.dataset.referenceImageLineRefiner === 'installed') {
    return globalThis.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__ || null;
  }
  const mapElement = document.getElementById('map');
  const panel = document.querySelector('.reference-image-panel');
  const editor = panel?.querySelector('[data-ref-editor]');
  if (!mapElement || !panel || !editor) return null;
  document.documentElement.dataset.referenceImageLineRefiner = 'installed';

  const canvas = document.createElement('canvas');
  canvas.className = 'reference-image-canvas reference-image-line-refine-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const mapOverlay = mapElement.querySelector('.map-overlay-svg');
  if (mapOverlay) mapElement.insertBefore(canvas, mapOverlay);
  else mapElement.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('선 보강 미리보기 Canvas를 만들 수 없습니다.');

  const imageCache = new Map();
  let state = null;
  let lastMessage = '';
  let lastTone = '';
  let disposed = false;
  let renderScheduled = false;
  let monitorTimer = 0;
  let lastHostFingerprint = '';
  let syncScheduled = false;

  function resizeCanvas() {
    const rect = mapElement.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    return dpr;
  }

  function strokePolyline(points, dpr, { width, style, dash = [] } = {}) {
    if (!points?.length) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = width;
    context.strokeStyle = style;
    context.setLineDash(dash);
    let drawing = false;
    context.beginPath();
    for (const point of points) {
      if (!point) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        context.moveTo(point[0], point[1]);
        drawing = true;
      } else context.lineTo(point[0], point[1]);
    }
    context.stroke();
    context.restore();
  }

  function render() {
    const dpr = resizeCanvas();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    if (state.phase === 'drawing' && state.roughScreenPoints.length) {
      strokePolyline(state.roughScreenPoints, dpr, { width: 5, style: 'rgba(255,255,255,.9)' });
      strokePolyline(state.roughScreenPoints, dpr, { width: 2, style: 'rgba(79,140,255,.98)', dash: [6, 4] });
    }
    if (state.phase === 'preview' && state.previewCoordinates.length) {
      const host = mapHost();
      const points = state.previewCoordinates.map(coordinate => projectVisible(host, coordinate));
      strokePolyline(points, dpr, { width: 6, style: 'rgba(255,255,255,.92)' });
      strokePolyline(points, dpr, { width: 3, style: 'rgba(79,140,255,1)' });
    }
  }

  function requestRender() {
    if (renderScheduled || disposed) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (!disposed) render();
    });
  }

  function setMessage(message, tone = '') {
    lastMessage = String(message || '');
    lastTone = tone;
    const hint = editor.querySelector('[data-ref-hint]');
    if (hint && lastMessage) {
      hint.textContent = lastMessage;
      hint.dataset.tone = lastTone;
    }
  }

  function ensureActionRow() {
    let row = editor.querySelector('[data-ref-line-actions]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'reference-image-gcp-actions reference-image-line-refine-actions';
      row.dataset.refLineActions = '';
      row.innerHTML = `
        <button type="button" class="ui-button ui-button--primary" data-ref-line-action="start">선 보강</button>
        <button type="button" class="ui-button ui-button--primary" data-ref-line-action="apply" hidden>적용</button>
        <button type="button" class="ui-button" data-ref-line-action="redraw" hidden>다시 그리기</button>
        <button type="button" class="ui-button" data-ref-line-action="cancel" hidden>취소</button>
      `;
      const gcpActions = editor.querySelector('.reference-image-gcp-actions');
      if (gcpActions) gcpActions.insertAdjacentElement('afterend', row);
      else editor.appendChild(row);
    }
    return row;
  }

  function cancelRefine({ message = '', tone = '' } = {}) {
    state = null;
    mapElement.classList.remove('is-reference-line-refine-mode');
    if (message) {
      lastMessage = message;
      lastTone = tone;
    }
    requestRender();
    scheduleSync();
  }

  function syncUi() {
    syncScheduled = false;
    if (disposed || editor.hidden) return;
    const recordId = selectedRecordId(panel);
    const meta = recordId ? publicRecordMeta(recordId) : null;
    if (state && (!recordId || recordId !== state.recordId)) {
      cancelRefine();
      return;
    }
    const warpReady = !!meta?.diagnostics;
    if (state && (meta?.locked || !warpReady)) {
      cancelRefine({
        message: meta?.locked ? '잠금을 해제한 뒤 선 보강을 사용할 수 있습니다.' : '기준점 보정이 완료된 이미지에서만 선 보강을 사용할 수 있습니다.',
        tone: 'error',
      });
      return;
    }
    const row = ensureActionRow();
    const start = row.querySelector('[data-ref-line-action="start"]');
    const apply = row.querySelector('[data-ref-line-action="apply"]');
    const redraw = row.querySelector('[data-ref-line-action="redraw"]');
    const cancel = row.querySelector('[data-ref-line-action="cancel"]');
    const active = !!state && state.recordId === recordId;
    start.hidden = active;
    start.disabled = !meta || meta.locked || !warpReady || mapElement.classList.contains('is-reference-gcp-mode') || mapElement.classList.contains('is-reference-placement-mode') || mapElement.classList.contains('is-reference-live-wire-mode');
    apply.hidden = !active || state.phase !== 'preview';
    redraw.hidden = !active || state.phase !== 'preview';
    cancel.hidden = !active;
    const gcpButton = editor.querySelector('[data-ref-action="gcp"]');
    if (gcpButton) gcpButton.disabled = !!meta?.locked || active || mapElement.classList.contains('is-reference-live-wire-mode');
    if (lastMessage) setMessage(lastMessage, lastTone);
  }

  function scheduleSync() {
    if (syncScheduled || disposed) return;
    syncScheduled = true;
    queueMicrotask(syncUi);
  }

  async function cachedImage(record) {
    const signature = `${record.blob?.type || ''}:${record.blob?.size || 0}`;
    const cached = imageCache.get(record.id);
    if (cached?.signature === signature) return cached;
    if (cached?.objectUrl) URL.revokeObjectURL(cached.objectUrl);
    const decoded = await createImageFromBlob(record.blob);
    const next = { ...decoded, signature };
    imageCache.set(record.id, next);
    return next;
  }

  async function loadSource(recordId) {
    let stored = (await listStoredReferenceImages()).find(record => String(record?.id) === String(recordId));
    const meta = publicRecordMeta(recordId);
    if (!stored?.blob) throw new Error('저장된 참조 이미지를 찾을 수 없습니다.');
    if (meta && Array.isArray(stored.controlPoints) && stored.controlPoints.length !== Number(meta.controlPointCount || 0)) {
      await new Promise(resolve => globalThis.setTimeout(resolve, 32));
      stored = (await listStoredReferenceImages()).find(record => String(record?.id) === String(recordId)) || stored;
    }
    if (meta?.locked || stored.locked) throw new Error('잠금을 해제한 뒤 선 보강을 사용할 수 있습니다.');
    const warp = buildReferenceImageWarp(stored.controlPoints || [], { mode: stored.warpMode });
    if (!warp.ok) throw new Error('기준점 보정을 완료한 뒤 선 보강을 사용할 수 있습니다.');
    const decoded = await cachedImage(stored);
    return {
      id: String(recordId),
      image: decoded.image,
      warp,
      mesh: buildReferenceImageMesh(warp, MESH_QUALITY),
      sourceWidth: Number(decoded.image.naturalWidth || 0),
      sourceHeight: Number(decoded.image.naturalHeight || 0),
    };
  }

  function localHitTestUv(source, point) {
    const host = mapHost();
    if (!source?.mesh || !host) return null;
    const projected = source.mesh.vertices.map(vertex => vertex.coordinate ? projectVisible(host, vertex.coordinate) : null);
    for (const triangle of source.mesh.triangles) {
      const destination = triangle.map(index => projected[index]);
      if (destination.some(candidate => !candidate)) continue;
      const weights = barycentric(point, destination);
      if (!weights) continue;
      const uv = triangle.map(index => source.mesh.vertices[index].uv);
      return [
        weights[0] * uv[0][0] + weights[1] * uv[1][0] + weights[2] * uv[2][0],
        weights[0] * uv[0][1] + weights[1] * uv[1][1] + weights[2] * uv[2][1],
      ];
    }
    return null;
  }

  function hitTestUv(source, point) {
    const shared = globalThis.__PANDOLAB_REFERENCE_IMAGE_HIT_TEST_UV__;
    const uv = typeof shared === 'function' ? shared(source.id, point) : null;
    return uv?.every(Number.isFinite) ? uv : localHitTestUv(source, point);
  }

  function appendSample(event, force = false) {
    if (!state?.source) return false;
    const screen = canvasPoint(event, mapElement);
    if (!force && state.roughScreenPoints.length && squaredDistance(state.roughScreenPoints.at(-1), screen) < SAMPLE_DISTANCE_SQUARED) return false;
    const uv = hitTestUv(state.source, screen);
    if (!uv) return false;
    const pixel = [
      clamp(uv[0], 0, 1) * Math.max(1, state.source.sourceWidth - 1),
      clamp(uv[1], 0, 1) * Math.max(1, state.source.sourceHeight - 1),
    ];
    state.roughScreenPoints.push(screen);
    state.roughImagePoints.push(pixel);
    requestRender();
    return true;
  }

  async function startRefine(recordId) {
    if (state) cancelRefine();
    if (mapElement.classList.contains('is-reference-gcp-mode') || mapElement.classList.contains('is-reference-placement-mode')) {
      setMessage('기준점 추가 또는 배치 편집을 먼저 종료한 뒤 선 보강을 시작하세요.', 'error');
      return false;
    }
    state = { recordId, phase: 'loading', source: null, pointerId: null, roughScreenPoints: [], roughImagePoints: [], previewCoordinates: [] };
    mapElement.classList.add('is-reference-line-refine-mode');
    setMessage('참조 이미지의 경계 정보를 준비하고 있습니다.', 'working');
    scheduleSync();
    try {
      const source = await loadSource(recordId);
      if (!state || state.recordId !== recordId) return false;
      state.source = source;
      state.phase = 'armed';
      setMessage('참조 이미지의 경계를 따라 대략 드래그하세요. 주변의 강한 선으로 자동 보강합니다.', 'working');
      scheduleSync();
      return true;
    } catch (error) {
      cancelRefine({ message: error?.message || '선 보강을 준비하지 못했습니다.', tone: 'error' });
      return false;
    }
  }

  async function finishDrawing(event) {
    if (!state || state.phase !== 'drawing') return false;
    appendSample(event, true);
    state.pointerId = null;
    if (state.roughImagePoints.length < 2) {
      state.phase = 'armed';
      state.roughScreenPoints = [];
      state.roughImagePoints = [];
      setMessage('보강할 선을 조금 더 길게 그려주세요.', 'error');
      requestRender();
      scheduleSync();
      return false;
    }
    const expectedState = state;
    state.phase = 'analyzing';
    setMessage('이미지 경계를 분석해 선을 보강하고 있습니다.', 'working');
    scheduleSync();
    requestRender();
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (state !== expectedState) return false;
    try {
      const field = getReferenceImageGradientField(state.source.image, { maxDimension: LINE_REFINER_OPTIONS.maxDimension });
      const result = refineReferenceImageLine({
        field,
        roughPoints: state.roughImagePoints,
        corridorRadius: LINE_REFINER_OPTIONS.corridorRadius,
        simplifyTolerance: LINE_REFINER_OPTIONS.simplifyTolerance,
      });
      if (!result.ok) {
        state.phase = 'armed';
        state.roughScreenPoints = [];
        state.roughImagePoints = [];
        setMessage(failureMessage(result.reason), 'error');
        requestRender();
        scheduleSync();
        return false;
      }
      state.previewCoordinates = referenceImagePixelsToCoordinates(result.points, {
        sourceWidth: state.source.sourceWidth,
        sourceHeight: state.source.sourceHeight,
        warp: state.source.warp,
      });
      state.phase = 'preview';
      state.roughScreenPoints = [];
      setMessage(`선 보강 결과 ${result.simplifiedPointCount}개 점 · 적용하거나 다시 그릴 수 있습니다.`, 'success');
      requestRender();
      scheduleSync();
      return true;
    } catch (error) {
      state.phase = 'armed';
      state.roughScreenPoints = [];
      state.roughImagePoints = [];
      setMessage(error?.message || '선 보강 중 오류가 발생했습니다.', 'error');
      requestRender();
      scheduleSync();
      return false;
    }
  }

  function redraw() {
    if (!state) return false;
    state.phase = 'armed';
    state.pointerId = null;
    state.roughScreenPoints = [];
    state.roughImagePoints = [];
    state.previewCoordinates = [];
    setMessage('경계를 따라 대략 선을 다시 드래그하세요.', 'working');
    requestRender();
    scheduleSync();
    return true;
  }

  function applyPreview() {
    if (!state || state.phase !== 'preview' || state.previewCoordinates.length < 2) return false;
    const bridge = globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
    if (!bridge?.isDraftActive?.()) {
      setMessage('먼저 지도 편집 도구를 켠 뒤 적용하세요. 보강 결과는 그대로 유지됩니다.', 'error');
      return false;
    }
    const applied = bridge.applyDraftCoordinates?.(state.previewCoordinates) === true;
    if (!applied) {
      setMessage('현재 편집선에 보강 결과를 적용하지 못했습니다. 편집 상태를 확인하세요.', 'error');
      return false;
    }
    cancelRefine({ message: '보강선을 현재 편집 draft에 적용했습니다.', tone: 'success' });
    return true;
  }

  function intercept(event) {
    if (!state || !['armed', 'drawing'].includes(state.phase)) return false;
    if (!mapElement.contains(event.target)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  function onPointerDown(event) {
    if (!state || state.phase !== 'armed' || event.button !== 0 || !mapElement.contains(event.target)) return;
    if (!intercept(event)) return;
    const screen = canvasPoint(event, mapElement);
    const uv = hitTestUv(state.source, screen);
    if (!uv) {
      setMessage('보정된 참조 이미지가 보이는 영역에서 드래그를 시작하세요.', 'error');
      return;
    }
    state.phase = 'drawing';
    state.pointerId = event.pointerId;
    state.roughScreenPoints = [];
    state.roughImagePoints = [];
    appendSample(event, true);
    try { mapElement.setPointerCapture?.(event.pointerId); } catch (_) {}
    setMessage('대략 선을 그리는 중입니다. 경계를 따라 끝까지 드래그하세요.', 'working');
    scheduleSync();
  }

  function onPointerMove(event) {
    if (!state || state.phase !== 'drawing' || event.pointerId !== state.pointerId) return;
    if (!intercept(event)) return;
    appendSample(event);
  }

  function onPointerUp(event) {
    if (!state || state.phase !== 'drawing' || event.pointerId !== state.pointerId) return;
    if (!intercept(event)) return;
    try { mapElement.releasePointerCapture?.(event.pointerId); } catch (_) {}
    void finishDrawing(event);
  }

  function onPointerCancel(event) {
    if (!state || state.phase !== 'drawing' || event.pointerId !== state.pointerId) return;
    if (!intercept(event)) return;
    redraw();
  }

  function onPanelClick(event) {
    const action = event.target.closest('[data-ref-line-action]')?.dataset.refLineAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const recordId = selectedRecordId(panel);
    if (action === 'start' && recordId) void startRefine(recordId);
    if (action === 'apply') applyPreview();
    if (action === 'redraw') redraw();
    if (action === 'cancel') cancelRefine({ message: '선 보강을 취소했습니다.' });
  }

  function onKeyDown(event) {
    if (referenceImageKeyBlocked(event)) return;
    if (event.key !== 'Escape' || !state) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelRefine({ message: '선 보강을 취소했습니다.' });
  }

  function monitorHost() {
    if (disposed) return;
    if (state?.phase === 'preview') {
      const host = mapHost();
      const fingerprint = `${host?.getProjectionKind?.() || ''}|${JSON.stringify(host?.getViewState?.() || null)}`;
      if (fingerprint !== lastHostFingerprint) {
        lastHostFingerprint = fingerprint;
        requestRender();
      }
    }
    monitorTimer = globalThis.setTimeout(monitorHost, state ? HOST_ACTIVE_POLL_MS : HOST_IDLE_POLL_MS);
  }

  const observer = new MutationObserver(() => {
    if (panel.hidden && state) cancelRefine();
    else scheduleSync();
  });
  // Watch host changes, not the button attributes written by either image tool.
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(editor, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  observer.observe(mapElement, { attributes: true, attributeFilter: ['class'] });
  const resizeObserver = new ResizeObserver(requestRender);
  resizeObserver.observe(mapElement);

  panel.addEventListener('click', onPanelClick, true);
  globalThis.addEventListener('pointerdown', onPointerDown, true);
  globalThis.addEventListener('pointermove', onPointerMove, true);
  globalThis.addEventListener('pointerup', onPointerUp, true);
  globalThis.addEventListener('pointercancel', onPointerCancel, true);
  globalThis.addEventListener('keydown', onKeyDown, true);
  monitorHost();
  scheduleSync();

  const api = Object.freeze({
    active: () => !!state,
    phase: () => state?.phase || 'idle',
    cancel: () => cancelRefine(),
    requestRender,
    destroy() {
      if (disposed) return;
      disposed = true;
      state = null;
      globalThis.clearTimeout(monitorTimer);
      observer.disconnect();
      resizeObserver.disconnect();
      panel.removeEventListener('click', onPanelClick, true);
      globalThis.removeEventListener('pointerdown', onPointerDown, true);
      globalThis.removeEventListener('pointermove', onPointerMove, true);
      globalThis.removeEventListener('pointerup', onPointerUp, true);
      globalThis.removeEventListener('pointercancel', onPointerCancel, true);
      globalThis.removeEventListener('keydown', onKeyDown, true);
      for (const cached of imageCache.values()) if (cached.objectUrl) URL.revokeObjectURL(cached.objectUrl);
      imageCache.clear();
      canvas.remove();
      mapElement.classList.remove('is-reference-line-refine-mode');
      document.documentElement.dataset.referenceImageLineRefiner = '';
      if (globalThis.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__ === api) delete globalThis.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__;
    },
  });

  globalThis.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__ = api;
  return api;
}
