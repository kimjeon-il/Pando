export function createMapInputController({
  element,
  interactiveTarget,
  canNavigate,
  getRevision,
  beginMovement,
  finishMovement,
  panBy,
  scheduleViewRender,
  getZoom,
  setZoom,
  zoomBy,
  canDirectTap,
  directTap,
  canDoubleTap,
  suppressClick,
}) {
  const pointers = new Map();
  let gesture = null;
  let pinch = null;
  let wheelFinishTimer = 0;
  let lastTapAt = 0;
  let lastTapPoint = null;
  let moving = false;

  const distance = (left, right) => Math.max(1, Math.hypot(left.x - right.x, left.y - right.y));

  function capturePointer(pointerId) {
    try { element.setPointerCapture?.(pointerId); }
    catch (_) { /* The pointer may already have ended outside the document. */ }
  }

  function startMovement() {
    if (moving) return;
    moving = true;
    beginMovement();
  }

  function endMovement(point = null) {
    if (!moving) return;
    moving = false;
    finishMovement(point);
  }

  function pointerDown(event) {
    if (event.button > 0 || interactiveTarget(event.target)) return;
    const point = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
    pointers.set(event.pointerId, point);
    if (event.pointerType === 'touch' && pointers.size === 2) {
      for (const pointerId of pointers.keys()) capturePointer(pointerId);
      const pair = [...pointers.values()];
      gesture = null;
      startMovement();
      pinch = { distance: distance(pair[0], pair[1]), zoom: getZoom() };
      event.preventDefault();
      return;
    }
    if (pointers.size !== 1) return;
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      panned: false,
      navigable: canNavigate(),
      revision: getRevision(),
      cancelled: false,
    };
  }

  function pointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
    if (pinch && pointers.size >= 2) {
      const pair = [...pointers.values()].slice(0, 2);
      setZoom(pinch.zoom * Math.pow(distance(pair[0], pair[1]) / pinch.distance, 1.18));
      scheduleViewRender();
      event.preventDefault();
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.cancelled || gesture.revision !== getRevision()) return;
    const threshold = gesture.pointerType === 'touch' ? 8 : 4;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > threshold) {
      gesture.moved = true;
      gesture.panned = gesture.navigable;
      if (gesture.panned) {
        capturePointer(event.pointerId);
        startMovement();
      }
    }
    if (!gesture.panned) return;
    panBy(event.clientX - gesture.lastX, event.clientY - gesture.lastY);
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    scheduleViewRender();
    event.preventDefault();
  }

  function finishPointer(event, cancelled = false) {
    pointers.delete(event.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        gesture = null;
        endMovement(null);
        suppressClick([event.clientX, event.clientY], 500);
      }
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const completed = gesture;
    gesture = null;
    const point = [event.clientX, event.clientY];
    if (cancelled || completed.cancelled || completed.revision !== getRevision()) {
      suppressClick(point, 700);
      endMovement(null);
      return;
    }
    if (completed.panned) {
      endMovement(point);
      return;
    }
    if (completed.pointerType !== 'touch' || completed.moved) return;
    const now = Date.now();
    if (canDoubleTap() && lastTapPoint && now - lastTapAt < 320 && Math.hypot(point[0] - lastTapPoint[0], point[1] - lastTapPoint[1]) < 28) {
      zoomBy(1.55);
      lastTapAt = 0;
      lastTapPoint = null;
      suppressClick(point, 500);
      return;
    }
    lastTapAt = now;
    lastTapPoint = point;
    if (!canDirectTap()) return;
    const rect = element.getBoundingClientRect();
    directTap([point[0] - rect.left, point[1] - rect.top]);
    suppressClick(point, 700);
  }

  function wheel(event) {
    event.preventDefault();
    startMovement();
    setZoom(getZoom() * Math.exp(-event.deltaY * 0.0013));
    scheduleViewRender();
    clearTimeout(wheelFinishTimer);
    wheelFinishTimer = setTimeout(() => endMovement(null), 120);
  }

  const pointerUp = event => finishPointer(event);
  const pointerCancel = event => finishPointer(event, true);

  function cancel() {
    if (gesture) gesture.cancelled = true;
    gesture = null;
    pinch = null;
    pointers.clear();
    clearTimeout(wheelFinishTimer);
    endMovement(null);
  }

  element.addEventListener('pointerdown', pointerDown, { passive: false });
  element.addEventListener('pointermove', pointerMove, { passive: false });
  element.addEventListener('pointerup', pointerUp, { passive: true });
  element.addEventListener('pointercancel', pointerCancel, { passive: true });
  element.addEventListener('wheel', wheel, { passive: false });

  return {
    cancel,
    isPanning: () => !!gesture?.panned || !!pinch,
    destroy() {
      cancel();
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', pointerCancel);
      element.removeEventListener('wheel', wheel);
    },
  };
}
