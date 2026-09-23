import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { feature as topologyFeature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile } from 'topojson-simplify';

import { validateGeometry } from '../assets/js/modules/geometry-validation.js';

function ringArcs(geometry, polygonIndex, ringIndex) {
  return geometry.type === 'Polygon'
    ? geometry.arcs?.[ringIndex]
    : geometry.arcs?.[polygonIndex]?.[ringIndex];
}

function arcIndex(reference) {
  return reference < 0 ? ~reference : reference;
}

function allArcReferences(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
  return polygons.flatMap(polygon => polygon.flatMap(ring => ring));
}

function inspectCandidate(candidate) {
  const collection = topologyFeature(candidate, candidate.objects.countries);
  const inspector = fileURLToPath(new URL('./inspect-preview-topology.py', import.meta.url));
  const inspection = spawnSync(process.env.PANDOLAB_PYTHON || 'python', [inspector], {
    input: JSON.stringify(collection),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (inspection.error || inspection.status !== 0) {
    const error = new Error(`미리보기 정밀 형상 검사를 실행하지 못했습니다: ${inspection.stderr || inspection.error?.message || inspection.status}`);
    error.code = 'PREVIEW_VALIDATOR_UNAVAILABLE';
    throw error;
  }
  return JSON.parse(inspection.stdout);
}

function segmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  const x = start[0] + amount * dx - point[0];
  const y = start[1] + amount * dy - point[1];
  return x * x + y * y;
}

function restoreNearIssue(issue, prepared, kept, restorePoint, byId) {
  const locations = issue.points || [issue.point];
  if (!locations.length || locations.some(point => !Array.isArray(point))) {
    throw new Error(`미리보기 형상 문제의 위치가 없습니다: ${issue.reason}`);
  }
  let additions = 0;
  for (const id of issue.ids) {
    const geometry = byId.get(String(id));
    if (!geometry) throw new Error(`미리보기 형상 문제의 국가가 없습니다: ${id}`);
    for (const location of locations) {
      const candidates = [];
      for (const reference of new Set(allArcReferences(geometry).map(arcIndex))) {
        const arc = prepared.arcs[reference];
        const indices = [];
        for (let index = 0; index < arc.length; index += 1) if (kept[reference][index]) indices.push(index);
        for (let index = 1; index < indices.length; index += 1) {
          const start = indices[index - 1];
          const end = indices[index];
          if (end - start <= 1) continue;
          const distance = segmentDistanceSquared(location, arc[start], arc[end]);
          candidates.push({ reference, start, end, distance });
        }
      }
      candidates.sort((left, right) => left.distance - right.distance || left.reference - right.reference || left.start - right.start);
      for (const segment of candidates.slice(0, issue.reason === 'overlap' ? 1 : 3)) {
        const points = [];
        for (let index = segment.start + 1; index < segment.end; index += 1) {
          if (!kept[segment.reference][index]) points.push(index);
        }
        points.sort((left, right) => prepared.arcs[segment.reference][right][2] - prepared.arcs[segment.reference][left][2] || left - right);
        for (const pointIndex of points.slice(0, issue.reason === 'overlap' ? 2 : 4)) {
          restorePoint(segment.reference, pointIndex);
          additions += 1;
        }
      }
    }
  }
  return additions;
}

function ringCounts(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map(polygon => polygon.length);
}

function createCandidate(prepared, threshold) {
  const kept = prepared.arcs.map(arc => Uint8Array.from(arc, point => point[2] >= threshold ? 1 : 0));
  const candidate = {
    type: 'Topology',
    bbox: prepared.bbox,
    objects: prepared.objects,
    arcs: prepared.arcs.map((arc, index) => arc.filter((_, pointIndex) => kept[index][pointIndex]).map(point => point.slice(0, 2))),
  };
  const restorePoint = (index, pointIndex) => {
    if (kept[index][pointIndex]) return;
    kept[index][pointIndex] = 1;
    candidate.arcs[index] = prepared.arcs[index]
      .filter((_, current) => kept[index][current])
      .map(point => point.slice(0, 2));
  };
  return { candidate, kept, restorePoint };
}

function repairCandidate(prepared, threshold, canonicalFeatures) {
  const { candidate, kept, restorePoint } = createCandidate(prepared, threshold);
  const geometries = prepared.objects.countries.geometries;
  const byId = new Map(geometries.map(geometry => [String(geometry.id), geometry]));
  for (let pass = 0; pass < 30; pass += 1) {
    for (let countryIndex = 0; countryIndex < geometries.length; countryIndex += 1) {
      const country = () => topologyFeature(candidate, geometries[countryIndex]);
      const failures = validateGeometry(country());
      const affectedRings = new Set(failures.map(issue => `${issue.polygonIndex ?? 0}:${issue.ringIndex ?? 0}`));
      for (const ringKey of affectedRings) {
        const [polygonIndex, ringIndex] = ringKey.split(':').map(Number);
        const references = ringArcs(geometries[countryIndex], polygonIndex, ringIndex) || [];
        const points = [];
        for (const reference of references) {
          const index = arcIndex(reference);
          prepared.arcs[index].forEach((point, pointIndex) => {
            if (!kept[index][pointIndex]) points.push({ index, pointIndex, weight: point[2] });
          });
        }
        points.sort((left, right) => right.weight - left.weight || left.index - right.index || left.pointIndex - right.pointIndex);
        let cursor = 0;
        let batch = 1;
        while (validateGeometry(country()).some(issue => (issue.polygonIndex ?? 0) === polygonIndex && (issue.ringIndex ?? 0) === ringIndex)) {
          if (cursor >= points.length) throw new Error(`미리보기 고리를 복구할 수 없습니다: ${canonicalFeatures[countryIndex].id}:${ringKey}`);
          for (let added = 0; added < batch && cursor < points.length; added += 1) {
            const point = points[cursor++];
            restorePoint(point.index, point.pointIndex);
          }
          batch = Math.min(batch * 2, 32);
        }
      }
    }
    const strictIssues = inspectCandidate(candidate);
    if (process.env.PANDOLAB_TOPOLOGY_DEBUG) {
      console.error(`topology repair pass ${pass}: ${strictIssues.length} strict issues ${JSON.stringify(strictIssues.slice(0, 2))}`);
    }
    if (!strictIssues.length) return candidate;
    let additions = 0;
    for (const issue of strictIssues) {
      additions += restoreNearIssue(issue, prepared, kept, restorePoint, byId);
    }
    if (!additions) throw new Error(`미리보기 정밀 형상을 복구할 수 없습니다: ${JSON.stringify(strictIssues.slice(0, 3))}`);
  }
  throw new Error('미리보기 topology 복구가 안정화되지 않았습니다.');
}

export function buildTopologyPreview(canonicalFeatures, {
  maxCoordinates,
  normalizeGeometry,
  hasCanonicalWinding,
}) {
  const original = topology({ countries: { type: 'FeatureCollection', features: canonicalFeatures } });
  const prepared = presimplify(original);
  const sourceCounts = canonicalFeatures.map(featureValue => ringCounts(featureValue.geometry));
  const countCoordinates = value => Array.isArray(value) && typeof value[0] === 'number'
    ? 1
    : Array.isArray(value) ? value.reduce((total, part) => total + countCoordinates(part), 0) : 0;
  let lastFailure = '';
  for (const proportion of [0.16, 0.14, 0.12, 0.10, 0.08]) {
    try {
      if (process.env.PANDOLAB_TOPOLOGY_DEBUG) console.error(`topology quantile ${proportion}`);
      const candidate = repairCandidate(prepared, quantile(prepared, proportion), canonicalFeatures);
      const generated = topologyFeature(candidate, candidate.objects.countries).features;
      const byId = new Map(generated.map(item => [String(item.id), item]));
      if (byId.size !== canonicalFeatures.length) throw new Error('미리보기 국가 ID가 중복되거나 누락됐습니다.');
      const features = canonicalFeatures.map((source, index) => {
        const raw = byId.get(String(source.id));
        if (!raw) throw new Error(`미리보기 국가가 누락됐습니다: ${source.id}`);
        const geometry = normalizeGeometry(raw.geometry);
        if (!geometry) throw new Error(`미리보기 국가 형상이 비었습니다: ${source.id}`);
        const result = { ...source, geometry };
        if (JSON.stringify(ringCounts(geometry)) !== JSON.stringify(sourceCounts[index])) {
          throw new Error(`미리보기 국가의 섬 또는 구멍이 누락됐습니다: ${source.id}`);
        }
        const issues = validateGeometry(result);
        if (issues.length || !hasCanonicalWinding(geometry)) throw new Error(`미리보기 국가 형상이 유효하지 않습니다: ${source.id} ${JSON.stringify(issues[0] || 'winding')}`);
        return result;
      });
      const coordinateCount = countCoordinates(features.map(item => item.geometry.coordinates));
      if (coordinateCount > maxCoordinates) throw new Error(`미리보기 좌표 수가 상한을 초과했습니다: ${coordinateCount}`);
      return { features, coordinateCount, simplificationQuantile: proportion };
    } catch (error) {
      if (error.code === 'PREVIEW_VALIDATOR_UNAVAILABLE') throw error;
      lastFailure = error.message;
      if (process.env.PANDOLAB_TOPOLOGY_DEBUG) console.error(lastFailure);
    }
  }
  throw new Error(`canonical topology에서 유효한 미리보기를 만들지 못했습니다: ${lastFailure}`);
}
