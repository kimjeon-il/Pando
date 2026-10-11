export const REFERENCE_IMAGE_GEOREF_SCHEMA_VERSION = 2;

export const REFERENCE_IMAGE_WARP_MODES = Object.freeze({
  AUTO: 'auto',
  SIMILARITY: 'similarity',
  AFFINE: 'affine',
  PROJECTIVE: 'projective',
  TPS: 'tps',
});

const MODE_MIN_POINTS = Object.freeze({
  [REFERENCE_IMAGE_WARP_MODES.SIMILARITY]: 2,
  [REFERENCE_IMAGE_WARP_MODES.AFFINE]: 3,
  [REFERENCE_IMAGE_WARP_MODES.PROJECTIVE]: 4,
  [REFERENCE_IMAGE_WARP_MODES.TPS]: 3,
});

const EPSILON = 1e-10;
const EARTH_RADIUS_METERS = 6371008.8;

const finiteNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function finitePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  return x === null || y === null ? null : [x, y];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapLongitude(value) {
  if (!Number.isFinite(value)) return value;
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function unwrapLongitude(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return value;
  let result = value;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

export function normalizeReferenceControlPoints(values = []) {
  const result = [];
  const ids = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const image = finitePair(value?.image || value?.uv || value?.source);
    const coordinate = finitePair(value?.coordinate || value?.geo || value?.target);
    if (!image || !coordinate) continue;
    const id = String(value?.id || `gcp-${index + 1}`).trim() || `gcp-${index + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    result.push(Object.freeze({
      id,
      image: Object.freeze([image[0], image[1]]),
      coordinate: Object.freeze([wrapLongitude(coordinate[0]), clamp(coordinate[1], -90, 90)]),
      pinned: value?.pinned === true,
    }));
  }
  return Object.freeze(result);
}

function unwrappedControlPoints(points) {
  if (!points.length) return points;
  const reference = points[0].coordinate[0];
  return points.map(point => ({
    ...point,
    coordinate: [unwrapLongitude(point.coordinate[0], reference), point.coordinate[1]],
  }));
}

function solveLinearSystem(matrix, values) {
  const size = matrix.length;
  if (!size || values.length !== size || matrix.some(row => row.length !== size)) return null;
  const augmented = matrix.map((row, index) => [...row.map(Number), Number(values[index])]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    let pivotValue = Math.abs(augmented[pivot][column]);
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(augmented[row][column]);
      if (candidate > pivotValue) {
        pivot = row;
        pivotValue = candidate;
      }
    }
    if (!Number.isFinite(pivotValue) || pivotValue < EPSILON) return null;
    if (pivot !== column) [augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]];
    const divisor = augmented[column][column];
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < EPSILON) continue;
      for (let cell = column; cell <= size; cell += 1) {
        augmented[row][cell] -= factor * augmented[column][cell];
      }
    }
  }
  const solution = augmented.map(row => row[size]);
  return solution.every(Number.isFinite) ? solution : null;
}

function solveLeastSquares(rows, values, regularization = 0) {
  if (!rows.length || rows.length !== values.length) return null;
  const width = rows[0]?.length || 0;
  if (!width || rows.some(row => row.length !== width)) return null;
  const normal = Array.from({ length: width }, () => Array(width).fill(0));
  const target = Array(width).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const value = Number(values[rowIndex]);
    for (let i = 0; i < width; i += 1) {
      target[i] += row[i] * value;
      for (let j = 0; j < width; j += 1) normal[i][j] += row[i] * row[j];
    }
  }
  for (let index = 0; index < width; index += 1) normal[index][index] += regularization;
  return solveLinearSystem(normal, target);
}

function solveConstrainedLeastSquares(
  rows,
  values,
  constraintRows = [],
  constraintValues = [],
  regularization = 0,
) {
  if (rows.length !== values.length || constraintRows.length !== constraintValues.length) return null;
  const width = rows[0]?.length || constraintRows[0]?.length || 0;
  if (!width) return null;
  if (rows.some(row => row.length !== width) || constraintRows.some(row => row.length !== width)) return null;
  if (!constraintRows.length) return solveLeastSquares(rows, values, regularization);

  const normal = Array.from({ length: width }, () => Array(width).fill(0));
  const target = Array(width).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const value = Number(values[rowIndex]);
    if (!Number.isFinite(value)) return null;
    for (let i = 0; i < width; i += 1) {
      target[i] += row[i] * value;
      for (let j = 0; j < width; j += 1) normal[i][j] += row[i] * row[j];
    }
  }
  for (let index = 0; index < width; index += 1) normal[index][index] += regularization;

  const constraintCount = constraintRows.length;
  const size = width + constraintCount;
  const system = Array.from({ length: size }, () => Array(size).fill(0));
  const rhs = Array(size).fill(0);

  for (let row = 0; row < width; row += 1) {
    rhs[row] = target[row];
    for (let column = 0; column < width; column += 1) system[row][column] = normal[row][column];
  }
  for (let constraint = 0; constraint < constraintCount; constraint += 1) {
    const constraintRow = constraintRows[constraint];
    const value = Number(constraintValues[constraint]);
    if (!Number.isFinite(value)) return null;
    rhs[width + constraint] = value;
    for (let column = 0; column < width; column += 1) {
      system[column][width + constraint] = constraintRow[column];
      system[width + constraint][column] = constraintRow[column];
    }
  }

  const solution = solveLinearSystem(system, rhs);
  return solution ? solution.slice(0, width) : null;
}

function fitSimilarity(points) {
  const rows = [];
  const values = [];
  const constraintRows = [];
  const constraintValues = [];
  for (const point of points) {
    const [u, v] = point.image;
    const [lon, lat] = point.coordinate;
    const targetRows = point.pinned ? constraintRows : rows;
    const targetValues = point.pinned ? constraintValues : values;
    targetRows.push([u, -v, 1, 0]);
    targetValues.push(lon);
    targetRows.push([v, u, 0, 1]);
    targetValues.push(lat);
  }
  const coefficients = solveConstrainedLeastSquares(rows, values, constraintRows, constraintValues);
  if (!coefficients) return null;
  const [a, b, tx, ty] = coefficients;
  return ([u, v]) => [a * u - b * v + tx, b * u + a * v + ty];
}

function fitAffine(points) {
  const rows = [];
  const lonValues = [];
  const latValues = [];
  const constraintRows = [];
  const constraintLonValues = [];
  const constraintLatValues = [];
  for (const point of points) {
    const row = [point.image[0], point.image[1], 1];
    if (point.pinned) {
      constraintRows.push(row);
      constraintLonValues.push(point.coordinate[0]);
      constraintLatValues.push(point.coordinate[1]);
    } else {
      rows.push(row);
      lonValues.push(point.coordinate[0]);
      latValues.push(point.coordinate[1]);
    }
  }
  const lonCoefficients = solveConstrainedLeastSquares(
    rows,
    lonValues,
    constraintRows,
    constraintLonValues,
  );
  const latCoefficients = solveConstrainedLeastSquares(
    rows,
    latValues,
    constraintRows,
    constraintLatValues,
  );
  if (!lonCoefficients || !latCoefficients) return null;
  return ([u, v]) => [
    lonCoefficients[0] * u + lonCoefficients[1] * v + lonCoefficients[2],
    latCoefficients[0] * u + latCoefficients[1] * v + latCoefficients[2],
  ];
}

function fitProjective(points) {
  const rows = [];
  const values = [];
  const constraintRows = [];
  const constraintValues = [];
  for (const point of points) {
    const [u, v] = point.image;
    const [lon, lat] = point.coordinate;
    const targetRows = point.pinned ? constraintRows : rows;
    const targetValues = point.pinned ? constraintValues : values;
    targetRows.push([u, v, 1, 0, 0, 0, -lon * u, -lon * v]);
    targetValues.push(lon);
    targetRows.push([0, 0, 0, u, v, 1, -lat * u, -lat * v]);
    targetValues.push(lat);
  }
  const h = solveConstrainedLeastSquares(rows, values, constraintRows, constraintValues, 1e-14);
  if (!h) return null;
  return ([u, v]) => {
    const denominator = h[6] * u + h[7] * v + 1;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return null;
    return [
      (h[0] * u + h[1] * v + h[2]) / denominator,
      (h[3] * u + h[4] * v + h[5]) / denominator,
    ];
  };
}

function tpsKernel(distanceSquared) {
  if (!Number.isFinite(distanceSquared) || distanceSquared <= EPSILON) return 0;
  return distanceSquared * Math.log(distanceSquared);
}

function fitThinPlateSpline(points) {
  const count = points.length;
  const width = count + 3;
  const basisRow = image => {
    const [u, v] = image;
    const row = [];
    for (const point of points) {
      const du = u - point.image[0];
      const dv = v - point.image[1];
      row.push(tpsKernel(du * du + dv * dv));
    }
    row.push(1, u, v);
    return row;
  };

  const rows = [];
  const lonValues = [];
  const latValues = [];
  const constraintRows = [];
  const constraintLonValues = [];
  const constraintLatValues = [];

  for (const point of points) {
    const row = basisRow(point.image);
    if (point.pinned) {
      constraintRows.push(row);
      constraintLonValues.push(point.coordinate[0]);
      constraintLatValues.push(point.coordinate[1]);
    } else {
      rows.push(row);
      lonValues.push(point.coordinate[0]);
      latValues.push(point.coordinate[1]);
    }
  }

  const sideConditions = [
    [...Array(count).fill(1), 0, 0, 0],
    [...points.map(point => point.image[0]), 0, 0, 0],
    [...points.map(point => point.image[1]), 0, 0, 0],
  ];
  for (const row of sideConditions) {
    constraintRows.push(row);
    constraintLonValues.push(0);
    constraintLatValues.push(0);
  }

  const regularization = points.some(point => point.pinned) ? 1e-8 : 1e-12;
  const lonCoefficients = solveConstrainedLeastSquares(
    rows,
    lonValues,
    constraintRows,
    constraintLonValues,
    regularization,
  );
  const latCoefficients = solveConstrainedLeastSquares(
    rows,
    latValues,
    constraintRows,
    constraintLatValues,
    regularization,
  );
  if (!lonCoefficients || !latCoefficients || lonCoefficients.length !== width || latCoefficients.length !== width) return null;

  return image => {
    const basis = basisRow(image);
    let lon = 0;
    let lat = 0;
    for (let index = 0; index < width; index += 1) {
      lon += lonCoefficients[index] * basis[index];
      lat += latCoefficients[index] * basis[index];
    }
    return [lon, lat];
  };
}

function haversineMeters(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const toRadians = Math.PI / 180;
  const lat1 = a[1] * toRadians;
  const lat2 = b[1] * toRadians;
  const deltaLat = (b[1] - a[1]) * toRadians;
  const deltaLon = (unwrapLongitude(b[0], a[0]) - a[0]) * toRadians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function imageCoverage(points) {
  if (!points.length) return 0;
  const xs = points.map(point => point.image[0]);
  const ys = points.map(point => point.image[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.max(0, width * height);
}

function resolveMode(mode, pointCount) {
  const normalized = Object.values(REFERENCE_IMAGE_WARP_MODES).includes(mode)
    ? mode
    : REFERENCE_IMAGE_WARP_MODES.AUTO;
  if (normalized !== REFERENCE_IMAGE_WARP_MODES.AUTO) return normalized;
  if (pointCount >= 6) return REFERENCE_IMAGE_WARP_MODES.TPS;
  if (pointCount >= 4) return REFERENCE_IMAGE_WARP_MODES.PROJECTIVE;
  if (pointCount >= 3) return REFERENCE_IMAGE_WARP_MODES.AFFINE;
  return REFERENCE_IMAGE_WARP_MODES.SIMILARITY;
}

function diagnosticsFor(points, project, mode) {
  const residuals = points.map(point => {
    const projected = project(point.image);
    return Object.freeze({
      id: point.id,
      pinned: point.pinned === true,
      meters: haversineMeters(point.coordinate, projected),
    });
  });
  const softResiduals = residuals.filter(item => !item.pinned && Number.isFinite(item.meters));
  const hardResiduals = residuals.filter(item => item.pinned && Number.isFinite(item.meters));
  const rmsSource = softResiduals.length ? softResiduals : hardResiduals;
  const rmsMeters = rmsSource.length
    ? Math.sqrt(rmsSource.reduce((sum, item) => sum + item.meters * item.meters, 0) / rmsSource.length)
    : Number.POSITIVE_INFINITY;
  const maxMeters = softResiduals.length
    ? Math.max(...softResiduals.map(item => item.meters))
    : hardResiduals.length
      ? Math.max(...hardResiduals.map(item => item.meters))
      : Number.POSITIVE_INFINITY;
  const hardMaxMeters = hardResiduals.length ? Math.max(...hardResiduals.map(item => item.meters)) : 0;
  const coverage = imageCoverage(points);
  const warnings = [];
  if (coverage < 0.08) warnings.push('control-points-concentrated');
  if (mode === REFERENCE_IMAGE_WARP_MODES.TPS && points.length < 5) warnings.push('tps-underconstrained');
  if (Number.isFinite(rmsMeters) && rmsMeters > 50000) warnings.push('high-residual');
  if (hardMaxMeters > 0.01) warnings.push('hard-constraint-residual');
  return Object.freeze({
    rmsMeters,
    maxMeters,
    hardMaxMeters,
    hardPointCount: hardResiduals.length,
    softPointCount: softResiduals.length,
    imageCoverage: coverage,
    residuals: Object.freeze(residuals),
    warnings: Object.freeze(warnings),
  });
}

export function buildReferenceImageWarp(values = [], { mode = REFERENCE_IMAGE_WARP_MODES.AUTO } = {}) {
  const normalizedPoints = normalizeReferenceControlPoints(values);
  const resolvedMode = resolveMode(mode, normalizedPoints.length);
  const minimum = MODE_MIN_POINTS[resolvedMode] || 2;
  if (normalizedPoints.length < minimum) {
    return Object.freeze({
      ok: false,
      mode: resolvedMode,
      minimumPoints: minimum,
      pointCount: normalizedPoints.length,
      reason: 'insufficient-control-points',
    });
  }
  const points = unwrappedControlPoints(normalizedPoints);
  const fitter = {
    [REFERENCE_IMAGE_WARP_MODES.SIMILARITY]: fitSimilarity,
    [REFERENCE_IMAGE_WARP_MODES.AFFINE]: fitAffine,
    [REFERENCE_IMAGE_WARP_MODES.PROJECTIVE]: fitProjective,
    [REFERENCE_IMAGE_WARP_MODES.TPS]: fitThinPlateSpline,
  }[resolvedMode];
  const rawProject = fitter?.(points);
  if (!rawProject) {
    return Object.freeze({
      ok: false,
      mode: resolvedMode,
      minimumPoints: minimum,
      pointCount: normalizedPoints.length,
      reason: 'singular-control-points',
    });
  }
  const project = imagePoint => {
    const pair = finitePair(imagePoint);
    if (!pair) return null;
    const coordinate = rawProject(pair);
    if (!coordinate || !coordinate.every(Number.isFinite)) return null;
    return Object.freeze([wrapLongitude(coordinate[0]), clamp(coordinate[1], -90, 90)]);
  };
  const diagnostics = diagnosticsFor(normalizedPoints, project, resolvedMode);
  return Object.freeze({
    ok: true,
    schemaVersion: REFERENCE_IMAGE_GEOREF_SCHEMA_VERSION,
    mode: resolvedMode,
    minimumPoints: minimum,
    pointCount: normalizedPoints.length,
    controlPoints: normalizedPoints,
    diagnostics,
    project,
  });
}


const AUTO_GEOREF_RANSAC_MODES = new Set([
  REFERENCE_IMAGE_WARP_MODES.SIMILARITY,
  REFERENCE_IMAGE_WARP_MODES.AFFINE,
  REFERENCE_IMAGE_WARP_MODES.PROJECTIVE,
]);

function resolveAutoGeorefMode(mode, pointCount) {
  if (AUTO_GEOREF_RANSAC_MODES.has(mode)) return mode;
  if (mode === REFERENCE_IMAGE_WARP_MODES.TPS) return null;
  if (pointCount >= 4) return REFERENCE_IMAGE_WARP_MODES.PROJECTIVE;
  if (pointCount >= 3) return REFERENCE_IMAGE_WARP_MODES.AFFINE;
  return REFERENCE_IMAGE_WARP_MODES.SIMILARITY;
}

function normalizeAutoGeorefCandidates(values = []) {
  if (!Array.isArray(values)) return Object.freeze([]);
  const ids = new Set();
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const id = String(value?.id || \`auto-gcp-\${index + 1}\`).trim() || \`auto-gcp-\${index + 1}\`;
    if (ids.has(id) || id === 'anchor') continue;
    const normalized = normalizeReferenceControlPoints([{ ...value, id, pinned: false }])[0];
    if (!normalized) continue;
    ids.add(id);
    const rawConfidence = finiteNumber(value?.confidence);
    result.push(Object.freeze({
      id,
      image: normalized.image,
      coordinate: normalized.coordinate,
      pinned: false,
      confidence: clamp(rawConfidence === null ? 1 : rawConfidence, 0, 1),
      origin: value?.origin == null ? null : String(value.origin),
    }));
  }
  return Object.freeze(result);
}

function normalizeAutoGeorefAnchor(anchor) {
  if (!anchor) return null;
  const normalized = normalizeReferenceControlPoints([{
    id: 'anchor',
    image: anchor.image,
    coordinate: anchor.coordinate,
    pinned: true,
  }])[0];
  return normalized || null;
}

function createDeterministicRandom(seed = 0x6d2b79f5) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function sampleAutoGeorefCandidates(values, count, random) {
  if (count <= 0) return [];
  if (count >= values.length) return [...values];
  const indices = values.map((_, index) => index);
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(random() * (indices.length - index));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices.slice(0, count).sort((a, b) => a - b).map(index => values[index]);
}

function autoGeorefResidualMeters(warp, candidate) {
  if (!warp?.ok || typeof warp.project !== 'function') return Number.POSITIVE_INFINITY;
  return haversineMeters(candidate.coordinate, warp.project(candidate.image));
}

function autoGeorefHypothesisScore(warp, candidates, thresholdMeters) {
  const inliers = [];
  let squaredMeters = 0;
  let confidence = 0;
  for (const candidate of candidates) {
    const meters = autoGeorefResidualMeters(warp, candidate);
    if (!Number.isFinite(meters) || meters > thresholdMeters) continue;
    inliers.push(candidate);
    squaredMeters += meters * meters;
    confidence += candidate.confidence;
  }
  const rmsMeters = inliers.length
    ? Math.sqrt(squaredMeters / inliers.length)
    : Number.POSITIVE_INFINITY;
  return {
    inliers,
    confidence,
    rmsMeters,
    coverage: imageCoverage(inliers),
  };
}

function betterAutoGeorefScore(candidate, current) {
  if (!current) return true;
  if (candidate.inliers.length !== current.inliers.length) {
    return candidate.inliers.length > current.inliers.length;
  }
  if (Math.abs(candidate.confidence - current.confidence) > 1e-12) {
    return candidate.confidence > current.confidence;
  }
  if (Math.abs(candidate.rmsMeters - current.rmsMeters) > 1e-9) {
    return candidate.rmsMeters < current.rmsMeters;
  }
  return candidate.coverage > current.coverage;
}

/**
 * Robustly fits a coarse automatic georeferencing transform from candidate
 * image/GIS matches. This deliberately limits RANSAC hypotheses to global
 * similarity/affine/projective transforms; TPS is reserved for a later
 * refinement stage after outliers have been removed.
 */
export function buildReferenceImageAutoGeoref(values = [], {
  anchor = null,
  mode = REFERENCE_IMAGE_WARP_MODES.AUTO,
  inlierThresholdMeters = 25000,
  maxTrials = 256,
  minimumInliers = null,
  seed = 0x6d2b79f5,
} = {}) {
  const candidates = normalizeAutoGeorefCandidates(values);
  const hardAnchor = anchor ? normalizeAutoGeorefAnchor(anchor) : null;
  if (anchor && !hardAnchor) {
    return Object.freeze({
      ok: false,
      reason: 'invalid-anchor',
      candidateCount: candidates.length,
    });
  }

  const hardPoints = hardAnchor ? [hardAnchor] : [];
  const totalPointCount = candidates.length + hardPoints.length;
  const resolvedMode = resolveAutoGeorefMode(mode, totalPointCount);
  if (!resolvedMode) {
    return Object.freeze({
      ok: false,
      reason: 'unsupported-auto-georef-mode',
      mode,
      candidateCount: candidates.length,
    });
  }

  const minimumPoints = MODE_MIN_POINTS[resolvedMode] || 2;
  const requiredSoftSample = Math.max(0, minimumPoints - hardPoints.length);
  if (candidates.length < requiredSoftSample || totalPointCount < minimumPoints) {
    return Object.freeze({
      ok: false,
      reason: 'insufficient-auto-georef-candidates',
      mode: resolvedMode,
      minimumPoints,
      candidateCount: candidates.length,
      hardPointCount: hardPoints.length,
    });
  }

  const thresholdMeters = Math.max(1, finiteNumber(inlierThresholdMeters) ?? 25000);
  const trialLimit = Math.max(1, Math.min(4096, Math.round(finiteNumber(maxTrials) ?? 256)));
  const requestedMinimum = Math.round(finiteNumber(minimumInliers) ?? minimumPoints);
  const requiredInliers = Math.max(minimumPoints, requestedMinimum);
  const random = createDeterministicRandom(seed);
  const seenSamples = new Set();
  let trials = 0;
  let attempts = 0;
  let best = null;

  while (trials < trialLimit && attempts < trialLimit * 12) {
    attempts += 1;
    const sample = sampleAutoGeorefCandidates(candidates, requiredSoftSample, random);
    const sampleKey = sample.map(item => item.id).join('\u0000');
    if (seenSamples.has(sampleKey)) {
      if (requiredSoftSample >= candidates.length) break;
      continue;
    }
    seenSamples.add(sampleKey);
    trials += 1;
    const hypothesis = buildReferenceImageWarp([...hardPoints, ...sample], { mode: resolvedMode });
    if (!hypothesis.ok) continue;
    const score = autoGeorefHypothesisScore(hypothesis, candidates, thresholdMeters);
    if (score.inliers.length + hardPoints.length < requiredInliers) continue;
    if (betterAutoGeorefScore(score, best?.score)) best = { score, hypothesis };
    if (score.inliers.length === candidates.length) break;
  }

  if (!best) {
    return Object.freeze({
      ok: false,
      reason: 'no-auto-georef-consensus',
      mode: resolvedMode,
      minimumPoints,
      candidateCount: candidates.length,
      hardPointCount: hardPoints.length,
      trials,
      thresholdMeters,
    });
  }

  let accepted = [...best.score.inliers];
  let finalWarp = null;
  for (let refinement = 0; refinement < 3; refinement += 1) {
    finalWarp = buildReferenceImageWarp([...hardPoints, ...accepted], { mode: resolvedMode });
    if (!finalWarp.ok) break;
    const refined = candidates.filter(candidate => (
      autoGeorefResidualMeters(finalWarp, candidate) <= thresholdMeters
    ));
    if (refined.length + hardPoints.length < requiredInliers) break;
    if (
      refined.length === accepted.length
      && refined.every((candidate, index) => candidate.id === accepted[index]?.id)
    ) {
      accepted = refined;
      break;
    }
    accepted = refined;
  }

  if (!finalWarp?.ok) {
    return Object.freeze({
      ok: false,
      reason: finalWarp?.reason || 'auto-georef-refit-failed',
      mode: resolvedMode,
      minimumPoints,
      candidateCount: candidates.length,
      hardPointCount: hardPoints.length,
      trials,
      thresholdMeters,
    });
  }

  const acceptedIds = new Set(accepted.map(candidate => candidate.id));
  const matches = candidates.map(candidate => {
    const residualMeters = autoGeorefResidualMeters(finalWarp, candidate);
    return Object.freeze({
      id: candidate.id,
      image: candidate.image,
      coordinate: candidate.coordinate,
      confidence: candidate.confidence,
      origin: candidate.origin,
      residualMeters,
      inlier: acceptedIds.has(candidate.id) && residualMeters <= thresholdMeters,
    });
  });
  const inlierIds = matches.filter(match => match.inlier).map(match => match.id);
  const rejectedIds = matches.filter(match => !match.inlier).map(match => match.id);

  return Object.freeze({
    ok: true,
    schemaVersion: REFERENCE_IMAGE_GEOREF_SCHEMA_VERSION,
    mode: resolvedMode,
    minimumPoints,
    thresholdMeters,
    trials,
    candidateCount: candidates.length,
    hardPointCount: hardPoints.length,
    inlierCount: inlierIds.length,
    rejectedCount: rejectedIds.length,
    inlierIds: Object.freeze(inlierIds),
    rejectedIds: Object.freeze(rejectedIds),
    matches: Object.freeze(matches),
    controlPoints: finalWarp.controlPoints,
    diagnostics: Object.freeze({
      ...finalWarp.diagnostics,
      ransacTrials: trials,
      ransacThresholdMeters: thresholdMeters,
      candidateCount: candidates.length,
      inlierCount: inlierIds.length,
      rejectedCount: rejectedIds.length,
    }),
    project: finalWarp.project,
    warp: finalWarp,
  });
}

export function referenceImageWarpQuad(warp) {
  if (!warp?.ok || typeof warp.project !== 'function') return null;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]]
    .map(image => warp.project(image));
  return corners.every(coordinate => coordinate?.every(Number.isFinite))
    ? corners.map(coordinate => [...coordinate])
    : null;
}

export function buildReferenceImageCalibrationWarp({
  controlPoints = [],
  anchor = null,
  cornerPinEnabled = false,
  mapQuad = null,
  mode = REFERENCE_IMAGE_WARP_MODES.AUTO,
} = {}) {
  const calibrationPoints = Array.isArray(controlPoints)
    ? controlPoints.map(point => ({
      id: point.id,
      image: Array.isArray(point.image) ? [...point.image] : point.image,
      coordinate: Array.isArray(point.coordinate) ? [...point.coordinate] : point.coordinate,
      pinned: false,
    }))
    : [];

  if (anchor) {
    calibrationPoints.unshift({
      id: 'anchor',
      image: Array.isArray(anchor.image) ? [...anchor.image] : anchor.image,
      coordinate: Array.isArray(anchor.coordinate) ? [...anchor.coordinate] : anchor.coordinate,
      pinned: true,
    });
  }

  if (!cornerPinEnabled || !calibrationPoints.length) {
    return buildReferenceImageWarp(calibrationPoints, { mode });
  }

  if (!Array.isArray(mapQuad) || mapQuad.length !== 4) {
    return Object.freeze({
      ok: false,
      mode: REFERENCE_IMAGE_WARP_MODES.TPS,
      minimumPoints: MODE_MIN_POINTS[REFERENCE_IMAGE_WARP_MODES.TPS],
      pointCount: calibrationPoints.length,
      reason: 'invalid-corner-pin-quad',
    });
  }

  const imageCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const cornerPoints = mapQuad.map((coordinate, index) => ({
    id: `corner-pin-${index}`,
    image: imageCorners[index],
    coordinate: Array.isArray(coordinate) ? [...coordinate] : coordinate,
    pinned: true,
  }));
  return buildReferenceImageWarp(
    [...cornerPoints, ...calibrationPoints],
    { mode: REFERENCE_IMAGE_WARP_MODES.TPS },
  );
}

export function buildReferenceImageProjectiveWarpFromQuad(mapQuad) {
  if (!Array.isArray(mapQuad) || mapQuad.length !== 4) {
    return Object.freeze({
      ok: false,
      mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE,
      minimumPoints: 4,
      pointCount: 0,
      reason: 'invalid-map-quad',
    });
  }
  const imageCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const values = mapQuad.map((coordinate, index) => ({
    id: `corner-${index}`,
    image: imageCorners[index],
    coordinate,
  }));
  return buildReferenceImageWarp(values, { mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE });
}

export function buildReferenceImageMesh(warp, { columns = 24, rows = 16 } = {}) {
  if (!warp?.ok || typeof warp.project !== 'function') return null;
  const columnCount = Math.max(1, Math.min(128, Math.round(Number(columns) || 24)));
  const rowCount = Math.max(1, Math.min(128, Math.round(Number(rows) || 16)));
  const vertices = [];
  for (let row = 0; row <= rowCount; row += 1) {
    const v = row / rowCount;
    for (let column = 0; column <= columnCount; column += 1) {
      const u = column / columnCount;
      const coordinate = warp.project([u, v]);
      vertices.push(Object.freeze({ uv: Object.freeze([u, v]), coordinate }));
    }
  }
  const triangles = [];
  const stride = columnCount + 1;
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const a = row * stride + column;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      triangles.push(Object.freeze([a, b, d]), Object.freeze([a, d, c]));
    }
  }
  return Object.freeze({
    columns: columnCount,
    rows: rowCount,
    vertices: Object.freeze(vertices),
    triangles: Object.freeze(triangles),
  });
}
