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

export function installReferenceImageController() {
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
  let placementEditingId = '';
  let placementDrag = null;
  let disposed = false;

  const selected = () => records.find(record => record.id === selectedId) || null;
  const renderer = createReferenceImageCanvasRenderer({
    mapElement,
    getRecords: () => records,
    getSelectedId: () => selectedId,
    getPlacementEditingId: () => placementEditingId,
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
    const timer = globalThis.setTimeout(() => {
      pendingPersistTimers.delete(record.id);
      void persist(record);
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
    });
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
    const decoded = await createImageFromBlob(blob);
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
    records.push(record);
    if (select) selectedId = record.id;
    if (save) await persist(record);
    refreshUi();
    return record;
  }

  async function removeRecord(record) {
    const index = records.indexOf(record);
    if (index < 0) return;
    records.splice(index, 1);
    clearScheduledPersist(record.id);
    if (record.objectUrl) URL.revokeObjectURL(record.objectUrl);
    selectedId = records.at(-1)?.id || '';
    if (placementEditingId === record.id) stopPlacementEditing({ renderUi: false });
    if (gcpState?.recordId === record.id) cancelGcp(false);
    await persistAll();
    refreshUi();
  }

  function moveRecord(record, delta) {
    const index = records.indexOf(record);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= records.length) return false;
    records.splice(index, 1);
    records.splice(nextIndex, 0, record);
    void persistAll();
    refreshUi();
    return true;
  }

  function startPlacementEditing(record) {
    if (!record || record.locked || record.warp?.ok) return;
    cancelGcp(false);
    placementEditingId = record.id;
    mapElement.classList.add('is-reference-placement-mode');
    renderEditor();
    renderer.requestRender();
  }

  function stopPlacementEditing({ renderUi = true } = {}) {
    placementDrag = null;
    placementEditingId = '';
    mapElement.classList.remove('is-reference-placement-mode');
    if (renderUi) renderEditor();
    renderer.requestRender();
  }

  function armGcp(record) {
    if (!record || record.locked) return;
    stopPlacementEditing({ renderUi: false });
    gcpState = { recordId: record.id, step: 'image', image: null };
    mapElement.classList.add('is-reference-gcp-mode');
    setHint('1/2 · 이미지에서 맞출 지점을 선택하세요.', 'working');
  }

  function cancelGcp(renderUi = true) {
    gcpState = null;
    mapElement.classList.remove('is-reference-gcp-mode');
    if (renderUi && selected()) renderEditor();
  }

  function beginPlacementDrag(event, record, point) {
    const hit = referenceImagePlacementHit(record, point);
    if (!hit) return false;
    placementDrag = createReferenceImagePlacementDrag(record, hit, point, event.pointerId);
    if (!placementDrag) return false;
    try { mapElement.setPointerCapture?.(event.pointerId); } catch (_) {}
    return true;
  }

  function updatePlacementDrag(event) {
    if (!placementDrag || event.pointerId !== placementDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === placementDrag.recordId);
    if (!record || record.locked || record.warp?.ok) {
      placementDrag = null;
      return false;
    }
    const changed = applyReferenceImagePlacementDrag(
      record,
      placementDrag,
      canvasPoint(event, mapElement),
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
    if (record) {
      void persist(record);
      renderEditor();
      renderer.requestRender();
    }
    return true;
  }

  function onMapPointerDown(event) {
    if (event.button !== 0) return;
    const point = canvasPoint(event, mapElement);
    if (gcpState) {
      const record = records.find(candidate => candidate.id === gcpState.recordId);
      if (!record || record.locked) {
        cancelGcp();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (gcpState.step === 'image') {
        const uv = renderer.hitTestUv(record, point);
        if (!uv) {
          setHint('이미지가 보이는 영역 안을 선택하세요.', 'error');
          return;
        }
        gcpState.image = uv;
        gcpState.step = 'map';
        setHint('2/2 · 같은 지점의 실제 지도 위치를 선택하세요.', 'working');
        return;
      }
      const coordinate = mapHost()?.unproject(point);
      if (!coordinate || !coordinate.every(Number.isFinite)) {
        setHint('이 위치에서는 지도 좌표를 계산할 수 없습니다.', 'error');
        return;
      }
      record.controlPoints.push({
        id: createId('gcp'),
        image: [...gcpState.image],
        coordinate: [coordinate[0], coordinate[1]],
      });
      rebuildWarp(record);
      void persist(record);
      gcpState = { recordId: record.id, step: 'image', image: null };
      refreshUi();
      setHint('기준점을 추가했습니다. 계속 추가하거나 Esc로 종료하세요.', 'success');
      return;
    }

    const record = selected();
    if (record && placementEditingId === record.id && !record.locked && !record.warp?.ok && beginPlacementDrag(event, record, point)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onMapPointerMove(event) {
    if (!placementDrag) return;
    if (updatePlacementDrag(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onMapPointerUp(event) {
    if (!placementDrag) return;
    if (finishPlacementDrag(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onEditorInput(event) {
    const record = selected();
    if (!record) return;
    const field = event.target?.dataset?.refField;
    if (!field) return;
    const continuous = CONTINUOUS_FIELDS.has(field);
    if (event.type === 'input' && !continuous) return;

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
    if (field === 'warp' || field === 'locked') renderEditor();
    renderer.requestRender();
  }

  async function onPanelClick(event) {
    const action = event.target.closest('[data-ref-action]')?.dataset.refAction;
    if (!action) {
      const row = event.target.closest('[data-reference-image-id]');
      if (row) {
        if (placementEditingId && placementEditingId !== row.dataset.referenceImageId) stopPlacementEditing({ renderUi: false });
        selectedId = row.dataset.referenceImageId;
        refreshUi();
      }
      return;
    }
    const record = selected();
    if (action === 'close') {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      cancelGcp(false);
      stopPlacementEditing({ renderUi: false });
      renderer.requestRender();
      return;
    }
    if (action === 'add') {
      fileInput.click();
      return;
    }
    if (!record) return;
    if (action === 'delete') await removeRecord(record);
    if (action === 'placement') {
      if (placementEditingId === record.id) stopPlacementEditing();
      else startPlacementEditing(record);
    }
    if (action === 'reset-placement' && !record.locked && !record.warp?.ok) {
      record.screenRect = defaultReferenceImageScreenRect(record.image, mapElement);
      record.rotation = 0;
      void persist(record);
      refreshUi();
    }
    if (action === 'bring-forward') moveRecord(record, 1);
    if (action === 'send-backward') moveRecord(record, -1);
    if (action === 'gcp') armGcp(record);
    if (action === 'undo-gcp' && record.controlPoints.length) {
      record.controlPoints.pop();
      rebuildWarp(record);
      void persist(record);
      refreshUi();
    }
    if (action === 'clear-gcp' && record.controlPoints.length) {
      record.controlPoints = [];
      rebuildWarp(record);
      void persist(record);
      refreshUi();
    }
    if (action === 'flip-x' || action === 'flip-y') {
      if (action === 'flip-x') record.flipX = !record.flipX;
      else record.flipY = !record.flipY;
      if (record.controlPoints.length) {
        record.controlPoints = [];
        rebuildWarp(record);
      }
      void persist(record);
      refreshUi();
    }
  }

  function onLauncherClick() {
    panel.hidden = !panel.hidden;
    launcher.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) {
      cancelGcp(false);
      stopPlacementEditing({ renderUi: false });
    }
    renderer.requestRender();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (gcpState) cancelGcp();
    else if (placementEditingId) stopPlacementEditing();
  }

  async function onFileChange() {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    for (const file of files) {
      try {
        await addBlob(file, file.name);
      } catch (error) {
        console.warn('[reference-image-add]', error);
      }
    }
  }

  const onPanelClickEvent = event => { void onPanelClick(event); };
  launcher.addEventListener('click', onLauncherClick);
  panel.addEventListener('click', onPanelClickEvent);
  editorElement.addEventListener('input', onEditorInput);
  editorElement.addEventListener('change', onEditorInput);
  mapElement.addEventListener('pointerdown', onMapPointerDown, true);
  mapElement.addEventListener('pointermove', onMapPointerMove, true);
  mapElement.addEventListener('pointerup', onMapPointerUp, true);
  mapElement.addEventListener('pointercancel', onMapPointerUp, true);
  globalThis.addEventListener('keydown', onKeyDown);
  fileInput.addEventListener('change', onFileChange);

  listStoredReferenceImages()
    .then(async values => {
      const ordered = [...values].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      for (const value of ordered) {
        if (!value?.blob) continue;
        try {
          await addBlob(value.blob, value.name, value, { select: false, save: false });
        } catch (error) {
          console.warn('[reference-image-restore]', error);
        }
      }
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
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      renderer.requestRender();
    },
    close: () => {
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      cancelGcp(false);
      stopPlacementEditing({ renderUi: false });
      renderer.requestRender();
    },
    requestRender: renderer.requestRender,
    destroy: () => {
      if (disposed) return;
      disposed = true;
      void persistAll();
      launcher.removeEventListener('click', onLauncherClick);
      panel.removeEventListener('click', onPanelClickEvent);
      editorElement.removeEventListener('input', onEditorInput);
      editorElement.removeEventListener('change', onEditorInput);
      mapElement.removeEventListener('pointerdown', onMapPointerDown, true);
      mapElement.removeEventListener('pointermove', onMapPointerMove, true);
      mapElement.removeEventListener('pointerup', onMapPointerUp, true);
      mapElement.removeEventListener('pointercancel', onMapPointerUp, true);
      globalThis.removeEventListener('keydown', onKeyDown);
      fileInput.removeEventListener('change', onFileChange);
      records.forEach(record => record.objectUrl && URL.revokeObjectURL(record.objectUrl));
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
