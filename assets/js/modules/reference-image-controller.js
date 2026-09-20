import {
  buildReferenceImageMesh,
  buildReferenceImageWarp,
  REFERENCE_IMAGE_WARP_MODES,
} from './reference-image-georef.js';
import {
  applyReferenceImagePlacementDrag,
  createReferenceImagePlacementDrag,
  defaultReferenceImageScreenRect,
  normalizeReferenceImageRotation,
  normalizeReferenceImageScreenRect,
  referenceImagePlacementHit,
} from './reference-image-placement.js';
import { createReferenceImageCanvasRenderer } from './reference-image-renderer.js';
import { registerReferenceImageInput } from './reference-image-input.js';
import { applyReferenceImageEdit, copyReferenceImageRecords, createReferenceImageHistory } from './reference-image-edit-session.js';
import { installReferenceImageSurface } from './reference-image-surface.js';
import {
  listStoredReferenceImages,
  putStoredReferenceImage,
  replaceStoredReferenceImages,
} from './reference-image-store.js';
import {
  createReferenceImageLauncher,
  createReferenceImagePanel,
  referenceImageEditorMarkup,
  renderReferenceImageList,
} from './reference-image-ui.js';

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DEFAULT_OPACITY = 0.55;
const DEFAULT_BLEND_MODE = 'source-over';
const PERSIST_DEBOUNCE_MS = 220;
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
const CONTINUOUS_FIELDS = new Set(['name', 'opacity', 'rotation']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberText = (value, digits = 0) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';

function createId(prefix = 'ref') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function mapHost() {
  return globalThis.__PANDOLAB_MAP_HOST__ || null;
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
    rotation: normalizeReferenceImageRotation(record?.rotation),
    controlPoints: Array.isArray(record?.controlPoints) ? record.controlPoints : [],
    blob: record?.blob instanceof Blob ? record.blob : null,
    screenRect: normalizeReferenceImageScreenRect(record?.screenRect),
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
    rotation: normalizeReferenceImageRotation(record.rotation),
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

export function installReferenceImageController({ workspaceSurfaces, confirm, getGeneration = () => 0, isBlocked = () => false, cancelTools = () => {} } = {}) {
  if (document.documentElement.dataset.referenceImageController === 'installed') return globalThis.__PANDOLAB_REFERENCE_IMAGES__ || null;
  const mapElement = document.getElementById('map');
  if (!mapElement) return null;
  document.documentElement.dataset.referenceImageController = 'installed';

  const launcher = createReferenceImageLauncher();
  const panel = createReferenceImagePanel();
  mapElement.append(launcher, panel);

  const fileInput = panel.querySelector('[data-ref-file]');
  const listElement = panel.querySelector('[data-ref-list]');
  const emptyElement = panel.querySelector('[data-ref-empty]');
  const editorElement = panel.querySelector('[data-ref-editor]');
  const records = [];
  const pendingPersistTimers = new Map();
  let selectedId = '';
  let gcpState = null;
  let controlPointEditingId = '';
  let selectedControlPointId = '';
  let controlPointDrag = null;
  let placementEditingId = '';
  let placementDrag = null;
  let disposed = false;
  let session = 0;
  let dragBefore = null;
  let continuousBefore = null;
  const history = createReferenceImageHistory();
  const objectUrls = new Set();
  const currentToken = () => `${session}:${getGeneration()}`;
  const validToken = token => !disposed && token === currentToken() && !isBlocked();
  let surface;

  const selected = () => records.find(record => record.id === selectedId) || null;
  const renderer = createReferenceImageCanvasRenderer({
    mapElement,
    getRecords: () => records,
    getSelectedId: () => selectedId,
    getPlacementEditingId: () => placementEditingId,
    getControlPointEditingId: () => controlPointEditingId,
    getSelectedControlPointId: () => selectedControlPointId,
    isPanelHidden: () => panel.hidden,
  });

  function rebuildWarp(record) {
    record.warp = buildReferenceImageWarp(record.controlPoints, { mode: record.warpMode });
    record.mesh = record.warp.ok ? buildReferenceImageMesh(record.warp, MESH_QUALITY) : null;
    record.projectedMesh = null;
    if (record.warp.ok && placementEditingId === record.id) stopPlacementEditing({ renderUi: false });
  }

  function clearScheduledPersist(recordId) {
    const timer = pendingPersistTimers.get(recordId);
    if (timer) globalThis.clearTimeout(timer);
    pendingPersistTimers.delete(recordId);
  }

  function persist(record) {
    const index = records.indexOf(record);
    if (index < 0 || !record.blob) return Promise.resolve(false);
    clearScheduledPersist(record.id);
    return putStoredReferenceImage(serializableRecord(record, index))
      .catch(error => {
        console.warn('[reference-image-store]', error);
        return false;
      });
  }

  function schedulePersist(record) {
    const index = records.indexOf(record);
    if (index < 0 || !record.blob) return;
    clearScheduledPersist(record.id);
    const token = currentToken();
    const timer = globalThis.setTimeout(() => {
      pendingPersistTimers.delete(record.id);
      if (validToken(token)) void persist(record);
    }, PERSIST_DEBOUNCE_MS);
    pendingPersistTimers.set(record.id, timer);
  }

  function persistAll() {
    for (const recordId of [...pendingPersistTimers.keys()]) clearScheduledPersist(recordId);
    return replaceStoredReferenceImages(records.map((record, order) => serializableRecord(record, order)))
      .catch(error => {
        console.warn('[reference-image-store]', error);
        return false;
      });
  }

  function renderList() {
    emptyElement.hidden = records.length > 0;
    renderReferenceImageList(listElement, records, selectedId);
  }

  function renderEditor() {
    const historyLocked = records.some(record => record.locked);
    panel.querySelector('[data-ref-action="undo"]').disabled = !history.canUndo() || historyLocked;
    panel.querySelector('[data-ref-action="redo"]').disabled = !history.canRedo() || historyLocked;
    const record = selected();
    editorElement.hidden = !record;
    if (!record) {
      editorElement.replaceChildren();
      return;
    }
    editorElement.innerHTML = referenceImageEditorMarkup({
      record,
      warp: record.warp,
      placementEditing: placementEditingId === record.id,
      index: records.indexOf(record),
      count: records.length,
      blendOptions: BLEND_OPTIONS,
      warpOptions: WARP_OPTIONS,
      gcpState,
      controlPointEditing: controlPointEditingId === record.id,
      selectedControlPointId,
    });
    syncEditingSurface();
  }

  function syncEditingSurface() {
    const active = !!(gcpState || placementEditingId || controlPointEditingId);
    const hint = gcpState
      ? (gcpState.step === 'image' ? '이미지에서 맞출 지점을 선택하세요.' : '같은 지점의 실제 지도 위치를 선택하세요.')
      : controlPointEditingId
        ? '지도 위 기준점을 드래그해 이동하거나 선택 후 Delete로 삭제하세요.'
        : '이미지를 드래그해 배치하세요.';
    surface?.setEditing(active, hint);
  }

  function cancelInteraction() {
    cancelTools();
    cancelGcp(false);
    stopControlPointEditing({ renderUi: false });
    stopPlacementEditing({ renderUi: false });
    renderEditor();
  }

  function restoreHistory(direction) {
    if (isBlocked() || records.some(record => record.locked)) return;
    cancelInteraction();
    const next = history[direction](records);
    if (!next) return;
    session++;
    continuousBefore = null;
    // Lock is a guard, not an edit to be implicitly restored by history.
    for (const item of next) item.locked = records.find(record => record.id === item.id)?.locked ?? false;
    records.splice(0, records.length, ...next);
    for (const record of records) rebuildWarp(record);
    if (!selected()) selectedId = records.at(-1)?.id || '';
    void persistAll(); refreshUi();
  }

  function resetSession() {
    session++;
    cancelInteraction();
    continuousBefore = null;
    history.clear();
    for (const id of pendingPersistTimers.keys()) clearScheduledPersist(id);
    surface?.close();
    refreshUi();
  }

  function refreshUi() {
    renderList();
    renderEditor();
    renderer.requestRender();
  }

  function setHint(text, tone = '') {
    const hint = editorElement.querySelector('[data-ref-hint]');
    if (!hint) return;
    hint.textContent = text;
    hint.dataset.tone = tone;
  }

  async function addBlob(blob, name, persisted = null, { select = true, save = true } = {}) {
    if (!(blob instanceof Blob) || !ACCEPTED_IMAGE_TYPES.has(blob.type)) throw new Error('PNG, JPG, WebP 이미지만 사용할 수 있습니다.');
    const token = currentToken();
    const decoded = await createImageFromBlob(blob);
    if (!validToken(token)) { URL.revokeObjectURL(decoded.url); return null; }
    objectUrls.add(decoded.url);
    const source = normalizePersistedRecord(persisted || {});
    const record = {
      ...source,
      id: persisted?.id || createId(),
      name: String(persisted?.name || name || '참조 이미지'),
      blob,
      image: decoded.image,
      objectUrl: decoded.url,
      screenRect: source.screenRect || defaultReferenceImageScreenRect(decoded.image, mapElement),
      warp: null,
      mesh: null,
      projectedMesh: null,
    };
    rebuildWarp(record);
    if (select) cancelInteraction();
    if (save) history.push(records);
    records.push(record);
    if (select) selectedId = record.id;
    if (save) await persist(record);
    refreshUi();
    return record;
  }

  async function removeRecord(record) {
    const index = records.indexOf(record);
    if (index < 0 || record.locked || isBlocked()) return;
    cancelInteraction();
    history.push(records);
    records.splice(index, 1);
    clearScheduledPersist(record.id);
    selectedId = records.at(-1)?.id || '';
    if (placementEditingId === record.id) stopPlacementEditing({ renderUi: false });
    if (gcpState?.recordId === record.id) cancelGcp(false);
    if (controlPointEditingId === record.id) stopControlPointEditing({ renderUi: false });
    await persistAll();
    refreshUi();
  }

  function moveRecord(record, delta) {
    const index = records.indexOf(record);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= records.length) return false;
    history.push(records);
    records.splice(index, 1);
    records.splice(nextIndex, 0, record);
    void persistAll();
    refreshUi();
    return true;
  }

  function startPlacementEditing(record) {
    if (!record || record.locked || record.warp?.ok) return;
    cancelTools();
    cancelGcp(false);
    placementEditingId = record.id;
    mapElement.classList.add('is-reference-placement-mode');
    renderEditor();
    renderer.requestRender();
  }

  function stopPlacementEditing({ renderUi = true } = {}) {
    cancelPlacementDrag();
    placementEditingId = '';
    mapElement.classList.remove('is-reference-placement-mode');
    if (renderUi) renderEditor();
    renderer.requestRender();
    syncEditingSurface();
  }

  function armGcp(record, pointId = '', side = 'image') {
    if (!record || record.locked) return;
    cancelTools();
    stopPlacementEditing({ renderUi: false });
    stopControlPointEditing({ renderUi: false });
    gcpState = { recordId: record.id, step: side, image: null, pointId, token: currentToken() };
    mapElement.classList.add('is-reference-gcp-mode');
    renderEditor();
    setHint(side === 'image' ? '이미지에서 맞출 지점을 선택하세요.' : '실제 지도 위치를 선택하세요.', 'working');
  }

  function cancelGcp(renderUi = true) {
    gcpState = null;
    mapElement.classList.remove('is-reference-gcp-mode');
    if (renderUi && selected()) renderEditor();
    syncEditingSurface();
  }

  function startControlPointEditing(record) {
    if (!record || record.locked || !record.controlPoints.length) return false;
    cancelTools();
    cancelGcp(false);
    stopPlacementEditing({ renderUi: false });
    controlPointEditingId = record.id;
    selectedControlPointId = '';
    mapElement.classList.add('is-reference-gcp-edit-mode');
    renderEditor();
    renderer.requestRender();
    return true;
  }

  function stopControlPointEditing({ renderUi = true } = {}) {
    cancelControlPointDrag();
    controlPointEditingId = '';
    selectedControlPointId = '';
    mapElement.classList.remove('is-reference-gcp-edit-mode');
    if (renderUi && selected()) renderEditor();
    renderer.requestRender();
    syncEditingSurface();
  }

  function beginControlPointDrag(event, record, point) {
    const hit = renderer.hitTestControlPoint(record, point);
    if (!hit) return false;
    controlPointDrag = {
      recordId: record.id,
      pointId: hit.id,
      pointerId: event.pointerId,
      before: copyReferenceImageRecords(records),
    };
    selectedControlPointId = hit.id;
    surface?.setGestureActive(true);
    try { mapElement.setPointerCapture?.(event.pointerId); } catch (_) {}
    renderEditor();
    renderer.requestRender();
    return true;
  }

  function updateControlPointDrag(point, event) {
    if (!controlPointDrag || event.pointerId !== controlPointDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === controlPointDrag.recordId);
    const coordinate = mapHost()?.unproject(point);
    if (!record || record.locked || !coordinate?.every(Number.isFinite)) return false;
    const changed = applyReferenceImageEdit(record, 'replace-coordinate', {
      id: controlPointDrag.pointId,
      value: coordinate,
    });
    if (!changed) return false;
    rebuildWarp(record);
    renderer.requestRender();
    return true;
  }

  function finishControlPointDrag(event) {
    if (!controlPointDrag || event.pointerId !== controlPointDrag.pointerId) return false;
    const drag = controlPointDrag;
    const record = records.find(candidate => candidate.id === drag.recordId);
    try { mapElement.releasePointerCapture?.(event.pointerId); } catch (_) {}
    controlPointDrag = null;
    surface?.setGestureActive(false);
    if (record) {
      const before = drag.before.find(candidate => candidate.id === record.id);
      if (JSON.stringify(before?.controlPoints) !== JSON.stringify(record.controlPoints)) history.push(drag.before);
      void persist(record);
      renderEditor();
      renderer.requestRender();
    }
    return true;
  }

  function cancelControlPointDrag() {
    if (!controlPointDrag) return;
    const drag = controlPointDrag;
    const record = records.find(candidate => candidate.id === drag.recordId);
    const before = drag.before.find(candidate => candidate.id === drag.recordId);
    if (record && before) {
      record.controlPoints = before.controlPoints.map(point => ({ ...point, image: [...point.image], coordinate: [...point.coordinate] }));
      rebuildWarp(record);
    }
    try { mapElement.releasePointerCapture?.(drag.pointerId); } catch (_) {}
    controlPointDrag = null;
    surface?.setGestureActive(false);
    renderer.requestRender();
  }

  function beginPlacementDrag(event, record, point) {
    const hit = referenceImagePlacementHit(record, point);
    if (!hit) return false;
    placementDrag = createReferenceImagePlacementDrag(record, hit, point, event.pointerId);
    if (!placementDrag) return false;
    dragBefore = copyReferenceImageRecords(records);
    surface?.setGestureActive(true);
    try { mapElement.setPointerCapture?.(event.pointerId); } catch (_) {}
    return true;
  }

  function updatePlacementDrag(point, event) {
    if (!placementDrag || event.pointerId !== placementDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === placementDrag.recordId);
    if (!record || record.locked || record.warp?.ok) {
      placementDrag = null;
      return false;
    }
    const changed = applyReferenceImagePlacementDrag(
      record,
      placementDrag,
      point,
      { shiftKey: event.shiftKey },
    );
    if (changed) renderer.requestRender();
    return changed;
  }

  function finishPlacementDrag(event) {
    if (!placementDrag || event.pointerId !== placementDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === placementDrag.recordId);
    try { mapElement.releasePointerCapture?.(event.pointerId); } catch (_) {}
    placementDrag = null;
    if (record && dragBefore) {
      const before = dragBefore.find(item => item.id === record.id);
      if (JSON.stringify(before.screenRect) !== JSON.stringify(record.screenRect) || before.rotation !== record.rotation) history.push(dragBefore);
    }
    dragBefore = null;
    surface?.setGestureActive(false);
    if (record) {
      void persist(record);
      renderEditor();
      renderer.requestRender();
    }
    return true;
  }

  function cancelPlacementDrag() {
    if (!placementDrag) return;
    const record = records.find(item => item.id === placementDrag.recordId);
    if (record) {
      record.screenRect = { ...placementDrag.startRect };
      record.rotation = placementDrag.startRotation;
    }
    try { mapElement.releasePointerCapture?.(placementDrag.pointerId); } catch (_) {}
    placementDrag = null; dragBefore = null;
    surface?.setGestureActive(false);
    renderer.requestRender();
  }

  function commitGcp(point) {
    if (gcpState) {
      const record = records.find(candidate => candidate.id === gcpState.recordId);
      if (!record || record.locked || !validToken(gcpState.token)) {
        cancelGcp();
        return;
      }
      const before = copyReferenceImageRecords(records);
      if (gcpState.step === 'image') {
        const uv = renderer.hitTestUv(record, point);
        if (!uv) {
          setHint('이미지가 보이는 영역 안을 선택하세요.', 'error');
          return;
        }
        if (gcpState.pointId) {
          applyReferenceImageEdit(record, 'replace-image', { id: gcpState.pointId, value: uv });
        } else {
          gcpState.image = uv;
          gcpState.step = 'map';
          syncEditingSurface();
          setHint('2/2 · 같은 지점의 실제 지도 위치를 선택하세요.', 'working');
          return;
        }
      } else {
        const coordinate = mapHost()?.unproject(point);
        if (!coordinate || !coordinate.every(Number.isFinite)) {
          setHint('이 위치에서는 지도 좌표를 계산할 수 없습니다.', 'error');
          return;
        }
        if (gcpState.pointId) applyReferenceImageEdit(record, 'replace-coordinate', { id: gcpState.pointId, value: coordinate });
        else record.controlPoints.push({
          id: createId('gcp'),
          image: [...gcpState.image],
          coordinate: [coordinate[0], coordinate[1]],
        });
      }
      history.push(before);
      rebuildWarp(record);
      void persist(record);
      if (gcpState.pointId) cancelGcp(false);
      else gcpState = { recordId: record.id, step: 'image', image: null, pointId: '', token: currentToken() };
      refreshUi();
      setHint('기준점을 추가했습니다. 계속 추가하거나 Esc로 종료하세요.', 'success');
      return;
    }
  }

  function beginGesture(point, event, { spacePan = false } = {}) {
    if (isBlocked() || !(gcpState || placementEditingId || controlPointEditingId)) return null;
    if (event.button === 1 || spacePan) return { kind: 'navigate' };
    if (event.button !== 0) return null;
    if (gcpState) {
      const state = gcpState;
      surface?.setGestureActive(true);
      return { kind: 'tap', end: next => { surface?.setGestureActive(false); if (gcpState === state) commitGcp(next); }, cancel: () => surface?.setGestureActive(false) };
    }
    const record = selected();
    if (record && controlPointEditingId === record.id && beginControlPointDrag(event, record, point)) {
      return { kind: 'exclusive', move: updateControlPointDrag, end: (_point, up) => finishControlPointDrag(up), cancel: cancelControlPointDrag };
    }
    if (record && !record.locked && !record.warp?.ok && beginPlacementDrag(event, record, point)) {
      return { kind: 'exclusive', move: updatePlacementDrag, end: (_point, up) => finishPlacementDrag(up), cancel: cancelPlacementDrag };
    }
    return { kind: 'navigate' };
  }

  function onEditorInput(event) {
    const record = selected();
    if (!record || isBlocked()) return;
    const field = event.target?.dataset?.refField;
    if (!field) return;
    const continuous = CONTINUOUS_FIELDS.has(field);
    if (event.type === 'input' && !continuous) return;
    if (record.locked && ['rotation', 'warp'].includes(field)) return;
    if (continuous && !continuousBefore) continuousBefore = copyReferenceImageRecords(records);
    if (!continuous && field !== 'locked') history.push(records);

    if (field === 'name') record.name = event.target.value || '참조 이미지';
    if (field === 'opacity') record.opacity = clamp(Number(event.target.value), 0, 1);
    if (field === 'rotation' && !record.warp?.ok && !record.locked) record.rotation = normalizeReferenceImageRotation(event.target.value);
    if (field === 'blend') record.blendMode = event.target.value;
    if (field === 'warp') {
      record.warpMode = event.target.value;
      rebuildWarp(record);
    }
    if (field === 'visible') record.visible = event.target.checked;
    if (field === 'locked') {
      record.locked = event.target.checked;
      if (record.locked) {
        cancelGcp(false);
        if (controlPointEditingId === record.id) stopControlPointEditing({ renderUi: false });
        if (placementEditingId === record.id) stopPlacementEditing({ renderUi: false });
      }
    }

    if (event.type === 'input' && continuous) schedulePersist(record);
    else void persist(record);
    if (field === 'name' || field === 'visible') renderList();
    if (field === 'opacity') {
      const output = event.target.parentElement?.querySelector('output');
      if (output) output.textContent = `${Math.round(record.opacity * 100)}%`;
    }
    if (field === 'rotation') event.target.value = numberText(record.rotation, 1);
    if (continuous && event.type === 'change' && continuousBefore) { history.push(continuousBefore); continuousBefore = null; }
    const historyLocked = records.some(item => item.locked);
    panel.querySelector('[data-ref-action="undo"]').disabled = !history.canUndo() || historyLocked;
    panel.querySelector('[data-ref-action="redo"]').disabled = !history.canRedo() || historyLocked;
    if (field === 'warp' || field === 'locked') renderEditor();
    renderer.requestRender();
  }

  async function onPanelClick(event) {
    const button = event.target.closest('[data-ref-action]');
    const action = button?.dataset.refAction;
    if (button?.disabled || isBlocked()) return;
    if (!action) {
      const row = event.target.closest('[data-reference-image-id]');
      if (row) {
        cancelInteraction();
        selectedId = row.dataset.referenceImageId;
        surface.resetScroll();
        refreshUi();
      }
      return;
    }
    const record = selected();
    if (action === 'close') {
      surface.close({ restoreFocus: true });
      return;
    }
    if (action === 'finish' || action === 'cancel') { cancelInteraction(); return; }
    if (action === 'undo' || action === 'redo') { restoreHistory(action); return; }
    if (action === 'add') {
      fileInput.click();
      return;
    }
    if (!record) return;
    if (record.locked && !['bring-forward', 'send-backward'].includes(action)) return;
    if (action === 'delete' || action === 'clear-gcp') {
      const token = currentToken();
      const accepted = await confirm({ title: action === 'delete' ? '참조 이미지 삭제' : '기준점 전체 삭제', message: action === 'delete' ? '이 참조 이미지를 삭제할까요?' : '기준점을 모두 삭제하고 보정을 해제할까요?', confirmText: '삭제', danger: true });
      if (!accepted || !validToken(token) || selected() !== record || record.locked || !records.includes(record)) return;
      if (action === 'delete') { await removeRecord(record); return; }
    }
    if (action === 'placement') {
      if (placementEditingId === record.id) stopPlacementEditing();
      else startPlacementEditing(record);
    }
    if (action === 'reset-placement' && !record.locked && !record.warp?.ok) {
      history.push(records);
      record.screenRect = defaultReferenceImageScreenRect(record.image, mapElement);
      record.rotation = 0;
      void persist(record);
      refreshUi();
    }
    if (action === 'bring-forward') moveRecord(record, 1);
    if (action === 'send-backward') moveRecord(record, -1);
    if (action === 'gcp') armGcp(record);
    if (action === 'gcp-edit') {
      if (controlPointEditingId === record.id) stopControlPointEditing();
      else startControlPointEditing(record);
      return;
    }
    if (action === 'edit-image' || action === 'edit-coordinate') armGcp(record, button.dataset.pointId, action === 'edit-image' ? 'image' : 'map');
    const before = copyReferenceImageRecords(records);
    const editAction = action === 'undo-gcp' ? 'delete-gcp' : action;
    const id = action === 'undo-gcp' ? record.controlPoints.at(-1)?.id : button?.dataset.pointId;
    if (applyReferenceImageEdit(record, editAction, { id })) {
      history.push(before); cancelGcp(false); selectedControlPointId = ''; rebuildWarp(record); void persist(record); refreshUi();
    }
  }

  function onKeyDown(event) {
    if (panel.hidden || isBlocked()) return false;
    if (event.key === 'Enter' && event.target?.closest('button,[role="button"]')) return false;
    if (event.key === 'Escape') {
      if (gcpState || placementEditingId) cancelInteraction();
      else surface.close({ restoreFocus: true });
      return true;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && controlPointEditingId && selectedControlPointId) {
      const record = selected();
      if (record && !record.locked) {
        const before = copyReferenceImageRecords(records);
        if (applyReferenceImageEdit(record, 'delete-gcp', { id: selectedControlPointId })) {
          history.push(before);
          selectedControlPointId = '';
          rebuildWarp(record);
          void persist(record);
          refreshUi();
        }
      }
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      restoreHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'); return true;
    }
    return ['Delete', 'Backspace', 'Enter'].includes(event.key) && !!(gcpState || placementEditingId || controlPointEditingId);
  }

  async function onFileChange() {
    const token = currentToken();
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    for (const file of files) {
      if (!validToken(token)) break;
      try {
        await addBlob(file, file.name);
      } catch (error) {
        console.warn('[reference-image-add]', error);
      }
    }
  }

  const onPanelClickEvent = event => { void onPanelClick(event); };
  surface = installReferenceImageSurface({ panel, launcher, workspaceSurfaces, onClose: cancelInteraction, onOpen: () => renderer.requestRender() });
  const unregisterInput = registerReferenceImageInput({ begin: beginGesture, active: () => !!(gcpState || placementEditingId || controlPointEditingId), key: onKeyDown, cancel: cancelInteraction, reset: resetSession });
  const stopPanelKeys = event => {
    const text = event.target?.closest('input,textarea,select,[contenteditable="true"]');
    if (!text && onKeyDown(event)) event.preventDefault();
    event.stopPropagation();
  };
  panel.addEventListener('keydown', stopPanelKeys);
  panel.addEventListener('click', onPanelClickEvent);
  editorElement.addEventListener('input', onEditorInput);
  editorElement.addEventListener('change', onEditorInput);
  fileInput.addEventListener('change', onFileChange);

  const restoreToken = currentToken();
  listStoredReferenceImages()
    .then(async values => {
      const ordered = [...values].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      for (const value of ordered) {
        if (!validToken(restoreToken)) return;
        if (!value?.blob) continue;
        try {
          await addBlob(value.blob, value.name, value, { select: false, save: false });
        } catch (error) {
          console.warn('[reference-image-restore]', error);
        }
      }
      if (!validToken(restoreToken)) return;
      selectedId = records.at(-1)?.id || '';
      void persistAll();
      refreshUi();
    })
    .catch(error => console.warn('[reference-image-store]', error));

  const api = Object.freeze({
    list: () => records.map((record, order) => ({
      id: record.id,
      name: record.name,
      order,
      visible: record.visible,
      locked: record.locked,
      opacity: record.opacity,
      blendMode: record.blendMode,
      rotation: record.rotation,
      placementEditing: placementEditingId === record.id,
      warpMode: record.warp?.mode || record.warpMode,
      controlPointCount: record.controlPoints.length,
      diagnostics: record.warp?.ok ? record.warp.diagnostics : null,
    })),
    open: () => {
      surface.open();
      renderer.requestRender();
    },
    close: () => {
      surface.close();
    },
    requestRender: renderer.requestRender,
    destroy: () => {
      if (disposed) return;
      disposed = true;
      unregisterInput(); cancelInteraction(); surface.destroy(); history.clear();
      void persistAll();
      panel.removeEventListener('keydown', stopPanelKeys);
      panel.removeEventListener('click', onPanelClickEvent);
      editorElement.removeEventListener('input', onEditorInput);
      editorElement.removeEventListener('change', onEditorInput);
      fileInput.removeEventListener('change', onFileChange);
      objectUrls.forEach(url => URL.revokeObjectURL(url));
      renderer.destroy();
      panel.remove();
      launcher.remove();
      document.documentElement.dataset.referenceImageController = '';
      if (globalThis.__PANDOLAB_REFERENCE_IMAGES__ === api) delete globalThis.__PANDOLAB_REFERENCE_IMAGES__;
    },
  });

  globalThis.__PANDOLAB_REFERENCE_IMAGES__ = api;
  refreshUi();
  return api;
}
