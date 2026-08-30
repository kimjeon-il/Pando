import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SELECTION_STYLE,
  buildSelectionBoundarySegments,
  buildSelectionRibbonVertices,
} from '../../assets/js/modules/selection-emphasis.js';

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

test('selection emphasis renderer does not use GL_LINES or lineWidth', async () => {
  const source = await readFile(new URL('../../assets/js/modules/selection-emphasis.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /gl\.LINES/);
  assert.doesNotMatch(source, /lineWidth/);
});

test('country interaction boundaries are sourced from the canonical line index mesh', async () => {
  const selection = await readFile(new URL('../../assets/js/modules/selection-emphasis.js', import.meta.url), 'utf8');
  const gpu = await readFile(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
  assert.match(selection, /mesh\.lineIndices/);
  assert.match(selection, /mesh\.countryIndices/);
  assert.match(gpu, /getCountryInteractionBoundaryData/);
  assert.match(gpu, /boundaryOwner: 'interaction-overlay'/);
  assert.doesNotMatch(gpu.slice(gpu.indexOf('function renderWebGl'), gpu.indexOf('function renderCanvasHydro')), /primaryBoundaryPaletteTexture/);
});

test('territorial persistent boundaries share the interaction GPU overlay without GL lines', async () => {
  const selection = await readFile(new URL('../../assets/js/modules/selection-emphasis.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  assert.match(selection, /setTerritorialBoundaries/);
  assert.match(selection, /territorialBoundaryBufferBytes/);
  assert.match(app, /buildTerritorialInternalBoundarySegments/);
  assert.match(app, /selectionEmphasisRenderer\?\.setTerritorialBoundaries/);
  assert.match(app, /territorialBoundaryLayer\.selectAll\('path\.territorial-internal-boundary'\)\.remove\(\)/);
});
