import {
  REFERENCE_IMAGE_TRANSFORM,
  buildReferenceImagePlacementMesh,
  referenceImagePlacementGeometry,
  referenceImagePlacementUvAtPoint,
} from './reference-image-transform.js';

const HOST_ACTIVE_POLL_MS = 34;
const HOST_IDLE_POLL_MS = 240;
const PLACEMENT_MESH_QUALITY = Object.freeze({ columns: 12, rows: 8 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mapHost() {
  return globalThis.__PANDOLAB_MAP_HOST__ || null;
}

function angularDistanceDegrees(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const factor = Math.PI / 180;
  const lonA = a[0] * factor;
  const latA = a[1] * factor;
  const lonB = b[0] * factor;
  const latB = b[1] * factor;
  const dot = Math.sin(latA) * Math.sin(latB) + Math.cos(latA) * Math.cos(latB) * Math.cos(lonA - lonB);
  return Math.acos(clamp(dot, -1, 1)) / factor;
}

function projectVisible(host, coordinate) {
  const projected = host?.project?.(coordinate);
  if (!projected || !projected.every(Number.isFinite)) return null;
  if (host.getProjectionKind?.() !== 'globe') return projected;
  const roundTrip = host.unproject?.(projected);
  return angularDistanceDegrees(coordinate, roundTrip) <= 0.25 ? projected : null;
}

function affineForTriangles(source, destination) {
  const [s0, s1, s2] = source;
  const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const coefficient = values => [
    (values[0] * (s1[1] - s2[1]) + values[1] * (s2[1] - s0[1]) + values[2] * (s0[1] - s1[1])) / denominator,
    (values[0] * (s2[0] - s1[0]) + values[1] * (s0[0] - s2[0]) + values[2] * (s1[0] - s0[0])) / denominator,
    (values[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + values[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + values[2] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator,
  ];
  const x = coefficient(destination.map(point => point[0]));
  const y = coefficient(destination.map(point => point[1]));
  return [x[0], y[0], x[1], y[1], x[2], y[2]];
}

function barycentric(point, triangle) {
  const [p0, p1, p2] = triangle;
  const denominator = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const a = ((p1[1] - p2[1]) * (point[0] - p2[0]) + (p2[0] - p1[0]) * (point[1] - p2[1])) / denominator;
  const b = ((p2[1] - p0[1]) * (point[0] - p2[0]) + (p0[0] - p2[0]) * (point[1] - p2[1])) / denominator;
  const c = 1 - a - b;
  return a >= -0.002 && b >= -0.002 && c >= -0.002 ? [a, b, c] : null;
}

function placementUv(record, pair) {
  return [
    record.flipX ? 1 - pair[0] : pair[0],
    record.flipY ? 1 - pair[1] : pair[1],
  ];
}

export function createReferenceImageCanvasRenderer({
  mapElement,
  getRecords,
  getSelectedId,
  getPlacementEditingId,
  getControlPointEditingId,
  getSelectedControlPointId,
  isPanelHidden,
} = {}) {
  if (!mapElement) throw new TypeError('reference image renderer requires mapElement');
  const canvas = document.createElement('canvas');
  canvas.className = 'reference-image-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const overlay = mapElement.querySelector('.map-overlay-svg');
  if (overlay) mapElement.insertBefore(canvas, overlay);
  else mapElement.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('참조 이미지 Canvas를 만들 수 없습니다.');

  let renderScheduled = false;
  let lastHostFingerprint = '';
  let monitorTimer = 0;
  let disposed = false;

  function resizeCanvas() {
    const rect = mapElement.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    return dpr;
  }

  function projectedMesh(record, host) {
    if (!record.mesh) return null;
    const points = record.mesh.vertices.map(vertex => vertex.coordinate ? projectVisible(host, vertex.coordinate) : null);
    record.projectedMesh = points;
    return points;
  }

  function drawTriangle(record, destination, uv, dpr) {
    const source = uv.map(pair => [
      pair[0] * record.image.naturalWidth,
      pair[1] * record.image.naturalHeight,
    ]);
    const transform = affineForTriangles(source, destination);
    if (!transform) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.beginPath();
    context.moveTo(destination[0][0], destination[0][1]);
    context.lineTo(destination[1][0], destination[1][1]);
    context.lineTo(destination[2][0], destination[2][1]);
    context.closePath();
    context.clip();
    context.transform(...transform);
    context.drawImage(record.image, 0, 0);
    context.restore();
  }

  function drawWarped(record, host, dpr) {
    const projected = projectedMesh(record, host);
    if (!projected) return;
    context.save();
    context.globalAlpha = record.opacity;
    context.globalCompositeOperation = record.blendMode;
    for (const triangle of record.mesh.triangles) {
      const destination = triangle.map(index => projected[index]);
      if (destination.some(point => !point || !point.every(Number.isFinite))) continue;
      const uv = triangle.map(index => record.mesh.vertices[index].uv);
      drawTriangle(record, destination, uv, dpr);
    }
    context.restore();
  }

  function drawPlaced(record, host, dpr) {
    const mesh = buildReferenceImagePlacementMesh(record, PLACEMENT_MESH_QUALITY);
    if (!mesh) return;
    const projected = mesh.vertices.map(vertex => projectVisible(host, vertex.coordinate));
    context.save();
    context.globalAlpha = record.opacity;
    context.globalCompositeOperation = record.blendMode;
    for (const triangle of mesh.triangles) {
      const destination = triangle.map(index => projected[index]);
      if (destination.some(point => !point || !point.every(Number.isFinite))) continue;
      const uv = triangle.map(index => placementUv(record, mesh.vertices[index].uv));
      drawTriangle(record, destination, uv, dpr);
    }
    context.restore();
  }

  function drawPlacementHandles(record, host, dpr) {
    if (record.id !== getPlacementEditingId?.() || record.warp?.ok || isPanelHidden?.()) return;
    const geometry = referenceImagePlacementGeometry(record, host);
    if (!geometry) return;
    const [nw, ne, se, sw] = geometry.corners;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.lineWidth = 1.5;
    context.strokeStyle = 'rgba(79,140,255,.96)';
    context.fillStyle = 'rgba(255,255,255,.96)';
    context.beginPath();
    context.moveTo(nw[0], nw[1]);
    context.lineTo(ne[0], ne[1]);
    context.lineTo(se[0], se[1]);
    context.lineTo(sw[0], sw[1]);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(geometry.handles.n[0], geometry.handles.n[1]);
    context.lineTo(geometry.rotateHandle[0], geometry.rotateHandle[1]);
    context.stroke();
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const point = geometry.handles[handle];
      context.beginPath();
      context.arc(point[0], point[1], REFERENCE_IMAGE_TRANSFORM.handleRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.beginPath();
    context.arc(
      geometry.rotateHandle[0],
      geometry.rotateHandle[1],
      REFERENCE_IMAGE_TRANSFORM.handleRadius,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
    context.restore();
  }

  function drawControlPoints(record, host, dpr) {
    if (record.id !== getSelectedId?.() || isPanelHidden?.()) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.lineWidth = 1.5;
    for (let index = 0; index < record.controlPoints.length; index += 1) {
      const point = record.controlPoints[index];
      const target = projectVisible(host, point.coordinate);
      const predictedCoordinate = record.warp?.ok ? record.warp.project(point.image) : null;
      const predicted = predictedCoordinate ? projectVisible(host, predictedCoordinate) : null;
      if (target && predicted && target.every(Number.isFinite) && predicted.every(Number.isFinite)) {
        context.beginPath();
        context.moveTo(predicted[0], predicted[1]);
        context.lineTo(target[0], target[1]);
        context.strokeStyle = 'rgba(255,255,255,.72)';
        context.stroke();
      }
      if (!target || !target.every(Number.isFinite)) continue;
      context.beginPath();
      context.arc(target[0], target[1], 4.5, 0, Math.PI * 2);
      const editing = record.id === getControlPointEditingId?.();
      const selected = editing && point.id === getSelectedControlPointId?.();
      context.fillStyle = selected ? 'rgba(245,158,11,1)' : 'rgba(79,140,255,.95)';
      context.fill();
      context.lineWidth = selected ? 2.5 : 1.5;
      context.strokeStyle = 'rgba(255,255,255,.95)';
      context.stroke();
      context.fillStyle = 'rgba(255,255,255,.96)';
      context.font = '600 10px sans-serif';
      context.fillText(String(index + 1), target[0] + 7, target[1] - 7);
    }
    context.restore();
  }

  function render() {
    const dpr = resizeCanvas();
    context.clearRect(0, 0, canvas.width, canvas.height);
    const host = mapHost();
    const records = getRecords?.() || [];
    for (const record of records) {
      if (!record.visible || !record.image || !host) continue;
      if (record.warp?.ok) drawWarped(record, host, dpr);
      else drawPlaced(record, host, dpr);
    }
    const selected = records.find(record => record.id === getSelectedId?.()) || null;
    if (host && selected) drawPlacementHandles(selected, host, dpr);
    if (host && selected) drawControlPoints(selected, host, dpr);
  }

  function requestRender() {
    if (renderScheduled || disposed) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (!disposed) render();
    });
  }

  function hitTestUv(record, point) {
    const host = mapHost();
    if (!host) return null;
    if (record?.warp?.ok && record.mesh) projectedMesh(record, host);
    if (!record?.warp?.ok || !record.mesh || !record.projectedMesh) {
      return referenceImagePlacementUvAtPoint(record, point, host);
    }
    for (const triangle of record.mesh.triangles) {
      const destination = triangle.map(index => record.projectedMesh[index]);
      if (destination.some(candidate => !candidate)) continue;
      const weights = barycentric(point, destination);
      if (!weights) continue;
      const uv = triangle.map(index => record.mesh.vertices[index].uv);
      return [
        weights[0] * uv[0][0] + weights[1] * uv[1][0] + weights[2] * uv[2][0],
        weights[0] * uv[0][1] + weights[1] * uv[1][1] + weights[2] * uv[2][1],
      ];
    }
    return null;
  }

  function hitTestControlPoint(record, point, radius = 12) {
    const host = mapHost();
    if (!record || record.id !== getSelectedId?.() || !host) return null;
    const limit = Math.max(1, Number(radius) || 12) ** 2;
    let closest = null;
    for (let index = 0; index < record.controlPoints.length; index += 1) {
      const controlPoint = record.controlPoints[index];
      const screen = projectVisible(host, controlPoint.coordinate);
      if (!screen) continue;
      const dx = point[0] - screen[0];
      const dy = point[1] - screen[1];
      const distance = dx * dx + dy * dy;
      if (distance <= limit && (!closest || distance < closest.distance)) {
        closest = { id: controlPoint.id, index, distance, screen };
      }
    }
    return closest;
  }

  const sharedHitTestUv = (recordId, point) => {
    const record = (getRecords?.() || []).find(candidate => String(candidate.id) === String(recordId));
    return record ? hitTestUv(record, point) : null;
  };
  globalThis.__PANDOLAB_REFERENCE_IMAGE_HIT_TEST_UV__ = sharedHitTestUv;

  const resizeObserver = new ResizeObserver(requestRender);
  resizeObserver.observe(mapElement);

  function monitorHost() {
    if (disposed) return;
    const host = mapHost();
    const records = getRecords?.() || [];
    const hasMapAnchoredVisible = !!host && records.some(record => record.visible && (record.mapQuad || record.warp?.ok));
    if (hasMapAnchoredVisible) {
      const fingerprint = `${host.getProjectionKind?.() || ''}|${JSON.stringify(host.getViewState?.() || null)}`;
      if (fingerprint !== lastHostFingerprint) {
        lastHostFingerprint = fingerprint;
        requestRender();
      }
    }
    monitorTimer = globalThis.setTimeout(monitorHost, hasMapAnchoredVisible ? HOST_ACTIVE_POLL_MS : HOST_IDLE_POLL_MS);
  }
  monitorHost();

  return Object.freeze({
    canvas,
    requestRender,
    hitTestUv,
    hitTestControlPoint,
    destroy() {
      if (disposed) return;
      disposed = true;
      globalThis.clearTimeout(monitorTimer);
      resizeObserver.disconnect();
      if (globalThis.__PANDOLAB_REFERENCE_IMAGE_HIT_TEST_UV__ === sharedHitTestUv) delete globalThis.__PANDOLAB_REFERENCE_IMAGE_HIT_TEST_UV__;
      canvas.remove();
    },
  });
}
