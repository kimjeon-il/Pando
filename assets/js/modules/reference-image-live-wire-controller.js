import { referenceImageKeyBlocked } from './reference-image-input.js';
import {
  buildReferenceImageMesh,
  buildReferenceImageWarp,
} from './reference-image-georef.js';
import { referenceImagePixelsToCoordinates } from './reference-image-line-refiner.js';
import {
  analysisPointFromUv,
  buildLiveWireTree,
  getReferenceImageLiveWireField,
  simplifyLiveWireSegments,
  snapLiveWireAnchor,
  sourcePixelsFromAnalysis,
  traceLiveWirePath,
} from './reference-image-live-wire.js';
import { listStoredReferenceImages } from './reference-image-store.js';

const MESH_QUALITY = Object.freeze({ columns: 24, rows: 16 });
const HOST_ACTIVE_POLL_MS = 34;
const HOST_IDLE_POLL_MS = 240;
const TREE_REBUILD_DISTANCE_SQUARED = 40 * 40;
const LIVE_WIRE_OPTIONS = Object.freeze({
  maxDimension: 1024,
  snapRadius: 8,
  searchRadius: 256,
  simplifyTolerance: 1.5,
  corridorWeight: 0.08,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const squaredDistance = (left, right) => {
  const dx = Number(left?.[0]) - Number(right?.[0]);
  const dy = Number(left?.[1]) - Number(right?.[1]);
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
      reject(new Error('참조 이미지를 자동 추적용으로 읽을 수 없습니다.'));
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
  if (reason === 'insufficient-edge-strength') return '이 구간의 경계가 너무 약합니다. 더 선명한 경계 가까이에 점을 지정하세요.';
  if (reason === 'target-outside-tree') return '현재 탐색 범위를 벗어났습니다. 커서를 조금 가까운 곳으로 옮겨주세요.';
  if (reason === 'path-not-found') return '현재 점까지 이어지는 경계를 찾지 못했습니다. 다른 위치를 지정하세요.';
  return '자동 추적 경로를 만들지 못했습니다. 다른 위치를 지정하세요.';
}

export function installReferenceImageLiveWire() {
  if (document.documentElement.dataset.referenceImageLiveWire === 'installed') {
    return globalThis.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__ || null;
  }
  const mapElement = document.getElementById('map');
  const panel = document.querySelector('.reference-image-panel');
  const editor = panel?.querySelector('[data-ref-editor]');
  if (!mapElement || !panel || !editor) return null;
  document.documentElement.dataset.referenceImageLiveWire = 'installed';

  const canvas = document.createElement('canvas');
  canvas.className = 'reference-image-canvas reference-image-live-wire-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const mapOverlay = mapElement.querySelector('.map-overlay-svg');
  if (mapOverlay) mapElement.insertBefore(canvas, mapOverlay);
  else mapElement.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('자동 추적 미리보기 Canvas를 만들 수 없습니다.');

  const imageCache = new Map();
  let state = null;
  let disposed = false;
  let renderScheduled = false;
  let previewScheduled = false;
  let pendingPointer = null;
  let syncScheduled = false;
  let monitorTimer = 0;
  let lastHostFingerprint = '';
  let lastMessage = '';
  let lastTone = '';

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
    context.beginPath();
    let drawing = false;
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

  function drawAnchors(points, dpr) {
    if (!points?.length) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const point of points) {
      if (!point) continue;
      context.beginPath();
      context.arc(point[0], point[1], 4.5, 0, Math.PI * 2);
      context.fillStyle = 'rgba(255,255,255,.98)';
      context.fill();
      context.beginPath();
      context.arc(point[0], point[1], 2.5, 0, Math.PI * 2);
      context.fillStyle = 'rgba(79,140,255,1)';
      context.fill();
    }
    context.restore();
  }

  function analysisPathToCoordinates(points) {
    if (!state?.source || !state?.field || !points?.length) return [];
    const sourcePixels = sourcePixelsFromAnalysis(state.field, points);
    return referenceImagePixelsToCoordinates(sourcePixels, {
      sourceWidth: state.source.sourceWidth,
      sourceHeight: state.source.sourceHeight,
      warp: state.source.warp,
    });
  }

  function analysisPathToScreen(points) {
    const host = mapHost();
    return analysisPathToCoordinates(points).map(coordinate => projectVisible(host, coordinate));
  }

  function render() {
    const dpr = resizeCanvas();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    for (const segment of state.segments || []) {
      const points = analysisPathToScreen(segment);
      strokePolyline(points, dpr, { width: 6, style: 'rgba(255,255,255,.94)' });
      strokePolyline(points, dpr, { width: 3, style: 'rgba(79,140,255,1)' });
    }
    if (state.phase === 'tracking' && state.previewPoints?.length) {
      const points = analysisPathToScreen(state.previewPoints);
      strokePolyline(points, dpr, { width: 5, style: 'rgba(255,255,255,.9)' });
      strokePolyline(points, dpr, { width: 2.5, style: 'rgba(79,140,255,.98)', dash: [7, 4] });
    }
    if (state.phase === 'preview' && state.previewCoordinates?.length) {
      const points = state.previewCoordinates.map(coordinate => projectVisible(mapHost(), coordinate));
      strokePolyline(points, dpr, { width: 6, style: 'rgba(255,255,255,.94)' });
      strokePolyline(points, dpr, { width: 3, style: 'rgba(79,140,255,1)' });
    }
    const anchorScreens = (state.anchors || []).map(anchor => analysisPathToScreen([anchor])[0]);
    drawAnchors(anchorScreens, dpr);
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
    let row = editor.querySelector('[data-ref-live-wire-actions]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'reference-image-gcp-actions reference-image-live-wire-actions';
      row.dataset.refLiveWireActions = '';
      row.innerHTML = `
        <button type="button" class="ui-button ui-button--primary" data-ref-live-wire-action="start">자동 추적</button>
        <button type="button" class="ui-button ui-button--primary" data-ref-live-wire-action="finish" hidden>완료</button>
        <button type="button" class="ui-button" data-ref-live-wire-action="undo" hidden>마지막 점 취소</button>
        <button type="button" class="ui-button ui-button--primary" data-ref-live-wire-action="apply" hidden>적용</button>
        <button type="button" class="ui-button" data-ref-live-wire-action="redraw" hidden>다시 그리기</button>
        <button type="button" class="ui-button" data-ref-live-wire-action="cancel" hidden>취소</button>
      `;
      const lineActions = editor.querySelector('[data-ref-line-actions]');
      const gcpActions = editor.querySelector('.reference-image-gcp-actions');
      if (lineActions) lineActions.insertAdjacentElement('afterend', row);
      else if (gcpActions) gcpActions.insertAdjacentElement('afterend', row);
      else editor.appendChild(row);
    }
    return row;
  }

  function scheduleSync() {
    if (syncScheduled || disposed) return;
    syncScheduled = true;
    queueMicrotask(syncUi);
  }

  function cancelLiveWire({ message = '', tone = '' } = {}) {
    state = null;
    pendingPointer = null;
    mapElement.classList.remove('is-reference-live-wire-mode');
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
      cancelLiveWire();
      return;
    }
    const warpReady = !!meta?.diagnostics;
    if (state && (meta?.locked || !warpReady)) {
      cancelLiveWire({
        message: meta?.locked ? '잠금을 해제한 뒤 자동 추적을 사용할 수 있습니다.' : '기준점 보정이 완료된 이미지에서만 자동 추적을 사용할 수 있습니다.',
        tone: 'error',
      });
      return;
    }
    const row = ensureActionRow();
    const start = row.querySelector('[data-ref-live-wire-action="start"]');
    const finish = row.querySelector('[data-ref-live-wire-action="finish"]');
    const undo = row.querySelector('[data-ref-live-wire-action="undo"]');
    const apply = row.querySelector('[data-ref-live-wire-action="apply"]');
    const redraw = row.querySelector('[data-ref-live-wire-action="redraw"]');
    const cancel = row.querySelector('[data-ref-live-wire-action="cancel"]');
    const active = !!state && state.recordId === recordId;
    const tracking = active && state.phase === 'tracking';
    const preview = active && state.phase === 'preview';
    const incompatibleMode = mapElement.classList.contains('is-reference-gcp-mode')
      || mapElement.classList.contains('is-reference-placement-mode')
      || mapElement.classList.contains('is-reference-line-refine-mode');
    start.hidden = active;
    start.disabled = !meta || meta.locked || !warpReady || incompatibleMode;
    finish.hidden = !tracking;
    finish.disabled = !state?.segments?.length && !state?.previewPoints?.length;
    undo.hidden = !tracking;
    undo.disabled = !(state?.anchors?.length);
    apply.hidden = !preview;
    redraw.hidden = !preview;
    cancel.hidden = !active;

    const gcpButton = editor.querySelector('[data-ref-action="gcp"]');
    if (gcpButton) gcpButton.disabled = !!meta?.locked || active || mapElement.classList.contains('is-reference-line-refine-mode');
    if (lastMessage) setMessage(lastMessage, lastTone);
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

  async function loadStoredRecord(recordId) {
    let stored = (await listStoredReferenceImages()).find(record => String(record?.id) === String(recordId));
    const meta = publicRecordMeta(recordId);
    if (!stored?.blob) throw new Error('저장된 참조 이미지를 찾을 수 없습니다.');
    for (let attempt = 0; meta && Array.isArray(stored.controlPoints)
      && stored.controlPoints.length !== Number(meta.controlPointCount || 0)
      && attempt < 6; attempt += 1) {
      await new Promise(resolve => globalThis.setTimeout(resolve, 40));
      stored = (await listStoredReferenceImages()).find(record => String(record?.id) === String(recordId)) || stored;
    }
    return stored;
  }

  async function loadSource(recordId) {
    const stored = await loadStoredRecord(recordId);
    const meta = publicRecordMeta(recordId);
    if (meta?.locked || stored.locked) throw new Error('잠금을 해제한 뒤 자동 추적을 사용할 수 있습니다.');
    const warp = buildReferenceImageWarp(stored.controlPoints || [], { mode: stored.warpMode });
    if (!warp.ok) throw new Error('기준점 보정을 완료한 뒤 자동 추적을 사용할 수 있습니다.');
    const decoded = await cachedImage(stored);
    const field = getReferenceImageLiveWireField(decoded.image, { maxDimension: LIVE_WIRE_OPTIONS.maxDimension });
    if (Number(field.peakEdgeStrength || 0) < 0.02) throw new Error('이미지에서 추적할 수 있는 선명한 경계를 찾지 못했습니다.');
    return {
      id: String(recordId),
      image: decoded.image,
      warp,
      mesh: buildReferenceImageMesh(warp, MESH_QUALITY),
      field,
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

  function screenToAnalysis(screen) {
    if (!state?.source || !state?.field) return null;
    const uv = hitTestUv(state.source, screen);
    return uv ? analysisPointFromUv(state.field, uv) : null;
  }

  async function startLiveWire(recordId) {
    if (state) cancelLiveWire();
    if (mapElement.classList.contains('is-reference-gcp-mode')
      || mapElement.classList.contains('is-reference-placement-mode')
      || mapElement.classList.contains('is-reference-line-refine-mode')) {
      setMessage('기준점 추가·배치 편집·선 보강을 먼저 종료한 뒤 자동 추적을 시작하세요.', 'error');
      return false;
    }
    state = {
      recordId,
      phase: 'loading',
      source: null,
      field: null,
      anchors: [],
      segments: [],
      previewPoints: [],
      previewCoordinates: [],
      tree: null,
      treeTarget: null,
    };
    mapElement.classList.add('is-reference-live-wire-mode');
    setMessage('참조 이미지의 경계를 분석하고 있습니다.', 'working');
    scheduleSync();
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      const source = await loadSource(recordId);
      if (!state || state.recordId !== recordId) return false;
      state.source = source;
      state.field = source.field;
      state.phase = 'armed';
      setMessage('추적할 경계 위를 클릭해 시작점을 지정하세요.', 'working');
      scheduleSync();
      requestRender();
      return true;
    } catch (error) {
      cancelLiveWire({ message: error?.message || '자동 추적을 준비하지 못했습니다.', tone: 'error' });
      return false;
    }
  }

  function placeFirstAnchor(screen) {
    const analysis = screenToAnalysis(screen);
    if (!analysis) {
      setMessage('보정된 참조 이미지가 보이는 영역에서 시작점을 지정하세요.', 'error');
      return false;
    }
    const anchor = snapLiveWireAnchor(state.field, analysis, { radius: LIVE_WIRE_OPTIONS.snapRadius });
    if (!anchor) return false;
    state.anchors = [anchor];
    state.segments = [];
    state.previewPoints = [];
    state.previewCoordinates = [];
    state.tree = null;
    state.treeTarget = null;
    state.phase = 'tracking';
    setMessage('마우스를 움직이면 경계를 자동 추적합니다. 클릭하면 현재 구간을 고정합니다.', 'working');
    requestRender();
    scheduleSync();
    return true;
  }

  function rebuildTree(target) {
    const anchor = state?.anchors?.at(-1);
    if (!anchor || !target) return null;
    const tree = buildLiveWireTree(state.field, anchor, {
      target,
      searchRadius: LIVE_WIRE_OPTIONS.searchRadius,
      snapRadius: LIVE_WIRE_OPTIONS.snapRadius,
      corridorWeight: LIVE_WIRE_OPTIONS.corridorWeight,
    });
    state.tree = tree.ok ? tree : null;
    state.treeTarget = tree.ok ? [...target] : null;
    return tree;
  }

  function computePreviewForScreen(screen) {
    if (!state || state.phase !== 'tracking') return false;
    const target = screenToAnalysis(screen);
    if (!target) {
      state.previewPoints = [];
      requestRender();
      return false;
    }
    let tree = state.tree;
    let result = tree ? traceLiveWirePath(tree, target, { snapRadius: LIVE_WIRE_OPTIONS.snapRadius }) : null;
    const shouldRebuild = !tree || !result?.ok
      || !state.treeTarget
      || squaredDistance(state.treeTarget, target) > TREE_REBUILD_DISTANCE_SQUARED;
    if (shouldRebuild) {
      tree = rebuildTree(target);
      if (!tree?.ok) {
        state.previewPoints = [];
        setMessage(failureMessage(tree?.reason), 'error');
        requestRender();
        return false;
      }
      result = traceLiveWirePath(tree, target, { snapRadius: LIVE_WIRE_OPTIONS.snapRadius });
    }
    if (!result?.ok) {
      state.previewPoints = [];
      setMessage(failureMessage(result?.reason), 'error');
      requestRender();
      return false;
    }
    state.previewPoints = result.points.map(point => [...point]);
    setMessage(`자동 추적 중 · 현재 구간 ${state.previewPoints.length}픽셀 · 클릭하면 고정합니다.`, 'working');
    requestRender();
    scheduleSync();
    return true;
  }

  function schedulePreview(screen) {
    pendingPointer = screen;
    if (previewScheduled || disposed) return;
    previewScheduled = true;
    requestAnimationFrame(() => {
      previewScheduled = false;
      const next = pendingPointer;
      pendingPointer = null;
      if (!disposed && next) computePreviewForScreen(next);
    });
  }

  function commitCurrentPreview(screen = null) {
    if (!state || state.phase !== 'tracking') return false;
    if (screen) computePreviewForScreen(screen);
    if (!state.previewPoints?.length || state.previewPoints.length < 2) {
      setMessage('먼저 마우스를 경계의 다음 지점으로 이동하세요.', 'error');
      return false;
    }
    const segment = state.previewPoints.map(point => [...point]);
    const end = [...segment.at(-1)];
    state.segments.push(segment);
    state.anchors.push(end);
    state.previewPoints = [];
    state.tree = null;
    state.treeTarget = null;
    setMessage(`구간 ${state.segments.length}개를 고정했습니다. 계속 이동하거나 완료하세요.`, 'success');
    requestRender();
    scheduleSync();
    return true;
  }

  function undoLastSegment() {
    if (!state || !['tracking', 'preview'].includes(state.phase)) return false;
    if (state.phase === 'preview') {
      state.phase = 'tracking';
      state.previewCoordinates = [];
    }
    if (state.segments.length) {
      state.segments.pop();
      if (state.anchors.length > 1) state.anchors.pop();
      state.previewPoints = [];
      state.tree = null;
      state.treeTarget = null;
      setMessage('마지막 고정 구간을 취소했습니다.', 'working');
      requestRender();
      scheduleSync();
      return true;
    }
    if (state.anchors.length) {
      state.anchors = [];
      state.previewPoints = [];
      state.phase = 'armed';
      setMessage('시작점을 취소했습니다. 새 시작점을 클릭하세요.', 'working');
      requestRender();
      scheduleSync();
      return true;
    }
    return false;
  }

  function finishTrace({ commitPreview = true } = {}) {
    if (!state || state.phase !== 'tracking') return false;
    if (commitPreview && state.previewPoints?.length >= 2) commitCurrentPreview();
    if (!state.segments.length) {
      setMessage('최소 한 구간을 고정한 뒤 완료하세요.', 'error');
      return false;
    }
    const simplified = simplifyLiveWireSegments(state.segments, { tolerance: LIVE_WIRE_OPTIONS.simplifyTolerance });
    const sourcePixels = sourcePixelsFromAnalysis(state.field, simplified);
    const coordinates = referenceImagePixelsToCoordinates(sourcePixels, {
      sourceWidth: state.source.sourceWidth,
      sourceHeight: state.source.sourceHeight,
      warp: state.source.warp,
    });
    if (coordinates.length < 2) {
      setMessage('완성된 추적선을 지도 좌표로 변환하지 못했습니다.', 'error');
      return false;
    }
    state.previewCoordinates = coordinates;
    state.previewPoints = [];
    state.tree = null;
    state.treeTarget = null;
    state.phase = 'preview';
    setMessage(`자동 추적 결과 ${coordinates.length}개 점 · 적용하거나 다시 그릴 수 있습니다.`, 'success');
    requestRender();
    scheduleSync();
    return true;
  }

  function redraw() {
    if (!state) return false;
    state.phase = 'armed';
    state.anchors = [];
    state.segments = [];
    state.previewPoints = [];
    state.previewCoordinates = [];
    state.tree = null;
    state.treeTarget = null;
    setMessage('새 시작점을 클릭하세요.', 'working');
    requestRender();
    scheduleSync();
    return true;
  }

  function applyPreview() {
    if (!state || state.phase !== 'preview' || state.previewCoordinates.length < 2) return false;
    const bridge = globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
    if (!bridge?.isDraftActive?.()) {
      setMessage('먼저 지도 편집 도구를 켠 뒤 적용하세요. 자동 추적 결과는 그대로 유지됩니다.', 'error');
      return false;
    }
    const applied = bridge.applyDraftCoordinates?.(state.previewCoordinates) === true;
    if (!applied) {
      setMessage('현재 편집선에 자동 추적 결과를 적용하지 못했습니다. 편집 상태를 확인하세요.', 'error');
      return false;
    }
    cancelLiveWire({ message: '자동 추적선을 현재 편집 draft에 적용했습니다.', tone: 'success' });
    return true;
  }

  function interceptMapEvent(event) {
    if (!state || !['armed', 'tracking'].includes(state.phase)) return false;
    if (!mapElement.contains(event.target)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  function onPointerDown(event) {
    if (!state || event.button !== 0 || !['armed', 'tracking'].includes(state.phase) || !mapElement.contains(event.target)) return;
    if (!interceptMapEvent(event)) return;
    const screen = canvasPoint(event, mapElement);
    if (state.phase === 'armed') placeFirstAnchor(screen);
    else commitCurrentPreview(screen);
  }

  function onPointerMove(event) {
    if (!state || state.phase !== 'tracking' || !mapElement.contains(event.target)) return;
    if (!interceptMapEvent(event)) return;
    schedulePreview(canvasPoint(event, mapElement));
  }

  function onDoubleClick(event) {
    if (!state || state.phase !== 'tracking' || !mapElement.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const screen = canvasPoint(event, mapElement);
    computePreviewForScreen(screen);
    if (state.previewPoints?.length >= 2) commitCurrentPreview();
    finishTrace({ commitPreview: false });
  }

  function onPanelClick(event) {
    const action = event.target.closest('[data-ref-live-wire-action]')?.dataset.refLiveWireAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const recordId = selectedRecordId(panel);
    if (action === 'start' && recordId) void startLiveWire(recordId);
    if (action === 'finish') finishTrace();
    if (action === 'undo') undoLastSegment();
    if (action === 'apply') applyPreview();
    if (action === 'redraw') redraw();
    if (action === 'cancel') cancelLiveWire({ message: '자동 추적을 취소했습니다.' });
  }

  function onKeyDown(event) {
    if (referenceImageKeyBlocked(event)) return;
    if (!state) return;
    const undoShortcut = event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z');
    if (undoShortcut && ['tracking', 'preview'].includes(state.phase)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      undoLastSegment();
      return;
    }
    if (event.key === 'Enter' && state.phase === 'tracking') {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishTrace();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelLiveWire({ message: '자동 추적을 취소했습니다.' });
    }
  }

  function monitorHost() {
    if (disposed) return;
    if (state && ['tracking', 'preview'].includes(state.phase)) {
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
    if (panel.hidden && state) cancelLiveWire();
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
  globalThis.addEventListener('dblclick', onDoubleClick, true);
  globalThis.addEventListener('keydown', onKeyDown, true);
  monitorHost();
  scheduleSync();

  const api = Object.freeze({
    active: () => !!state,
    phase: () => state?.phase || 'idle',
    segmentCount: () => state?.segments?.length || 0,
    previewPointCount: () => state?.previewPoints?.length || 0,
    cancel: () => cancelLiveWire(),
    requestRender,
    destroy() {
      if (disposed) return;
      disposed = true;
      state = null;
      pendingPointer = null;
      globalThis.clearTimeout(monitorTimer);
      observer.disconnect();
      resizeObserver.disconnect();
      panel.removeEventListener('click', onPanelClick, true);
      globalThis.removeEventListener('pointerdown', onPointerDown, true);
      globalThis.removeEventListener('pointermove', onPointerMove, true);
      globalThis.removeEventListener('dblclick', onDoubleClick, true);
      globalThis.removeEventListener('keydown', onKeyDown, true);
      for (const cached of imageCache.values()) if (cached.objectUrl) URL.revokeObjectURL(cached.objectUrl);
      imageCache.clear();
      canvas.remove();
      mapElement.classList.remove('is-reference-live-wire-mode');
      document.documentElement.dataset.referenceImageLiveWire = '';
      if (globalThis.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__ === api) delete globalThis.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__;
    },
  });

  globalThis.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__ = api;
  return api;
}
