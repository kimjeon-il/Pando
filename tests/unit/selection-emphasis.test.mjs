import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildSelectionBoundarySegments,
  buildSelectionChannelSignature,
} from "../../shared/frontend/js/modules/selection-stroke-geometry.js";

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

test('selection emphasis renderer does not use GL_LINES or lineWidth', async () => {
  const source = await readFile(new URL("../../shared/frontend/js/modules/selection-pass.js", import.meta.url), 'utf8');
  assert.doesNotMatch(source, /gl\.LINES/);
  assert.doesNotMatch(source, /lineWidth/);
});

test('shared stroke renderer includes a one-time offscreen health check and gates availability on it', async () => {
  const source = await readFile(new URL("../../shared/frontend/js/modules/gpu-stroke-renderer.js", import.meta.url), 'utf8');
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
  const selection = await readFile(new URL("../../shared/frontend/js/modules/selection-pass.js", import.meta.url), 'utf8');
  const gpu = await readFile(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
  const meshCore = await readFile(new URL("../../shared/frontend/js/workers/gpu-mesh-core.js", import.meta.url), 'utf8');
  assert.doesNotMatch(selection, /lineIndices|countryIndices/);
  assert.match(selection, /snapshot\.strokeResources/);
  assert.match(selection, /ownerIds:\s*\[id\]/);
  assert.match(gpu, /function buildCountryStrokeResource/);
  assert.match(gpu, /preparedGeometry\.startsEnds/);
  assert.match(gpu, /preparedGeometry\.inputOwnerRanges/);
  assert.match(gpu, /function prewarmCountryStrokeResources/);
  assert.match(gpu, /buildCountryStrokeResource\(mesh, meshCountryIds, activeMeshQuality, activeRevision\)/);
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

test('country interaction fill consumes only the prepared emphasized ranges', async () => {
  const gpu = await readFile(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
  const start = gpu.indexOf('function drawCountryInteractionFills');
  const end = gpu.indexOf('function drawCountryBoundaryMask', start);
  assert.ok(start >= 0 && end > start, 'country interaction fill helper must remain isolated');
  const interactionFill = gpu.slice(start, end);
  assert.match(gpu, /function ensureCountryIdScene/);
  assert.doesNotMatch(interactionFill, /ensureCountryIdScene\(\)/);
  assert.match(interactionFill, /function drawCountryInteractionFills\(\{ base, override \}\)/);
  assert.match(interactionFill, /if \(base\.length\) drawProgram\([^;]+base\)/s);
  assert.match(interactionFill, /if \(override\.length\) drawProgram\([^;]+override\)/s);
  assert.doesNotMatch(interactionFill, /triangleRangesByCountryId/);
});

test('territorial persistent boundaries use the shared GPU scene stroke domain', async () => {
  const rendering = await readFile(new URL("../../shared/frontend/js/modules/rendering-domain.js", import.meta.url), 'utf8');
  const gpu = await readFile(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
  const preparation = await readFile(new URL("../../shared/frontend/js/modules/map-display-preparation.js", import.meta.url), 'utf8');
  assert.match(preparation, /buildTerritorialInternalBoundarySegments/);
  assert.doesNotMatch(rendering, /buildTerritorialInternalBoundarySegments/);
  assert.match(rendering, /replaceGpuSceneDomain\?\.\('territorial-boundaries'/);
  assert.match(gpu, /strokeRenderer\.drawBatches/);
});

test('SelectionPass is independent from canvas and shares the main renderer context lifecycle', async () => {
  const selectionPass = await readFile(new URL("../../shared/frontend/js/modules/selection-pass.js", import.meta.url), 'utf8');
  const renderer = await readFile(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
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
  const app = readApplicationOwners('gpu-scene', 'domain-assembly');
  const packet = await readFile(new URL("../../shared/frontend/js/modules/selection-packet.js", import.meta.url), 'utf8');
  const rendering = await readFile(new URL("../../shared/frontend/js/modules/rendering-domain.js", import.meta.url), 'utf8');
  assert.match(packet, /countryBoundaryRevision/);
  assert.match(packet, /territorialBoundaryRevision/);
  const { createSelectionPacket } = await import("../../shared/frontend/js/modules/selection-packet.js");
  const selectionPacket = createSelectionPacket({ channels: { primary: [{ key: 'territorial:entity:A' }] } });
  assert.equal(selectionPacket.channels.primary[0].key, 'territorial:entity:A');
  assert.equal(Object.isFrozen(selectionPacket.channels.primary), true);
  assert.equal(Object.hasOwn(selectionPacket, 'country'), false);
  assert.equal(Object.hasOwn(selectionPacket, 'generic'), false);
  assert.doesNotMatch(app, /currentSelectionPacket = createSelectionPacket\(/);
  assert.doesNotMatch(app, /selectionPass\.updateData\(currentSelectionPacket\)/);
  assert.match(rendering, /gpuMapRenderer\?\.renderInteraction\?\./);
  assert.doesNotMatch(app, /selectionCanvasHost/);
  assert.doesNotMatch(app, /createSelectionEmphasisRenderer/);
});

test('selection overlay commits staged SVG only after GPU draw coverage is known', async () => {
  const app = readApplicationOwners('gpu-scene', 'domain-assembly');
  const rendering = await readFile(new URL("../../shared/frontend/js/modules/rendering-domain.js", import.meta.url), 'utf8');
  const start = rendering.indexOf('const renderSelectionOverlayFrame');
  const end = rendering.indexOf('const renderSelection =', start);
  const source = rendering.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(app, /function renderSelectionOverlayFrame\b/);
  assert.doesNotMatch(app, /function renderSelectionOverlay\b/);
  assert.doesNotMatch(source, /selectionLayer\.selectAll\('\*'\)\.remove\(\)/);
  assert.match(source, /createElementNS/);
  assert.match(source, /selectionCoverage\(gpuRenderResult/);
  assert.match(source, /selectionTarget\?\.replaceChildren/);
  assert.match(source, /retainedPreviousFrame/);
});

test('map hover delegates ownership and invalidation to the selection domain', async () => {
  const app = readApplicationOwners('gpu-scene', 'domain-assembly');
  const start = app.indexOf('function setMapHover');
  const end = app.indexOf('\n  }', start);
  const source = app.slice(start, end);
  assert.match(source, /selectionDomain\.setHover\(nextRef, \{ source: 'map'/);
  assert.doesNotMatch(source, /invalidateSelectionOverlay/);
  assert.doesNotMatch(source, /renderHoverOverlay\(\)/);
});
