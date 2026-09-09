/** CountryValidation: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCountryValidation() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('country-validation already connected');
    dependencies = ports;
  }

  function unwrapRingLongitudes(rawRing) {
    const ring = (0, dependencies.ensureClosedRing)(rawRing);
    if (!ring.length) return [];
    const out = [[ring[0][0], ring[0][1]]];
    for (let i = 1; i < ring.length; i += 1) {
      let lon = ring[i][0];
      const previous = out[i - 1][0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      out.push([lon, ring[i][1]]);
    }
    return out;
  }

  function orientation2d(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  function segmentsProperlyIntersect(a, b, c, d, epsilon = 1e-10) {
    const abC = orientation2d(a, b, c);
    const abD = orientation2d(a, b, d);
    const cdA = orientation2d(c, d, a);
    const cdB = orientation2d(c, d, b);
    return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
  }

  function ringHasSelfIntersection(rawRing) {
    const ring = unwrapRingLongitudes(rawRing);
    const segmentCount = Math.max(0, ring.length - 1);
    if (segmentCount < 4) return false;
    const segments = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const a = ring[index], b = ring[index + 1];
      segments.push({
        index, a, b,
        minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]),
      });
    }
    segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY || a.index - b.index);
    let active = [];
    for (const segment of segments) {
      active = active.filter(other => other.maxX >= segment.minX);
      for (const other of active) {
        if (Math.abs(segment.index - other.index) <= 1 ||
            (Math.min(segment.index, other.index) === 0 && Math.max(segment.index, other.index) === segmentCount - 1)) continue;
        if (other.maxY < segment.minY || other.minY > segment.maxY) continue;
        if (segmentsProperlyIntersect(segment.a, segment.b, other.a, other.b)) return true;
      }
      active.push(segment);
    }
    return false;
  }

  function countryGeometryIsValid(geometry) {
    const polygons = (0, dependencies.geometryMultiCoordinates)(geometry);
    if (!polygons.length) return false;
    return polygons.every(polygon => polygon?.length && polygon.every(ring => {
      const closed = (0, dependencies.ensureClosedRing)(ring);
      const unique = new Set(closed.slice(0, -1).map(coord => (0, dependencies.coordKey)(coord, 8)));
      return closed.length >= 4 && unique.size >= 3 &&
        (0, dependencies.coordNear)(closed[0], closed[closed.length - 1], 1e-9) &&
        Math.abs((0, dependencies.ringSignedArea)(closed)) > 1e-14 &&
        !ringHasSelfIntersection(closed);
    }));
  }

  function snapGeometryToGrid(geometry, precision = 7) {
    if (!geometry?.coordinates) return geometry;
    const factor = 10 ** precision;
    const snap = value => {
      if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        return [Math.round(Number(value[0]) * factor) / factor, Math.round(Number(value[1]) * factor) / factor];
      }
      return Array.isArray(value) ? value.map(snap) : value;
    };
    return { ...geometry, coordinates: snap(geometry.coordinates) };
  }

  function validateCountryGeometryEdit(affectedIds, baselineOrUnion = null, { featureOverrides = null } = {}) {
    const clipper = window.polygonClipping;
    const affected = new Set([...affectedIds].map(String));
    const baseline = baselineOrUnion?.union
      ? baselineOrUnion
      : { union: baselineOrUnion, overlaps: new Map(), boundaryLength: 0 };
    const areaTolerance = Math.max(1e-8, Number(baseline.boundaryLength || 0) * 2e-7);
    const overrideMap = featureOverrides instanceof Map ? featureOverrides : new Map();
    const features = (dependencies.state.countriesData?.features || []).map(feature => (
      overrideMap.get(String(feature?.id || '')) || feature
    ));
    const ids = features.map(feature => String(feature?.id || ''));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      return { ok: false, message: '국가 ID가 비어 있거나 중복되었습니다.' };
    }
    for (const feature of features) {
      const id = String(feature?.id || '');
      if (affected.has(id) && !countryGeometryIsValid(feature.geometry)) {
        return { ok: false, message: `${(0, dependencies.countryName)(feature)}의 경계가 유효하지 않습니다.` };
      }
    }

    const tested = new Set();
    for (const feature of features) {
      const id = String(feature?.id || '');
      if (!affected.has(id)) continue;
      const bounds = (0, dependencies.geometryBounds)(feature.geometry);
      const nearby = overrideMap.size
        ? features.filter(other => (0, dependencies.boundsOverlap)(bounds, (0, dependencies.geometryBounds)(other.geometry)))
        : (0, dependencies.spatialFeatures)(bounds);
      for (const other of nearby) {
        const otherId = String(other?.id || '');
        if (id === otherId) continue;
        const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);
        const overlapArea = (0, dependencies.multiPolygonPlanarArea)(clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates));
        const previousArea = Number(baseline.overlaps?.get(pairKey) || 0);
        if (overlapArea > previousArea + areaTolerance) {
          return { ok: false, message: `${(0, dependencies.countryName)(feature)}과(와) ${(0, dependencies.countryName)(other)} 사이에 ${(overlapArea - previousArea).toExponential(3)}deg²의 새 중첩이 생겼습니다. 편입 영역을 줄이거나 국경선을 다시 지정하세요.` };
        }
      }
    }

    if (baseline.union) {
      const unionAfter = (0, dependencies.countryUnionFromFeatures)(features, affected);
      const changedArea = (0, dependencies.multiPolygonPlanarArea)(clipper.xor(baseline.union, unionAfter));
      if (changedArea > areaTolerance) return { ok: false, message: `편집 영역에 ${changedArea.toExponential(3)}deg²의 새 빈틈 또는 면적 변화가 생겼습니다. 편입선을 다시 지정하세요.` };
    }
    return { ok: true };
  }

  function captureCountryGeometryValidationBaseline(affectedIds) {
    const ids = new Set([...affectedIds].map(String));
    const features = dependencies.state.countriesData?.features || [];
    const clipper = window.polygonClipping;
    const overlaps = new Map();
    let boundaryLength = 0;
    for (const feature of features) {
      const id = String(feature?.id || '');
      if (!ids.has(id)) continue;
      for (const polygon of (0, dependencies.geometryPolygonSets)(feature.geometry)) for (const ring of polygon || []) {
        for (let index = 0; index < ring.length - 1; index += 1) boundaryLength += Math.hypot(ring[index + 1][0] - ring[index][0], ring[index + 1][1] - ring[index][1]);
      }
      for (const other of (0, dependencies.spatialFeatures)((0, dependencies.geometryBounds)(feature.geometry))) {
        const otherId = String(other?.id || '');
        if (!otherId || otherId === id) continue;
        const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
        if (overlaps.has(pairKey)) continue;
        overlaps.set(pairKey, (0, dependencies.multiPolygonPlanarArea)(clipper.intersection(feature.geometry.coordinates, other.geometry.coordinates)));
      }
    }
    return { union: (0, dependencies.countryUnionFromFeatures)(features, ids), overlaps, boundaryLength };
  }

  function structuredGeometryIssueKey(issue = {}) {
    const entityRefs = [...(issue.entityRefs || [])].map(String).sort().join('|');
    return [
      issue.kind || 'geometry',
      entityRefs,
      issue.polygonIndex ?? '',
      issue.ringIndex ?? '',
      issue.vertexIndex ?? '',
      issue.segmentIndex ?? '',
    ].join(':');
  }

  function restoreCountryEditSnapshot(snapshot) {
    const changedIds = new Set(dependencies.state.historyDirtyCountryIds);
    (0, dependencies.applySharedProjectFields)(snapshot, 'history');
    (0, dependencies.restoreCountriesFromSnapshot)(snapshot);
    (0, dependencies.normalizeProjectObjects)();
    const restoredDirtyIds = new Set(dependencies.state.historyDirtyCountryIds);
    for (const id of dependencies.state.historyDirtyCountryIds) changedIds.add(String(id));
    (0, dependencies.markCountryGeometriesChanged)(changedIds);
    dependencies.state.historyDirtyCountryIds = restoredDirtyIds;
    (0, dependencies.rebuildBoundaryTopology)(dependencies.state.tool === 'country-border' ? dependencies.state.boundaryEditCountryIds : dependencies.state.coastEditCountryId);
    dependencies.renderingDomain?.invalidateCountryPatch?.('country-edit-snapshot-restored');
  }

  function interpolateCoordinate(a, b, t) {
    let targetLon = b[0];
    while (targetLon - a[0] > 180) targetLon -= 360;
    while (targetLon - a[0] < -180) targetLon += 360;
    let lon = a[0] + (targetLon - a[0]) * t;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return [lon, a[1] + (b[1] - a[1]) * t];
  }

  function refreshCountryCentroids(ids = null) {
    const filter = ids ? new Set([...ids].map(String)) : null;
    (0, dependencies.scheduleCountryLabelAnchors)(filter, 20);
  }



  return Object.freeze({
    connect,

    get captureCountryGeometryValidationBaseline() { return captureCountryGeometryValidationBaseline; },
    get interpolateCoordinate() { return interpolateCoordinate; },
    get refreshCountryCentroids() { return refreshCountryCentroids; },
    get restoreCountryEditSnapshot() { return restoreCountryEditSnapshot; },
    get ringHasSelfIntersection() { return ringHasSelfIntersection; },
    get segmentsProperlyIntersect() { return segmentsProperlyIntersect; },
    get snapGeometryToGrid() { return snapGeometryToGrid; },
    get structuredGeometryIssueKey() { return structuredGeometryIssueKey; },
    get validateCountryGeometryEdit() { return validateCountryGeometryEdit; },
  });
}
