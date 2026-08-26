const clone = value => structuredClone(value);

function multiCoordinates(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += Number(ring[previous]?.[0] || 0) * Number(ring[index]?.[1] || 0)
      - Number(ring[index]?.[0] || 0) * Number(ring[previous]?.[1] || 0);
  }
  return area / 2;
}

function multiArea(value) {
  const polygons = value?.type ? multiCoordinates(value) : value || [];
  return polygons.reduce((total, polygon) => total + Math.max(0,
    Math.abs(ringArea(polygon[0] || [])) - (polygon || []).slice(1).reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0),
  ), 0);
}

function normalizeGeometry(value) {
  const coordinates = value?.type ? multiCoordinates(value) : value;
  if (!Array.isArray(coordinates) || !coordinates.length || multiArea(coordinates) <= 1e-14) return null;
  return coordinates.length === 1
    ? { type: 'Polygon', coordinates: clone(coordinates[0]) }
    : { type: 'MultiPolygon', coordinates: clone(coordinates) };
}

function coordinateKey(coord, precision = 6) {
  return `${Number(coord?.[0]).toFixed(precision)},${Number(coord?.[1]).toFixed(precision)}`;
}

function boundaryKeys(geometry) {
  const keys = new Set();
  for (const polygon of multiCoordinates(geometry)) {
    for (const ring of polygon || []) for (const coord of ring || []) keys.add(coordinateKey(coord));
  }
  return keys;
}

export function createTerritorialGeometryKernel(clipper) {
  if (!clipper?.union || !clipper?.difference || !clipper?.intersection) {
    throw new Error('영역 geometry 연산 엔진을 불러오지 못했습니다.');
  }

  function mergeUnits(source, targets) {
    if (!source?.geometry || !(targets || []).length) throw new Error('합칠 영역을 찾을 수 없습니다.');
    const geometry = normalizeGeometry(clipper.union(source.geometry.coordinates, ...targets.map(target => target.geometry.coordinates)));
    if (!geometry) throw new Error('영역 합집합을 만들 수 없습니다.');
    return { survivor: { ...clone(source), geometry }, removedIds: targets.map(target => String(target.id)) };
  }

  function transferGeometry(source, target, geometry) {
    if (!source?.geometry || !target?.geometry || !geometry) throw new Error('이전할 영역과 대상을 찾을 수 없습니다.');
    const transferred = normalizeGeometry(geometry);
    if (!transferred) throw new Error('이전할 geometry가 비어 있습니다.');
    const outside = clipper.difference(transferred.coordinates, source.geometry.coordinates);
    if (multiArea(outside) > Math.max(1e-10, multiArea(transferred) * 1e-10)) throw new Error('이전 geometry가 원본 영역 밖으로 벗어났습니다.');
    const sourceGeometry = normalizeGeometry(clipper.difference(source.geometry.coordinates, transferred.coordinates));
    const targetGeometry = normalizeGeometry(clipper.union(target.geometry.coordinates, transferred.coordinates));
    if (!targetGeometry) throw new Error('대상 geometry를 갱신할 수 없습니다.');
    return {
      source: sourceGeometry ? { ...clone(source), geometry: sourceGeometry } : null,
      target: { ...clone(target), geometry: targetGeometry },
      transferredGeometry: transferred,
    };
  }

  function splitUnit(unit, geometries) {
    if (!unit?.geometry || !Array.isArray(geometries) || geometries.length < 2) throw new Error('분할 결과가 부족합니다.');
    const parts = geometries.map(normalizeGeometry);
    if (parts.some(part => !part)) throw new Error('분할 결과에 빈 geometry가 있습니다.');
    const union = normalizeGeometry(clipper.union(...parts.map(part => part.coordinates)));
    const lost = clipper.difference(unit.geometry.coordinates, union.coordinates);
    const added = clipper.difference(union.coordinates, unit.geometry.coordinates);
    const tolerance = Math.max(1e-10, multiArea(unit.geometry) * 1e-10);
    if (multiArea(lost) > tolerance || multiArea(added) > tolerance) throw new Error('분할 전후의 전체 면적이 일치하지 않습니다.');
    return parts;
  }

  function editBoundary(unit, geometry) {
    const normalized = normalizeGeometry(geometry);
    if (!unit || !normalized) throw new Error('경계 편집 결과가 올바르지 않습니다.');
    return { ...clone(unit), geometry: normalized };
  }

  function areAdjacent(left, right) {
    if (!left?.geometry || !right?.geometry) return false;
    const leftKeys = boundaryKeys(left.geometry);
    let shared = 0;
    for (const key of boundaryKeys(right.geometry)) {
      if (!leftKeys.has(key)) continue;
      shared += 1;
      if (shared >= 2) return true;
    }
    return false;
  }

  function validatePartition(container, units) {
    if (!container?.geometry || !(units || []).length) return { ok: true, issues: [] };
    const issues = [];
    for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
      const outside = clipper.difference(units[leftIndex].geometry.coordinates, container.geometry.coordinates);
      if (multiArea(outside) > 1e-10) issues.push(`${units[leftIndex].id}이(가) 부모 영역 밖으로 벗어났습니다.`);
      for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
        const overlap = clipper.intersection(units[leftIndex].geometry.coordinates, units[rightIndex].geometry.coordinates);
        if (multiArea(overlap) > 1e-10) issues.push(`${units[leftIndex].id}와 ${units[rightIndex].id}가 겹칩니다.`);
      }
    }
    const covered = clipper.union(...units.map(unit => unit.geometry.coordinates));
    const remainder = clipper.difference(container.geometry.coordinates, covered);
    if (multiArea(remainder) > 1e-10) issues.push('분할 영역 사이에 빈틈이 있습니다.');
    return { ok: issues.length === 0, issues };
  }

  return Object.freeze({
    areAdjacent,
    editBoundary,
    mergeUnits,
    splitUnit,
    transferGeometry,
    validatePartition,
  });
}
