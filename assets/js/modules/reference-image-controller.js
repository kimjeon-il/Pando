import {
  buildReferenceImageCalibrationWarp,
  buildReferenceImageMesh,
  referenceImageWarpQuad,
  REFERENCE_IMAGE_WARP_MODES,
} from './reference-image-georef.js';
import {
  migrateReferenceImageStoredRecord,
  normalizeReferenceImageRecord,
  serializeReferenceImageRecord,
} from './reference-image-model.js';
import {
  alignReferenceImageAnchor,
  defaultReferenceImageMapQuad,
  referenceImagePlacementRotation,
  referenceImageScreenRectToMapQuad,
  setReferenceImagePlacementRotation,
} from './reference-image-transform.js';
import { createReferenceImageInteraction } from './reference-image-interaction.js';
import { createReferenceImageCanvasRenderer } from './reference-image-renderer.js';
import { registerReferenceImageInput } from './reference-image-input.js';
import { applyReferenceImageEdit, copyReferenceImageRecords, createReferenceImageHistory } from './reference-image-edit-session.js';
import { installReferenceImageSurface } from './reference-image-surface.js';
import {
  putStoredReferenceImage,
  readStoredReferenceImageCollection,
  replaceStoredReferenceImages,
} from './reference-image-store.js';
import {
  createReferenceImagePanel,
  referenceImageEditorMarkup,
  renderReferenceImageList,
} from './reference-image-ui.js';

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
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

