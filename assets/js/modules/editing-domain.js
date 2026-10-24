import { geometryRevision, touchGeometry } from './geometry-versions.js';
import {
  appendDraftStrokeSamples,
  beginDraftStroke as beginRawDraftStroke,
  cancelDraftStroke as cancelRawDraftStroke,
  createDraftStrokeState,
  finalizeDraftStroke,
  resetDraftStrokeState,
} from './draft-stroke.js';
import { resolveSnap, snapIndicator } from './geometry-snap.js';
import { createEditingRenderPacket, EMPTY_EDITING_RENDER_PACKET } from './editing-render-packet.js';
import { assertCurrentGisImportPlan } from './gis-import-plan.js';
import { validateGeometry } from './geometry-validation.js';

const cloneCoordinate = value => [Number(value[0]), Number(value[1])];
const cloneCoordinates = values => (values || []).map(cloneCoordinate);
const coordinateNear = (left, right, epsilon = 1e-9) => !!left && !!right
  && Math.abs(Number(left[0]) - Number(right[0])) <= epsilon
  && Math.abs(Number(left[1]) - Number(right[1])) <= epsilon;

function segmentIntersection(leftStart, leftEnd, rightStart, rightEnd, epsilon = 1e-10) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const first = cross(leftStart, leftEnd, rightStart);
  const second = cross(leftStart, leftEnd, rightEnd);
  const third = cross(rightStart, rightEnd, leftStart);
  const fourth = cross(rightStart, rightEnd, leftEnd);
  if (((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
    && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))) return true;
  const between = (value, start, end) => value >= Math.min(start, end) - epsilon && value <= Math.max(start, end) + epsilon;
  const onSegment = (point, start, end, area) => Math.abs(area) <= epsilon
    && between(point[0], start[0], end[0]) && between(point[1], start[1], end[1]);
  return onSegment(rightStart, leftStart, leftEnd, first)
    || onSegment(rightEnd, leftStart, leftEnd, second)
    || onSegment(leftStart, rightStart, rightEnd, third)
    || onSegment(leftEnd, rightStart, rightEnd, fourth);
}

function defaultDraftIssues(coords, closed = false) {
  for (let index = 1; index < coords.length; index += 1) {
    if (coordinateNear(coords[index - 1], coords[index])) {
      return [{
        kind: 'duplicate-vertex', coordinate: cloneCoordinate(coords[index]), vertexIndex: index,
        segmentIndex: index - 1, message: '서로 다른 위치를 연결하세요.',
      }];
    }
  }
  const points = cloneCoordinates(coords);
  if (closed && points.length >= 3) points.push(cloneCoordinate(points[0]));
  const segmentCount = Math.max(0, points.length - 1);
  for (let left = 0; left < segmentCount; left += 1) {
    for (let right = left + 1; right < segmentCount; right += 1) {
      if (Math.abs(left - right) <= 1 || (closed && left === 0 && right === segmentCount - 1)) continue;
      if (!segmentIntersection(points[left], points[left + 1], points[right], points[right + 1])) continue;
      return [{
        kind: 'self-intersection', coordinate: cloneCoordinate(points[left]), segmentIndex: left,
        message: closed ? '영역 경계가 자기 자신과 교차합니다.' : '선이 자기 자신과 교차합니다.',
      }];
    }
  }
  return [];
}

function draftGeometry(coords, shape) {
  if (!coords.length) return null;
  if (shape === 'polygon' && coords.length >= 3) {
    return { type: 'Polygon', coordinates: [[...cloneCoordinates(coords), cloneCoordinate(coords[0])]] };
  }
  return {
    type: coords.length === 1 ? 'Point' : 'LineString',
    coordinates: coords.length === 1 ? cloneCoordinate(coords[0]) : cloneCoordinates(coords),
  };
}

function draftSegments(coords, polygon) {
  const rows = [];
  for (let index = 0; index < coords.length - 1; index += 1) {
    rows.push({ key: `segment:${index}`, segmentIndex: index, start: coords[index], end: coords[index + 1] });
  }
  if (polygon && coords.length >= 3) {
    rows.push({ key: `segment:${coords.length - 1}`, segmentIndex: coords.length - 1, start: coords.at(-1), end: coords[0] });
  }
  return rows;
}

function editableVertices(feature) {
  const value = feature?.geometry;
  if (!value) return [];
  if (value.type === 'LineString') {
    return (value.coordinates || []).map((coord, index) => ({ key: `0:${index}`, partIndex: 0, index, coordinate: coord }));
  }
  if (value.type === 'MultiLineString') {
    return (value.coordinates || []).flatMap((part, partIndex) => (part || []).map((coord, index) => ({ key: `${partIndex}:${index}`, partIndex, index, coordinate: coord })));
  }
  const polygons = value.type === 'Polygon' ? [value.coordinates || []] : value.type === 'MultiPolygon' ? value.coordinates || [] : [];
  return polygons.flatMap((polygon, polygonIndex) => (polygon || []).flatMap((ring, ringIndex) => (
    (ring || []).slice(0, Math.max(0, ring.length - 1)).map((coord, index) => ({
      key: `${polygonIndex}:${ringIndex}:${index}`, polygonIndex, ringIndex, index, coordinate: coord,
    }))
  )));
}

function setEditableVertex(feature, vertex, value) {
  touchGeometry(feature.geometry);
  const next = cloneCoordinate(value);
  const type = feature?.geometry?.type;
  if (type === 'LineString') feature.geometry.coordinates[vertex.index] = next;
  else if (type === 'MultiLineString') feature.geometry.coordinates[vertex.partIndex][vertex.index] = next;
  else {
    const ring = type === 'Polygon'
      ? feature.geometry.coordinates?.[vertex.ringIndex]
      : feature.geometry.coordinates?.[vertex.polygonIndex]?.[vertex.ringIndex];
    if (!ring || vertex.index < 0 || vertex.index >= ring.length - 1) return false;
    ring[vertex.index] = next;
    if (vertex.index === 0) ring[ring.length - 1] = cloneCoordinate(next);
  }
  return true;
}

