import { decodeReferenceImageSource, referenceImageSourceHash } from './reference-image-source.js';
import {
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
import { referenceImageKeyBlocked, referenceImageNavigationHeld, registerReferenceImageInput } from './reference-image-input.js';
import { applyReferenceImageEdit, copyReferenceImageRecords, createReferenceImageHistory } from './reference-image-edit-session.js';
import { createReferenceAnalysisClient } from './reference-image-analysis-client.js';
import { createReferenceImageAnalysisService } from './reference-image-analysis.js';
import { installReferenceImageSurface } from './reference-image-surface.js';
import {
  listStoredReferenceImages,
  putStoredReferenceImage,
  replaceStoredReferenceImages,
  registerReferenceImageCollection,
  markReferenceImageCollectionChanged,
} from './reference-image-store.js';
import {
  createReferenceImagePanel,
  referenceImageEditorMarkup,
  referenceImageWorkflow,
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

export function installReferenceImageController({
  workspaceSurfaces,
  confirm,
  getGeneration = () => 0,
  isBlocked = () => false,
  cancelTools = () => {},
  auxiliaryInputActive = () => false,
  searchPlaces = null,
  genericFeatureService,
  startBoundaryTrace,
  onFeaturesApplied = () => {},
  onCollectionChanged = () => {},
} = {}) {
  if (document.documentElement.dataset.referenceImageController === 'installed') return globalThis.__PANDOLAB_REFERENCE_IMAGES__ || null;
  const mapElement = document.getElementById('map');
  const launcher = document.getElementById('referenceImageBtn');
  if (!mapElement || !launcher) return null;
  const workspace = mapElement.closest('.workspace');
  if (!workspace) throw new TypeError('Reference images require a workspace host.');
  document.documentElement.dataset.referenceImageController = 'installed';

  const panel = createReferenceImagePanel();
  workspace.append(panel);

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
  const markRecordDirty = (id, assetChanged = true) => {
    if (assetChanged) { markReferenceImageCollectionChanged();onCollectionChanged(); }
    dirtyRecords.add(id);
    const version = (recordVersions.get(id) || 0) + 1;
    recordVersions.set(id, version);
    return version;
  };
  const pendingPersistTimers = new Map();
  let selectedId = '';
  let activeTab = 'placement';
  let navigationOverride = false;
  let disposed = false;
  let session = 0;
  let continuousBefore = null;
  let linearDraft = null;
  let analysisRun = null;
  const analysisClient = createReferenceAnalysisClient({ getGeneration });
  const analysisService = createReferenceImageAnalysisService({ client: analysisClient, searchPlaces, getGeneration, genericFeatureService });
  const history = createReferenceImageHistory();
  const currentToken = () => `${session}:${getGeneration()}`;
  const ownsSession = token => !disposed && token === currentToken();
  const validToken = token => ownsSession(token) && !isBlocked();
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
    getPlacementEditingId: () => navigationOverride ? '' : interactionState().placementEditingId,
    getFreeTransformEditingId: () => navigationOverride ? '' : interactionState().freeTransformEditingId,
    getControlPointEditingId: () => navigationOverride ? '' : interactionState().controlPointEditingId,
    getSelectedControlPointId: () => interactionState().selectedControlPointId,
    isPanelHidden: () => panel.hidden,
  });

  function rebuildWarp(record) {
    if (record.analysis) record.analysis.georef = null;
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

  function persist(record, { assetChanged = true } = {}) {
    if (storageState !== 'ready') return Promise.resolve(false);
    const index = records.indexOf(record);
    if (index < 0 || !record.blob) return Promise.resolve(false);
    clearScheduledPersist(record.id);
    const version = markRecordDirty(record.id, assetChanged);
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
      if (validToken(token)) void persist(record, { assetChanged: false });
    }, PERSIST_DEBOUNCE_MS);
    pendingPersistTimers.set(record.id, timer);
  }

  function persistAll() {
    if (storageState !== 'ready') return Promise.resolve(false);
    dirtyCollection = true;
    markReferenceImageCollectionChanged();onCollectionChanged();
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

  function syncNavigationUi() {
    mapElement.classList.toggle('is-reference-map-pan-mode', !panel.hidden && navigationOverride);
    if (navigationOverride || panel.hidden) delete mapElement.dataset.referencePointer;
    for (const button of panel.querySelectorAll('[data-ref-action="navigation-toggle"]')) {
      const active = !interaction?.isActive() && !linearDraft ? true : navigationOverride;
      button.setAttribute('aria-pressed', String(active));
      button.textContent = navigationOverride ? '이미지 조작으로 복귀' : '지도 이동';
      button.setAttribute('aria-label', navigationOverride
        ? '이전 이미지 조작으로 복귀' : '이미지 조작을 유지한 채 지도 이동');
    }
  }

  function setNavigationOverride(active) {
    if (navigationOverride === (active === true)) return;
    navigationOverride = active === true;
    renderEditor();
    if (navigationOverride && (interaction?.isActive() || linearDraft)) {
      surface?.setEditing(true, '지도 이동 중 · 이미지 편집 단계는 유지됩니다. 다시 누르면 조작을 계속합니다.');
    }
    renderer.requestRender();
  }

  function onMapPointerHover(event) {
    if (panel.hidden || referenceImageNavigationHeld() || event.pointerType === 'touch') {
      delete mapElement.dataset.referencePointer;
      return;
    }
    const bounds = mapElement.getBoundingClientRect();
    const point = [event.clientX - bounds.left, event.clientY - bounds.top];
    const hit = interaction?.hitType(point) || '';
    if (hit) mapElement.dataset.referencePointer = hit;
    else delete mapElement.dataset.referencePointer;
  }

  function onMapPointerLeave() {
    delete mapElement.dataset.referencePointer;
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
      surface?.setWorkflow(null);
      syncNavigationUi();
      return;
    }
    const state = interactionState();
    const anchorState = state.anchorState?.recordId === record.id ? state.anchorState : null;
    const gcpState = state.gcpState?.recordId === record.id ? state.gcpState : null;
    const currentLinearDraft = linearDraft?.recordId === record.id ? linearDraft : null;
    const workflow = referenceImageWorkflow({
      record,
      anchorState,
      gcpState,
      controlPointEditing: state.controlPointEditingId === record.id,
      linearDraft: currentLinearDraft,
    });
    editorElement.innerHTML = referenceImageEditorMarkup({
      record,
      warp: record.warp,
      placementEditing: state.placementEditingId === record.id,
      freeTransformEditing: state.freeTransformEditingId === record.id,
      index: records.indexOf(record),
      count: records.length,
      blendOptions: BLEND_OPTIONS,
      warpOptions: WARP_OPTIONS,
      anchorState,
      gcpState,
      controlPointEditing: state.controlPointEditingId === record.id,
      selectedControlPointId: state.selectedControlPointId,
      placementRotation: referenceImagePlacementRotation(record, mapHost()),
      linearDraft: currentLinearDraft,
      workflow,
      activeTab,
      navigationOverride,
    });
    if (workflow) {
      surface?.setEditing(true, navigationOverride
        ? '지도 이동 중 · 이미지 편집 단계는 유지됩니다. 다시 누르면 조작을 계속합니다.'
        : workflow.instruction);
    } else if (record.analysis?.editingChainId == null) interaction?.syncSurface();
    surface?.setWorkflow(workflow);
    syncNavigationUi();
  }

  function cancelAnalysis(record = analysisRun?.record || selected(), { render = true } = {}) {
    if (!record || (analysisRun?.record !== record && !record.analysis)) return false;
    if (analysisRun?.record === record) {
      analysisRun.abort.abort();
      analysisClient.cancel();
      analysisRun = null;
    }
    if (record.analysis?.boundaries) record.analysis = { boundaries: record.analysis.boundaries, selectedIds: new Set(), reviewing: false };
    else record.analysis = null;
    if (render) { renderEditor(); renderer.requestRender(); }
    return true;
  }

  async function startAnalysis(record, operation) {
    const previous = record.analysis?.boundaries;
    const layoutFirst = operation === 'analyze-layout' || (operation === 'auto-analysis' && !record.sourceRect && !record.controlPoints.length);
    cancelInteraction();
    const run = { record, token: currentToken(), abort: new AbortController() };
    analysisRun = run;
    record.analysis = { busy: true, stage: layoutFirst ? 'layout' : operation === 'extract-boundaries' ? 'boundaries' : 'georef',
      extractAfter: operation === 'auto-analysis', boundaries: previous, selectedIds: new Set(), reviewing: false };
    renderEditor();
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (analysisRun !== run) return;
      if (layoutFirst) {
        const layout = await analysisService.analyzeLayout(record, { signal: run.abort.signal });
        if (analysisRun !== run) return;
        if (!validToken(run.token) || selected() !== record || !records.includes(record) || record.locked) { cancelAnalysis(record); return; }
        if (layout.panels.length || operation === 'analyze-layout') {
          record.analysis.layout = layout;
          record.analysis.busy = false;
          if (operation === 'auto-analysis' && layout.panels.length === 1 && layout.panels[0].kind === 'main' && !layout.panels[0].requiresReview) {
            await useLayoutPanel(record, layout.panels[0].id);return;
          }
          renderEditor(); renderer.requestRender();
          if (!layout.panels.length) setHint('분리할 도곽을 찾지 못했습니다. 전체 이미지로 자동 맞춤을 실행할 수 있습니다.');
          return;
        }
        record.analysis.stage = 'georef'; renderEditor();
      }
      const result = operation === 'extract-boundaries'
        ? await analysisService.extractBoundaries(record, { signal: run.abort.signal, previous })
        : await analysisService.analyzeGeoreference(record, { signal: run.abort.signal });
      if (analysisRun !== run) return;
      if (!validToken(run.token) || selected() !== record || !records.includes(record) || record.locked) { cancelAnalysis(record); return; }
      record.analysis.busy = false;
      if (operation === 'extract-boundaries') {
        record.analysis.boundaries = result;
        record.analysis.reviewing = true;
        record.analysis.graphHistory = { past: [], future: [] };
      } else {
        record.analysis.georef = result.ok ? result : null;
        if (!result.ok) { analysisRun = null; record.analysis = null; }
      }
      renderEditor(); renderer.requestRender();
      if (operation !== 'extract-boundaries' && !result.ok) setHint(autoGeorefFailureMessage(result), 'error');
    } catch (error) {
      if (analysisRun !== run) return;
      const current = validToken(run.token) && selected() === record && records.includes(record) && !record.locked;
      cancelAnalysis(record);
      if (current && error.name !== 'AbortError') {
        console.error('[reference-image-analysis]', error);
        setHint(error.message || '이미지 자동 분석 중 오류가 발생했습니다.', 'error');
      }
    }
  }

  async function useLayoutPanel(record, panelId) {
    const review = record.analysis;
    const panel = review?.layout?.panels.find(item => item.id === panelId);
    if (!panel || panel.kind === 'legend' || review.busy || record.locked) return;
    analysisService.assertCurrent(record, review.layout.snapshot);
    const token = currentToken();
    const isCurrent = () => validToken(token) && selected() === record && records.includes(record)
      && record.analysis === review && !record.locked;
    const sourceHash = await referenceImageSourceHash(record.blob);
    const hashes = await Promise.all(records.map(item => referenceImageSourceHash(item.blob)));
    if (!isCurrent()) return;
    const rect = JSON.stringify(panel.sourceRect);
    let crop = records.find((item, index) => hashes[index] === sourceHash && JSON.stringify(item.sourceRect) === rect);
    if (crop?.locked) throw new Error('이 영역의 참조 이미지가 잠겨 있습니다. 잠금을 해제한 뒤 분석하세요.');
    const before = copyReferenceImageRecords(records);
    if (!crop) {
      crop = await addBlob(record.blob, record.name, {
        id: createId(), name: `${record.name} · ${panel.kind === 'main' ? '본 지도' : '삽입도'}`,
        sourceRect: panel.sourceRect, mapQuad: record.mapQuad,
      }, { select: false, save: false, isCurrent });
      if (!crop) return;
    }
    if (!isCurrent()) return;
    cancelInteraction();
    record.visible = false; crop.visible = true; selectedId = crop.id;
    history.push(before);
    await persistAll(); refreshUi();
    if (selected() === crop && validToken(token) && !crop.locked) await startAnalysis(crop, review.extractAfter ? 'auto-analysis' : 'auto-georef');
  }

  async function editBoundary(record, command) {
    const review = record.analysis;
    if (!review?.reviewing || review.busy || record.locked) return false;
    const run = { record, token: currentToken(), abort: new AbortController() };
    analysisRun = run;
    review.busy = true; review.stage = 'edit'; review.pointAction = null; review.connectFrom = null;
    renderEditor();
    try {
      const next = await analysisService.editBoundaries(record, review.boundaries, command, { signal: run.abort.signal });
      if (analysisRun !== run || record.analysis !== review) return false;
      if (!validToken(run.token) || selected() !== record || !records.includes(record) || record.locked) { cancelAnalysis(record); return false; }
      review.graphHistory.past.push(review.boundaries);
      if (review.graphHistory.past.length > 20) review.graphHistory.past.shift();
      review.graphHistory.future = [];
      review.boundaries = next;
      review.selectedIds.clear();
      review.busy = false;
      renderEditor(); renderer.requestRender();
      return true;
    } catch (error) {
      if (analysisRun !== run || record.analysis !== review) return false;
      review.busy = false;
      renderEditor(); renderer.requestRender();
      if (error.name !== 'AbortError') {
        console.error('[PL-REFERENCE-BOUNDARY-EDIT]', error);
        setHint(error.message || '경계 수정을 적용하지 못했습니다. 이전 결과를 유지했습니다.', 'error');
      }
      return false;
    }
  }

  function restoreBoundaryEdit(record, direction) {
    const review = record?.analysis;
    if (!review?.reviewing || review.busy || review.editingChainId != null || record.locked) return;
    const from = direction === 'undo' ? review.graphHistory.past : review.graphHistory.future;
    const to = direction === 'undo' ? review.graphHistory.future : review.graphHistory.past;
    if (!from.length) return;
    to.push(review.boundaries); review.boundaries = from.pop();
    review.selectedIds.clear(); review.pointAction = null; review.connectFrom = null;
    renderEditor(); renderer.requestRender();
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
    cancelAnalysis(undefined, { render: false });
    cancelLinearDraft({ render: false });
    interaction?.cancelAll();
    navigationOverride = false;
    syncNavigationUi();
    renderer.requestRender();
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
    for (const record of records) {
      // Restoring document edits cannot restart a cancelled analysis.
      record.analysis = null;
      rebuildWarp(record);
    }
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
    const state = interactionState();
    if (linearDraft || state.anchorState || state.gcpState || state.controlPointEditingId || analysisRun) {
      surface?.setEditing(true, navigationOverride
        ? '지도 이동 중 · 이미지 편집 단계는 유지됩니다. 다시 누르면 조작을 계속합니다.'
        : text);
    }
  }

  function autoGeorefFailureMessage(result) {
    const reason = String(result?.reason || '');
    if (reason === 'auto-georef-preview-stale') return '분석 뒤에 이미지 배치가 바뀌었습니다. 자동 맞춤을 다시 실행하세요.';
    if (reason === 'ocr-runtime-unavailable') return '앱에 포함된 OCR 자료를 읽지 못했습니다.';
    if (reason === 'no-ocr-text') return '이미지에서 도시명으로 사용할 문자를 찾지 못했습니다.';
    if (reason === 'insufficient-ocr-symbol-candidates') return '도시명과 도시 기호의 대응이 부족합니다. 지역이나 수동 기준점을 보완하세요.';
    if (reason === 'ocr-recognition-failed') return 'OCR 실행에 실패했습니다.';
    return '정확한 위치를 확정할 근거가 부족합니다. 지역이나 수동 기준점을 보완한 뒤 다시 분석하세요.';
  }

  async function addBlob(blob, name, persisted = null, { select = true, save = true, isCurrent = () => true, prepareOnly = false } = {}) {
    if (save && storageState !== 'ready') throw new Error('참조 이미지 저장 목록을 먼저 읽어야 합니다.');
    if (!(blob instanceof Blob) || !ACCEPTED_IMAGE_TYPES.has(blob.type)) throw new Error('PNG, JPG, WebP 이미지만 사용할 수 있습니다.');
    const token = currentToken();
    const decoded = await decodeReferenceImageSource(blob, persisted?.sourceRect);
    if (!ownsSession(token) || (!prepareOnly && isBlocked()) || !isCurrent()) return null;
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
      mapQuad,
      warp: null,
      mesh: null,
      projectedMesh: null,
    };
    rebuildWarp(record);
    if (prepareOnly) return record;
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
    const candidate = event.target?.dataset?.refCandidate;
    if (candidate) {
      const review = record.analysis;
      if (event.type !== 'change' || record.locked || !review?.reviewing || review.busy) return;
      if (event.target.checked) review.selectedIds.add(candidate);
      else review.selectedIds.delete(candidate);
      renderEditor(); renderer.requestRender(); return;
    }
    const field = event.target?.dataset?.refField;
    if (!field) return;
    const continuous = CONTINUOUS_FIELDS.has(field);
    if (event.type === 'input' && !continuous) return;
    if (record.locked && ['rotation', 'warp'].includes(field)) return;
    const cancelledAutoGeoref = (field === 'rotation' || field === 'warp')
      && cancelAnalysis(record, { render: false });
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
      if (record.locked) {
        cancelAnalysis(record, { render: false });
        cancelLinearDraft({ render: false });
      }
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
    if (field === 'warp' || field === 'locked' || cancelledAutoGeoref) renderEditor();
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
    // The tool controllers need this explicit notification: their observer watches
    // editor replacement, not hidden attributes on dynamically rebuilt child tabs.
    panel.dispatchEvent(new CustomEvent('reference-image-tab-changed'));
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
        cancelAnalysis(record, { render: false });
        if (linearDraft?.recordId === record.id) cancelLinearDraft({ render: false });
        if (selectedId === record.id) interaction?.handleRecordLocked(record);
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
    if (action === 'navigation-toggle') {
      setNavigationOverride(!navigationOverride);
      return;
    }
    if (navigationOverride && ['placement', 'free-transform', 'anchor', 'gcp', 'gcp-edit',
      'edit-image', 'edit-coordinate', 'linear-river', 'linear-coastline'].includes(action)) {
      navigationOverride = false;
      syncNavigationUi();
      renderer.requestRender();
    }
    if (action === 'linear-cancel') { cancelLinearDraft(); return; }
    if (record.locked && !['bring-forward', 'send-backward', 'cancel-auto-georef', 'cancel-boundaries'].includes(action)) return;
    if (!['auto-georef', 'auto-analysis', 'analyze-layout', 'use-layout-panel', 'use-grid-points', 'extract-boundaries', 'choose-location', 'apply-auto-georef', 'cancel-auto-georef',
      'apply-boundaries', 'cancel-boundaries', 'boundary-exclude', 'boundary-cut', 'boundary-retrace', 'boundary-endpoint',
      'boundary-undo', 'boundary-redo', 'bring-forward', 'send-backward'].includes(action)) {
      cancelAnalysis(record, { render: false });
    }
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
    if (action === 'linear-map-redraw' && linearDraft?.phase === 'preview') {
      linearDraft.coordinates = [];
      linearDraft.preview = null;
      linearDraft.phase = 'map';
      linearDraft.error = '';
      renderEditor();renderer.requestRender();return;
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
    if (['auto-georef', 'auto-analysis', 'analyze-layout', 'extract-boundaries'].includes(action)) {
      await startAnalysis(record, action); return;
    }
    if (action === 'use-layout-panel') { await useLayoutPanel(record, button.dataset.panelId); return; }
    if (action === 'use-grid-points') {
      const review = record.analysis;
      if (!review?.layout || review.busy) return;
      const result = analysisService.reviewGraticule(record, review.layout);
      const before = copyReferenceImageRecords(records);
      const ids = new Set(result.controlPoints.map(point => point.id));
      record.controlPoints = [...record.controlPoints.filter(point => !ids.has(point.id)), ...result.controlPoints];
      record.gridReference = result.gridReference;
      cancelAnalysis(record, { render: false }); rebuildWarp(record); history.push(before);
      await persist(record); refreshUi(); return;
    }
    if (action === 'cancel-auto-georef' || action === 'cancel-boundaries') {
      cancelAnalysis(record); return;
    }
    if (action === 'boundary-undo' || action === 'boundary-redo') {
      restoreBoundaryEdit(record, action === 'boundary-undo' ? 'undo' : 'redo'); return;
    }
    if (['boundary-exclude', 'boundary-cut', 'boundary-retrace', 'boundary-endpoint'].includes(action)) {
      const review = record.analysis;
      if (!review?.reviewing || review.busy || review.editingChainId != null) return;
      const chain = review.boundaries.graph.chains.find(item => String(item.id) === button.dataset.chainId);
      if (!chain) return;
      if (action === 'boundary-exclude') await editBoundary(record, { type: 'exclude', chainId: chain.id });
      if (action === 'boundary-cut') {
        review.pointAction = { chainId: chain.id }; review.connectFrom = null;
        renderEditor(); renderer.requestRender();
      }
      if (action === 'boundary-endpoint' && ['start', 'end'].includes(button.dataset.end)) {
        const endpoint = { chainId: chain.id, end: button.dataset.end };
        if (!review.connectFrom) { review.connectFrom = endpoint; review.pointAction = null; renderEditor(); renderer.requestRender(); }
        else if (review.connectFrom.chainId === endpoint.chainId && review.connectFrom.end === endpoint.end) {
          review.connectFrom = null; renderEditor(); renderer.requestRender();
        } else await editBoundary(record, { type: 'join', from: review.connectFrom, to: endpoint });
      }
      if (action === 'boundary-retrace') {
        if (typeof startBoundaryTrace !== 'function') throw new TypeError('Boundary review requires the Live-Wire trace port.');
        review.editingChainId = chain.id; review.pointAction = null; review.connectFrom = null;
        renderEditor(); renderer.requestRender();
        const onClose = () => {
          if (record.analysis !== review) return;
          review.editingChainId = null; renderEditor(); renderer.requestRender();
        };
        try {
          const started = await startBoundaryTrace(record.id, { points: chain.points,
            onApply: points => editBoundary(record, { type: 'replace', chainId: chain.id, points }), onClose });
          if (!started) onClose();
        } catch (error) { onClose(); throw error; }
      }
      return;
    }
    if (action === 'choose-location') {
      const preview = record.analysis?.georef;
      const choice = preview?.locations?.[Number(button.dataset.location)];
      if (choice) { record.analysis.georef = choice; renderEditor(); }
      return;
    }
    if (action === 'apply-auto-georef') {
      const preview = record.analysis?.georef;
      if (!preview?.ok || preview.requiresLocationChoice) return;
      analysisService.assertCurrent(record, preview.snapshot);
      const extractAfter = record.analysis.extractAfter;
      const token = currentToken();
      const result = await applyPlaceAutoGeorefResult(record, preview, token);
      if (!validToken(token) || selected() !== record || !records.includes(record)) return;
      if (result.applied && extractAfter) await startAnalysis(record, 'extract-boundaries');
      else if (result.applied) setHint(`자동 기준점 ${result.appliedControlPointCount}개를 적용했습니다. 필요하면 개별 기준점을 수정하세요.`, 'success');
      else setHint(autoGeorefFailureMessage(result), 'error');
      return;
    }
    if (action === 'apply-boundaries') {
      const review = record.analysis;
      if (!review?.reviewing || review.busy || !review.selectedIds.size) return;
      const token = currentToken();
      review.busy = true; review.stage = 'apply'; renderEditor();
      try {
        const ids = await analysisService.applyExtractedFeatures(record, review.boundaries, [...review.selectedIds]);
        if (!validToken(token)) return;
        onFeaturesApplied(ids);
        if (record.analysis !== review || selected() !== record || !records.includes(record)) return;
        cancelAnalysis(record);
        setHint(`선·영역 ${ids.length}개를 생성했습니다. 객체 실행 취소로 한 번에 되돌릴 수 있습니다.`, 'success');
      } catch (error) {
        console.error('[PL-REFERENCE-BOUNDARY-APPLY]', error);
        if (record.analysis === review) {
          review.busy = false; renderEditor();
          setHint(error.message || '선·영역을 생성하지 못했습니다. 검토 결과를 유지했습니다.', 'error');
        }
      }
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
      const review = selected()?.analysis;
      if (review?.pointAction || review?.connectFrom) {
        review.pointAction = null; review.connectFrom = null; renderEditor(); renderer.requestRender();
      } else if (navigationOverride) setNavigationOverride(false);
      else if (linearDraft || interaction?.isActive() || analysisRun) cancelInteraction();
      else surface.close({ restoreFocus: true });
      return true;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && interaction?.deleteSelectedControlPoint()) {
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      const direction = event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo';
      if (selected()?.analysis?.reviewing) restoreBoundaryEdit(selected(), direction);
      else restoreHistory(direction);
      return true;
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
  surface = installReferenceImageSurface({
    panel, launcher, workspaceSurfaces, mapElement, onAction: onPanelClickEvent,
    onAuxiliaryEditingStart: () => {
      if (selected()?.analysis?.editingChainId != null) {
        cancelLinearDraft({ render: false }); interaction.cancelAll({ renderUi: false });
      } else cancelInteraction();
    },
    onClose: cancelInteraction,
    onOpen: () => { syncNavigationUi(); renderer.requestRender(); },
  });
  const unregisterInput = registerReferenceImageInput({
    begin: (point, event, context) => {
      if (panel.hidden) return null;
      if (referenceImageNavigationHeld()) return { kind: 'navigate' };
      const record = selected();
      const review = record?.analysis;
      if (review?.reviewing && review.pointAction && !review.busy && !record.locked) {
        const chainId = review.pointAction.chainId;
        return { kind: 'tap', end: next => {
          if (record.analysis !== review || review.pointAction?.chainId !== chainId) return;
          const uv = renderer.hitTestUv(record, next);
          if (!uv) return;
          const graph = review.boundaries.graph;
          editBoundary(record, { type: 'cut', chainId, point: [uv[0] * (graph.width - 1), uv[1] * (graph.height - 1)] })
            .catch(error => { console.error('[PL-REFERENCE-BOUNDARY-EDIT]', error); setHint(error.message, 'error'); });
        } };
      }
      // Auxiliary line tools own one-finger input; the map still owns pinch.
      if (event.pointerType === 'touch' && auxiliaryInputActive()) return { kind: 'exclusive' };
      return linearDraft ? linearGesture(point, event, context) : interaction.beginGesture(point, event, context);
    },
    active: () => !!linearDraft || !!selected()?.analysis?.pointAction || interaction.isActive() || navigationOverride || auxiliaryInputActive(),
    surfaceOpen: () => !panel.hidden,
    mapNavigationActive: () => !panel.hidden && navigationOverride,
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
  mapElement.addEventListener('pointermove', onMapPointerHover, { passive: true });
  mapElement.addEventListener('pointerleave', onMapPointerLeave);
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
  const restoredImages = restoreStoredImages();
  const unregisterCollection = registerReferenceImageCollection({
    async capture() {
      await restoredImages;
      if (storageState !== 'ready') throw new Error('참조 이미지 저장 목록을 먼저 읽어야 합니다.');
      return [...records.map((record, order) => serializeReferenceImageRecord(record, order)), ...retainedRecords];
    },
    async replace(values) {
      await restoredImages;
      cancelInteraction();
      const token = currentToken(), staged = [];
      for (const value of values) {
        const record = await addBlob(value.blob, value.name, value, { select: false, save: false, prepareOnly: true });
        if (!record || !ownsSession(token)) throw new Error('프로젝트 변경으로 참조 이미지 읽기가 취소되었습니다.');
        staged.push(record);
      }
      if (!ownsSession(token)) throw new Error('프로젝트 변경으로 참조 이미지 교체가 취소되었습니다.');
      for (const id of [...pendingPersistTimers.keys()]) clearScheduledPersist(id);
      await replaceStoredReferenceImages(values);
      if (!ownsSession(token)) throw new Error('프로젝트 변경으로 참조 이미지 교체가 취소되었습니다.');
      records.splice(0, records.length, ...staged); retainedRecords.splice(0);
      dirtyRecords.clear(); dirtyCollection = false; history.clear(); storageState = 'ready'; storageError = '';
      selectedId = records.at(-1)?.id || ''; refreshUi();
    },
  });


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

  const api = Object.freeze({
    list: () => {
      const state = interactionState();
      return records.map((record, order) => ({
        id: record.id,
        name: record.name,
        sourceRect: record.sourceRect ? { ...record.sourceRect } : null,
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
      unregisterCollection();
      unregisterInput(); cancelInteraction(); analysisClient.dispose(); surface.destroy(); history.clear();
      if (storageState === 'ready' && (dirtyCollection || dirtyRecords.size || pendingPersistTimers.size)) void persistAll();
      else for (const id of [...pendingPersistTimers.keys()]) clearScheduledPersist(id);
      panel.removeEventListener('keydown', stopPanelKeys);
      panel.removeEventListener('click', onPanelClickEvent);
      mapElement.removeEventListener('pointermove', onMapPointerHover);
      mapElement.removeEventListener('pointerleave', onMapPointerLeave);
      mapElement.classList.remove('is-reference-map-pan-mode', 'is-reference-space-pan');
      delete mapElement.dataset.referencePointer;
      editorElement.removeEventListener('input', onEditorInput);
      editorElement.removeEventListener('change', onEditorInput);
      editorElement.removeEventListener('keydown', onEditorTabKeydown);
      fileInput.removeEventListener('change', onFileChange);
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
