import { referenceImageMappingSignature } from './reference-image-model.js';
import { resolveReferenceImagePlaceDetections } from './reference-image-place-match.js';
import { calculateReferenceImage, referenceWarpDescriptor } from './reference-image-core.js';
import { normalizeSourceProvenance, SOURCE_KINDS } from './source-provenance.js';
import { GENERIC_FEATURE_SCHEMA_VERSION } from './version-contract.js';
import { referenceImageSourceHash } from './reference-image-source.js';

const failure = (message, code) => Object.assign(new Error(message), { code });

export function createReferenceImageAnalysisService({ client, searchPlaces, getGeneration, genericFeatureService, uid = () => crypto.randomUUID() } = {}) {
  if (typeof client?.run !== 'function' || typeof searchPlaces !== 'function' || typeof getGeneration !== 'function'
    || typeof genericFeatureService?.addMany !== 'function') throw new TypeError('Reference analysis requires its Worker, global place search, project generation and generic command owner.');

  function assertCurrent(record, snapshot) {
    if (record.locked || record.id !== snapshot.imageId || record.blob !== snapshot.sourceBlob
      || getGeneration() !== snapshot.projectGeneration || referenceImageMappingSignature(record) !== snapshot.baseMappingSignature) {
      throw failure('이미지·정합·프로젝트가 변경되어 이전 분석 결과를 적용하지 않았습니다.', 'PL-REF-ANALYSIS-STALE');
    }
  }
  async function capture(record) {
    const snapshot = { imageId: record.id, sourceBlob: record.blob, baseMappingSignature: referenceImageMappingSignature(record),
      projectGeneration: getGeneration(), dataRevision: globalThis.PANDOLAB_BUILD_META?.dataRevision || 'local' };
    snapshot.sourceRect = record.sourceRect ? { ...record.sourceRect } : null;
    snapshot.imageSha256 = await referenceImageSourceHash(record.blob);assertCurrent(record, snapshot);return Object.freeze(snapshot);
  }
  async function analyzeGeoreference(record, { signal = null, languages = null, mapDate = null } = {}) {
    const snapshot = await capture(record);
    const ocr = await client.run('reference.ocr', { blob: record.blob, sourceRect: record.sourceRect, languages }, { signal });
    assertCurrent(record, snapshot);signal?.throwIfAborted();
    if (!ocr.ok) return { ok: false, reason: ocr.reason, ocr, snapshot };
    const matched = await resolveReferenceImagePlaceDetections(ocr.detections, { search: query => searchPlaces(query, { scope: 'reference', mapDate, signal }), mapDate, anchor: record.anchor,
      allowAmbiguous: true, maxDetections: 256, maxSearchQueries: 1024, maxPlaces: 20000 });
    assertCurrent(record, snapshot);signal?.throwIfAborted();
    const detected = new Map(ocr.detections.map(row => [row.id, row]));
    const candidates = matched.matches.flatMap(row => {
      const symbol = detected.get(row.detectionId)?.symbol;
      return symbol ? [{ ...row, image: symbol.uv, confidence: row.confidence * .76 + symbol.confidence * .24 }] : [];
    });
    if (candidates.length < 6) return { ok: false, reason: 'insufficient-ocr-symbol-candidates', matching: matched, ocr, snapshot };
    const manualControlPoints = record.controlPoints.filter(point => !point.id.startsWith('auto-place:'));
    const calibration = { anchor: record.anchor, linearConstraints: record.linearConstraints, cornerPinEnabled: record.cornerPinEnabled, mapQuad: record.mapQuad };
    const solve = points => client.run('reference.georef', { width: ocr.width, height: ocr.height, manualControlPoints, calibration,
      options: { points, anchor: record.anchor, mode: 'auto', maxTrials: 1024, minimumInliers: 6, inlierThresholdMeters: 25000 } }, { signal });
    const solved = await solve(candidates);assertCurrent(record, snapshot);
    const result = { ok: solved.ok && solved.diagnostics.quality.recommended, reason: solved.reason || solved.diagnostics?.quality?.reason || '',
      source: 'place-ocr', ocr, matching: { ...matched, matches: candidates, matchCount: candidates.length }, georef: solved,
      snapshot, baseMappingSignature: snapshot.baseMappingSignature };
    if (!result.ok) return result;
    const accepted = new Set(solved.inlierIds), remaining = candidates.filter(row => !accepted.has(row.id));
    if (new Set(remaining.map(row => row.detectionId)).size >= 6) {
      const alternative = await solve(remaining);assertCurrent(record, snapshot);
      if (alternative.ok && alternative.diagnostics.quality.recommended && alternative.inlierCount >= solved.inlierCount * .85) {
        return { ...result, requiresLocationChoice: true, locations: [result, { ...result, georef: alternative, matching: { ...matched, matches: remaining, matchCount: remaining.length } }] };
      }
    }
    return result;
  }
  async function analyzeLayout(record, { signal = null, languages = null } = {}) {
    const snapshot = await capture(record);
    const result = await client.run('reference.layout', { blob: record.blob, sourceRect: record.sourceRect, languages }, { signal });
    assertCurrent(record, snapshot);signal?.throwIfAborted();
    return { ...result, snapshot };
  }
  function reviewGraticule(record, analysis) {
    assertCurrent(record, analysis.snapshot);
    const grid = analysis.grid;
    if (!grid || grid.points.length < 4 || grid.independentLongitudeLabels < 2 || grid.independentLatitudeLabels < 2) {
      throw failure('서로 다른 경도·위도 표기가 각각 두 개 이상 필요합니다.', 'PL-REF-GRID-INSUFFICIENT');
    }
    const controlPoints = grid.points.map(point => {
      if (point.image.length !== 2 || point.coordinate.length !== 2 || !point.image.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
        || !point.coordinate.every((value, axis) => Number.isFinite(value) && Math.abs(value) <= (axis ? 90 : 180))) {
        throw failure('격자 좌표 후보가 올바르지 않습니다.', 'PL-REF-GRID-CONTRACT');
      }
      return { id: `reviewed-${point.id}`, image: [...point.image], coordinate: [...point.coordinate] };
    });
    return { controlPoints, gridReference: { primeMeridian: 'greenwich', datum: 'WGS84', reviewed: true, labels: structuredClone(grid.labels) } };
  }
  async function extractBoundaries(record, { signal = null, previous = null } = {}) {
    if (!record.warp?.ok) throw failure('먼저 이미지 정합을 확인하세요.', 'PL-REF-CALIBRATION-REQUIRED');
    const snapshot = await capture(record);
    const reusable = previous?.snapshot.sourceBlob === snapshot.sourceBlob && previous.snapshot.dataRevision === snapshot.dataRevision
      && JSON.stringify(previous.snapshot.sourceRect ?? null) === JSON.stringify(snapshot.sourceRect);
    const raw = reusable ? previous : await client.run('reference.segment', { blob: record.blob, sourceRect: record.sourceRect }, { signal });
    assertCurrent(record, snapshot);signal?.throwIfAborted();
    if (!raw.graph?.ok || !/^[a-f0-9]{64}$/.test(raw.modelVersion) || raw.evaluationStatus !== 'validated') throw failure('검증된 경계 분석 결과가 아닙니다.', 'PL-REF-ANALYSIS-CONTRACT');
    return { graph: raw.graph, rawGraph: raw.rawGraph || raw.graph, edits: raw.edits || [], modelVersion: raw.modelVersion, evaluationStatus: raw.evaluationStatus, snapshot };
  }
  async function editBoundaries(record, analysis, command, { signal = null } = {}) {
    assertCurrent(record, analysis.snapshot);signal?.throwIfAborted();
    const graph = await client.run('reference.editGraph', { graph: analysis.graph, command }, { signal });
    assertCurrent(record, analysis.snapshot);signal?.throwIfAborted();
    if (!graph?.ok) throw failure('경계망 수정 결과가 올바르지 않습니다.', 'PL-REF-BOUNDARY-EDIT');
    return { ...analysis, graph, rawGraph: analysis.rawGraph, edits: [...analysis.edits, structuredClone(command)] };
  }
  async function applyExtractedFeatures(record, analysis, selectedIds) {
    assertCurrent(record, analysis.snapshot);
    if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) throw failure('적용할 경계를 선택하세요.', 'PL-REF-SELECTION');
    const projected = calculateReferenceImage('projectBoundaryGraph', { graph: analysis.graph, warp: referenceWarpDescriptor(record.warp) });
    const choices = new Map([...projected.lines.map(row => ['line:' + row.id, row]), ...projected.polygons.map(row => ['face:' + row.id, row])]);
    const incompleteFaces = new Set(analysis.graph.faces.filter(face => face.touchesImageEdge).map(face => 'face:' + face.id));
    const features = selectedIds.map(id => {
      const candidate = choices.get(id);
      if (!candidate || incompleteFaces.has(id)) throw failure('현재 분석에 없거나 지도 가장자리에서 잘린 경계입니다.', 'PL-REF-SELECTION');
      const source = normalizeSourceProvenance({ kind: SOURCE_KINDS.USER, dataset: 'reference-image-analysis', sourceId: analysis.snapshot.imageSha256,
        sourceFormat: 'raster', sourceType: id.startsWith('face:') ? 'boundary-face' : 'boundary-line', version: analysis.modelVersion, importedAt: new Date().toISOString(),
        details: { referenceImageId: record.id, referenceImageName: record.name, candidateId: id, imageSha256: analysis.snapshot.imageSha256,
          modelVersion: analysis.modelVersion, dataRevision: analysis.snapshot.dataRevision, mappingSignature: analysis.snapshot.baseMappingSignature,
          reviewStatus: 'provisional', sourceDate: null, historicalAccuracy: 'unverified', boundaryEdits: analysis.edits,
          sourceRect: analysis.snapshot.sourceRect, gridReference: record.gridReference } });
      return { type: 'Feature', id: uid(), geometry: candidate.geometry, properties: { schemaVersion: GENERIC_FEATURE_SCHEMA_VERSION, name: '', notes: '', color: '#e26a44', locked: false, source } };
    });
    assertCurrent(record, analysis.snapshot);
    const created = await genericFeatureService.addMany(features);
    return created.map(feature => feature.id);
  }
  return Object.freeze({ analyzeLayout, reviewGraticule, analyzeGeoreference, extractBoundaries, editBoundaries, applyExtractedFeatures, assertCurrent });
}
