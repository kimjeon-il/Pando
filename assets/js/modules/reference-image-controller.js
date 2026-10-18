import {
  buildReferenceImageAutoGeoref,
  buildReferenceImageCalibrationWarp,
  buildReferenceImageMesh,
  referenceImageWarpQuad,
  REFERENCE_IMAGE_WARP_MODES,
} from './reference-image-georef.js';
import {
  normalizeReferenceImageRecord,
  referenceImageMappingSignature,
  serializeReferenceImageRecord,
} from './reference-image-model.js';
import {
  alignReferenceImageAnchor,
  defaultReferenceImageMapQuad,
  referenceImagePlacementRotation,
  setReferenceImagePlacementRotation,
} from './reference-image-transform.js';
import { createReferenceImageInteraction } from './reference-image-interaction.js';
import { createReferenceImageCanvasRenderer } from './reference-image-renderer.js';
import { getReferenceImageLiveWireField, traceReferenceImageLinearAnchors } from './reference-image-live-wire.js';
import { buildReferenceImageSourceMapping } from './reference-image-source-mapping.js';
import { referenceImageKeyBlocked, registerReferenceImageInput } from './reference-image-input.js';
import { applyReferenceImageEdit, copyReferenceImageRecords, createReferenceImageHistory } from './reference-image-edit-session.js';
import {
  buildReferenceImagePlaceSeeds,
  buildReferenceImagePlaceSymbolCandidates,
  createReferenceImagePointRaster,
  findReferenceImagePointSymbolNearTextBox,
} from './reference-image-auto-georef.js';
import { detectReferenceImageText } from './reference-image-ocr.js';
import {
  resolveReferenceImagePlaceAutoGeoref,
  resolveReferenceImagePlaceDetections,
} from './reference-image-place-match.js';
import { installReferenceImageSurface } from './reference-image-surface.js';
import {
  listStoredReferenceImages,
  putStoredReferenceImage,
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

export function installReferenceImageController({
  workspaceSurfaces,
  confirm,
  getGeneration = () => 0,
  isBlocked = () => false,
  cancelTools = () => {},
  searchPlaces = null,
  getPlaces = null,
  preparePlaces = null,
} = {}) {
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
  let activeTab = 'placement';
  let disposed = false;
  let session = 0;
  let continuousBefore = null;
  let linearDraft = null;
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
    getRecords: () => linearDraft?.preview
      ? records.map(record => record.id === linearDraft.recordId ? linearDraft.preview.record : record)
      : records,
    getLinearDraft: () => linearDraft,
    getSelectedId: () => selectedId,
    getPlacementEditingId: () => interactionState().placementEditingId,
    getFreeTransformEditingId: () => interactionState().freeTransformEditingId,
    getControlPointEditingId: () => interactionState().controlPointEditingId,
    getSelectedControlPointId: () => interactionState().selectedControlPointId,
    isPanelHidden: () => panel.hidden,
  });

  function rebuildWarp(record) {
    record.autoGeorefPreview = null;
    record.warp = buildReferenceImageCalibrationWarp({
      controlPoints: record.controlPoints,
      anchor: record.anchor,
      linearConstraints: record.linearConstraints,
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
    for (const button of panel.querySelectorAll('[data-ref-action="undo"]')) button.disabled = !history.canUndo() || historyLocked;
    for (const button of panel.querySelectorAll('[data-ref-action="redo"]')) button.disabled = !history.canRedo() || historyLocked;
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
      linearDraft: linearDraft?.recordId === record.id ? linearDraft : null,
      activeTab,
    });
    interaction?.syncSurface();
    if (linearDraft) surface?.setEditing(true, linearDraft.phase === 'image'
      ? '이미지에서 선을 따라 점을 찍으세요.'
      : linearDraft.phase === 'map' ? '지도에서 대응 선을 찍으세요.' : '변형 이미지를 확인하세요.');
  }

  function cancelLinearDraft({ render = true } = {}) {
    if (!linearDraft) return;
    linearDraft = null;
    mapElement.classList.remove('is-reference-linear-mode');
    surface?.setEditing(false);
    if (render) { renderEditor(); renderer.requestRender(); }
  }

  function startLinearDraft(record, kind) {
    if (!record || record.locked || !['river', 'coastline'].includes(kind)) return false;
    const sourceWarp = buildReferenceImageSourceMapping(record);
    if (record.controlPoints.length < 2 || !record.warp?.ok || !sourceWarp.ok) {
      setHint('먼저 기준점 보정을 완료하세요.', 'error'); return false;
    }
    interaction?.cancelAll({ renderUi: false });
    let field;
    try { field = getReferenceImageLiveWireField(record.image); }
    catch { setHint('이미지의 경계를 분석하지 못했습니다.', 'error'); return false; }
    cancelLinearDraft({ render: false });
    linearDraft = {
      recordId: record.id, kind, phase: 'image', anchors: [], image: [], coordinates: [],
      field, sourceWarp, preview: null, error: '',
      signature: referenceImageMappingSignature(record), version: recordVersions.get(record.id) || 0,
    };
    mapElement.classList.add('is-reference-linear-mode');
    renderEditor(); renderer.requestRender(); return true;
  }

  function linearGesture(point, event, { spacePan = false } = {}) {
    if (!linearDraft || event.button === 1 || spacePan) return null;
    if (event.button !== 0) return null;
    const draft = linearDraft;
    return { kind: 'tap', end: next => {
      if (linearDraft !== draft || selected()?.id !== draft.recordId) return;
      const record = selected();
      if (draft.phase === 'image') {
        const uv = renderer.hitTestUv(record, next);
        if (!uv) { draft.error = '이미지가 보이는 영역 안을 선택하세요.'; renderEditor(); return; }
        const anchors = [...draft.anchors, uv];
        if (anchors.length >= 2) {
          const result = traceReferenceImageLinearAnchors(draft.field, anchors);
          if (!result.ok) { draft.error = '선 자동 추적에 실패했습니다. 다른 지점을 찍으세요.'; renderEditor(); return; }
          draft.image = result.image;
        }
        draft.anchors = anchors;
      } else if (draft.phase === 'map') {
        const coordinate = mapHost()?.unproject(next);
        if (!coordinate?.every(Number.isFinite)) { draft.error = '지도 좌표를 읽을 수 없습니다.'; renderEditor(); return; }
        draft.coordinates.push([coordinate[0], coordinate[1]]);
      }
      draft.error = '';renderEditor();renderer.requestRender();
    } };
  }

  function previewLinearDraft(record) {
    if (!linearDraft || linearDraft.phase !== 'map' || linearDraft.coordinates.length < 2) return false;
    if (linearDraft.signature !== referenceImageMappingSignature(record)
      || linearDraft.version !== (recordVersions.get(record.id) || 0)) {
      linearDraft.error = '참조 이미지가 변경되었습니다. 선 제약을 다시 지정하세요.';
      linearDraft.preview = null; renderEditor(); return false;
    }
    const constraint = {
      id: createId('linear'), kind: linearDraft.kind, image: linearDraft.image.map(point => [...point]),
      coordinates: linearDraft.coordinates.map(point => [...point]), weight: 1, enabled: true,
    };
    const warp = buildReferenceImageCalibrationWarp({
      controlPoints: record.controlPoints, anchor: record.anchor,
      linearConstraints: [...record.linearConstraints, constraint],
      cornerPinEnabled: record.cornerPinEnabled, mapQuad: record.mapQuad, mode: record.warpMode,
    });
    if (!warp.ok) { linearDraft.error = '미리보기를 만들 수 없습니다. 기준점 또는 배치를 확인하세요.'; renderEditor(); return false; }
    linearDraft.preview = { constraint, record: { ...record, warp, mesh: buildReferenceImageMesh(warp, MESH_QUALITY), projectedMesh: null } };
    linearDraft.phase = 'preview';linearDraft.error = '';
    renderEditor();renderer.requestRender();return true;
  }

  function cancelInteraction() {
    cancelLinearDraft({ render: false });
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

  function autoGeorefFailureMessage(result) {
    const reason = String(result?.reason || '');
    if (reason === 'insufficient-place-seeds') return '현재 화면에서 자동 맞춤에 사용할 도시가 충분하지 않습니다. 지도를 대상 지역에 대략 맞춰 놓고 다시 시도하세요.';
    if (reason === 'insufficient-symbol-candidates') return '도시 주변에서 지도 기호를 충분히 찾지 못했습니다. 이미지를 조금 더 정확히 배치하거나 수동 고정점 하나를 지정하세요.';
    if (reason === 'no-auto-georef-consensus') return '도시 기호 후보들의 위치가 서로 일치하지 않아 자동 정렬을 확정하지 못했습니다.';
    if (reason === 'auto-georef-preview-stale') return '미리보기 뒤에 이미지 배치가 바뀌었습니다. 자동 맞춤을 다시 실행하세요.';
    if (reason === 'place-snapshot-unavailable') return '도시 데이터에 접근할 수 없어 자동 맞춤을 실행할 수 없습니다.';
    if (reason === 'text-detector-unavailable') return '이 브라우저에서는 OCR을 사용할 수 없습니다. 도시 기호 기반 자동 맞춤 결과를 확인하세요.';
    if (reason === 'no-ocr-text') return '이미지에서 도시명으로 사용할 문자를 찾지 못했습니다.';
    if (reason === 'insufficient-ocr-symbol-candidates') return '도시명은 찾았지만 주변에서 실제 도시 기호를 충분히 찾지 못했습니다.';
    if (reason === 'text-detector-failed') return '브라우저 OCR 실행에 실패했습니다.';
    return '자동 맞춤 결과를 만들지 못했습니다. 대략 배치나 고정점을 조정한 뒤 다시 시도하세요.';
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
    const source = persisted
      ? normalizeReferenceImageRecord({
        ...persisted,
        id: persisted?.id || createId(),
        name: String(persisted?.name || name || '참조 이미지'),
        blob,
      })
      : normalizeReferenceImageRecord({
        id: createId(),
        name: String(name || '참조 이미지'),
        blob,
      });
    if (persisted && !source.mapQuad) {
      throw new Error('참조 이미지 저장 데이터에 지도 배치 정보가 없습니다.');
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
      if (record.locked) cancelLinearDraft({ render: false });
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
    for (const button of panel.querySelectorAll('[data-ref-action="undo"]')) button.disabled = !history.canUndo() || historyLocked;
    for (const button of panel.querySelectorAll('[data-ref-action="redo"]')) button.disabled = !history.canRedo() || historyLocked;
    if (field === 'warp' || field === 'locked') renderEditor();
    renderer.requestRender();
  }

  function setEditorTab(next, { focus = false } = {}) {
    if (!['placement', 'match', 'display'].includes(next)) return false;
    activeTab = next;
    for (const tab of editorElement.querySelectorAll('[data-ref-tab]')) {
      const selectedTab = tab.dataset.refTab === activeTab;
      tab.classList.toggle('is-active', selectedTab);
      tab.setAttribute('aria-selected', String(selectedTab));
      tab.tabIndex = selectedTab ? 0 : -1;
      if (selectedTab && focus) tab.focus({ preventScroll: true });
    }
    for (const section of editorElement.querySelectorAll('[data-ref-section]')) {
      section.hidden = section.dataset.refSection !== activeTab;
    }
    return true;
  }

  function onEditorTabKeydown(event) {
    const tab = event.target.closest?.('[data-ref-tab]');
    if (!tab) return;
    const order = ['placement', 'match', 'display'];
    const current = order.indexOf(tab.dataset.refTab);
    const next = event.key === 'Home' ? order[0] : event.key === 'End' ? order.at(-1)
      : event.key === 'ArrowRight' ? order[(current + 1) % order.length]
        : event.key === 'ArrowLeft' ? order[(current + order.length - 1) % order.length] : null;
    if (!next) return;
    event.preventDefault();
    setEditorTab(next, { focus: true });
  }

  function onListAction(button) {
    if (button.disabled || storageState !== 'ready' || isBlocked()) return;
    const record = records.find(item => item.id === button.dataset.refRecordId);
    if (!record) return;
    const action = button.dataset.refListAction;
    if (action === 'forward' || action === 'backward') {
      moveRecord(record, action === 'forward' ? 1 : -1);
      return;
    }
    if (action === 'visible') {
      history.push(records);
      record.visible = !record.visible;
    } else if (action === 'locked') {
      record.locked = !record.locked;
      if (record.locked) {
        if (linearDraft?.recordId === record.id) cancelLinearDraft({ render: false });
        interaction?.handleRecordLocked(record);
      }
    } else return;
    void persist(record);
    refreshUi();
  }

  async function onPanelClick(event) {
    const listButton = event.target.closest('[data-ref-list-action]');
    if (listButton) { onListAction(listButton); return; }
    const tabButton = event.target.closest('[data-ref-tab]');
    if (tabButton) { setEditorTab(tabButton.dataset.refTab); return; }
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
    if (action === 'linear-cancel') { cancelLinearDraft(); return; }
    if (record.locked && !['bring-forward', 'send-backward', 'cancel-auto-georef'].includes(action)) return;
    if (action === 'linear-river' || action === 'linear-coastline') {
      startLinearDraft(record, action === 'linear-river' ? 'river' : 'coastline');return;
    }
    if (action === 'linear-image-undo' && linearDraft?.phase === 'image') {
      linearDraft.anchors.pop();
      const result = traceReferenceImageLinearAnchors(linearDraft.field, linearDraft.anchors);
      linearDraft.image = result.ok ? result.image : [];
      linearDraft.error = '';renderEditor();renderer.requestRender();return;
    }
    if (action === 'linear-image-finish' && linearDraft?.phase === 'image' && linearDraft.image.length >= 2) {
      linearDraft.phase = 'map';renderEditor();renderer.requestRender();return;
    }
    if (action === 'linear-map-undo' && linearDraft?.phase === 'map') {
      linearDraft.coordinates.pop();renderEditor();renderer.requestRender();return;
    }
    if (action === 'linear-preview') { previewLinearDraft(record);return; }
    if (action === 'linear-apply' && linearDraft?.phase === 'preview') {
      const draft = linearDraft;
      if (draft.signature !== referenceImageMappingSignature(record)
        || draft.version !== (recordVersions.get(record.id) || 0)) {
        draft.error = '미리보기 뒤에 참조 이미지가 변경되었습니다. 다시 지정하세요.';
        draft.preview = null;draft.phase = 'map';renderEditor();renderer.requestRender();return;
      }
      const before = copyReferenceImageRecords(records);
      record.linearConstraints = [...record.linearConstraints, draft.preview.constraint];
      rebuildWarp(record);
      if (!record.warp.ok) {
        record.linearConstraints = before.find(item => item.id === record.id)?.linearConstraints || [];
        rebuildWarp(record);draft.error = '선 제약을 적용하지 못했습니다.';
        renderEditor();renderer.requestRender();return;
      }
      history.push(before);
      void persist(record);
      cancelLinearDraft({ render: false });refreshUi();return;
    }
    if (action === 'linear-remove') {
      const before = copyReferenceImageRecords(records);
      const next = record.linearConstraints.filter(item => item.id !== button.dataset.constraintId);
      if (next.length === record.linearConstraints.length) return;
      record.linearConstraints = next;rebuildWarp(record);history.push(before);
      void persist(record);refreshUi();return;
    }
    if (linearDraft) cancelLinearDraft({ render: false });
    if (action === 'auto-georef') {
      cancelInteraction();
      record.autoGeorefBusy = true;
      record.autoGeorefPreview = null;
      renderEditor();
      const token = currentToken();
      await new Promise(resolve => requestAnimationFrame(resolve));
      try {
        const result = await autoGeorefSmart({ id: record.id });
        if (!validToken(token) || selected() !== record || !records.includes(record)) return;
        record.autoGeorefBusy = false;
        record.autoGeorefPreview = result.ok ? result : null;
        renderEditor();
        if (result.ok) {
          const method = result.source === 'place-ocr' ? 'OCR 도시명' : '도시 기호';
          const candidates = result.source === 'place-ocr'
            ? (result.matching?.matchCount ?? 0)
            : (result.symbolCandidateCount ?? 0);
          setHint(`${method} 후보 ${candidates}개 중 ${result.georef.inlierCount}개를 채택했습니다. 결과를 확인한 뒤 적용하세요.`, 'success');
        } else setHint(autoGeorefFailureMessage(result), 'error');
      } catch (error) {
        if (!validToken(token) || selected() !== record || !records.includes(record)) return;
        record.autoGeorefBusy = false;
        record.autoGeorefPreview = null;
        renderEditor();
        setHint(error?.message || '자동 맞춤 분석 중 오류가 발생했습니다.', 'error');
      }
      return;
    }
    if (action === 'cancel-auto-georef') {
      record.autoGeorefPreview = null;
      record.autoGeorefBusy = false;
      renderEditor();
      setHint('자동 맞춤 미리보기를 취소했습니다.');
      return;
    }
    if (action === 'apply-auto-georef') {
      const preview = record.autoGeorefPreview;
      if (!preview?.ok) return;
      const token = currentToken();
      record.autoGeorefBusy = true;
      renderEditor();
      const result = await applyPlaceAutoGeorefResult(record, preview, token);
      if (!validToken(token) || selected() !== record || !records.includes(record)) return;
      record.autoGeorefBusy = false;
      record.autoGeorefPreview = null;
      renderEditor();
      if (result.applied) {
        setHint(`자동 기준점 ${result.appliedControlPointCount}개를 적용했습니다. 필요하면 개별 기준점을 수정하세요.`, 'success');
      } else setHint(autoGeorefFailureMessage(result), 'error');
      return;
    }
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
    if (panel.hidden || isBlocked() || referenceImageKeyBlocked(event)) return false;
    if (event.key === 'Enter' && event.target?.closest('button,[role="button"]')) return false;
    if (event.key === 'Escape') {
      if (linearDraft || interaction?.isActive()) cancelInteraction();
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
    begin: (point, event, context) => linearDraft ? linearGesture(point, event, context) : interaction.beginGesture(point, event, context),
    active: () => !!linearDraft || interaction.isActive(),
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
  editorElement.addEventListener('keydown', onEditorTabKeydown);
  fileInput.addEventListener('change', onFileChange);

  async function restoreStoredImages() {
    const restoreToken = currentToken();
    storageState = 'loading'; storageError = ''; renderStorageStatus();
    try {
      const values = await listStoredReferenceImages();
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
        } catch (error) {
          retainedRecords.push(value);
          console.warn('[reference-image-restore]', error);
        }
      }
      if (!validToken(restoreToken)) throw new Error('프로젝트가 변경되었습니다. 저장 목록을 다시 읽으세요.');
      storageState = 'ready';
      selectedId = records.at(-1)?.id || '';
    } catch (error) {
      storageState = 'error';
      storageError = '저장된 참조 이미지를 읽지 못했습니다. 원본을 보존했습니다. 다시 읽기를 눌러 재시도하세요.';
      console.warn('[reference-image-store]', error);
    }
    if (!disposed) refreshUi();
  }
  void restoreStoredImages();


  function coarseAutoGeorefMode(record, requestedMode = null) {
    return requestedMode
      || (record.warpMode === REFERENCE_IMAGE_WARP_MODES.TPS
        ? REFERENCE_IMAGE_WARP_MODES.AUTO
        : record.warpMode);
  }

  async function applyPlaceAutoGeorefResult(record, result, token = currentToken()) {
    if (!result?.ok) return Object.freeze({ ...result, applied: false });
    if (
      result.baseMappingSignature
      && result.baseMappingSignature !== referenceImageMappingSignature(record)
    ) {
      return Object.freeze({ ...result, ok: false, reason: 'auto-georef-preview-stale', applied: false });
    }
    if (!validToken(token) || !records.includes(record) || record.locked || isBlocked() || storageState !== 'ready') {
      return Object.freeze({ ...result, ok: false, reason: 'reference-image-session-changed', applied: false });
    }

    const acceptedIds = new Set(result.georef?.inlierIds || []);
    const autoPoints = (result.matching?.matches || [])
      .filter(match => acceptedIds.has(match.id))
      .map(match => ({
        id: match.id,
        image: [...match.image],
        coordinate: [...match.coordinate],
      }));
    if (!autoPoints.length) {
      return Object.freeze({ ...result, ok: false, reason: 'no-auto-georef-inliers', applied: false });
    }

    const before = copyReferenceImageRecords(records);
    const previousRecord = before.find(item => item.id === record.id) || null;
    const fallbackQuad = referenceImageWarpQuad(record.warp);
    const manualPoints = record.controlPoints.filter(point => !String(point.id || '').startsWith('auto-place:'));
    record.controlPoints = [...manualPoints, ...autoPoints];
    record.warpMode = result.georef?.mode || record.warpMode;
    rebuildWarp(record);
    if (!record.warp.ok) {
      record.controlPoints = previousRecord?.controlPoints || manualPoints;
      record.warpMode = previousRecord?.warpMode || record.warpMode;
      rebuildWarp(record);
      if (fallbackQuad) record.mapQuad = fallbackQuad;
      return Object.freeze({ ...result, ok: false, reason: record.warp.reason || 'auto-georef-apply-failed', applied: false });
    }

    history.push(before);
    cancelInteraction();
    await persist(record);
    refreshUi();
    return Object.freeze({
      ...result,
      applied: true,
      appliedControlPointCount: autoPoints.length,
      totalControlPointCount: record.controlPoints.length,
      finalMode: record.warp.mode,
      finalDiagnostics: record.warp.diagnostics,
    });
  }

  async function autoGeorefPlaces({
    id = selectedId,
    detections = [],
    mapDate = null,
    mode = null,
    matching = {},
    georef = {},
    apply = false,
  } = {}) {
    const record = records.find(item => item.id === id) || null;
    if (!record) return Object.freeze({ ok: false, reason: 'reference-image-not-found' });
    if (typeof searchPlaces !== 'function') return Object.freeze({ ok: false, reason: 'place-search-unavailable' });
    if (apply && (record.locked || isBlocked() || storageState !== 'ready')) {
      return Object.freeze({ ok: false, reason: 'reference-image-not-editable' });
    }

    const token = currentToken();
    const result = await resolveReferenceImagePlaceAutoGeoref(detections, {
      search: searchPlaces,
      anchor: record.anchor,
      mapDate,
      mode: coarseAutoGeorefMode(record, mode),
      matching,
      georef,
    });
    if (!apply || !result.ok) return result;
    return applyPlaceAutoGeorefResult(record, result, token);
  }

  async function autoGeorefPlaceSymbols({
    id = selectedId,
    mode = null,
    apply = false,
    rasterOptions = {},
    symbolOptions = {},
    georef = {},
  } = {}) {
    const record = records.find(item => item.id === id) || null;
    if (!record) return Object.freeze({ ok: false, reason: 'reference-image-not-found' });
    if (typeof getPlaces !== 'function') return Object.freeze({ ok: false, reason: 'place-snapshot-unavailable' });
    if (apply && (record.locked || isBlocked() || storageState !== 'ready')) {
      return Object.freeze({ ok: false, reason: 'reference-image-not-editable' });
    }
    const host = mapHost();
    if (!host || !record.image) return Object.freeze({ ok: false, reason: 'reference-image-mapping-unavailable' });

    const token = currentToken();
    if (typeof preparePlaces === 'function') await preparePlaces();
    if (!validToken(token) || !records.includes(record)) {
      return Object.freeze({ ok: false, reason: 'reference-image-session-changed' });
    }
    const places = getPlaces() || [];
    const seeds = buildReferenceImagePlaceSeeds(places, {
      projectCoordinate: coordinate => host.project?.(coordinate),
      hitTestUv: screen => renderer.hitTestUv(record, screen),
      maximumSeeds: 120,
    });
    if (seeds.length < 2) {
      return Object.freeze({
        ok: false,
        reason: 'insufficient-place-seeds',
        seedCount: seeds.length,
        placeCount: Array.isArray(places) ? places.length : 0,
      });
    }

    const raster = createReferenceImagePointRaster(record.image, { maxDimension: 1600, ...rasterOptions });
    const defaultSearchRadius = Math.max(
      12,
      Math.min(48, Math.round(Math.max(raster.width, raster.height) * 0.018)),
    );
    const detected = buildReferenceImagePlaceSymbolCandidates(raster, seeds, {
      searchRadiusPx: defaultSearchRadius,
      minimumConfidence: 0.42,
      dedupeRadiusPx: 4,
      maximumCandidates: 96,
      ...symbolOptions,
    });
    const candidates = detected.candidates.map(candidate => Object.freeze({
      ...candidate,
      id: 'auto-place:symbol:' + candidate.id,
      origin: 'place-symbol',
    }));
    const totalPossible = candidates.length + (record.anchor ? 1 : 0);
    if (totalPossible < 2) {
      return Object.freeze({
        ok: false,
        reason: 'insufficient-symbol-candidates',
        seedCount: seeds.length,
        symbolCandidateCount: candidates.length,
        symbolMissCount: detected.misses.length,
      });
    }
    const minimumInliers = Math.min(
      totalPossible,
      Math.max(Math.min(totalPossible, 4), Math.ceil(totalPossible * 0.35)),
    );
    const solved = buildReferenceImageAutoGeoref(candidates, {
      anchor: record.anchor,
      mode: coarseAutoGeorefMode(record, mode),
      inlierThresholdMeters: 25000,
      maxTrials: 512,
      minimumInliers,
      ...georef,
    });
    const matching = Object.freeze({
      matchCount: candidates.length,
      rejectedCount: detected.misses.length,
      matches: Object.freeze(candidates),
      rejected: detected.misses,
    });
    const result = Object.freeze({
      ok: solved.ok,
      reason: solved.reason || '',
      source: 'place-symbol',
      seedCount: seeds.length,
      placeCount: Array.isArray(places) ? places.length : 0,
      symbolCandidateCount: candidates.length,
      symbolMissCount: detected.misses.length,
      matching,
      georef: solved,
      baseMappingSignature: referenceImageMappingSignature(record),
    });
    if (!apply || !result.ok) return result;
    return applyPlaceAutoGeorefResult(record, result, token);
  }


  async function autoGeorefOcr({
    id = selectedId,
    mode = null,
    mapDate = null,
    matching = {},
    georef = {},
    ocr = {},
  } = {}) {
    const record = records.find(item => item.id === id) || null;
    if (!record) return Object.freeze({ ok: false, reason: 'reference-image-not-found' });
    if (typeof searchPlaces !== 'function') return Object.freeze({ ok: false, reason: 'place-search-unavailable' });
    if (!record.image) return Object.freeze({ ok: false, reason: 'invalid-image' });

    const token = currentToken();
    const detected = await detectReferenceImageText(record.image, ocr);
    if (!validToken(token) || !records.includes(record)) {
      return Object.freeze({ ok: false, reason: 'reference-image-session-changed' });
    }
    if (!detected.ok) {
      return Object.freeze({
        ok: false,
        reason: detected.reason,
        source: 'place-ocr',
        ocr: detected,
        baseMappingSignature: referenceImageMappingSignature(record),
      });
    }

    const matched = await resolveReferenceImagePlaceDetections(detected.detections, {
      search: searchPlaces,
      anchor: record.anchor,
      mapDate,
      ...matching,
    });
    if (!validToken(token) || !records.includes(record)) {
      return Object.freeze({ ok: false, reason: 'reference-image-session-changed' });
    }

    const raster = createReferenceImagePointRaster(record.image, { maxDimension: 2048 });
    const detectionById = new Map(detected.detections.map(item => [String(item.id), item]));
    const refinedMatches = [];
    const refinementRejected = [];
    const searchRadius = Math.max(16, Math.min(42, Math.round(Math.max(raster.width, raster.height) * 0.014)));

    for (const match of matched.matches || []) {
      const detection = detectionById.get(String(match.detectionId));
      const box = detection?.box;
      const symbol = findReferenceImagePointSymbolNearTextBox(raster, box, {
        searchRadiusPx: searchRadius,
        minimumConfidence: 0.4,
      });
      if (!symbol) {
        refinementRejected.push(Object.freeze({
          detectionId: match.detectionId,
          text: match.text,
          placeId: match.placeId,
          reason: 'ocr-place-symbol-not-found',
        }));
        continue;
      }
      refinedMatches.push(Object.freeze({
        ...match,
        id: 'auto-place:ocr-symbol:' + match.detectionId + ':' + match.placeId,
        image: symbol.uv,
        confidence: clamp(match.confidence * 0.76 + symbol.confidence * 0.24, 0, 1),
        origin: 'place-ocr-symbol',
        symbol,
      }));
    }

    const candidates = refinedMatches.map(match => ({
      id: match.id,
      image: match.image,
      coordinate: match.coordinate,
      confidence: match.confidence,
      origin: match.origin,
    }));
    const totalPossible = candidates.length + (record.anchor ? 1 : 0);
    if (totalPossible < 2) {
      return Object.freeze({
        ok: false,
        reason: 'insufficient-ocr-symbol-candidates',
        source: 'place-ocr',
        ocr: detected,
        matching: Object.freeze({
          ...matched,
          matchCount: refinedMatches.length,
          rejectedCount: (matched.rejectedCount || 0) + refinementRejected.length,
          matches: Object.freeze(refinedMatches),
          rejected: Object.freeze([...(matched.rejected || []), ...refinementRejected]),
        }),
        baseMappingSignature: referenceImageMappingSignature(record),
      });
    }

    const minimumInliers = Math.min(
      totalPossible,
      Math.max(Math.min(totalPossible, 4), Math.ceil(totalPossible * 0.35)),
    );
    const solved = buildReferenceImageAutoGeoref(candidates, {
      anchor: record.anchor,
      mode: coarseAutoGeorefMode(record, mode),
      inlierThresholdMeters: 25000,
      maxTrials: 512,
      minimumInliers,
      ...georef,
    });
    const refinedMatching = Object.freeze({
      ...matched,
      matchCount: refinedMatches.length,
      rejectedCount: (matched.rejectedCount || 0) + refinementRejected.length,
      matches: Object.freeze(refinedMatches),
      rejected: Object.freeze([...(matched.rejected || []), ...refinementRejected]),
    });
    return Object.freeze({
      ok: solved.ok,
      reason: solved.reason || '',
      source: 'place-ocr',
      ocr: detected,
      matching: refinedMatching,
      georef: solved,
      baseMappingSignature: referenceImageMappingSignature(record),
    });
  }

  async function autoGeorefSmart(options = {}) {
    const symbols = await autoGeorefPlaceSymbols(options);
    const symbolInliers = Number(symbols?.georef?.inlierCount || 0);
    const symbolRms = Number(symbols?.georef?.diagnostics?.rmsMeters);
    const symbolStrong = symbols.ok
      && Number.isFinite(symbolRms)
      && (
        (symbolInliers >= 8 && symbolRms <= 15000)
        || (symbolInliers >= 6 && symbolRms <= 10000)
      );
    if (symbolStrong) return symbols;

    const ocr = await autoGeorefOcr(options);
    if (ocr.ok) {
      if (!symbols.ok) return ocr;
      const ocrInliers = Number(ocr?.georef?.inlierCount || 0);
      const ocrRms = Number(ocr?.georef?.diagnostics?.rmsMeters);
      const ocrBetter = ocrInliers > symbolInliers
        || (ocrInliers === symbolInliers
          && Number.isFinite(ocrRms)
          && (!Number.isFinite(symbolRms) || ocrRms + 1e-6 < symbolRms));
      if (ocrBetter) return ocr;
    }
    if (symbols.ok) return Object.freeze({ ...symbols, ocrFallback: ocr });
    return Object.freeze({
      ...symbols,
      ocrFallback: ocr,
      reason: symbols.reason || ocr.reason,
    });
  }

  const api = Object.freeze({
    autoGeorefPlaces,
    autoGeorefPlaceSymbols,
    autoGeorefOcr,
    autoGeorefSmart,
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
        mappingReady: !!record.warp?.ok || !!record.cornerPinEnabled,
        mappingSignature: referenceImageMappingSignature(record),
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
      editorElement.removeEventListener('keydown', onEditorTabKeydown);
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
