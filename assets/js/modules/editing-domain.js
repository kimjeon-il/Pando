import {
  createDraftEditState,
  deleteDraftVertex,
  insertDraftVertex,
  moveDraftVertex,
  recordDraftSnapshot,
  redoDraftSnapshot,
  removeLastDraftVertex,
  resetDraftEditState,
  undoDraftSnapshot,
} from './draft-editor.js';
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
  importTransactions = null,
  onEditingStateChanged = () => {},
  maxHistory = 100,
} = {}) {
  let phase = 'idle';
  let activeTool = 'select';
  let projectGeneration = Number(projectDomain?.getGeneration?.() || 0);
  let disposed = false;
  let revision = 0;
  let packet = EMPTY_EDITING_RENDER_PACKET;
  let packetRevision = -1;
  let draftCoords = [];
  let draftHover = null;
  let draftCutAssessment = null;
  let draftEdit = createDraftEditState();
  let draftStroke = createDraftStrokeState();
  let activeSnap = null;
  let activeGesture = null;
  let gestureSequence = 0;
  let pendingMove = null;
  let pendingMoveFrame = 0;
  let snapshotCache = null;

  const tool = toolController || {};
  const services = draftServices || {};
  const geometry = geometryEditing || {};
  const imports = importTransactions || {};
  const active = () => { if (disposed) throw new Error('Editing domain is disposed.'); };
  const toolConfig = () => services.getToolConfig?.(activeTool) || null;
  const draftInputActive = () => !!toolConfig();
  const requestEditingRender = reason => context?.requestRender?.({ kind: 'editing-overlays', reason: String(reason || 'editing-change') });

  const buildSnapshot = reason => Object.freeze({
    revision,
    projectGeneration,
    phase,
    activeTool,
    reason: String(reason || ''),
    draft: Object.freeze({
      coords: Object.freeze(cloneCoordinates(draftCoords).map(Object.freeze)),
      hover: draftHover ? Object.freeze(cloneCoordinate(draftHover)) : null,
      inputPhase: draftEdit.inputPhase,
      selectedVertexIndex: draftEdit.selectedVertexIndex,
      insertTarget: draftEdit.insertTarget ? Object.freeze({
        segmentIndex: draftEdit.insertTarget.segmentIndex,
        coordinate: Object.freeze(cloneCoordinate(draftEdit.insertTarget.coordinate)),
      }) : null,
      dragging: draftEdit.dragging,
      issues: Object.freeze([...(draftEdit.issues || [])]),
      historyCount: draftEdit.history.length,
      futureCount: draftEdit.future.length,
      strokeActive: draftStroke.active === true,
      cutAssessment: draftCutAssessment,
      activeSnap,
    }),
  });

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
    const assessment = services.assessDraft?.({
      tool: activeTool,
      coords: cloneCoordinates(draftCoords),
      hover: draftHover ? cloneCoordinate(draftHover) : null,
      buildPreview,
      revision: draftEdit.revision,
    }) || null;
    draftCutAssessment = assessment?.cutAssessment || assessment || null;
    draftEdit.issues = [...(assessment?.issues
      || draftCutAssessment?.issues
      || services.validateDraft?.(activeTool, draftCoords)
      || defaultDraftIssues(draftCoords, toolConfig()?.shape === 'polygon'))];
    draftEdit.splitPreview = buildPreview ? (assessment?.splitPreview || null) : null;
    return assessment;
  };

  const syncAfterMutation = (options = {}) => {
    draftEdit.revision += 1;
    draftEdit.insertTarget = null;
    draftHover = null;
    refreshDerivedState({ buildPreview: options.buildPreview !== false });
    emit(options.reason || 'draft-mutated');
    return true;
  };

  const commitDraftCoords = (nextCoords, selectedVertexIndex = draftEdit.selectedVertexIndex, options = {}) => {
    active();
    if (!draftInputActive()) return false;
    if (options.record !== false) recordDraftSnapshot(draftEdit, draftCoords, draftEdit.selectedVertexIndex, maxHistory);
    draftCoords = cloneCoordinates(nextCoords);
    if (options.inputPhase) draftEdit.inputPhase = options.inputPhase === 'refine' ? 'refine' : 'draw';
    draftEdit.selectedVertexIndex = Number.isInteger(selectedVertexIndex) && selectedVertexIndex >= 0 && selectedVertexIndex < draftCoords.length
      ? selectedVertexIndex : null;
    return syncAfterMutation(options);
  };

  const appendDraftCoordinate = (coord, options = {}) => {
    if (!draftInputActive() || !Array.isArray(coord)) return false;
    if (options.dedupe && draftCoords.length && coordinateNear(draftCoords.at(-1), coord)) return false;
    return commitDraftCoords([...draftCoords, coord], draftCoords.length, { inputPhase: 'draw' });
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
    if (!draftInputActive() || draftStroke.active) return false;
    const value = undoDraftSnapshot(draftEdit, draftCoords);
    if (!value) return false;
    draftCoords = cloneCoordinates(value.coords);
    draftEdit.selectedVertexIndex = value.selectedVertexIndex;
    return syncAfterMutation({ buildPreview: true });
  };

  const performDraftRedo = () => {
    if (!draftInputActive() || draftStroke.active) return false;
    const value = redoDraftSnapshot(draftEdit, draftCoords);
    if (!value) return false;
    draftCoords = cloneCoordinates(value.coords);
    draftEdit.selectedVertexIndex = value.selectedVertexIndex;
    return syncAfterMutation({ buildPreview: true });
  };

  const removeLastDraftPoint = () => {
    if (!draftInputActive() || draftStroke.active || !draftCoords.length) return false;
    const value = removeLastDraftVertex(draftCoords, draftEdit.selectedVertexIndex);
    return commitDraftCoords(value.coords, value.selectedVertexIndex);
  };

  const deleteSelectedDraftPoint = () => {
    if (!draftInputActive() || draftStroke.active || !Number.isInteger(draftEdit.selectedVertexIndex)) return false;
    const value = deleteDraftVertex(draftCoords, draftEdit.selectedVertexIndex);
    return commitDraftCoords(value.coords, value.selectedVertexIndex, { inputPhase: 'refine' });
  };

  const insertDraftPointAt = (segmentIndex, value) => {
    if (!draftInputActive() || draftStroke.active || !Array.isArray(value)) return false;
    const result = insertDraftVertex(draftCoords, Number(segmentIndex), value, toolConfig()?.shape === 'polygon');
    return result.insertedIndex == null ? false : commitDraftCoords(result.coords, result.insertedIndex, { inputPhase: 'refine' });
  };

  const insertDraftPoint = () => draftEdit.insertTarget
    ? insertDraftPointAt(draftEdit.insertTarget.segmentIndex, draftEdit.insertTarget.coordinate)
    : false;

  const selectDraftVertex = index => {
    if (!Number.isInteger(index) || index < 0 || index >= draftCoords.length) return false;
    if (draftEdit.selectedVertexIndex === index && draftEdit.inputPhase === 'refine' && !draftEdit.insertTarget) return false;
    draftEdit.selectedVertexIndex = index;
    draftEdit.inputPhase = 'refine';
    draftEdit.insertTarget = null;
    emit('draft-vertex-select');
    return true;
  };

  const moveSelectedDraftPointByPixels = (dx, dy) => {
    const index = draftEdit.selectedVertexIndex;
    const current = draftCoords[index];
    if (!draftInputActive() || draftStroke.active || !Number.isInteger(index) || !current) return false;
    const projected = services.projectCoordinate?.(current);
    const value = projected ? services.screenToCoordinate?.([projected[0] + dx, projected[1] + dy]) : null;
    if (!value) return false;
    return commitDraftCoords(moveDraftVertex(draftCoords, index, value), index, { inputPhase: 'refine' });
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

  const clearDraftHover = (reason = 'draft-hover-clear') => {
    if (!draftHover && !draftEdit.insertTarget && !activeSnap) return false;
    draftHover = null;
    draftEdit.insertTarget = null;
    activeSnap = null;
    emit(reason);
    return true;
  };

  const beginDraftStroke = (screenPoint, event = {}) => {
    active();
    const config = toolConfig();
    if (!config || draftEdit.inputPhase !== 'draw' || services.isSpacePanActive?.()) return false;
    const sample = services.screenSample?.(screenPoint);
    if (!sample) return false;
    draftHover = null;
    draftEdit.insertTarget = null;
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

  const finishDraftStroke = screenPoint => {
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
    commitDraftCoords(next, null, { inputPhase: 'refine', buildPreview: true, reason: 'draft-stroke-finish' });
    services.onFinished?.(config);
    return true;
  };

  const cancelDraftStroke = reason => {
    active();
    if (!draftStroke.active) return false;
    cancelRawDraftStroke(draftStroke);
    emit(reason || 'draft-stroke-cancel');
    return true;
  };

  const startDraft = (config = {}) => {
    active();
    draftCoords = cloneCoordinates(config.coords);
    draftHover = null;
    draftCutAssessment = null;
    draftEdit = createDraftEditState();
    draftStroke = createDraftStrokeState();
    activeSnap = null;
    if (config.inputPhase === 'refine') draftEdit.inputPhase = 'refine';
    emit('draft-start');
    return true;
  };

  const redrawDraft = () => {
    if (!draftInputActive()) return false;
    cancelDraftStroke('redraw-draft');
    draftCoords = [];
    draftHover = null;
    draftCutAssessment = null;
    resetDraftEditState(draftEdit);
    emit('redraw-draft');
    return true;
  };

  const clearDraft = (options = {}) => {
    active();
    const normalizedOptions = typeof options === 'boolean'
      ? { render: options }
      : (options || {});
    pendingMove = null;
    if (pendingMoveFrame) services.cancelFrame?.(pendingMoveFrame);
    pendingMoveFrame = 0;
    activeGesture = null;
    draftCoords = [];
    draftHover = null;
    draftCutAssessment = null;
    resetDraftStrokeState(draftStroke);
    resetDraftEditState(draftEdit);
    activeSnap = null;
    previewController?.clear?.();
    emit(normalizedOptions.reason || 'draft-cleared', { render: normalizedOptions.render !== false });
    return true;
  };

  const setTool = (nextTool, options = {}) => {
    active();
    const name = String(nextTool || 'select');
    if (name !== 'select' && tool.requireCanonicalData && !tool.requireCanonicalData()) return false;
    cancelActiveGesture('tool-change', { emitChange: false });
    if (tool.getGeometryPreviewSession?.() && activeTool !== name) tool.discardGeometryPreview?.({ announce: false });
    if (activeTool !== name) clearDraft({ reason: 'tool-draft-reset', render: false });
    tool.clearHover?.();
    tool.resetForTool?.(name);
    activeTool = name;
    phase = name === 'select' ? 'idle' : 'active';
    tool.applyToolPresentation?.(name, options);
    emit('tool-change');
    return true;
  };

  const beginTool = value => setTool(value);
  const finishTool = () => setTool('select', { announce: false });
  const cancelTool = reason => {
    clearDraft({ reason: reason || 'cancel-tool', render: false });
    return setTool('select', { announce: false });
  };

  const beginBoundaryEdit = target => {
    active();
    phase = 'boundary-edit';
    activeTool = target?.mode || 'country-border';
    geometry.beginBoundaryEdit?.(target);
    emit('begin-boundary-edit');
    return true;
  };

  const beginObjectVertexEdit = (targetRef, vertexKey) => geometry.beginObjectVertexEdit?.({ targetRef, vertexKey }) ?? false;
  const beginBoundaryVertexEdit = (targetRef, vertexKey) => geometry.beginBoundaryVertexEdit?.({ targetRef, vertexKey }) ?? false;

  function cancelActiveGesture(reason = 'gesture-cancel', { emitChange = true } = {}) {
    if (!activeGesture) return false;
    geometry.cancelGesture?.(activeGesture, reason);
    activeGesture = null;
    draftEdit.dragging = false;
    activeSnap = null;
    previewController?.clear?.();
    if (emitChange) emit(reason);
    return true;
  }

  const interactionCoordinate = event => Array.isArray(event?.screenPoint)
    ? resolveCoordinate(event.screenPoint, event.pointerType || 'mouse', { excludeNodeKey: event.vertexKey, targetRef: event.targetRef })
    : null;

  const beginGesture = event => {
    if (Number(event.projectGeneration) !== projectGeneration || Number(event.packetRevision) !== revision) return false;
    const gestureId = String(event.gestureId || `editing-${++gestureSequence}`);
    activeGesture = { id: gestureId, type: event.type, targetRef: event.targetRef || null, vertexKey: event.vertexKey || null };
    if (event.type === 'draft-vertex-drag-start') {
      const index = Number(event.vertexIndex);
      if (!Number.isInteger(index) || !draftCoords[index]) return cancelActiveGesture('invalid-draft-gesture', { emitChange: false });
      recordDraftSnapshot(draftEdit, draftCoords, index, maxHistory);
      draftEdit.selectedVertexIndex = index;
      draftEdit.inputPhase = 'refine';
      draftEdit.insertTarget = null;
      draftEdit.dragging = true;
      draftEdit.splitPreview = null;
      draftHover = null;
    } else {
      let began;
      if (event.type === 'boundary-vertex-drag-start') {
        began = geometry.beginBoundaryGesture?.(event);
        if (began && typeof began === 'object') activeGesture.session = { kind: 'boundary', ...began };
      } else if (typeof geometry.beginObjectGesture === 'function') {
        began = geometry.beginObjectGesture(event);
      } else {
        const source = geometry.resolveObjectFeature?.(event.targetRef);
        const detached = source ? structuredClone(source) : null;
        const selectedVertex = editableVertices(detached).find(item => item.key === String(event.vertexKey || ''));
        if (!source || !detached || !selectedVertex || geometry.canEditObject?.(source, selectedVertex) === false) began = false;
        else {
          activeGesture.session = {
            kind: 'object',
            source,
            detached,
            vertex: selectedVertex,
            beforeGeometry: structuredClone(source.geometry),
            changed: false,
          };
          began = true;
        }
      }
      if (began === false) return cancelActiveGesture('rejected-vertex-gesture', { emitChange: false });
    }
    emit(event.type);
    return true;
  };

  const applyGestureMove = event => {
    if (!activeGesture || String(event.gestureId || '') !== activeGesture.id || Number(event.projectGeneration) !== projectGeneration) return false;
    const value = interactionCoordinate(event);
    if (!value) return false;
    if (activeGesture.type === 'draft-vertex-drag-start') {
      const index = draftEdit.selectedVertexIndex;
      draftCoords = moveDraftVertex(draftCoords, index, value);
      draftEdit.revision += 1;
      refreshDerivedState({ buildPreview: false });
    } else if (activeGesture.session?.kind === 'object') {
      const session = activeGesture.session;
      session.changed = session.changed || !coordinateNear(session.vertex.coordinate, value);
      setEditableVertex(session.detached, session.vertex, value);
      session.vertex = editableVertices(session.detached).find(item => item.key === session.vertex.key) || session.vertex;
      geometry.previewObjectGesture?.({
        source: session.source,
        feature: session.detached,
        vertex: session.vertex,
        segments: vertexPreviewSegments(session.detached, session.vertex),
      });
    } else if (activeGesture.session?.kind === 'boundary') {
      geometry.moveBoundaryGesture?.(activeGesture.session, value, event);
    } else geometry.moveGesture?.(activeGesture, value, event);
    emit(event.type);
    return true;
  };

  const flushPendingMove = () => {
    pendingMoveFrame = 0;
    const event = pendingMove;
    pendingMove = null;
    if (event) applyGestureMove(event);
  };

  const queueGestureMove = event => {
    pendingMove = event;
    if (!pendingMoveFrame) pendingMoveFrame = (services.requestFrame || globalThis.requestAnimationFrame || (callback => globalThis.setTimeout(callback, 0)))(flushPendingMove);
    return true;
  };

  const endGesture = async event => {
    if (!activeGesture || String(event.gestureId || '') !== activeGesture.id || Number(event.projectGeneration) !== projectGeneration) return false;
    if (pendingMove) flushPendingMove();
    const gesture = activeGesture;
    activeGesture = null;
    if (gesture.type === 'draft-vertex-drag-start') {
      draftEdit.dragging = false;
      activeSnap = null;
      refreshDerivedState({ buildPreview: true });
      emit(event.type);
      return true;
    }
    let result;
    if (gesture.session?.kind === 'object') {
      const editDomain = gesture.targetRef?.domain === 'hydro' ? 'hydro' : 'generic';
      result = await applyGeometryPatch(editDomain, {
        commit: () => geometry.commitObjectGesture?.({
          source: gesture.session.source,
          feature: gesture.session.detached,
          beforeGeometry: gesture.session.beforeGeometry,
          changed: gesture.session.changed,
        }),
      });
    } else if (gesture.session?.kind === 'boundary') {
      result = await applyGeometryPatch('country', {
        commit: () => geometry.commitBoundaryGesture?.(gesture.session, event),
      });
    } else result = await geometry.endGesture?.(gesture, event);
    activeSnap = null;
    previewController?.clear?.();
    emit(event.type);
    return result !== false;
  };

  const handleInteraction = event => {
    active();
    const value = event && Object.freeze({ ...event });
    const type = String(value?.type || '');
    if (!type) return false;
    if (type.endsWith('-drag-start')) return beginGesture(value);
    if (type.endsWith('-drag-move')) return queueGestureMove(value);
    if (type.endsWith('-drag-end')) return endGesture(value);
    if (Number(value.projectGeneration) !== projectGeneration || Number(value.packetRevision) !== revision) return false;
    if (type === 'draft-segment-hover') {
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
      draftEdit.insertTarget = { segmentIndex: row.segmentIndex, coordinate: cloneCoordinate(insert) };
      emit(type);
      return true;
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
    const objectTarget = supplemental.objectVertices || geometry.getObjectVertexTarget?.();
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
      revision,
      projectGeneration,
      tool: activeTool,
      phase,
      draft: {
        active: !!config,
        inputPhase: draftEdit.inputPhase,
        shape: config?.shape || null,
        geometry: draftGeometry(assessment?.line || [...draftCoords, ...(draftHover ? [draftHover] : [])], config?.shape),
        rawStrokeGeometry: draftStroke.active ? draftGeometry(rawCoords, 'line') : null,
        autoCloseSegment: config?.shape === 'polygon' && draftCoords.length >= 3 ? { start: draftCoords.at(-1), end: draftCoords[0] } : null,
        vertices: cloneCoordinates(displayCoords).map((value, index) => ({ key: `draft:${index}`, index, coordinate: value, selected: index === draftEdit.selectedVertexIndex })),
        segments: draftSegments(displayCoords, config?.shape === 'polygon'),
        selectedVertexIndex: draftEdit.selectedVertexIndex,
        insertTarget: draftEdit.insertTarget,
        dragging: draftEdit.dragging,
        issues: draftHover ? assessment?.issues || [] : draftEdit.issues,
        splitCandidates: !draftHover && !draftEdit.dragging && draftEdit.splitPreview?.revision === draftEdit.revision
          ? draftEdit.splitPreview.candidates : assessment?.splitPreview?.candidates || [],
        snapPoints: assessment?.snaps ? Object.entries(assessment.snaps).filter(([, item]) => item?.coordinate).map(([endpoint, item]) => ({ endpoint, ...item })) : [],
        cutStatus: assessment?.status || null,
        canCommit: assessment ? assessment.valid === true : draftEdit.issues.length === 0,
      },
      objectVertices,
      boundaryEdit: supplemental.boundaryEdit,
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

  const executeTerritorialTransaction = plan => applyGeometryPatch('territorial', plan);
  const updatePointer = input => handleInteraction(input);
  const commit = () => { phase = 'idle'; activeTool = 'select'; return emit('commit'); };
  const cancel = reason => cancelTool(reason || 'cancel');
  const resetProject = generation => {
    projectGeneration = Number(generation || 0);
    activeGesture = null;
    activeTool = 'select';
    phase = 'idle';
    draftCoords = [];
    draftHover = null;
    draftCutAssessment = null;
    draftEdit = createDraftEditState();
    draftStroke = createDraftStrokeState();
    activeSnap = null;
    emit('project-reset');
    return true;
  };
  const dispose = () => {
    cancelActiveGesture('dispose', { emitChange: false });
    disposed = true;
    phase = 'idle';
    activeTool = 'select';
  };

  return Object.freeze({
    setTool, beginTool, updatePointer, finishTool, cancelTool, beginBoundaryEdit,
    beginObjectVertexEdit, beginBoundaryVertexEdit, handleInteraction, createRenderPacket,
    startDraft, replaceDraftCoordinates, setDraftHover, clearDraftHover, selectDraftVertex,
    cancelActiveGesture, resetProject, applyGeometryPatch, executeTerritorialTransaction,
    commit, cancel, dispose, draftInputActive, commitDraftCoords, appendDraftCoordinate, appendDraftScreenPoint,
    performDraftUndo, performDraftRedo, removeLastDraftPoint, deleteSelectedDraftPoint,
    insertDraftPoint, moveSelectedDraftPointByPixels, beginDraftStroke, appendDraftStroke,
    finishDraftStroke, cancelDraftStroke, redrawDraft, syncDraftAfterMutation: syncAfterMutation,
    clearDraft,
    importProject: (...args) => imports.replaceProject?.(...args),
    mergeCountries: (...args) => imports.mergeCountries?.(...args),
    importTerritorial: (...args) => imports.territorial?.(...args),
    importGeneric: (...args) => imports.geoJson?.(...args),
    importDistribution: (...args) => imports.distribution?.(...args),
    commitImport: (...args) => imports.commitImport?.(...args),
    reconcileCoast: (...args) => imports.reconcileCoast?.(...args),
    snapshot: () => snapshotCache || (snapshotCache = buildSnapshot('snapshot')),
  });
}
