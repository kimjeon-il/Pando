import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Blob } from 'node:buffer';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createGenericFeatureService } from '../../assets/js/modules/generic-feature-service.js';
import { buildReferenceImageWarp } from '../../assets/js/modules/reference-image-georef.js';
import { createReferenceImageAnalysisService } from '../../assets/js/modules/reference-image-analysis.js';
import { calculateReferenceImage } from '../../assets/js/modules/reference-image-core.js';

const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
const record = () => ({ id: 'map-a', name: 'reference', blob: new Blob(['source image']), warpMode: 'affine', controlPoints: [
  { id: 'a', image: [0, 0], coordinate: [10, 40] }, { id: 'b', image: [1, 0], coordinate: [20, 40] }, { id: 'c', image: [0, 1], coordinate: [10, 30] },
] });
const graph = { ok: true, width: 11, height: 11, chains: [{ id: 0, points: [[1, 1], [9, 1]], semanticBits: 1, confidence: .9 }, { id: 1, points: [[1, 9], [9, 9]], semanticBits: 1, confidence: .9 }], faces: [], unresolved: [] };

test('graticule confirmation preserves transcription and rejects stale mappings and insufficient independent labels', async () => {
  const image = record();
  const grid = { points: [[0, 0], [1, 0], [0, 1], [1, 1]].map((point, i) => ({ id: 'grid:' + i, image: point, coordinate: [20 + point[0], 40 - point[1]] })),
    labels: [{ originalText: '٢٠° E' }], independentLongitudeLabels: 2, independentLatitudeLabels: 2 };
  const service = createReferenceImageAnalysisService({ getGeneration: () => 1, searchPlaces: async () => [], genericFeatureService: { addMany: async () => [] },
    client: { run: async operation => { assert.equal(operation, 'reference.layout');return { panels: [], grid }; } } });
  const analysis = await service.analyzeLayout(image);
  const reviewed = service.reviewGraticule(image, analysis);
  assert.equal(reviewed.controlPoints.length, 4);
  assert.equal(reviewed.gridReference.labels[0].originalText, '٢٠° E');
  assert.equal(image.controlPoints.length, 3, 'service does not mutate the record');
  assert.throws(() => service.reviewGraticule(image, { ...analysis, grid: { ...grid, independentLatitudeLabels: 1 } }), { code: 'PL-REF-GRID-INSUFFICIENT' });
  image.controlPoints[0].coordinate = [11, 40];
  assert.throws(() => service.reviewGraticule(image, analysis), { code: 'PL-REF-ANALYSIS-STALE' });
});

test('reviewed extracted lines create one real Core import with provenance and atomic undo redo', async () => {
  const owner = await createNodeCoreProject(seed());
  try {
    const generic = createGenericFeatureService({ documentModel: owner.documentModel, commandOwner: owner.project });
    const before = structuredClone(generic.list());
    const service = createReferenceImageAnalysisService({ getGeneration: () => 1, searchPlaces: async () => [], genericFeatureService: generic,
      client: { run: async operation => { assert.equal(operation, 'reference.segment'); return { graph, modelVersion: 'a'.repeat(64), evaluationStatus: 'validated' }; } } });
    const image = record();image.warp = buildReferenceImageWarp(image.controlPoints, { mode: 'affine' });
    const analysis = await service.extractBoundaries(image);
    const ids = await service.applyExtractedFeatures(image, analysis, ['line:0', 'line:1']);
    assert.equal(ids.length, 2);
    assert.equal(generic.list().length, before.length + 2);
    const created = generic.get(ids[0]);
    assert.equal(created.geometry.type, 'LineString');
    assert.equal(created.properties.source.details.reviewStatus, 'provisional');
    assert.equal(created.properties.source.details.referenceImageId, 'map-a');
    assert.equal(created.properties.source.details.modelVersion, 'a'.repeat(64));
    assert.equal(await owner.project.undo(), true);
    assert.deepEqual(generic.list(), before);
    assert.equal(await owner.project.redo(), true);
    assert.ok(generic.get(ids[0]));assert.ok(generic.get(ids[1]));
  } finally { owner.dispose(); }
});

test('a changed project or image mapping rejects old extraction before any command', async () => {
  let generation = 1, calls = 0;
  const image = record();image.warp = buildReferenceImageWarp(image.controlPoints, { mode: 'affine' });
  const service = createReferenceImageAnalysisService({ getGeneration: () => generation, searchPlaces: async () => [],
    genericFeatureService: { addMany: async () => { calls++;return []; } }, client: { run: async () => ({ graph, modelVersion: 'a'.repeat(64), evaluationStatus: 'validated' }) } });
  const analysis = await service.extractBoundaries(image);
  generation = 2;
  await assert.rejects(service.applyExtractedFeatures(image, analysis, ['line:0']), { code: 'PL-REF-ANALYSIS-STALE' });
  assert.equal(calls, 0);
});

test('boundary editing preserves the inference master and reuses edited pixels after calibration changes', async () => {
  const image = record();image.warp = buildReferenceImageWarp(image.controlPoints, { mode: 'affine' });
  let segmentCalls = 0;
  const service = createReferenceImageAnalysisService({ getGeneration: () => 1, searchPlaces: async () => [], genericFeatureService: { addMany: async () => [] },
    client: { run: async (operation, payload) => {
      if (operation === 'reference.editGraph') return calculateReferenceImage('editBoundaryGraph', payload);
      segmentCalls++;return { graph, modelVersion: 'a'.repeat(64), evaluationStatus: 'validated' };
    } } });
  const analysis = await service.extractBoundaries(image);
  const edited = await service.editBoundaries(image, analysis, { type: 'exclude', chainId: 0 });
  assert.equal(analysis.graph.chains.length, 2);
  assert.equal(edited.graph.chains.length, 1);
  assert.equal(edited.rawGraph, graph);
  assert.deepEqual(edited.edits, [{ type: 'exclude', chainId: 0 }]);
  image.controlPoints[0].coordinate = [11, 40];
  image.warp = buildReferenceImageWarp(image.controlPoints, { mode: 'affine' });
  const moved = await service.extractBoundaries(image, { previous: edited });
  assert.equal(moved.graph, edited.graph);
  assert.equal(moved.rawGraph, graph);
  assert.deepEqual(moved.edits, edited.edits);
  assert.equal(segmentCalls, 1);
});
