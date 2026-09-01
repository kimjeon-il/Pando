import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildSelectionBoundaryBufferData,
  buildSelectionBoundarySegments,
  buildSelectionChannelSignature,
  buildSelectionRibbonVertices,
  validateSelectionRibbonVertices,
} from '../../assets/js/modules/selection-stroke-geometry.js';
import { SELECTION_STYLE } from '../../assets/js/modules/selection-style.js';

function projectedRibbonPoint(vertex, halfWidth = 1) {
  const [startX, startY, endX, endY, side, endpoint] = vertex;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);
  const direction = [dx / length, dy / length];
  const normal = [-direction[1], direction[0]];
  const center = endpoint < 0.5 ? [startX - direction[0] * halfWidth, startY - direction[1] * halfWidth]
    : [endX + direction[0] * halfWidth, endY + direction[1] * halfWidth];
  return [center[0] + normal[0] * side * halfWidth, center[1] + normal[1] * side * halfWidth];
}

function triangleArea(a, b, c) {
  return Math.abs((a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) / 2);
}

test('selection boundaries keep polygon holes and independent multipolygon rings', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
      [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1], [0.5, 0.5]],
    ],
  };
  const multi = {
    type: 'MultiPolygon',
    coordinates: [polygon.coordinates, [[[10, 10], [11, 10], [11, 11], [10, 10]]]],
  };
  assert.equal(buildSelectionBoundarySegments(polygon).length, 8);
  assert.equal(buildSelectionBoundarySegments(multi).length, 11);
});

test('selection line geometries stay independent and dateline crossings are split', () => {
  const line = { type: 'LineString', coordinates: [[170, 0], [179, 1], [-179, 2], [-170, 3]] };
  const multiLine = { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3], [4, 4]]] };
  assert.equal(buildSelectionBoundarySegments(line).length, 4);
  assert.equal(buildSelectionBoundarySegments(multiLine).length, 3);
});

test('ribbon data expands each geographic segment to two triangles', () => {
  const geometry = { type: 'LineString', coordinates: [[0, 0], [1, 0], [1, 1]] };
  const segments = buildSelectionBoundarySegments(geometry);
  const vertices = buildSelectionRibbonVertices(geometry);
  assert.equal(vertices.length, segments.length * 6 * 6);
  assert.equal(vertices.length / 6 / 3, segments.length * 2);
  assert.equal(SELECTION_STYLE.primaryWidth, 2.5);
  assert.equal(SELECTION_STYLE.primaryAlpha, 1.0);
  assert.equal(SELECTION_STYLE.secondaryWidth, 1.5);
  assert.equal(SELECTION_STYLE.secondaryAlpha, 0.72);
});

test('ribbon triangles preserve start/end order and have non-zero screen-space area', () => {
  for (const coordinates of [
    [[0, 0], [10, 0]],
    [[0, 0], [0, 10]],
    [[-3, 2], [7, 11]],
    [[179.5, 0], [180, 0.5]],
  ]) {
    const vertices = buildSelectionRibbonVertices({ type: 'LineString', coordinates });
    assert.equal(validateSelectionRibbonVertices(vertices, 1).valid, true);
    const tuples = Array.from({ length: 6 }, (_, index) => vertices.slice(index * 6, index * 6 + 6));
    const points = tuples.map(vertex => projectedRibbonPoint(vertex));
    assert.ok(triangleArea(points[0], points[1], points[2]) > 0);
    assert.ok(triangleArea(points[3], points[4], points[5]) > 0);
    for (const vertex of tuples) assert.deepEqual(vertex.slice(0, 4), [...coordinates[0], ...coordinates[1]]);
  }
});

test('ribbon validation rejects malformed, non-finite, and zero-length primitives', () => {
  const valid = buildSelectionRibbonVertices({ type: 'LineString', coordinates: [[0, 0], [1, 0]] });
  assert.equal(validateSelectionRibbonVertices(valid, 1).valid, true);
  assert.equal(validateSelectionRibbonVertices(valid.slice(0, -1)).reason, 'invalid-ribbon-length');
  assert.equal(validateSelectionRibbonVertices(valid, 2).reason, 'segment-count-mismatch');
  const nonFinite = valid.slice();
  nonFinite[0] = Number.NaN;
  assert.equal(validateSelectionRibbonVertices(nonFinite).reason, 'non-finite-ribbon-value');
  const reversed = valid.slice();
  [reversed[12], reversed[14]] = [reversed[14], reversed[12]];
  assert.equal(validateSelectionRibbonVertices(reversed).reason, 'inconsistent-ribbon-endpoints');
  const badPattern = valid.slice();
  badPattern[4] = 1;
  assert.equal(validateSelectionRibbonVertices(badPattern).reason, 'invalid-ribbon-vertex-pattern');
  assert.equal(buildSelectionRibbonVertices({ type: 'LineString', coordinates: [[1, 1], [1, 1]] }).length, 0);
  assert.equal(buildSelectionRibbonVertices({ type: 'LineString', coordinates: [[0, 0], [Number.NaN, 1]] }).length, 0);
});

