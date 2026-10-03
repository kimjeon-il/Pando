import {
  applyReferenceImageEdit,
  copyReferenceImageRecords,
} from './reference-image-edit-session.js';
import {
  alignReferenceImageAnchor,
  applyReferenceImageFreeTransformDrag,
  applyReferenceImagePlacementDrag,
  createReferenceImageFreeTransformDrag,
  createReferenceImagePlacementDrag,
  referenceImageFreeTransformHit,
  referenceImagePlacementHit,
} from './reference-image-transform.js';

function releasePointer(mapElement, pointerId) {
  try { mapElement.releasePointerCapture?.(pointerId); } catch (_) {}
}

function capturePointer(mapElement, pointerId) {
  try { mapElement.setPointerCapture?.(pointerId); } catch (_) {}
}

export function createReferenceImageInteraction({
  mapElement,
  records,
  selected,
  renderer,
  getMapHost,
  getSurface,
  cancelTools = () => {},
  currentToken,
  validToken,
  createId,
  rebuildWarp,
  getCurrentWarpQuad,
  history,
  persist,
  renderEditor,
  refreshUi,
  setHint,
} = {}) {
  if (!mapElement || !Array.isArray(records) || typeof selected !== 'function') {
    throw new TypeError('reference image interaction requires mapElement, records and selected');
  }
  if (!renderer || typeof renderer.requestRender !== 'function') {
    throw new TypeError('reference image interaction requires renderer');
  }

  let anchorState = null;
  let gcpState = null;
  let controlPointEditingId = '';
  let selectedControlPointId = '';
  let controlPointDrag = null;
  let placementEditingId = '';
  let placementDrag = null;
  let placementBefore = null;
  let freeTransformEditingId = '';
  let freeTransformDrag = null;
  let freeTransformBefore = null;

  const surface = () => getSurface?.() || null;

  function getState() {
    return {
      anchorState,
      gcpState,
      controlPointEditingId,
      selectedControlPointId,
      placementEditingId,
      freeTransformEditingId,
    };
  }

  function isActive() {
    return !!(anchorState || gcpState || placementEditingId || freeTransformEditingId || controlPointEditingId);
  }

  function syncSurface() {
    const hint = anchorState
      ? (anchorState.step === 'image'
        ? '이미지에서 고정할 지점을 선택하세요.'
        : '같은 지점의 실제 지도 위치를 선택하세요.')
      : gcpState
        ? (gcpState.step === 'image'
          ? '이미지에서 맞출 지점을 선택하세요.'
          : '같은 지점의 실제 지도 위치를 선택하세요.')
        : controlPointEditingId
          ? '지도 위 기준점을 드래그해 이동하거나 선택 후 Delete로 삭제하세요.'
          : freeTransformEditingId
            ? '네 모서리를 각각 드래그해 자유 변형하세요.'
            : selected()?.anchor
              ? '고정점 유지 중 · 크기와 회전만 조정할 수 있습니다.'
              : '이미지를 드래그해 배치하세요.';
    surface()?.setEditing(isActive(), hint);
  }

  function cancelControlPointDrag() {
    if (!controlPointDrag) return;
    const drag = controlPointDrag;
    const record = records.find(candidate => candidate.id === drag.recordId);
    const before = drag.before.find(candidate => candidate.id === drag.recordId);
    if (record && before) {
      record.controlPoints = before.controlPoints.map(point => ({
        ...point,
        image: [...point.image],
        coordinate: [...point.coordinate],
      }));
      rebuildWarp(record);
    }
    releasePointer(mapElement, drag.pointerId);
    controlPointDrag = null;
    surface()?.setGestureActive(false);
    renderer.requestRender();
  }

  function cancelPlacementDrag() {
    if (!placementDrag) return;
    const record = records.find(item => item.id === placementDrag.recordId);
    if (record) record.mapQuad = placementDrag.startMapQuad.map(coordinate => [...coordinate]);
    releasePointer(mapElement, placementDrag.pointerId);
    placementDrag = null;
    placementBefore = null;
    surface()?.setGestureActive(false);
    renderer.requestRender();
  }

  function cancelFreeTransformDrag() {
    if (!freeTransformDrag) return;
    const drag = freeTransformDrag;
    const record = records.find(item => item.id === drag.recordId);
    const before = freeTransformBefore?.find(item => item.id === drag.recordId);
    if (record && before) {
      record.mapQuad = before.mapQuad.map(coordinate => [...coordinate]);
      record.cornerPinEnabled = before.cornerPinEnabled;
      rebuildWarp(record);
    } else if (record) {
      record.mapQuad = drag.startMapQuad.map(coordinate => [...coordinate]);
      rebuildWarp(record);
    }
    releasePointer(mapElement, drag.pointerId);
    freeTransformDrag = null;
    freeTransformBefore = null;
    surface()?.setGestureActive(false);
    renderer.requestRender();
  }

  function stopPlacementEditing({ renderUi = true } = {}) {
    cancelPlacementDrag();
    placementEditingId = '';
    mapElement.classList.remove('is-reference-placement-mode');
    if (renderUi) renderEditor();
    renderer.requestRender();
    syncSurface();
  }

  function stopFreeTransformEditing({ renderUi = true } = {}) {
    cancelFreeTransformDrag();
    freeTransformEditingId = '';
    mapElement.classList.remove('is-reference-free-transform-mode');
    if (renderUi) renderEditor();
    renderer.requestRender();
    syncSurface();
  }

  function cancelAnchor(renderUi = true) {
    anchorState = null;
    mapElement.classList.remove('is-reference-anchor-mode');
    if (renderUi && selected()) renderEditor();
    syncSurface();
  }

  function cancelGcp(renderUi = true) {
    gcpState = null;
    mapElement.classList.remove('is-reference-gcp-mode');
    if (renderUi && selected()) renderEditor();
    syncSurface();
  }

  function stopControlPointEditing({ renderUi = true } = {}) {
    cancelControlPointDrag();
    controlPointEditingId = '';
    selectedControlPointId = '';
    mapElement.classList.remove('is-reference-gcp-edit-mode');
    if (renderUi && selected()) renderEditor();
    renderer.requestRender();
    syncSurface();
  }

  function startPlacementEditing(record) {
    if (!record || record.locked || record.warp?.ok) return false;
    cancelTools();
    cancelAnchor(false);
    cancelGcp(false);
    stopControlPointEditing({ renderUi: false });
    stopFreeTransformEditing({ renderUi: false });
    placementEditingId = record.id;
    mapElement.classList.add('is-reference-placement-mode');
    renderEditor();
    renderer.requestRender();
    return true;
  }

  function startFreeTransformEditing(record) {
    if (!record || record.locked) return false;
    cancelTools();
    cancelAnchor(false);
    cancelGcp(false);
    stopControlPointEditing({ renderUi: false });
    stopPlacementEditing({ renderUi: false });
    freeTransformEditingId = record.id;
    mapElement.classList.add('is-reference-free-transform-mode');
    renderEditor();
    renderer.requestRender();
    return true;
  }

  function armAnchor(record) {
    if (!record || record.locked) return false;
    cancelTools();
    cancelGcp(false);
    stopControlPointEditing({ renderUi: false });
    stopPlacementEditing({ renderUi: false });
    stopFreeTransformEditing({ renderUi: false });
    anchorState = {
      recordId: record.id,
      step: 'image',
      image: null,
      token: currentToken(),
    };
    mapElement.classList.add('is-reference-anchor-mode');
    renderEditor();
    setHint('1/2 · 이미지에서 고정할 지점을 선택하세요.', 'working');
    return true;
  }

  function armGcp(record, pointId = '', side = 'image') {
    if (!record || record.locked) return false;
    cancelTools();
    cancelAnchor(false);
    stopPlacementEditing({ renderUi: false });
    stopFreeTransformEditing({ renderUi: false });
    stopControlPointEditing({ renderUi: false });
    gcpState = {
      recordId: record.id,
      step: side,
      image: null,
      pointId,
      token: currentToken(),
    };
    mapElement.classList.add('is-reference-gcp-mode');
    renderEditor();
    setHint(
      side === 'image'
        ? '이미지에서 맞출 지점을 선택하세요.'
        : '실제 지도 위치를 선택하세요.',
      'working',
    );
    return true;
  }

  function startControlPointEditing(record) {
    if (!record || record.locked || !record.controlPoints.length) return false;
    cancelTools();
    cancelAnchor(false);
    cancelGcp(false);
    stopPlacementEditing({ renderUi: false });
    stopFreeTransformEditing({ renderUi: false });
    controlPointEditingId = record.id;
    selectedControlPointId = '';
    mapElement.classList.add('is-reference-gcp-edit-mode');
    renderEditor();
    renderer.requestRender();
    return true;
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
    surface()?.setGestureActive(true);
    capturePointer(mapElement, event.pointerId);
    renderEditor();
    renderer.requestRender();
    return true;
  }

  function updateControlPointDrag(point, event) {
    if (!controlPointDrag || event.pointerId !== controlPointDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === controlPointDrag.recordId);
    const coordinate = getMapHost()?.unproject(point);
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
    releasePointer(mapElement, event.pointerId);
    controlPointDrag = null;
    surface()?.setGestureActive(false);
    if (record) {
      const before = drag.before.find(candidate => candidate.id === record.id);
      if (JSON.stringify(before?.controlPoints) !== JSON.stringify(record.controlPoints)) {
        history.push(drag.before);
      }
      void persist(record);
      renderEditor();
      renderer.requestRender();
    }
    return true;
  }

  function beginPlacementDrag(event, record, point) {
    const host = getMapHost();
    const hit = referenceImagePlacementHit(record, point, host);
    if (!hit) return false;
    placementDrag = createReferenceImagePlacementDrag(record, hit, point, host, event.pointerId);
    if (!placementDrag) return false;
    placementBefore = copyReferenceImageRecords(records);
    surface()?.setGestureActive(true);
    capturePointer(mapElement, event.pointerId);
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
      getMapHost(),
      { shiftKey: event.shiftKey },
    );
    if (changed) renderer.requestRender();
    return changed;
  }

  function finishPlacementDrag(event) {
    if (!placementDrag || event.pointerId !== placementDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === placementDrag.recordId);
    releasePointer(mapElement, event.pointerId);
    placementDrag = null;
    if (record && placementBefore) {
      const before = placementBefore.find(item => item.id === record.id);
      if (JSON.stringify(before?.mapQuad) !== JSON.stringify(record.mapQuad)) {
        history.push(placementBefore);
      }
    }
    placementBefore = null;
    surface()?.setGestureActive(false);
    if (record) {
      void persist(record);
      renderEditor();
      renderer.requestRender();
    }
    return true;
  }

  function beginFreeTransformDrag(event, record, point) {
    const host = getMapHost();
    const sourceQuad = record.cornerPinEnabled
      ? record.mapQuad
      : getCurrentWarpQuad(record) || record.mapQuad;
    if (!sourceQuad) return false;
    const hitRecord = sourceQuad === record.mapQuad
      ? record
      : { ...record, mapQuad: sourceQuad };
    const hit = referenceImageFreeTransformHit(hitRecord, point, host);
    if (!hit) return false;

    freeTransformBefore = copyReferenceImageRecords(records);
    const dragRecord = sourceQuad === record.mapQuad
      ? record
      : { ...record, mapQuad: sourceQuad };
    const drag = createReferenceImageFreeTransformDrag(dragRecord, hit, event.pointerId);
    if (!drag) {
      freeTransformBefore = null;
      return false;
    }
    freeTransformDrag = {
      ...drag,
      activatesCornerPins: !record.cornerPinEnabled,
    };
    surface()?.setGestureActive(true);
    capturePointer(mapElement, event.pointerId);
    return true;
  }

  function updateFreeTransformDrag(point, event) {
    if (!freeTransformDrag || event.pointerId !== freeTransformDrag.pointerId) return false;
    const record = records.find(candidate => candidate.id === freeTransformDrag.recordId);
    if (!record || record.locked) {
      cancelFreeTransformDrag();
      return false;
    }

    const before = freeTransformBefore?.find(candidate => candidate.id === record.id);
    const previouslyEnabled = record.cornerPinEnabled;
    const previousQuad = record.mapQuad.map(coordinate => [...coordinate]);

    if (freeTransformDrag.activatesCornerPins && !record.cornerPinEnabled) {
      record.mapQuad = freeTransformDrag.startMapQuad.map(coordinate => [...coordinate]);
      record.cornerPinEnabled = true;
    }

    const changed = applyReferenceImageFreeTransformDrag(
      record,
      freeTransformDrag,
      point,
      getMapHost(),
    );
    if (!changed) {
      if (!previouslyEnabled && before) {
        record.mapQuad = before.mapQuad.map(coordinate => [...coordinate]);
        record.cornerPinEnabled = before.cornerPinEnabled;
        rebuildWarp(record);
      }
      return false;
    }

    record.cornerPinEnabled = true;
    rebuildWarp(record);
    if ((record.anchor || record.controlPoints.length) && !record.warp.ok) {
      record.mapQuad = previousQuad;
      record.cornerPinEnabled = previouslyEnabled;
      rebuildWarp(record);
      return false;
    }
    renderer.requestRender();
    return true;
  }

  function finishFreeTransformDrag(event) {
    if (!freeTransformDrag || event.pointerId !== freeTransformDrag.pointerId) return false;
    const drag = freeTransformDrag;
    const record = records.find(candidate => candidate.id === drag.recordId);
    releasePointer(mapElement, event.pointerId);
    freeTransformDrag = null;
    surface()?.setGestureActive(false);
    if (record && freeTransformBefore) {
      const before = freeTransformBefore.find(item => item.id === record.id);
      const changed = JSON.stringify(before?.mapQuad) !== JSON.stringify(record.mapQuad)
        || before?.cornerPinEnabled !== record.cornerPinEnabled;
      if (changed) {
        history.push(freeTransformBefore);
        void persist(record);
      }
    }
    freeTransformBefore = null;
    renderEditor();
    renderer.requestRender();
    return true;
  }

  function commitAnchor(point) {
    if (!anchorState) return;
    const record = records.find(candidate => candidate.id === anchorState.recordId);
    if (!record || record.locked || !validToken(anchorState.token)) {
      cancelAnchor();
      return;
    }
    if (anchorState.step === 'image') {
      const uv = renderer.hitTestUv(record, point);
      if (!uv) {
        setHint('이미지가 보이는 영역 안을 선택하세요.', 'error');
        return;
      }
      anchorState.image = [...uv];
      anchorState.step = 'map';
      syncSurface();
      setHint('2/2 · 같은 지점의 실제 지도 위치를 선택하세요.', 'working');
      renderEditor();
      return;
    }

    const coordinate = getMapHost()?.unproject(point);
    if (!coordinate || !coordinate.every(Number.isFinite)) {
      setHint('이 위치에서는 지도 좌표를 계산할 수 없습니다.', 'error');
      return;
    }

    const before = copyReferenceImageRecords(records);
    const previous = before.find(candidate => candidate.id === record.id);
    record.anchor = {
      image: [...anchorState.image],
      coordinate: [coordinate[0], coordinate[1]],
    };
    rebuildWarp(record);

    let accepted = true;
    if (record.warp.ok) {
      accepted = Number(record.warp.diagnostics?.hardMaxMeters) <= 0.01;
    } else if (
      record.warp.reason === 'singular-control-points'
      && record.warp.pointCount >= record.warp.minimumPoints
    ) {
      accepted = false;
    } else {
      accepted = alignReferenceImageAnchor(record);
    }

    if (!accepted) {
      record.anchor = previous?.anchor ? {
        image: [...previous.anchor.image],
        coordinate: [...previous.anchor.coordinate],
      } : null;
      if (previous?.mapQuad) record.mapQuad = previous.mapQuad.map(value => [...value]);
      rebuildWarp(record);
      setHint('이 위치에는 고정점 제약을 적용할 수 없습니다.', 'error');
      renderer.requestRender();
      return;
    }

    history.push(before);
    void persist(record);
    cancelAnchor(false);
    refreshUi();
    setHint(
      record.warp.ok
        ? '고정점을 제약식으로 적용했습니다. 일반 기준점은 오차를 최소화하면서 이 지점은 정확히 유지됩니다.'
        : '고정점을 설정했습니다. 배치 편집에서 크기와 회전 시 이 지점이 유지됩니다.',
      'success',
    );
  }

  function commitGcp(point) {
    if (!gcpState) return;
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
        applyReferenceImageEdit(record, 'replace-image', {
          id: gcpState.pointId,
          value: uv,
        });
      } else {
        gcpState.image = uv;
        gcpState.step = 'map';
        syncSurface();
        setHint('2/2 · 같은 지점의 실제 지도 위치를 선택하세요.', 'working');
        return;
      }
    } else {
      const coordinate = getMapHost()?.unproject(point);
      if (!coordinate || !coordinate.every(Number.isFinite)) {
        setHint('이 위치에서는 지도 좌표를 계산할 수 없습니다.', 'error');
        return;
      }
      if (gcpState.pointId) {
        applyReferenceImageEdit(record, 'replace-coordinate', {
          id: gcpState.pointId,
          value: coordinate,
        });
      } else {
        record.controlPoints.push({
          id: createId('gcp'),
          image: [...gcpState.image],
          coordinate: [coordinate[0], coordinate[1]],
        });
      }
    }

    history.push(before);
    rebuildWarp(record);
    void persist(record);
    if (gcpState.pointId) {
      cancelGcp(false);
    } else {
      gcpState = {
        recordId: record.id,
        step: 'image',
        image: null,
        pointId: '',
        token: currentToken(),
      };
    }
    refreshUi();
    setHint('기준점을 추가했습니다. 계속 추가하거나 Esc로 종료하세요.', 'success');
  }

  function beginGesture(point, event, { spacePan = false } = {}) {
    if (!isActive()) return null;
    if (event.button === 1 || spacePan) return { kind: 'navigate' };
    if (event.button !== 0) return null;

    if (anchorState) {
      const state = anchorState;
      surface()?.setGestureActive(true);
      return {
        kind: 'tap',
        end: next => {
          surface()?.setGestureActive(false);
          if (anchorState === state) commitAnchor(next);
        },
        cancel: () => surface()?.setGestureActive(false),
      };
    }
    if (gcpState) {
      const state = gcpState;
      surface()?.setGestureActive(true);
      return {
        kind: 'tap',
        end: next => {
          surface()?.setGestureActive(false);
          if (gcpState === state) commitGcp(next);
        },
        cancel: () => surface()?.setGestureActive(false),
      };
    }

    const record = selected();
    if (record && controlPointEditingId === record.id && beginControlPointDrag(event, record, point)) {
      return {
        kind: 'exclusive',
        move: updateControlPointDrag,
        end: (_point, up) => finishControlPointDrag(up),
        cancel: cancelControlPointDrag,
      };
    }
    if (record && freeTransformEditingId === record.id && beginFreeTransformDrag(event, record, point)) {
      return {
        kind: 'exclusive',
        move: updateFreeTransformDrag,
        end: (_point, up) => finishFreeTransformDrag(up),
        cancel: cancelFreeTransformDrag,
      };
    }
    if (
      record
      && !record.locked
      && !record.warp?.ok
      && placementEditingId === record.id
      && beginPlacementDrag(event, record, point)
    ) {
      return {
        kind: 'exclusive',
        move: updatePlacementDrag,
        end: (_point, up) => finishPlacementDrag(up),
        cancel: cancelPlacementDrag,
      };
    }
    return { kind: 'navigate' };
  }

  function deleteSelectedControlPoint() {
    if (!controlPointEditingId || !selectedControlPointId) return false;
    const record = selected();
    if (!record || record.locked) return true;

    const before = copyReferenceImageRecords(records);
    const fallbackQuad = getCurrentWarpQuad(record);
    if (!applyReferenceImageEdit(record, 'delete-gcp', { id: selectedControlPointId })) return true;

    history.push(before);
    selectedControlPointId = '';
    rebuildWarp(record);
    if (!record.warp.ok && fallbackQuad) {
      record.mapQuad = fallbackQuad;
      if (record.anchor) alignReferenceImageAnchor(record);
    }
    void persist(record);
    refreshUi();
    return true;
  }

  function handleRecordLocked(record) {
    if (!record?.locked) return;
    cancelAnchor(false);
    cancelGcp(false);
    if (controlPointEditingId === record.id) stopControlPointEditing({ renderUi: false });
    if (placementEditingId === record.id) stopPlacementEditing({ renderUi: false });
    if (freeTransformEditingId === record.id) stopFreeTransformEditing({ renderUi: false });
    syncSurface();
  }

  function handleRecordRemoved(record) {
    if (!record) return;
    if (placementEditingId === record.id) stopPlacementEditing({ renderUi: false });
    if (freeTransformEditingId === record.id) stopFreeTransformEditing({ renderUi: false });
    if (anchorState?.recordId === record.id) cancelAnchor(false);
    if (gcpState?.recordId === record.id) cancelGcp(false);
    if (controlPointEditingId === record.id) stopControlPointEditing({ renderUi: false });
    syncSurface();
  }

  function cancelAll({ renderUi = true } = {}) {
    cancelTools();
    cancelAnchor(false);
    cancelGcp(false);
    stopControlPointEditing({ renderUi: false });
    stopPlacementEditing({ renderUi: false });
    stopFreeTransformEditing({ renderUi: false });
    if (renderUi) renderEditor();
    syncSurface();
  }

  return Object.freeze({
    getState,
    isActive,
    syncSurface,
    cancelAll,
    startPlacementEditing,
    stopPlacementEditing,
    startFreeTransformEditing,
    stopFreeTransformEditing,
    armAnchor,
    cancelAnchor,
    armGcp,
    cancelGcp,
    startControlPointEditing,
    stopControlPointEditing,
    beginGesture,
    deleteSelectedControlPoint,
    handleRecordLocked,
    handleRecordRemoved,
  });
}
