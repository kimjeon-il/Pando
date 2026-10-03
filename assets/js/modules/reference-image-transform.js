export const REFERENCE_IMAGE_TRANSFORM = Object.freeze({
  handleRadius: 8,
  hitRadius: 12,
  rotateHandleOffset: 30,
  minimumWidth: 48,
  minimumHeight: 36,
});

const radians = value => Number(value) * Math.PI / 180;
const degrees = value => Number(value) * 180 / Math.PI;
const HANDLE_ORDER = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

function finitePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function normalizeCoordinate(value) {
  const pair = finitePair(value);
  if (!pair) return null;
  let lon = pair[0];
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return [lon, Math.max(-90, Math.min(90, pair[1]))];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function multiply(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar];
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function average(points) {
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function length(vector) {
  return Math.hypot(vector[0], vector[1]);
}

function normalizeVector(vector) {
  const magnitude = length(vector);
  return magnitude > 1e-9 ? [vector[0] / magnitude, vector[1] / magnitude] : null;
}

function rotatePoint(point, center, angleDegrees) {
  const angle = radians(angleDegrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const delta = subtract(point, center);
  return [
    center[0] + delta[0] * cos - delta[1] * sin,
    center[1] + delta[0] * sin + delta[1] * cos,
  ];
}

function solveBasis(delta, u, v) {
  const determinant = u[0] * v[1] - u[1] * v[0];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
  return [
    (delta[0] * v[1] - delta[1] * v[0]) / determinant,
    (u[0] * delta[1] - u[1] * delta[0]) / determinant,
  ];
}

function barycentric(point, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
  const w0 = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const w1 = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  const w2 = 1 - w0 - w1;
  return w0 >= -0.002 && w1 >= -0.002 && w2 >= -0.002 ? [w0, w1, w2] : null;
}

function unprojectCorners(host, corners) {
  if (!host?.unproject || !Array.isArray(corners) || corners.length !== 4) return null;
  const quad = [];
  for (const corner of corners) {
    const coordinate = normalizeCoordinate(host.unproject(corner));
    if (!coordinate) return null;
    quad.push(coordinate);
  }
  return quad;
}

function applyScreenCorners(record, corners, host) {
  const quad = unprojectCorners(host, corners);
  if (!record || !quad) return false;
  record.mapQuad = quad;
  return true;
}

export function normalizeReferenceImageRotation(value) {
  let angle = Number(value);
  if (!Number.isFinite(angle)) angle = 0;
  angle %= 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
}

export function normalizeReferenceImageScreenRect(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x,
    y,
    width: Math.max(REFERENCE_IMAGE_TRANSFORM.minimumWidth, width),
    height: Math.max(REFERENCE_IMAGE_TRANSFORM.minimumHeight, height),
  };
}

export function defaultReferenceImageScreenRect(image, mapElement) {
  const bounds = mapElement.getBoundingClientRect();
  const maxWidth = Math.max(180, bounds.width * 0.62);
  const maxHeight = Math.max(140, bounds.height * 0.62);
  const naturalWidth = Math.max(1, Number(image?.naturalWidth) || 1);
  const naturalHeight = Math.max(1, Number(image?.naturalHeight) || 1);
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
  const width = Math.max(80, naturalWidth * scale);
  const height = Math.max(60, naturalHeight * scale);
  return {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  };
}

export function referenceImageScreenRectToMapQuad(screenRect, rotation, host) {
  const rect = normalizeReferenceImageScreenRect(screenRect);
  if (!rect || !host?.unproject) return null;
  const center = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ].map(point => rotatePoint(point, center, normalizeReferenceImageRotation(rotation)));
  return unprojectCorners(host, corners);
}

export function defaultReferenceImageMapQuad(image, mapElement, host) {
  return referenceImageScreenRectToMapQuad(defaultReferenceImageScreenRect(image, mapElement), 0, host);
}

export function projectReferenceImageMapQuad(record, host) {
  if (!record?.mapQuad || record.mapQuad.length !== 4 || !host?.project) return null;
  const corners = record.mapQuad.map(coordinate => finitePair(host.project(coordinate)));
  return corners.every(Boolean) ? corners : null;
}

export function referenceImagePlacementGeometry(record, host) {
  const corners = projectReferenceImageMapQuad(record, host);
  if (!corners) return null;
  const [nw, ne, se, sw] = corners;
  const center = average(corners);
  const topMid = midpoint(nw, ne);
  const rightMid = midpoint(ne, se);
  const bottomMid = midpoint(sw, se);
  const leftMid = midpoint(nw, sw);
  const topVector = subtract(ne, nw);
  const bottomVector = subtract(se, sw);
  const leftVector = subtract(sw, nw);
  const rightVector = subtract(se, ne);
  const widthVector = multiply(add(topVector, bottomVector), 0.5);
  const heightVector = multiply(add(leftVector, rightVector), 0.5);
  const u = normalizeVector(widthVector);
  const v = normalizeVector(heightVector);
  const topUnit = normalizeVector(topVector);
  if (!u || !v || !topUnit) return null;
  const outward = [topUnit[1], -topUnit[0]];
  const rotateHandle = add(topMid, multiply(outward, REFERENCE_IMAGE_TRANSFORM.rotateHandleOffset));
  const handles = Object.freeze({
    nw,
    n: topMid,
    ne,
    e: rightMid,
    se,
    s: bottomMid,
    sw,
    w: leftMid,
  });
  return Object.freeze({
    corners,
    center,
    handles,
    rotateHandle,
    width: Math.max(1e-9, length(widthVector)),
    height: Math.max(1e-9, length(heightVector)),
    u,
    v,
    rotation: normalizeReferenceImageRotation(degrees(Math.atan2(topVector[1], topVector[0]))),
  });
}

export function referenceImagePlacementRotation(record, host) {
  return referenceImagePlacementGeometry(record, host)?.rotation ?? 0;
}

export function referenceImagePlacementHit(record, point, host) {
  const candidate = finitePair(point);
  const geometry = referenceImagePlacementGeometry(record, host);
  if (!candidate || !geometry) return null;
  const radius = REFERENCE_IMAGE_TRANSFORM.hitRadius;
  if (Math.hypot(candidate[0] - geometry.rotateHandle[0], candidate[1] - geometry.rotateHandle[1]) <= radius) {
    return Object.freeze({ type: 'rotate' });
  }
  for (const handle of HANDLE_ORDER) {
    const location = geometry.handles[handle];
    if (Math.hypot(candidate[0] - location[0], candidate[1] - location[1]) <= radius) {
      return Object.freeze({ type: 'resize', handle });
    }
  }
  if (
    barycentric(candidate, [geometry.corners[0], geometry.corners[1], geometry.corners[2]])
    || barycentric(candidate, [geometry.corners[0], geometry.corners[2], geometry.corners[3]])
  ) {
    return Object.freeze({ type: 'move' });
  }
  return null;
}

export function createReferenceImagePlacementDrag(record, hit, point, host, pointerId = null) {
  const startPoint = finitePair(point);
  const geometry = referenceImagePlacementGeometry(record, host);
  if (!geometry || !hit || !startPoint) return null;
  return {
    pointerId,
    recordId: record.id,
    hit,
    startPoint,
    startCorners: geometry.corners.map(corner => [...corner]),
    startMapQuad: record.mapQuad.map(coordinate => [...coordinate]),
    center: [...geometry.center],
    startRotation: geometry.rotation,
    startAngle: degrees(Math.atan2(startPoint[1] - geometry.center[1], startPoint[0] - geometry.center[0])),
    width: geometry.width,
    height: geometry.height,
    aspect: geometry.width / Math.max(1e-9, geometry.height),
    u: [...geometry.u],
    v: [...geometry.v],
  };
}

function resizedCornerLayout(handle, fixed, dirU, dirV, width, height) {
  const alongU = multiply(dirU, width);
  const alongV = multiply(dirV, height);
  if (handle === 'se') return [fixed, add(fixed, alongU), add(add(fixed, alongU), alongV), add(fixed, alongV)];
  if (handle === 'nw') return [add(add(fixed, alongU), alongV), add(fixed, alongV), fixed, add(fixed, alongU)];
  if (handle === 'ne') return [add(fixed, alongV), add(add(fixed, alongU), alongV), add(fixed, alongU), fixed];
  if (handle === 'sw') return [add(fixed, alongU), fixed, add(fixed, alongV), add(add(fixed, alongU), alongV)];
  return null;
}

function resizeCorner(drag, point, shiftKey) {
  const definitions = {
    se: { fixed: drag.startCorners[0], dirU: drag.u, dirV: drag.v },
    nw: { fixed: drag.startCorners[2], dirU: multiply(drag.u, -1), dirV: multiply(drag.v, -1) },
    ne: { fixed: drag.startCorners[3], dirU: drag.u, dirV: multiply(drag.v, -1) },
    sw: { fixed: drag.startCorners[1], dirU: multiply(drag.u, -1), dirV: drag.v },
  };
  const definition = definitions[drag.hit.handle];
  if (!definition) return null;
  const components = solveBasis(subtract(point, definition.fixed), definition.dirU, definition.dirV);
  if (!components) return null;
  let width = Math.max(REFERENCE_IMAGE_TRANSFORM.minimumWidth, components[0]);
  let height = Math.max(REFERENCE_IMAGE_TRANSFORM.minimumHeight, components[1]);
  if (shiftKey) {
    const widthFromHeight = height * drag.aspect;
    const heightFromWidth = width / drag.aspect;
    if (widthFromHeight > width) width = widthFromHeight;
    else height = heightFromWidth;
  }
  return resizedCornerLayout(drag.hit.handle, definition.fixed, definition.dirU, definition.dirV, width, height);
}

function resizeEdge(drag, point) {
  const [nw, ne, se, sw] = drag.startCorners;
  if (drag.hit.handle === 'e') {
    const fixed = midpoint(nw, sw);
    const components = solveBasis(subtract(point, fixed), drag.u, drag.v);
    if (!components) return null;
    const widthVector = multiply(drag.u, Math.max(REFERENCE_IMAGE_TRANSFORM.minimumWidth, components[0]));
    return [nw, add(nw, widthVector), add(sw, widthVector), sw];
  }
  if (drag.hit.handle === 'w') {
    const fixed = midpoint(ne, se);
    const components = solveBasis(subtract(point, fixed), multiply(drag.u, -1), drag.v);
    if (!components) return null;
    const widthVector = multiply(drag.u, Math.max(REFERENCE_IMAGE_TRANSFORM.minimumWidth, components[0]));
    return [subtract(ne, widthVector), ne, se, subtract(se, widthVector)];
  }
  if (drag.hit.handle === 's') {
    const fixed = midpoint(nw, ne);
    const components = solveBasis(subtract(point, fixed), drag.u, drag.v);
    if (!components) return null;
    const heightVector = multiply(drag.v, Math.max(REFERENCE_IMAGE_TRANSFORM.minimumHeight, components[1]));
    return [nw, ne, add(ne, heightVector), add(nw, heightVector)];
  }
  if (drag.hit.handle === 'n') {
    const fixed = midpoint(sw, se);
    const components = solveBasis(subtract(point, fixed), drag.u, multiply(drag.v, -1));
    if (!components) return null;
    const heightVector = multiply(drag.v, Math.max(REFERENCE_IMAGE_TRANSFORM.minimumHeight, components[1]));
    return [subtract(sw, heightVector), subtract(se, heightVector), se, sw];
  }
  return null;
}

export function applyReferenceImagePlacementDrag(record, drag, point, host, { shiftKey = false } = {}) {
  const candidate = finitePair(point);
  if (!record || !drag || !candidate || !host) return false;
  if (drag.hit.type === 'move') {
    const delta = subtract(candidate, drag.startPoint);
    return applyScreenCorners(record, drag.startCorners.map(corner => add(corner, delta)), host);
  }
  if (drag.hit.type === 'rotate') {
    const angle = degrees(Math.atan2(candidate[1] - drag.center[1], candidate[0] - drag.center[0]));
    let target = normalizeReferenceImageRotation(drag.startRotation + (angle - drag.startAngle));
    if (shiftKey) target = normalizeReferenceImageRotation(Math.round(target / 15) * 15);
    const delta = normalizeReferenceImageRotation(target - drag.startRotation);
    return applyScreenCorners(record, drag.startCorners.map(corner => rotatePoint(corner, drag.center, delta)), host);
  }
  if (drag.hit.type !== 'resize') return false;
  const corners = ['nw', 'ne', 'se', 'sw'].includes(drag.hit.handle)
    ? resizeCorner(drag, candidate, shiftKey)
    : resizeEdge(drag, candidate);
  return corners ? applyScreenCorners(record, corners, host) : false;
}

export function setReferenceImagePlacementRotation(record, host, value) {
  const geometry = referenceImagePlacementGeometry(record, host);
  if (!geometry) return false;
  const target = normalizeReferenceImageRotation(value);
  const delta = normalizeReferenceImageRotation(target - geometry.rotation);
  return applyScreenCorners(record, geometry.corners.map(corner => rotatePoint(corner, geometry.center, delta)), host);
}

export function referenceImagePlacementUvAtPoint(record, point, host) {
  const candidate = finitePair(point);
  const corners = projectReferenceImageMapQuad(record, host);
  if (!candidate || !corners) return null;
  const triangles = [
    { indices: [0, 1, 2], uv: [[0, 0], [1, 0], [1, 1]] },
    { indices: [0, 2, 3], uv: [[0, 0], [1, 1], [0, 1]] },
  ];
  for (const triangle of triangles) {
    const weights = barycentric(candidate, triangle.indices.map(index => corners[index]));
    if (!weights) continue;
    let u = weights[0] * triangle.uv[0][0] + weights[1] * triangle.uv[1][0] + weights[2] * triangle.uv[2][0];
    let v = weights[0] * triangle.uv[0][1] + weights[1] * triangle.uv[1][1] + weights[2] * triangle.uv[2][1];
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));
    if (record.flipX) u = 1 - u;
    if (record.flipY) v = 1 - v;
    return [u, v];
  }
  return null;
}