test('selection emphasis renderer does not use GL_LINES or lineWidth', async () => {
  const source = await readFile(new URL('../../assets/js/modules/selection-pass.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /gl\.LINES/);
  assert.doesNotMatch(source, /lineWidth/);
});

test('selection boundary buffer coverage tracks rendered and missing objects independently', () => {
  const renderedGeometry = { type: 'LineString', coordinates: [[0, 0], [1, 0], [1, 1]] };
  const ribbon = buildSelectionRibbonVertices(renderedGeometry);
  const data = buildSelectionBoundaryBufferData([
    { key: 'territorial:territory:rendered', geometry: renderedGeometry },
    { key: 'territorial:admin:rendered', geometry: renderedGeometry },
    { key: 'territorial:region:rendered', geometry: renderedGeometry },
    { key: 'country:RUS', ribbonVertices: new Float32Array(ribbon), segmentCount: 2 },
    { key: 'territorial:region:empty', geometry: { type: 'LineString', coordinates: [[0, 0]] } },
    { key: 'country:missing', missing: true },
  ]);
  assert.deepEqual(data.renderedKeys, [
    'territorial:territory:rendered',
    'territorial:admin:rendered',
    'territorial:region:rendered',
    'country:RUS',
  ]);
  assert.deepEqual(data.missingKeys, ['territorial:region:empty', 'country:missing']);
  assert.ok(data.segmentCount > 0);
  assert.equal(data.values.length, data.segmentCount * 36);
});

test('malformed precomputed ribbons are isolated as missing without suppressing valid objects', () => {
  const valid = buildSelectionRibbonVertices({ type: 'LineString', coordinates: [[0, 0], [2, 0]] });
  const malformed = valid.slice();
  malformed[12] = 2;
  const data = buildSelectionBoundaryBufferData([
    { key: 'country:valid', ribbonVertices: valid, segmentCount: 1 },
    { key: 'country:malformed', ribbonVertices: malformed, segmentCount: 1 },
    { key: 'country:mismatch', ribbonVertices: valid, segmentCount: 2 },
  ]);
  assert.deepEqual(data.renderedKeys, ['country:valid']);
  assert.deepEqual(data.missingKeys, ['country:malformed', 'country:mismatch']);
  assert.equal(data.segmentCount, 1);
  assert.equal(data.values.length, 36);
});

test('shared stroke renderer includes a one-time offscreen health check and gates availability on it', async () => {
  const source = await readFile(new URL('../../assets/js/modules/gpu-stroke-renderer.js', import.meta.url), 'utf8');
  assert.match(source, /function runSelfTest\(\)/);
  assert.match(source, /gl\.readPixels\(0, 0, 16, 16/);
  assert.match(source, /gpuHealth === 'healthy'/);
  assert.match(source, /selfTestPassed/);
  assert.match(source, /return runSelfTest\(\)/);
});

test('selection channel signatures use keys and geometry revisions instead of object identity', () => {
  const first = [{
    key: 'territorial:region:one',
    geometryRevision: 'region-one:7',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  }];
  const sameRevisionNewObject = [{
    key: 'territorial:region:one',
    geometryRevision: 'region-one:7',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  }];
  const changedRevision = [{ ...sameRevisionNewObject[0], geometryRevision: 'region-one:8' }];
  assert.equal(buildSelectionChannelSignature('primary', first), buildSelectionChannelSignature('primary', sameRevisionNewObject));
  assert.notEqual(buildSelectionChannelSignature('primary', first), buildSelectionChannelSignature('primary', changedRevision));
  assert.notEqual(buildSelectionChannelSignature('hover', first), buildSelectionChannelSignature('primary', first));
});

test('country interaction boundaries reuse stable shared resources and draw only requested owners', async () => {
  const selection = await readFile(new URL('../../assets/js/modules/selection-pass.js', import.meta.url), 'utf8');
  const gpu = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  const meshCore = await readFile(new URL('../../assets/js/workers/gpu-mesh-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(selection, /lineIndices|countryIndices/);
  assert.match(selection, /snapshot\.strokeResources/);
  assert.match(selection, /ownerIds:\s*\[id\]/);
  assert.match(gpu, /function buildCountryStrokeResource/);
  assert.match(gpu, /sourceMesh\.strokeStartsEnds/);
  assert.match(gpu, /sourceMesh\.strokeOwnerRanges/);
  assert.match(gpu, /function prewarmCountryStrokeResources/);
  assert.match(gpu, /buildCountryStrokeResource\(canonicalMesh, canonicalCountryIds, 'canonical', canonicalRevision\)/);
  assert.doesNotMatch(gpu, /const selectedOwnerIds = new Set/);
  assert.doesNotMatch(gpu, /ownerFilter/);
  assert.match(meshCore, /strokeStartsEnds/);
  assert.match(meshCore, /strokeOwnerRanges/);
  assert.doesNotMatch(gpu, /canonical-selection-boundary-gpu/);
  assert.match(gpu, /ownerRanges/);
  assert.match(gpu, /getCountryInteractionBoundaryData/);
  assert.match(gpu, /boundaryOwner: 'interaction-overlay'/);
  const baseStart = gpu.indexOf('function drawCountryBoundaryStrokes');
  const baseEnd = gpu.indexOf('function drawBaseSceneContent', baseStart);
  const baseBoundary = gpu.slice(baseStart, baseEnd);
  assert.match(baseBoundary, /drawProgram\(lineProgram, lineVao, lineIndexBuffer/);
  assert.doesNotMatch(baseBoundary, /currentCountryStrokeResources\(\)/);
  assert.doesNotMatch(gpu.slice(gpu.indexOf('function renderWebGl'), gpu.indexOf('function renderCanvasHydro')), /primaryBoundaryPaletteTexture/);
});

test('country interaction fill composites the cached country-id scene before any geometry fallback', async () => {
  const gpu = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  const start = gpu.indexOf('function drawCountryInteractionFills');
  const end = gpu.indexOf('function renderGpuSceneDomain', start);
  const interactionFill = gpu.slice(start, end);
  assert.match(gpu, /function ensureCountryIdScene/);
  assert.match(interactionFill, /countryStateFillProgram && countryStateQuadBuffer && ensureCountryIdScene\(\)/);
  assert.match(interactionFill, /gl\.drawArrays\(gl\.TRIANGLE_STRIP, 0, 4\)/);
  assert.match(interactionFill, /performanceMetrics\.countryInteractionIndexCount = 0/);
});

test('territorial persistent boundaries use the shared GPU scene stroke domain', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const gpu = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  assert.match(app, /buildTerritorialInternalBoundarySegments/);
  assert.match(app, /replaceGpuSceneDomain\('territorial-boundaries'/);
  assert.match(gpu, /strokeRenderer\.drawBatches/);
});

test('SelectionPass is independent from canvas and shares the main renderer context lifecycle', async () => {
  const selectionPass = await readFile(new URL('../../assets/js/modules/selection-pass.js', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(selectionPass, /getContext\s*\(/);
  assert.doesNotMatch(selectionPass, /addEventListener\s*\(/);
  assert.doesNotMatch(selectionPass, /removeEventListener\s*\(/);
  assert.doesNotMatch(selectionPass, /\bdocument\b/);
  assert.match(renderer, /webglcontextlost/);
  assert.match(renderer, /webglcontextrestored/);
  assert.match(renderer, /handleSharedGpuContextLost/);
  assert.match(selectionPass, /function initialize\(nextDevice, shared = \{\}\)/);
});

test('selection data travels through one packet contract and main-renderer interaction draw', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const packet = await readFile(new URL('../../assets/js/modules/selection-packet.js', import.meta.url), 'utf8');
  assert.match(packet, /countryBoundaryRevision/);
  assert.match(packet, /territorialBoundaryRevision/);
  assert.match(packet, /generic: Object\.freeze/);
  assert.match(app, /currentSelectionPacket = createSelectionPacket\(/);
  assert.match(app, /selectionPass\.updateData\(currentSelectionPacket\)/);
  assert.match(app, /gpuMapRenderer\.renderInteraction\?\./);
  assert.doesNotMatch(app, /selectionCanvasHost/);
  assert.doesNotMatch(app, /createSelectionEmphasisRenderer/);
});

test('selection overlay commits staged SVG only after GPU draw coverage is known', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function renderSelectionOverlayFrame');
  const end = app.indexOf('function issueCoordinate', start);
  const source = app.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(source, /selectionLayer\.selectAll\('\*'\)\.remove\(\)/);
  assert.match(source, /document\.createElementNS/);
  assert.match(source, /gpuRenderResult\?\.channels\?\.primary\?\.renderedKeys/);
  assert.match(source, /selectionTarget\?\.replaceChildren/);
  assert.match(source, /retainedPreviousFrame/);
});

test('map hover invalidates selection data instead of rendering synchronously', async () => {
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function setMapHover');
  const end = app.indexOf('function syncGpuCountryEmphasis', start);
  const source = app.slice(start, end);
  assert.match(source, /invalidateSelectionOverlay\('map-hover'\)/);
  assert.doesNotMatch(source, /renderHoverOverlay\(\)/);
});
