const clone = value => value == null ? value : structuredClone(value);

function polygonCoordinates(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function geometryFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  return { type: 'MultiPolygon', coordinates: clone(coordinates) };
}

function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

function pointOnSegment(point, a, b, epsilon = 1e-9) {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > epsilon) return false;
  return point[0] >= Math.min(a[0], b[0]) - epsilon && point[0] <= Math.max(a[0], b[0]) + epsilon
    && point[1] >= Math.min(a[1], b[1]) - epsilon && point[1] <= Math.max(a[1], b[1]) + epsilon;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    j = i;
  }
  return inside;
}

function pointInPolygonSet(point, polygon) {
  if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some(ring => pointInRing(point, ring));
}

function pointInGeometry(point, geometry) {
  return polygonCoordinates(geometry).some(polygon => pointInPolygonSet(point, polygon));
}

function segmentIntersectionParameter(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return [];
  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
  return [Math.max(0, Math.min(1, t))];
}

function boundaryParameters(a, b, geometry) {
  const parameters = [0, 1];
  for (const polygon of polygonCoordinates(geometry)) {
    for (const ring of polygon) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        parameters.push(...segmentIntersectionParameter(a, b, ring[index], ring[index + 1]));
      }
    }
  }
  return [...new Set(parameters.map(value => Number(value.toFixed(12))))].sort((left, right) => left - right);
}

function interpolate(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function sameCoordinate(a, b) {
  return !!a && !!b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function extractLineSections(lineGeometry, containerGeometry) {
  const sections = [];
  for (const line of lineParts(lineGeometry)) {
    let current = [];
    const flush = () => {
      const deduped = current.filter((point, index) => index === 0 || !sameCoordinate(point, current[index - 1]));
      if (deduped.length >= 2) sections.push({ type: 'LineString', coordinates: deduped });
      current = [];
    };
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index];
      const b = line[index + 1];
      const parameters = boundaryParameters(a, b, containerGeometry);
      let segmentAdded = false;
      for (let partIndex = 0; partIndex < parameters.length - 1; partIndex += 1) {
        const start = parameters[partIndex];
        const end = parameters[partIndex + 1];
        if (end - start < 1e-10) continue;
        const midpoint = interpolate(a, b, (start + end) / 2);
        if (!pointInGeometry(midpoint, containerGeometry)) {
          if (segmentAdded) flush();
          segmentAdded = false;
          continue;
        }
        const startPoint = interpolate(a, b, start);
        const endPoint = interpolate(a, b, end);
        if (!current.length) current.push(startPoint);
        else if (!sameCoordinate(current[current.length - 1], startPoint)) current.push(startPoint);
        current.push(endPoint);
        segmentAdded = true;
      }
      if (!segmentAdded && current.length) flush();
    }
    flush();
  }
  return sections;
}

export function planDrawnTerritoryAnnex({ drawnGeometry, donorFeatures = [], targetFeature = null, clipper } = {}) {
  if (!drawnGeometry || !clipper?.intersection || !clipper?.difference || !clipper?.union) return null;
  const donors = donorFeatures.filter(feature => polygonCoordinates(feature?.geometry).length);
  if (!donors.length || !targetFeature?.geometry) return null;
  const donorUnionCoordinates = clipper.union(...donors.map(feature => polygonCoordinates(feature.geometry)));
  let transferCoordinates = clipper.intersection(polygonCoordinates(drawnGeometry), donorUnionCoordinates);
  if (!transferCoordinates?.length) return null;
  transferCoordinates = clipper.difference(transferCoordinates, polygonCoordinates(targetFeature.geometry));
  const transferGeometry = geometryFromCoordinates(transferCoordinates);
  if (!transferGeometry) return null;
  const donorChanges = donors.map(feature => {
    const overlap = clipper.intersection(polygonCoordinates(feature.geometry), transferCoordinates);
    return { countryId: String(feature.properties?.editor_id || feature.id || ''), geometry: geometryFromCoordinates(overlap) };
  }).filter(item => item.geometry);
  return {
    transferGeometry,
    donorChanges,
    targetCountryId: String(targetFeature.properties?.editor_id || targetFeature.id || ''),
  };
}

export function extractRiverAnnexSections(riverGeometry, donorFeatures = []) {
  const sections = [];
  for (const donor of donorFeatures) {
    for (const section of extractLineSections(riverGeometry, donor.geometry)) {
      sections.push({ ...section, donorCountryId: String(donor.properties?.editor_id || donor.id || '') });
    }
  }
  return sections;
}

export { lineParts };