function vertexPreviewSegments(feature, vertex) {
  const type = feature?.geometry?.type;
  let values = null;
  let closed = false;
  if (type === 'LineString') values = feature.geometry.coordinates;
  else if (type === 'MultiLineString') values = feature.geometry.coordinates?.[vertex.partIndex];
  else if (type === 'Polygon') { values = feature.geometry.coordinates?.[vertex.ringIndex]; closed = true; }
  else if (type === 'MultiPolygon') { values = feature.geometry.coordinates?.[vertex.polygonIndex]?.[vertex.ringIndex]; closed = true; }
  const count = Math.max(0, (values?.length || 0) - (closed ? 1 : 0));
  if (!values || vertex.index < 0 || vertex.index >= count) return [];
  const rows = [];
  const push = (startIndex, endIndex) => rows.push({ start: values[startIndex], end: values[endIndex] });
  if (closed || vertex.index > 0) push((vertex.index - 1 + count) % count, vertex.index);
  if (closed || vertex.index < count - 1) push(vertex.index, (vertex.index + 1) % count);
  return rows;
}

export function createEditingDomain({
  context = null,
  projectDomain = null,
  gisDomain = null,
  selectionDomain = null,
  previewController = null,
  transactionRunner = null,
  toolController = null,
  draftServices = null,
  geometryEditing = null,
  getImportCommitter = null,
  onEditingStateChanged = () => {},
  commandOwner,
} = {}) {
  let phase = 'idle';
  let activeTool = 'select';
  let projectGeneration = Number(projectDomain?.getGeneration?.() || 0);
  let disposed = false;
  let revision = 0;
  let packet = EMPTY_EDITING_RENDER_PACKET;
  let packetRevision = -1;
  let draftCoords = Object.freeze([]);
  let draftHover = null;
  let draftCutAssessment = null;
  let draftEdit = Object.freeze({ active: false,revision: 0,inputPhase: 'draw',vertexInsertMode: false,
    selectedVertexIndex: null,insertTarget: null,dragging: false,historyCount: 0,futureCount: 0 });
  let draftIssues = [];
  let draftSplitPreview = null;
  let draftStroke = createDraftStrokeState();
  let activeSnap = null;
  let activeGesture = null;
  let selectedVertex=null,vertexPlacement=false,objectVertexEditing=null;
  let selectionHistory = [];
  let selectionCursor = 0;
  const selectionDraftActive = () => ['merge-country', 'merge-territorial-unit', 'merge-generic-feature'].includes(activeTool);
  const recordSelectionChange = ({ undo, redo }) => {
    if (!selectionDraftActive()) throw new Error('Selection history requires an active merge draft.');
    selectionHistory = selectionHistory.slice(0, selectionCursor);
    selectionHistory.push({ undo, redo });
    selectionCursor++;
    emit('selection-draft-change');
  };
  let boundaryHistory = [];
  let boundaryCursor = 0;
  let gestureSequence = 0;
  let pendingMove = null;
  let pendingMoveFrame = 0;
  let snapshotCache = null;
  let draftPreparationEpoch = 0;
  let toolRequestSequence = 0;

  const tool = toolController || {};
  const services = draftServices || {};
  if (typeof services.requestFrame !== 'function') throw new TypeError('Editing domain requires requestFrame().');
  if (typeof services.cancelFrame !== 'function') throw new TypeError('Editing domain requires cancelFrame().');
  if (typeof services.reportOperationError !== 'function') throw new TypeError('Editing domain requires its draft operation error reporter.');
  const geometry = geometryEditing || {};
  if (typeof commandOwner?.draftApply !== 'function' || typeof commandOwner.subscribeTransitions !== 'function'
    || typeof commandOwner.state !== 'function')
    throw new TypeError('Editing domain requires the canonical C++ document draft owner.');
  const active = () => { if (disposed) throw new Error('Editing domain is disposed.'); };
  const toolConfig = () => services.getToolConfig?.(activeTool) || null;
  const draftInputActive = () => !!toolConfig();
  const requestEditingRender = reason => context?.requestRender?.({ kind: 'editing-overlays', reason: String(reason || 'editing-change') });

  const boundaryDraftActive = () => ['territorial-border','country-coast'].includes(activeTool) && geometry.boundaryDraftActive();
  const boundaryMoves = () => {
    const moves = new Map();
    for (const session of boundaryHistory.slice(0,boundaryCursor)) moves.set(session.node.nodeKey,session);
    return [...moves.values()].filter(session=>!coordinateNear(session.node.coordinate,session.coordinate));
  };
  const boundaryCoordinate = value => boundaryMoves().find(session=>coordinateNear(session.node.coordinate,value))?.coordinate || value;
  const previewBoundaryDraft = async () => {
    if (!boundaryDraftActive() || activeGesture) return false;
    const moves=boundaryMoves(); if(!moves.length)return false;
    const history=boundaryHistory,cursor=boundaryCursor,generation=projectGeneration;
    return geometry.previewBoundaryDraft({moves,preparation:moves[0].preparation,borderMode:activeTool==='territorial-border',
      current:()=>history===boundaryHistory && cursor===boundaryCursor && generation===projectGeneration});
  };
  const buildSnapshot = reason => {
    const draftActive = draftInputActive();
    return Object.freeze({
      revision,
      projectGeneration,
      gestureActive: !!activeGesture,
      selectedVertex,vertexPlacement,objectVertexEditing,
      ...(selectionDraftActive() ? {selectionDraft: Object.freeze({historyCount: selectionCursor, futureCount: selectionHistory.length - selectionCursor})} : {}),
      ...(boundaryDraftActive() ? {boundaryDraft:Object.freeze({historyCount:boundaryCursor,futureCount:boundaryHistory.length-boundaryCursor,moveCount:boundaryMoves().length})} : {}),
      phase,
      activeTool,
      reason: String(reason || ''),
      draft: Object.freeze({
        active: draftActive,
        coords: Object.freeze(cloneCoordinates(draftCoords).map(Object.freeze)),
        hover: draftActive && draftHover ? Object.freeze(cloneCoordinate(draftHover)) : null,
        inputPhase: draftEdit.inputPhase,
        vertexInsertMode: draftEdit.vertexInsertMode,
        selectedVertexIndex: draftEdit.selectedVertexIndex,
        insertTarget: draftActive && draftEdit.insertTarget ? Object.freeze({
          segmentIndex: draftEdit.insertTarget.segmentIndex,
          coordinate: Object.freeze(cloneCoordinate(draftEdit.insertTarget.coordinate)),
        }) : null,
        dragging: draftActive && draftEdit.dragging,
        issues: Object.freeze(draftActive ? [...draftIssues] : []),
        historyCount: draftEdit.historyCount,
        futureCount: draftEdit.futureCount,
        strokeActive: draftActive && draftStroke.active === true,
        cutAssessment: draftActive ? draftCutAssessment : null,
        activeSnap: draftActive ? activeSnap : null,
      }),
    });
  };

  const emit = (reason, { render = true } = {}) => {
    revision += 1;
    packetRevision = -1;
    const value = buildSnapshot(reason);
    snapshotCache = value;
    onEditingStateChanged(value);
    context?.publish?.('editing-state-changed', value);
    if (render) requestEditingRender(reason);
    return value;
  };

  const refreshDerivedState = ({ buildPreview = false } = {}) => {
    const preparationEpoch = ++draftPreparationEpoch;
    const assessment = services.assessDraft?.({
      tool: activeTool,
      coords: cloneCoordinates(draftCoords),
      hover: draftHover ? cloneCoordinate(draftHover) : null,
      buildPreview,
      revision: draftEdit.revision,
    }) || null;
    if (assessment?.then) {
      const expectedDraft = draftEdit, expectedRevision = draftEdit.revision, expectedTool = activeTool, expectedGeneration = projectGeneration;
      draftCutAssessment = { status: 'pending', valid: false, issues: [], message: '경계선을 계산하고 있습니다.' };
      draftSplitPreview = null;
      assessment.then(result => {
        if (disposed || preparationEpoch !== draftPreparationEpoch || expectedDraft !== draftEdit || !draftCoords.length || expectedRevision !== draftEdit.revision || expectedTool !== activeTool || expectedGeneration !== projectGeneration) return;
        draftCutAssessment = result;
        draftIssues = result?.issues || [];
        draftSplitPreview = result?.split ? { revision: expectedRevision, candidates: result.split.candidates } : null;
        emit('cut-preparation-ready');
      }).catch(error => {
        if (disposed || preparationEpoch !== draftPreparationEpoch || expectedDraft !== draftEdit || !draftCoords.length || expectedRevision !== draftEdit.revision || expectedTool !== activeTool || expectedGeneration !== projectGeneration) return;
        draftCutAssessment = { status: 'invalid', valid: false, issues: [], message: error.message };
        emit('cut-preparation-failed');
      });
      return draftCutAssessment;
    }
    draftCutAssessment = assessment?.cutAssessment || assessment || null;
    draftIssues = [...(assessment?.issues
      || draftCutAssessment?.issues
      || services.validateDraft?.(activeTool, draftCoords)
      || defaultDraftIssues(draftCoords, toolConfig()?.shape === 'polygon'))];
    draftSplitPreview = buildPreview ? (assessment?.splitPreview || null) : null;
    return assessment;
  };

  const syncAfterMutation = (options = {}) => {
    draftHover = null;
    refreshDerivedState({ buildPreview: options.buildPreview !== false });
    emit(options.reason || 'draft-mutated');
    return true;
  };

  const acceptCoreDraftSnapshot = value => {
    if (!value || !Array.isArray(value.coords) || !Number.isSafeInteger(value.revision)
      || !Number.isSafeInteger(value.historyCount) || !Number.isSafeInteger(value.futureCount))
      throw Object.assign(new Error('A complete C++ draft acknowledgement is required.'), { code: 'PL-CORE-RESPONSE' });
    const projected={ ...value,coords: value.coords,vertexInsertMode: value.insertMode,
      insertTarget: value.insertTarget || null };
    if (JSON.stringify(projected) === JSON.stringify(draftEdit)) return;
    draftCoords = Object.freeze(value.coords.map(coord => Object.freeze(cloneCoordinate(coord))));
    draftEdit = Object.freeze({ ...projected,coords: draftCoords,
      insertTarget: value.insertTarget ? Object.freeze({ ...value.insertTarget,
        coordinate: Object.freeze(cloneCoordinate(value.insertTarget.coordinate)) }) : null });
    snapshotCache = null;
    packetRevision = -1;
  };
  const unsubscribeCore = commandOwner.subscribeTransitions((result,operation) => {
    if (operation === 'core.document-draft-apply') acceptCoreDraftSnapshot(result.snapshot);
    else if (operation === 'core.document-draft-snapshot') acceptCoreDraftSnapshot(result);
    else if (['core.document-load','core.document-initialize','core.document-replacement-rollback'].includes(operation))
      acceptCoreDraftSnapshot(result.draft);
  });
  const applyDraft = async (action,payload = {},options = {}) => {
    active();
    const expectedGeneration = projectGeneration;
    const source=commandOwner.state();
    if (!source) throw Object.assign(new Error('The C++ draft document is not loaded.'),{ code: 'PL-CORE-NOT-LOADED' });
    const response = await commandOwner.draftApply({ action,expectedEpoch: source.epoch,...payload });
    if (disposed || expectedGeneration !== projectGeneration) return false;
    acceptCoreDraftSnapshot(response.snapshot);
    if (response.result === false) return false;
    if (options.coordinateMutation) return syncAfterMutation(options);
    if (options.emit !== false) emit(options.reason || `draft-${action}`,{ render: options.render !== false });
    return response.result;
  };

  const commitDraftCoords = (nextCoords, selectedVertexIndex = draftEdit.selectedVertexIndex, options = {}) => {
    active();
    if (!draftInputActive()) return false;
    return applyDraft('replaceCoordinates',{ coords: nextCoords,record: options.record !== false,
      selectedVertexIndex,inputPhase: options.inputPhase || draftEdit.inputPhase,
      expectedDraftRevision: draftEdit.revision },{ ...options,coordinateMutation: true });
  };

  const appendDraftCoordinate = (coord, options = {}) => {
    if (!draftInputActive() || draftEdit.vertexInsertMode || !Array.isArray(coord)) return false;
    if (options.dedupe && draftCoords.length && coordinateNear(draftCoords.at(-1), coord)) return false;
    return applyDraft('append',{ coordinate: coord },{ coordinateMutation: true });
  };

  const appendDraftScreenPoint = (screenPoint, pointerType = 'mouse', options = {}) => {
    const value = resolveCoordinate(screenPoint, pointerType, options);
    return value ? appendDraftCoordinate(value, options) : false;
  };

  const replaceDraftCoordinates = (coords, options = {}) => commitDraftCoords(coords, options.selectedVertexIndex ?? null, {
    record: options.record === true,
    inputPhase: options.inputPhase || draftEdit.inputPhase,
    buildPreview: options.buildPreview !== false,
    reason: options.reason,
  });

  const performDraftUndo = () => {
    if (selectionDraftActive()) {
      if (!selectionCursor) return false;
      selectionHistory[--selectionCursor].undo();
      emit('selection-draft-undo');
      return true;
    }
    if(boundaryDraftActive()){if(activeGesture || !boundaryCursor)return false;boundaryCursor--;emit('boundary-draft-undo');return true;}
    if (!draftInputActive() || draftStroke.active) return false;
    return applyDraft('undo',{}, { coordinateMutation: true,buildPreview: true });
  };

  const performDraftRedo = () => {
    if (selectionDraftActive()) {
      if (selectionCursor === selectionHistory.length) return false;
      selectionHistory[selectionCursor++].redo();
      emit('selection-draft-redo');
      return true;
    }
    if(boundaryDraftActive()){if(activeGesture || boundaryCursor===boundaryHistory.length)return false;boundaryCursor++;emit('boundary-draft-redo');return true;}
    if (!draftInputActive() || draftStroke.active) return false;
    return applyDraft('redo',{}, { coordinateMutation: true,buildPreview: true });
  };

  const removeLastDraftPoint = () => {
    if (!draftInputActive() || draftStroke.active || !draftCoords.length) return false;
    return applyDraft('removeLast',{}, { coordinateMutation: true });
  };

  const deleteSelectedDraftPoint = () => {
    if (!draftInputActive() || draftStroke.active || !Number.isInteger(draftEdit.selectedVertexIndex)) return false;
    return applyDraft('deleteSelected',{}, { coordinateMutation: true });
  };

  const insertDraftPointAt = (segmentIndex, value) => {
    if (!draftInputActive() || draftStroke.active || !Array.isArray(value)) return false;
    return applyDraft('insertAt',{ segmentIndex: Number(segmentIndex),coordinate: value },{ coordinateMutation: true });
  };

  const insertDraftPoint = () => draftEdit.insertTarget
    ? insertDraftPointAt(draftEdit.insertTarget.segmentIndex, draftEdit.insertTarget.coordinate)
    : false;

  const setDraftVertexInsertMode = enabled => {
    const next = enabled === true;
    if (next && (!draftInputActive() || draftStroke.active || draftEdit.dragging || draftCoords.length < 2)) return false;
    draftHover = null;
    return applyDraft('setInsertMode',{ insertMode: next },{ reason: 'draft-insert-mode' });
  };

  const selectDraftVertex = index => {
    if (!draftInputActive() || draftStroke.active) return false;
    return applyDraft('selectVertex',{ index },{ reason: 'draft-vertex-select' });
  };

  const moveSelectedDraftPointByPixels = (dx, dy) => {
    const index = draftEdit.selectedVertexIndex;
    const current = draftCoords[index];
    if (!draftInputActive() || draftStroke.active || !Number.isInteger(index) || !current) return false;
    const projected = services.projectCoordinate?.(current);
    const value = projected ? services.screenToCoordinate?.([projected[0] + dx, projected[1] + dy]) : null;
    if (!value) return false;
    return applyDraft('replaceCoordinates',{ coords: draftCoords.map((coord,position) => position===index ? value : coord),
      record: true,selectedVertexIndex: index,inputPhase: 'refine',expectedDraftRevision: draftEdit.revision },{ coordinateMutation: true });
  };

  const resolveCoordinate = (screenPoint, pointerType = 'mouse', options = {}) => {
    const raw = services.screenToCoordinate?.(screenPoint);
    if (!raw) return null;
    const result = resolveSnap({
      coordinate: raw,
      screenPoint,
      candidates: services.snapCandidates?.({ tool: activeTool, coordinate: raw, ...options }) || [],
      project: services.projectCoordinate,
      pointerType,
    });
    activeSnap = snapIndicator(result);
    return result?.coordinate ? cloneCoordinate(result.coordinate) : cloneCoordinate(raw);
  };

  const setDraftHover = input => {
    if (!draftInputActive() || draftEdit.inputPhase !== 'draw' || !draftCoords.length || draftStroke.active) return false;
    const value = Array.isArray(input?.coordinate) ? cloneCoordinate(input.coordinate) : resolveCoordinate(input?.screenPoint, input?.pointerType || 'mouse');
    if (!value || coordinateNear(value, draftHover)) return false;
    draftHover = value;
    emit('draft-hover');
    return true;
  };

  const clearDraftHover = async (reason = 'draft-hover-clear') => {
    if (!draftHover && !draftEdit.insertTarget && !activeSnap) return false;
    draftHover = null;
    if (draftEdit.insertTarget) await applyDraft('setInsertTarget',{ insertTarget: null },{ emit: false });
    activeSnap = null;
    emit(reason);
    return true;
  };

  const beginDraftStroke = (screenPoint, event = {}) => {
    active();
    const config = toolConfig();
    if (!config || draftEdit.vertexInsertMode || draftEdit.inputPhase !== 'draw' || services.isSpacePanActive?.()) return false;
    const sample = services.screenSample?.(screenPoint);
    if (!sample) return false;
    draftHover = null;
    if (draftEdit.insertTarget) applyDraft('setInsertTarget',{ insertTarget: null },{ emit: false })
      .catch(error => services.reportOperationError(error,'PL-DRAFT-STROKE-001'));
    const started = beginRawDraftStroke(draftStroke, {
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      profile: config.profile,
      sample,
    });
    if (started) emit('draft-stroke-begin');
    return !!started;
  };

  const appendDraftStroke = screenPoints => {
    active();
    if (!draftStroke.active) return false;
    const samples = (screenPoints || []).map(point => services.screenSample?.(point)).filter(Boolean);
    const changed = appendDraftStrokeSamples(draftStroke, samples);
    if (changed) emit('draft-stroke-update');
    return !!changed;
  };

  const finishDraftStroke = async screenPoint => {
    active();
    if (!draftStroke.active) return false;
    appendDraftStroke([screenPoint]);
    const config = toolConfig();
    const first = draftCoords[0] || draftStroke.samples[0]?.coordinate;
    const result = finalizeDraftStroke(draftStroke, {
      shape: config?.shape || 'line',
      closeTargetScreen: first ? services.projectCoordinate?.(first) : null,
    });
    if (!result) return false;
    const next = cloneCoordinates(draftCoords);
    for (const value of result.coords || []) {
      if (!next.length || !coordinateNear(next.at(-1), value)) next.push(cloneCoordinate(value));
    }
    const minimum = Number(config?.minimumPoints || (config?.shape === 'polygon' ? 3 : 2));
    if (next.length < minimum) {
      services.onTooShort?.(config);
      emit('draft-stroke-too-short');
      return false;
    }
    const changed = await commitDraftCoords(next, null, { inputPhase: 'refine', buildPreview: true, reason: 'draft-stroke-finish' });
    if (!changed) return false;
    await services.onFinished?.(config);
    return true;
  };

  const cancelDraftStroke = reason => {
    active();
    if (!draftStroke.active) return false;
    cancelRawDraftStroke(draftStroke);
    emit(reason || 'draft-stroke-cancel');
    return true;
  };

  const startDraft = async (config = {}) => {
    active();
    await applyDraft('start',{ shape: config.shape || toolConfig()?.shape || 'line',coords: config.coords || [],
      inputPhase: config.inputPhase === 'refine' ? 'refine' : 'draw' },{ emit: false });
    draftHover = null;
    draftCutAssessment = null;
    draftStroke = createDraftStrokeState();
    activeSnap = null;
    draftIssues = [];
    draftSplitPreview = null;
    emit('draft-start');
    return true;
  };

  const redrawDraft = async () => {
    if (!draftInputActive()) return false;
    cancelDraftStroke('redraw-draft');
    draftHover = null;
    draftCutAssessment = null;
    await applyDraft('clear',{}, { emit: false });
    draftIssues = [];
    draftSplitPreview = null;
    emit('redraw-draft');
    return true;
  };

  const clearDraft = async (options = {}) => {
    active();
    services.cancelPreparation?.();
    draftPreparationEpoch += 1;
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Draft clear requires an options object.');
    pendingMove = null;
    if (pendingMoveFrame) services.cancelFrame(pendingMoveFrame);
    pendingMoveFrame = 0;
    activeGesture = null;
    draftHover = null;
    draftCutAssessment = null;
    resetDraftStrokeState(draftStroke);
    await applyDraft('clear',{}, { emit: false });
    draftIssues = [];
    draftSplitPreview = null;
    activeSnap = null;
    previewController?.clear?.();
    emit(options.reason || 'draft-cleared', { render: options.render !== false });
    return true;
  };

  const setTool = async (nextTool, options = {}) => {
    active();
    const generation = projectGeneration;
    const request = ++toolRequestSequence;
    const current = () => !disposed && generation === projectGeneration && request === toolRequestSequence;
    const name = String(nextTool || 'select');
    if (name !== 'select' && tool.requireCanonicalData && !tool.requireCanonicalData()) return false;
    await cancelActiveGesture('tool-change', { emitChange: false });
    if (!current()) return false;
    if (tool.getGeometryPreviewSession?.() && activeTool !== name) await tool.discardGeometryPreview({ announce: false });
    if (!current()) return false;
    const changedTool = activeTool !== name;
    selectionHistory = []; selectionCursor = 0;
    if(changedTool || boundaryDraftActive()){boundaryHistory=[];boundaryCursor=0;}
    if (changedTool) await clearDraft({ reason: 'tool-draft-reset', render: false });
    if (!current()) return false;
    await tool.clearHover?.();
    if (!current()) return false;
    await tool.resetForTool?.(name);
    if (!current()) return false;
    if(changedTool){selectedVertex=null;vertexPlacement=false;}
    activeTool = name;
    if (changedTool) {
      const config = toolConfig();
      await applyDraft(config ? 'start' : 'stop',config ? { shape: config.shape,coords: [],inputPhase: 'draw' } : {},{ emit: false });
      if (!current()) return false;
    }
    phase = name === 'select' ? 'idle' : 'active';
    tool.applyToolPresentation?.(name, options);
    emit('tool-change');
    return true;
  };

  async function cancelActiveGesture(reason = 'gesture-cancel', { emitChange = true } = {}) {
    if (!activeGesture && !previewController?.isActive?.()) return false;
    const gesture = activeGesture;
    if (pendingMoveFrame) services.cancelFrame(pendingMoveFrame);
    pendingMoveFrame = 0;
    pendingMove = null;
    if (gesture && gesture.type !== 'draft-vertex-drag-start') await geometry.cancelGesture?.(gesture, reason);
    activeGesture = null;
    if (gesture?.type === 'draft-vertex-drag-start') await applyDraft('cancelDrag',{}, { emit: false });
    activeSnap = null;
    previewController?.clear?.();
    if (emitChange) emit(reason);
    return true;
  }

  const interactionCoordinate = event => Array.isArray(event?.screenPoint)
    ? resolveCoordinate(event.screenPoint, event.pointerType || 'mouse', { excludeNodeKey: event.vertexKey, targetRef: event.targetRef })
    : null;

  const beginGesture = async event => {
    if (Number(event.projectGeneration) !== projectGeneration || Number(event.packetRevision) !== revision) return false;
    if (event.type === 'draft-vertex-drag-start' && (!draftInputActive() || draftStroke.active)) return false;
    const gestureId = String(event.gestureId || `editing-${++gestureSequence}`);
    await cancelActiveGesture('gesture-replaced', { emitChange: false });
    activeGesture = { id: gestureId, type: event.type, pointerType:event.pointerType,screenPoint:event.screenPoint, targetRef: event.targetRef || null, vertexKey: event.vertexKey || null };
    if (event.type === 'draft-vertex-drag-start') {
      const index = Number(event.vertexIndex);
      if (!Number.isInteger(index) || !draftCoords[index]) return cancelActiveGesture('invalid-draft-gesture', { emitChange: false });
      await applyDraft('beginDrag',{ index },{ emit: false });
      draftSplitPreview = null;
      draftHover = null;
    } else {
      let began;
      if (event.type === 'boundary-vertex-drag-start') {
        began = geometry.beginBoundaryGesture(event);
        if (began) {
          began.startCoordinate=cloneCoordinate(boundaryCoordinate(began.node.coordinate));began.coordinate=began.startCoordinate;
          began.previewSegments=began.node.segments.map(segment=>({...segment,start:boundaryCoordinate(segment.start),end:boundaryCoordinate(segment.end)}));
          geometry.moveBoundaryGesture(began,began.startCoordinate);
        }
        if (began && typeof began === 'object') activeGesture.session = { kind: 'boundary', ...began };
      } else if (typeof geometry.beginObjectGesture === 'function') {
        began = geometry.beginObjectGesture(event);
      } else {
        const source = geometry.resolveObjectFeature?.(event.targetRef);
        const detached = source ? structuredClone(source) : null;
        const selectedVertex = editableVertices(detached).find(item => item.key === String(event.vertexKey || ''));
        if (!source || !detached || !selectedVertex || geometry.canEditObject?.(source, selectedVertex, activeGesture.targetRef) === false) began = false;
        else {
          activeGesture.session = {
            kind: 'object',
            source,
            sourceGeometry: source.geometry,
            sourceGeometryRevision: geometryRevision(source.geometry),
            detached,
            vertex: selectedVertex,
            startCoordinate: selectedVertex.coordinate.slice(),
            beforeGeometry: structuredClone(source.geometry),
            changed: false,
            snapshot: geometry.captureObjectGestureSnapshot?.(),
          };
          began = true;
        }
      }
      if (began === false) return cancelActiveGesture('rejected-vertex-gesture', { emitChange: false });
    }
    emit(event.type);
    return true;
  };

  const objectGestureCurrent = gesture => {
    const session = gesture.session;
    return geometry.resolveObjectFeature(gesture.targetRef) === session.source
      && session.source.geometry === session.sourceGeometry
      && geometryRevision(session.sourceGeometry) === session.sourceGeometryRevision
      && geometry.canEditObject?.(session.source, session.vertex, gesture.targetRef) !== false;
  };

  const applyGestureMove = async event => {
    if (!activeGesture || String(event.gestureId || '') !== activeGesture.id || Number(event.projectGeneration) !== projectGeneration) return false;
    const value = interactionCoordinate(event);
    if (!value) return false;
    activeGesture.screenPoint=event.screenPoint;activeGesture.coordinate=value;
    if (activeGesture.type === 'draft-vertex-drag-start') {
      await applyDraft('moveDrag',{ coordinate: value },{ emit: false });
      refreshDerivedState({ buildPreview: false });
    } else if (activeGesture.session?.kind === 'object') {
      const session = activeGesture.session;
      if (!objectGestureCurrent(activeGesture)) return cancelActiveGesture('object-target-invalidated');
      session.changed = !coordinateNear(session.startCoordinate, value);
      setEditableVertex(session.detached, session.vertex, value);
      session.vertex = editableVertices(session.detached).find(item => item.key === session.vertex.key) || session.vertex;
      geometry.previewObjectGesture?.({
        targetRef: activeGesture.targetRef,
        source: session.source,
        feature: session.detached,
        vertex: session.vertex,
        segments: vertexPreviewSegments(session.detached, session.vertex),
        gestureId: activeGesture.id,
      });
    } else if (activeGesture.session?.kind === 'boundary') {
      geometry.moveBoundaryGesture?.(activeGesture.session, value, event);
    } else geometry.moveGesture?.(activeGesture, value, event);
    emit(event.type);
    return true;
  };

  const flushPendingMove = async () => {
    pendingMoveFrame = 0;
    const event = pendingMove;
    pendingMove = null;
    if (event) await applyGestureMove(event);
  };

  const queueGestureMove = event => {
    pendingMove = event;
    if (!pendingMoveFrame) pendingMoveFrame = services.requestFrame(() =>
      flushPendingMove().catch(error => services.reportOperationError(error,'PL-DRAFT-MOVE-001')));
    return true;
  };

  const endGesture = async event => {
    if (!activeGesture || String(event.gestureId || '') !== activeGesture.id || Number(event.projectGeneration) !== projectGeneration) return false;
    if (pendingMove) await flushPendingMove();
    if (!activeGesture) return false;
    if (activeGesture.session?.kind === 'object' && !objectGestureCurrent(activeGesture)) {
      await cancelActiveGesture('object-target-invalidated');
      return false;
    }
    const gesture = activeGesture;
    const generation = projectGeneration;
    const previewId = previewController?.snapshot?.().id;
    activeGesture = null;
    if (gesture.type === 'draft-vertex-drag-start') {
      await applyDraft('finishDrag',{}, { emit: false });
      activeSnap = null;
      refreshDerivedState({ buildPreview: true });
      emit(event.type);
      return true;
    }
    let result;
    if (previewId) previewController.waitForResult(previewId);
    try {
      if (gesture.session?.kind === 'object') {
        const editDomain = gesture.targetRef?.domain === 'hydro' ? 'hydro' : 'generic';
        if (gesture.session.changed
          && ['Polygon', 'MultiPolygon'].includes(gesture.session.detached.geometry?.type)) {
          const issue = validateGeometry(gesture.session.detached).find(row => row.severity !== 'warning');
          if (issue) throw Object.assign(new Error(issue.message), { code: 'PL-HYDRO-GEOMETRY', issue });
        }
        result = await applyGeometryPatch(editDomain, {
          commit: () => geometry.commitObjectGesture?.({
            targetRef: gesture.targetRef,
            source: gesture.session.source,
            feature: gesture.session.detached,
            beforeGeometry: gesture.session.beforeGeometry,
            changed: gesture.session.changed,
            snapshot: gesture.session.snapshot,
            previewId,
          }),
        });
      } else if (gesture.session?.kind === 'boundary') {
        if(gesture.session.changed){boundaryHistory=boundaryHistory.slice(0,boundaryCursor);boundaryHistory.push(gesture.session);boundaryCursor++;}
        if(previewId)previewController.clear(previewId);
        result=true;
      } else result = await geometry.endGesture?.(gesture, event);
    } catch (error) {
      if (previewId) previewController.clear(previewId);
      if (!disposed && generation === projectGeneration) emit('vertex-commit-failed');
      throw error;
    }
    if (disposed || generation !== projectGeneration) return false;
    activeSnap = null;
    if (result === false && previewId) previewController.clear(previewId);
    emit(event.type);
    return result !== false;
  };

  const placeSelectedVertex=async value=>{
    if(!vertexPlacement||!selectedVertex||Number(value.projectGeneration)!==projectGeneration)return false;
    const vertex=selectedVertex,packet=createRenderPacket(),group=vertex.kind==='draft-vertex'?packet.draft.vertices:vertex.kind==='boundary-vertex'?packet.boundaryEdit?.handles:packet.objectVertices?.handles;
    const exists=group?.some(row=>vertex.kind==='draft-vertex'?row.index===vertex.vertexIndex:(row.nodeKey||row.key)===vertex.vertexKey);
    if(!exists){selectedVertex=null;vertexPlacement=false;emit('vertex-selection-stale');return false;}
    vertexPlacement=false;const event={...value,...vertex,projectGeneration,packetRevision:revision,gestureId:'placement-'+(++gestureSequence)};
    if(!await beginGesture({...event,type:vertex.kind+'-drag-start'}))return false;
    try {await applyGestureMove({...event,type:vertex.kind+'-drag-move'});return await endGesture({...event,type:vertex.kind+'-drag-end'});}
    catch(error){await cancelActiveGesture('placement-failed');throw error;}
  };
  const handleInteraction = event => {
    active();
    const value = event && Object.freeze({ ...event });
    const type = String(value?.type || '');
    if (!type) return false;
    if(type==='object-edit-start'){if(activeGesture||draftInputActive()||boundaryDraftActive())return false;const target=geometry.getObjectVertexTarget(value.targetRef);if(!target)return false;objectVertexEditing=Object.freeze({...target.targetRef});selectedVertex=null;vertexPlacement=false;emit(type);return true;}
    if(type==='object-edit-end'){if(activeGesture)return false;objectVertexEditing=null;selectedVertex=null;vertexPlacement=false;emit(type);return true;}
    if(type==='gesture-cancel')return cancelActiveGesture('touch-cancel');
    if(type.endsWith('-vertex-select')){
      if(Number(value.projectGeneration)!==projectGeneration||Number(value.packetRevision)!==revision||activeGesture)return false;
      selectedVertex=Object.freeze({kind:type.replace('-select',''),targetRef:value.targetRef||null,vertexKey:value.vertexKey||null,vertexIndex:value.vertexIndex});vertexPlacement=false;
      if(type==='draft-vertex-select')return selectDraftVertex(Number(value.vertexIndex));emit(type);return true;
    }
    if(type==='vertex-placement-start'){if(!selectedVertex||activeGesture)return false;vertexPlacement=true;emit(type);return true;}
    if(type==='vertex-placement-cancel'){vertexPlacement=false;emit(type);return true;}
    if(type==='vertex-placement-commit')return placeSelectedVertex(value);

    if (type.endsWith('-drag-start')) return beginGesture(value);
    if (type.endsWith('-drag-move')) return queueGestureMove(value);
    if (type.endsWith('-drag-end')) return endGesture(value);
    if (Number(value.projectGeneration) !== projectGeneration) return false;
    // Prepared-source identities outlive presentation revisions. The workflow validates
    // component source keys and calculation-specific candidate IDs before changing selection.
    const preparedTerritory = type.startsWith('territory-component-') && value.territorySourceKey
      || type === 'territory-candidate-select' && value.candidateId;
    if (Number(value.packetRevision) !== revision && !preparedTerritory) return false;
    if (type === 'draft-segment-hover' || type === 'draft-segment-insert') {
      if (!draftInputActive() || draftStroke.active || services.isSpacePanActive?.()) return false;
      if (type === 'draft-segment-insert' && !draftEdit.vertexInsertMode) return false;
      const row = draftSegments(draftCoords, toolConfig()?.shape === 'polygon').find(item => item.segmentIndex === Number(value.segmentIndex));
      const start = row ? services.projectCoordinate?.(row.start) : null;
      const end = row ? services.projectCoordinate?.(row.end) : null;
      if (!start || !end || !Array.isArray(value.screenPoint)) return false;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const length2 = dx * dx + dy * dy;
      if (length2 <= 1e-6) return false;
      const ratio = Math.max(0.08, Math.min(0.92, ((value.screenPoint[0] - start[0]) * dx + (value.screenPoint[1] - start[1]) * dy) / length2));
      const insert = services.screenToCoordinate?.([start[0] + dx * ratio, start[1] + dy * ratio]);
      if (!insert) return false;
      if (type === 'draft-segment-insert') return insertDraftPointAt(row.segmentIndex, insert);
      return applyDraft('setInsertTarget',{ insertTarget: { segmentIndex: row.segmentIndex,coordinate: insert } },{ reason: type });
    }
    if (type === 'draft-segment-leave') return clearDraftHover(type);
    if (type === 'draft-insert-request') return insertDraftPoint();
    if (type === 'draft-vertex-select') return selectDraftVertex(Number(value.vertexIndex));
    if (type === 'draft-hover-move') return setDraftHover(value);
    if (type === 'draft-hover-clear') return clearDraftHover(type);
    if (type === 'draft-stroke-start') return beginDraftStroke(value.screenPoint, value);
    if (type === 'draft-stroke-move') return appendDraftStroke(value.screenPoints || [value.screenPoint]);
    if (type === 'draft-stroke-end') return finishDraftStroke(value.screenPoint);
    if (type === 'draft-stroke-cancel') return cancelDraftStroke(type);
    if (type.startsWith('territory-')) {
      const changed = geometry.handleTerritoryInteraction?.(value) ?? false;
      if (changed) emit(type);
      return changed;
    }
    return false;
  };

  const createRenderPacket = () => {
    if (packetRevision === revision) return packet;
    const config = toolConfig();
    const rawCoords = cloneCoordinates(draftCoords);
    for (const sample of draftStroke.samples || []) {
      if (!rawCoords.length || !coordinateNear(rawCoords.at(-1), sample.coordinate)) rawCoords.push(cloneCoordinate(sample.coordinate));
    }
    const assessment = draftCutAssessment;
    const displayCoords = assessment?.line?.length === draftCoords.length ? assessment.line : draftCoords;
    const supplemental = geometry.renderPacket?.({
      tool: activeTool,
      phase,
      revision,
      projectGeneration,
      draftCoords: cloneCoordinates(draftCoords),
      selectedVertexIndex: draftEdit.selectedVertexIndex,
    }) || {};
    const objectTarget = supplemental.objectVertices || geometry.getObjectVertexTarget?.(objectVertexEditing);
    const objectFeature = activeGesture?.session?.kind === 'object'
      ? activeGesture.session.detached
      : objectTarget?.feature;
    const objectVertices = objectTarget && objectFeature ? {
      targetRef: objectTarget.targetRef,
      mode: objectTarget.mode,
      handles: editableVertices(objectFeature),
      previewSegments: activeGesture?.session?.kind === 'object'
        ? vertexPreviewSegments(objectFeature, activeGesture.session.vertex)
        : [],
    } : supplemental.objectVertices;
    packet = createEditingRenderPacket({
      boundaryActiveNodeKey: activeGesture?.session?.kind === 'boundary' ? activeGesture.vertexKey : null,
      boundaryActiveCoordinate: activeGesture?.session?.kind === 'boundary' ? activeGesture.session.coordinate : null,
      revision,
      projectGeneration,
      tool: activeTool,
      phase,
      draft: config ? {
        active: true,
        inputPhase: draftEdit.inputPhase,
        vertexInsertMode: draftEdit.vertexInsertMode,
        shape: config.shape,
        geometry: draftGeometry(assessment?.line || [...draftCoords, ...(draftHover ? [draftHover] : [])], config.shape),
        rawStrokeGeometry: draftStroke.active ? draftGeometry(rawCoords, 'line') : null,
        autoCloseSegment: config.shape === 'polygon' && draftCoords.length >= 3 ? { start: draftCoords.at(-1), end: draftCoords[0] } : null,
        vertices: cloneCoordinates(displayCoords).map((value, index) => ({ key: `draft:${index}`, index, coordinate: value, selected: index === draftEdit.selectedVertexIndex })),
        segments: draftSegments(displayCoords, config.shape === 'polygon'),
        selectedVertexIndex: draftEdit.selectedVertexIndex,
        insertTarget: draftEdit.insertTarget,
        dragging: draftEdit.dragging,
        issues: draftHover ? assessment?.issues || [] : draftIssues,
        splitCandidates: !draftHover && !draftEdit.dragging && draftSplitPreview?.revision === draftEdit.revision
          ? draftSplitPreview.candidates : assessment?.splitPreview?.candidates || [],
        snapPoints: assessment?.snaps ? Object.entries(assessment.snaps).filter(([, item]) => item?.coordinate).map(([endpoint, item]) => ({ endpoint, ...item })) : [],
        cutStatus: assessment?.status || null,
        canCommit: assessment ? assessment.valid === true : draftIssues.length === 0,
      } : { active: false },
      selectedVertex,vertexPlacement,
      magnifier:activeGesture?.pointerType==='touch'&&activeGesture.screenPoint?{screenPoint:activeGesture.screenPoint,coordinate:activeGesture.coordinate}:null,
      objectVertices,
      boundaryEdit: supplemental.boundaryEdit && boundaryMoves().length ? {
        ...supplemental.boundaryEdit, draft: true,
        handles:supplemental.boundaryEdit.handles.map(handle=>({...handle,coordinate:boundaryCoordinate(handle.coordinate)})),
        segments:supplemental.boundaryEdit.segments.map(segment=>({...segment,start:boundaryCoordinate(segment.start),end:boundaryCoordinate(segment.end)})),
      } : supplemental.boundaryEdit,
      territoryOperation: supplemental.territoryOperation,
      snap: activeSnap,
      preview: supplemental.preview || previewController?.packet?.() || null,
      validationIssues: supplemental.validationIssues,
    });
    packetRevision = revision;
    return packet;
  };

  const applyGeometryPatch = async (domain, patch) => {
    active();
    if (typeof transactionRunner === 'function') return transactionRunner({ domain, patch, projectGeneration });
    const error = new TypeError(`${domain} geometry patch requires a transaction runner.`);
    error.code = 'PL-EDIT-TRANSACTION-001';
    throw error;
  };

  const resetProject = async generation => {
    selectionHistory = []; selectionCursor = 0;
    boundaryHistory=[];boundaryCursor=0;
    await cancelActiveGesture('project-reset', { emitChange: false });
    projectGeneration = Number(generation || 0);
    activeGesture = null;
    activeTool = 'select';
    phase = 'idle';
    draftHover = null;
    draftCutAssessment = null;
    await applyDraft('stop',{}, { emit: false });
    draftIssues = [];
    draftSplitPreview = null;
    draftStroke = createDraftStrokeState();
    activeSnap = null;
    selectedVertex=null;vertexPlacement=false;objectVertexEditing=null;
    emit('project-reset');
    return true;
  };
  const captureReplacement=()=>{
    const saved={activeTool,phase,draftHover,draftCutAssessment,draftEdit,draftIssues,draftSplitPreview,draftCoords:cloneCoordinates(draftCoords),selectionHistory:selectionHistory.slice(),selectionCursor,boundaryHistory:boundaryHistory.slice(),boundaryCursor,selectedVertex,vertexPlacement,objectVertexEditing};
    return generation=>{projectGeneration=generation;activeTool=saved.activeTool;phase=saved.phase;draftHover=saved.draftHover;draftCutAssessment=saved.draftCutAssessment;draftEdit=saved.draftEdit;draftCoords=saved.draftCoords;draftIssues=saved.draftIssues;draftSplitPreview=saved.draftSplitPreview;selectionHistory=saved.selectionHistory;selectionCursor=saved.selectionCursor;boundaryHistory=saved.boundaryHistory;boundaryCursor=saved.boundaryCursor;selectedVertex=saved.selectedVertex;vertexPlacement=saved.vertexPlacement;objectVertexEditing=saved.objectVertexEditing;emit('replacement-rollback');};
  };
  const dispose = () => {
    selectionHistory = []; boundaryHistory = [];
    if (pendingMoveFrame) services.cancelFrame(pendingMoveFrame);
    pendingMoveFrame = 0;
    pendingMove = null;
    activeGesture = null;
    previewController?.clear?.();
    unsubscribeCore();
    disposed = true;
    phase = 'idle';
    activeTool = 'select';
  };
  const commitImport = async plan => {
    const assertCurrent = () => assertCurrentGisImportPlan(plan, projectDomain.getGeneration());
    assertCurrent();
    const result = { ...plan.payload.result, assertCurrent };
    const committer = await getImportCommitter();
    assertCurrent();
    if (!committer) throw new Error('GIS import committer is not ready.');
    if (plan.kind === 'project-replace') return committer.applyImportedReplacement(result);
    if (plan.kind === 'territorial') return committer.commitTerritorialImport(result, plan.source.fileName || '벡터 파일');
    const target = plan.kind === 'distribution' ? 'distribution' : result.targetType || 'generic';
    return committer.importGeoJson({ name: plan.source.fileName || '벡터 파일' }, {
      parsed: result.collection,
      target,
      mapping: { ...result.mapping },
    });
  };

  return Object.freeze({
    setTool, handleInteraction, createRenderPacket,
    refreshEditingPresentation: async reason => {
      if (disposed) return false;
      if (!draftInputActive() && draftEdit.vertexInsertMode) await applyDraft('setInsertMode',{ insertMode: false },{ emit: false });
      emit(reason || 'editing-presentation-changed');
      return true;
    },
    refreshTerritorySelection: ({ tool: expectedTool, reason } = {}) => {
      if (disposed || !expectedTool || String(expectedTool) !== activeTool) return false;
      emit(reason || 'territory-selection-changed');
      return true;
    },
    startDraft, replaceDraftCoordinates, clearDraftHover,
    acceptCoreDraftSnapshot,
    cancelActiveGesture, resetProject, previewBoundaryDraft,
    dispose, draftInputActive, appendDraftScreenPoint,
    recordSelectionChange, performDraftUndo, performDraftRedo, removeLastDraftPoint, deleteSelectedDraftPoint,
    moveSelectedDraftPointByPixels, redrawDraft, setDraftVertexInsertMode,
    clearDraft,
    commitImport,
    captureReplacement,
    snapshot: () => snapshotCache || (snapshotCache = buildSnapshot('snapshot')),
  });
}