export function installReferenceImageController({ workspaceSurfaces, confirm, getGeneration = () => 0, isBlocked = () => false, cancelTools = () => {} } = {}) {
  if (document.documentElement.dataset.referenceImageController === 'installed') return globalThis.__PANDOLAB_REFERENCE_IMAGES__ || null;
  const mapElement = document.getElementById('map');
  const launcher = document.getElementById('referenceImageBtn');
  if (!mapElement || !launcher) return null;
  document.documentElement.dataset.referenceImageController = 'installed';

  const panel = createReferenceImagePanel();
  mapElement.append(panel);

  const fileInput = panel.querySelector('[data-ref-file]');
  const listElement = panel.querySelector('[data-ref-list]');
  const emptyElement = panel.querySelector('[data-ref-empty]');
  const editorElement = panel.querySelector('[data-ref-editor]');
  const records = [];
  const retainedRecords = [];
  const dirtyRecords = new Set();
  let dirtyCollection = false;
  let storageState = 'loading';
  let storageError = '';
  const recordVersions = new Map();
  let collectionVersion = 0;
  const markRecordDirty = id => {
    dirtyRecords.add(id);
    const version = (recordVersions.get(id) || 0) + 1;
    recordVersions.set(id, version);
    return version;
  };
  const pendingPersistTimers = new Map();
  let selectedId = '';
  let disposed = false;
  let session = 0;
  let continuousBefore = null;
  const history = createReferenceImageHistory();
  const objectUrls = new Set();
  const currentToken = () => `${session}:${getGeneration()}`;
  const validToken = token => !disposed && token === currentToken() && !isBlocked();
  let surface;
  let interaction;

  const selected = () => records.find(record => record.id === selectedId) || null;
  const interactionState = () => interaction?.getState() || {
    anchorState: null,
    gcpState: null,
    controlPointEditingId: '',
    selectedControlPointId: '',
    placementEditingId: '',
    freeTransformEditingId: '',
  };
  const renderer = createReferenceImageCanvasRenderer({
    mapElement,
    getRecords: () => records,
    getSelectedId: () => selectedId,
    getPlacementEditingId: () => interactionState().placementEditingId,
    getFreeTransformEditingId: () => interactionState().freeTransformEditingId,
    getControlPointEditingId: () => interactionState().controlPointEditingId,
    getSelectedControlPointId: () => interactionState().selectedControlPointId,
    isPanelHidden: () => panel.hidden,
  });

  function rebuildWarp(record) {
    record.warp = buildReferenceImageCalibrationWarp({
      controlPoints: record.controlPoints,
      anchor: record.anchor,
      cornerPinEnabled: record.cornerPinEnabled,
      mapQuad: record.mapQuad,
      mode: record.warpMode,
    });
    record.mesh = record.warp.ok ? buildReferenceImageMesh(record.warp, MESH_QUALITY) : null;
    record.projectedMesh = null;
    if (record.warp.ok && interactionState().placementEditingId === record.id) {
      interaction?.stopPlacementEditing({ renderUi: false });
    }
  }

  function clearScheduledPersist(recordId) {
    const timer = pendingPersistTimers.get(recordId);
    if (timer) globalThis.clearTimeout(timer);
    pendingPersistTimers.delete(recordId);
  }

  function persist(record) {
    if (storageState !== 'ready') return Promise.resolve(false);
    const index = records.indexOf(record);
    if (index < 0 || !record.blob) return Promise.resolve(false);
    clearScheduledPersist(record.id);
    const version = markRecordDirty(record.id);
    return putStoredReferenceImage(serializeReferenceImageRecord(record, index))
      .then(() => {
        if (version === recordVersions.get(record.id) && !pendingPersistTimers.has(record.id)) dirtyRecords.delete(record.id);
        return true;
      })
      .catch(error => {
        console.warn('[reference-image-store]', error);
        storageError = '참조 이미지를 저장하지 못했습니다. 변경 사항을 유지했습니다.';
        renderStorageStatus();
        return false;
      });
  }

  function schedulePersist(record) {
    if (storageState !== 'ready') return;
    const index = records.indexOf(record);
    if (index < 0 || !record.blob) return;
    clearScheduledPersist(record.id);
    markRecordDirty(record.id);
    const token = currentToken();
    const timer = globalThis.setTimeout(() => {
      pendingPersistTimers.delete(record.id);
      if (validToken(token)) void persist(record);
    }, PERSIST_DEBOUNCE_MS);
    pendingPersistTimers.set(record.id, timer);
  }

  function persistAll() {
    if (storageState !== 'ready') return Promise.resolve(false);
    dirtyCollection = true;
    const version = ++collectionVersion;
    const versions = new Map(recordVersions);
    for (const recordId of [...pendingPersistTimers.keys()]) clearScheduledPersist(recordId);
    return replaceStoredReferenceImages([...records.map((record, order) => serializeReferenceImageRecord(record, order)), ...retainedRecords])
      .then(() => {
        if (version === collectionVersion) dirtyCollection = false;
        for (const id of dirtyRecords) {
          if (versions.get(id) === recordVersions.get(id) && !pendingPersistTimers.has(id)) dirtyRecords.delete(id);
        }
        return true;
      })
      .catch(error => {
        console.warn('[reference-image-store]', error);
        storageError = '참조 이미지를 저장하지 못했습니다. 변경 사항을 유지했습니다.';
        renderStorageStatus();
        return false;
      });
  }

  function renderStorageStatus() {
    const status = panel.querySelector('[data-ref-storage-status]');
    const retry = panel.querySelector('[data-ref-action="retry-storage"]');
    const text = storageState === 'loading' ? '저장된 참조 이미지를 읽는 중입니다.'
      : storageError || (retainedRecords.length ? `${retainedRecords.length}개 이미지를 표시하지 못했습니다. 저장된 원본은 보관했습니다.` : '');
    status.hidden = !text;
    panel.querySelector('[data-ref-storage-message]').textContent = text;
    retry.hidden = !storageError;
    retry.textContent = storageState === 'error' ? '다시 읽기' : '다시 저장';
    retry.disabled = storageState === 'loading';
    panel.querySelector('[data-ref-action="add"]').disabled = storageState !== 'ready';
    fileInput.disabled = storageState !== 'ready';
  }

  function renderList() {
    emptyElement.hidden = records.length > 0;
    renderReferenceImageList(listElement, records, selectedId);
  }

  function renderEditor() {
    renderStorageStatus();
    const historyLocked = records.some(record => record.locked);
    panel.querySelector('[data-ref-action="undo"]').disabled = !history.canUndo() || historyLocked;
    panel.querySelector('[data-ref-action="redo"]').disabled = !history.canRedo() || historyLocked;
    const record = selected();
    editorElement.hidden = !record;
    if (!record) {
      editorElement.replaceChildren();
      return;
    }
    const state = interactionState();
    editorElement.innerHTML = referenceImageEditorMarkup({
      record,
      warp: record.warp,
      placementEditing: state.placementEditingId === record.id,
      freeTransformEditing: state.freeTransformEditingId === record.id,
      index: records.indexOf(record),
      count: records.length,
      blendOptions: BLEND_OPTIONS,
      warpOptions: WARP_OPTIONS,
      anchorState: state.anchorState?.recordId === record.id ? state.anchorState : null,
      gcpState: state.gcpState,
      controlPointEditing: state.controlPointEditingId === record.id,
      selectedControlPointId: state.selectedControlPointId,
      placementRotation: referenceImagePlacementRotation(record, mapHost()),
    });
    interaction?.syncSurface();
  }

  function cancelInteraction() {
    interaction?.cancelAll();
  }

  function restoreHistory(direction) {
    if (storageState !== 'ready' || isBlocked() || records.some(record => record.locked)) return;
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
    if (save && storageState !== 'ready') throw new Error('참조 이미지 저장 목록을 먼저 읽어야 합니다.');
    if (!(blob instanceof Blob) || !ACCEPTED_IMAGE_TYPES.has(blob.type)) throw new Error('PNG, JPG, WebP 이미지만 사용할 수 있습니다.');
    const token = currentToken();
    const decoded = await createImageFromBlob(blob);
    if (!validToken(token)) { URL.revokeObjectURL(decoded.url); return null; }
    objectUrls.add(decoded.url);
    const host = mapHost();
    if (!host) throw new Error('지도 좌표계를 준비할 수 없습니다.');
    let migration = null;
    let source;
    if (persisted) {
      const legacyMapQuad = persisted?.screenRect
        ? referenceImageScreenRectToMapQuad(persisted.screenRect, persisted.rotation, host)
        : null;
      migration = migrateReferenceImageStoredRecord({
        ...persisted,
        id: persisted?.id || createId(),
        name: String(persisted?.name || name || '참조 이미지'),
        blob,
      }, { legacyMapQuad });
      if (migration.unsupportedFutureVersion) {
        throw new Error(`현재 버전보다 새로운 참조 이미지 저장 형식(v${migration.sourceVersion})입니다.`);
      }
      source = migration.record;
      if (migration.needsPlacementMigration || !source?.mapQuad) {
        throw new Error('구버전 참조 이미지의 배치 정보를 현재 지도 좌표로 변환할 수 없습니다.');
      }
    } else {
      source = normalizeReferenceImageRecord({
        id: createId(),
        name: String(name || '참조 이미지'),
        blob,
      });
    }

    const mapQuad = source.mapQuad || defaultReferenceImageMapQuad(decoded.image, mapElement, host);
    if (!mapQuad) throw new Error('참조 이미지를 현재 지도 위치에 배치할 수 없습니다.');
    const record = {
      ...source,
      id: source.id || createId(),
      name: source.name || '참조 이미지',
      blob,
      image: decoded.image,
      objectUrl: decoded.url,
      mapQuad,
      warp: null,
      mesh: null,
      projectedMesh: null,
      storageNeedsUpgrade: migration?.migrated === true,
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
    interaction?.handleRecordRemoved(record);
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

  function onEditorInput(event) {
    const record = selected();
    if (!record || storageState !== 'ready' || isBlocked()) return;
    const field = event.target?.dataset?.refField;
    if (!field) return;
    const continuous = CONTINUOUS_FIELDS.has(field);
    if (event.type === 'input' && !continuous) return;
    if (record.locked && ['rotation', 'warp'].includes(field)) return;
    if (continuous && !continuousBefore) continuousBefore = copyReferenceImageRecords(records);
    if (!continuous && field !== 'locked') history.push(records);

    if (field === 'name') record.name = event.target.value || '참조 이미지';
    if (field === 'opacity') record.opacity = clamp(Number(event.target.value), 0, 1);
    if (field === 'rotation' && !record.warp?.ok && !record.locked) {
      setReferenceImagePlacementRotation(record, mapHost(), event.target.value);
    }
    if (field === 'blend') record.blendMode = event.target.value;
    if (field === 'warp') {
      record.warpMode = event.target.value;
      rebuildWarp(record);
    }
    if (field === 'visible') record.visible = event.target.checked;
    if (field === 'locked') {
      record.locked = event.target.checked;
      interaction?.handleRecordLocked(record);
    }

    if (event.type === 'input' && continuous) schedulePersist(record);
    else void persist(record);
    if (field === 'name' || field === 'visible') renderList();
    if (field === 'opacity') {
      const output = event.target.parentElement?.querySelector('output');
      if (output) output.textContent = `${Math.round(record.opacity * 100)}%`;
    }
    if (field === 'rotation') event.target.value = numberText(referenceImagePlacementRotation(record, mapHost()), 1);
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
    if (action === 'retry-storage') {
      if (storageState === 'error') await restoreStoredImages();
      else if (await persistAll()) { storageError = ''; renderStorageStatus(); }
      return;
    }
    if (storageState !== 'ready' && action !== 'close') return;
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
      if (interactionState().placementEditingId === record.id) interaction.stopPlacementEditing();
      else interaction.startPlacementEditing(record);
    }
    if (action === 'free-transform') {
      if (interactionState().freeTransformEditingId === record.id) interaction.stopFreeTransformEditing();
      else interaction.startFreeTransformEditing(record);
      return;
    }
    if (action === 'anchor') {
      if (interactionState().anchorState?.recordId === record.id) interaction.cancelAnchor();
      else interaction.armAnchor(record);
      return;
    }
    if (action === 'clear-anchor' && record.anchor && !record.locked) {
      const fallbackQuad = referenceImageWarpQuad(record.warp);
      history.push(records);
      record.anchor = null;
      rebuildWarp(record);
      if (!record.warp.ok && fallbackQuad) record.mapQuad = fallbackQuad;
      void persist(record);
      refreshUi();
      return;
    }
    if (action === 'reset-placement' && !record.locked && !record.warp?.ok) {
      const mapQuad = defaultReferenceImageMapQuad(record.image, mapElement, mapHost());
      if (mapQuad) {
        history.push(records);
        record.mapQuad = mapQuad;
        record.anchor = null;
        record.cornerPinEnabled = false;
        rebuildWarp(record);
        void persist(record);
        refreshUi();
      }
    }
    if (action === 'bring-forward') moveRecord(record, 1);
    if (action === 'send-backward') moveRecord(record, -1);
    if (action === 'gcp') {
      if (interactionState().gcpState?.recordId === record.id) interaction.cancelGcp();
      else interaction.armGcp(record);
      return;
    }
    if (action === 'gcp-edit') {
      if (interactionState().controlPointEditingId === record.id) interaction.stopControlPointEditing();
      else interaction.startControlPointEditing(record);
      return;
    }
    if (action === 'edit-image' || action === 'edit-coordinate') {
      interaction.armGcp(record, button.dataset.pointId, action === 'edit-image' ? 'image' : 'map');
    }
    const before = copyReferenceImageRecords(records);
    const fallbackQuad = referenceImageWarpQuad(record.warp);
    const editAction = action === 'undo-gcp' ? 'delete-gcp' : action;
    const id = action === 'undo-gcp' ? record.controlPoints.at(-1)?.id : button?.dataset.pointId;
    if (applyReferenceImageEdit(record, editAction, { id })) {
      history.push(before);
      interaction.cancelGcp(false);
      interaction.clearSelectedControlPoint();
      rebuildWarp(record);
      if (!record.warp.ok && fallbackQuad) {
        record.mapQuad = fallbackQuad;
        if (record.anchor) alignReferenceImageAnchor(record);
      }
      void persist(record);
      refreshUi();
    }
  }

  function onKeyDown(event) {
    if (panel.hidden || isBlocked()) return false;
    if (event.key === 'Enter' && event.target?.closest('button,[role="button"]')) return false;
    if (event.key === 'Escape') {
      if (interaction?.isActive()) cancelInteraction();
      else surface.close({ restoreFocus: true });
      return true;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && interaction?.deleteSelectedControlPoint()) {
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      restoreHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'); return true;
    }
    return ['Delete', 'Backspace', 'Enter'].includes(event.key) && !!interaction?.isActive();
  }

  async function onFileChange() {
    if (storageState !== 'ready') return;
    const token = currentToken();
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    for (const file of files) {
      if (!validToken(token)) break;
      try {
        await addBlob(file, file.name);
      } catch (error) {
        console.warn('[reference-image-add]', error);
        storageError = error.message;
        renderStorageStatus();
      }
    }
  }

  interaction = createReferenceImageInteraction({
    mapElement,
    records,
    selected,
    renderer,
    getMapHost: mapHost,
    getSurface: () => surface,
    cancelTools,
    currentToken,
    validToken,
    createId,
    rebuildWarp,
    getCurrentWarpQuad: record => referenceImageWarpQuad(record?.warp),
    history,
    persist,
    renderEditor,
    refreshUi,
    setHint,
  });

  const onPanelClickEvent = event => { void onPanelClick(event).catch(error => {
    console.warn('[reference-image-action]', error);
    storageError = error.message;
    renderStorageStatus();
  }); };
  surface = installReferenceImageSurface({ panel, launcher, workspaceSurfaces, onClose: cancelInteraction, onOpen: () => renderer.requestRender() });
  const unregisterInput = registerReferenceImageInput({
    begin: interaction.beginGesture,
    active: interaction.isActive,
    key: onKeyDown,
    cancel: cancelInteraction,
    reset: resetSession,
  });
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

  async function restoreStoredImages() {
    const restoreToken = currentToken();
    storageState = 'loading'; storageError = ''; renderStorageStatus();
    try {
      const collection = await readStoredReferenceImageCollection();
      const values = collection.records;
      let needsStorageUpgrade = collection.needsUpgrade;
      const ordered = [...values].sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
      retainedRecords.splice(0);
      const seenIds = new Set();
      for (const value of ordered) {
        if (!validToken(restoreToken)) throw new Error('프로젝트가 변경되었습니다. 저장 목록을 다시 읽으세요.');
        if (value?.id && seenIds.has(value.id)) { retainedRecords.push(value); continue; }
        if (value?.id) seenIds.add(value.id);
        if (!value?.blob) { retainedRecords.push(value); continue; }
        if (records.some(record => record.id === value.id)) continue;
        try {
          const record = await addBlob(value.blob, value.name, value, { select: false, save: false });
          if (!record) throw new Error('참조 이미지 읽기가 중단되었습니다.');
          if (record.storageNeedsUpgrade) needsStorageUpgrade = true;
        } catch (error) {
          retainedRecords.push(value);
          console.warn('[reference-image-restore]', error);
        }
      }
      if (!validToken(restoreToken)) throw new Error('프로젝트가 변경되었습니다. 저장 목록을 다시 읽으세요.');
      storageState = 'ready';
      selectedId = records.at(-1)?.id || '';
      if (needsStorageUpgrade) {
        const upgraded = await persistAll();
        if (upgraded) {
          for (const record of records) record.storageNeedsUpgrade = false;
        }
      }
    } catch (error) {
      storageState = 'error';
      storageError = '저장된 참조 이미지를 읽지 못했습니다. 원본을 보존했습니다. 다시 읽기를 눌러 재시도하세요.';
      console.warn('[reference-image-store]', error);
    }
    if (!disposed) refreshUi();
  }
  void restoreStoredImages();

  const api = Object.freeze({
    list: () => {
      const state = interactionState();
      return records.map((record, order) => ({
        id: record.id,
        name: record.name,
        order,
        visible: record.visible,
        locked: record.locked,
        opacity: record.opacity,
        blendMode: record.blendMode,
        rotation: referenceImagePlacementRotation(record, mapHost()),
        placementEditing: state.placementEditingId === record.id,
        freeTransformEditing: state.freeTransformEditingId === record.id,
        cornerPinEnabled: !!record.cornerPinEnabled,
        anchored: !!record.anchor,
        warpMode: record.warp?.mode || record.warpMode,
        controlPointCount: record.controlPoints.length,
        diagnostics: record.warp?.ok ? record.warp.diagnostics : null,
      }));
    },
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
      if (storageState === 'ready' && (dirtyCollection || dirtyRecords.size || pendingPersistTimers.size)) void persistAll();
      else for (const id of [...pendingPersistTimers.keys()]) clearScheduledPersist(id);
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
