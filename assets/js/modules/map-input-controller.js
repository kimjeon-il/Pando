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
  transformView,
  zoomBy,
  canDirectTap,
  directTap,
  canDoubleTap,
  suppressClick,
  canDrawStroke = () => false,
  beginStroke = () => false,
  moveStroke = () => {},
  endStroke = () => {},
  cancelStroke = () => {},
}) {
  const pointers = new Map();
  let gesture = null;
  let pinch = null;
  let wheelFinishTimer = 0;
  let lastTapAt = 0;
  let lastTapPoint = null;
  let moving = false;

  const distance = (left, right) => Math.max(1, Math.hypot(left.x - right.x, left.y - right.y));
  const center = (left, right) => ({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
  const localPoint = event => {
    const rect = element.getBoundingClientRect?.() || { left: 0, top: 0 };
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const localClientPoint = point => {
    const rect = element.getBoundingClientRect?.() || { left: 0, top: 0 };
    return [point.x - rect.left, point.y - rect.top];
  };
  const localSamples = event => {
    const events = event.getCoalescedEvents?.() || [event];
    return events.length ? events.map(localPoint) : [localPoint(event)];
  };

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
      if (gesture?.kind === 'draw') cancelStroke(event);
      for (const pointerId of pointers.keys()) capturePointer(pointerId);
      const pair = [...pointers.values()];
      gesture = null;
      startMovement();
      pinch = { distance: distance(pair[0], pair[1]), zoom: getZoom(), center: center(pair[0], pair[1]) };
      event.preventDefault();
      return;
    }
    if (pointers.size !== 1) return;
    const drawing = !!canDrawStroke(event) && beginStroke(localPoint(event), event) !== false;
    if (drawing) capturePointer(event.pointerId);
    gesture = {
      kind: drawing ? 'draw' : 'navigate',
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
    if (drawing) event.preventDefault();
  }

  function pointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
    if (pinch && pointers.size >= 2) {
      const pair = [...pointers.values()].slice(0, 2);
      const nextCenter = center(pair[0], pair[1]);
      const nextZoom = pinch.zoom * Math.pow(distance(pair[0], pair[1]) / pinch.distance, 1.18);
      transformView({
        zoom: nextZoom,
        fromPoint: localClientPoint(pinch.center),
        toPoint: localClientPoint(nextCenter),
        source: 'pinch',
      });
      pinch.center = nextCenter;
      scheduleViewRender();
      event.preventDefault();
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.cancelled || gesture.revision !== getRevision()) return;
    const threshold = gesture.pointerType === 'touch' ? 8 : 4;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > threshold) {
      gesture.moved = true;
      gesture.panned = gesture.kind === 'navigate' && gesture.navigable;
      if (gesture.panned) {
        capturePointer(event.pointerId);
        startMovement();
      }
    }
    if (gesture.kind === 'draw') {
      if (gesture.moved) moveStroke(localSamples(event), event);
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      event.preventDefault();
      return;
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
      if (completed.kind === 'draw') cancelStroke(event);
      suppressClick(point, 700);
      endMovement(null);
      return;
    }
    if (completed.kind === 'draw') {
      if (completed.moved) {
        endStroke(localPoint(event), event);
        suppressClick(point, 700);
      } else {
        cancelStroke(event);
        if (completed.pointerType === 'touch' && canDirectTap()) {
          directTap(localPoint(event));
          suppressClick(point, 700);
        }
      }
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
    const point = localPoint(event);
    transformView({
      zoom: getZoom() * Math.exp(-event.deltaY * 0.0013),
      fromPoint: point,
      toPoint: point,
      source: 'wheel',
    });
    scheduleViewRender();
    clearTimeout(wheelFinishTimer);
    wheelFinishTimer = setTimeout(() => endMovement(null), 120);
  }

  const pointerUp = event => finishPointer(event);
  const pointerCancel = event => finishPointer(event, true);

  function cancel() {
    if (gesture?.kind === 'draw') cancelStroke();
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
    isDrawing: () => gesture?.kind === 'draw',
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
