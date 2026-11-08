// This is a disposable presentation copy. Canonical coordinates stay owned by
// the document; only the new flat buffer crosses the mesh Worker boundary.
export async function packCountryMeshFeatures(features, { isCurrent = () => true,
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const rows = []; let count = 0;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry && !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new TypeError('Country mesh requires polygon geometry');
    const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    rows.push({ id: feature.id, type: geometry?.type || null, rings: polygons.map(polygon => polygon.map(ring => {
      count += ring.length; return ring.length;
    })) });
  }
  const coordinates = new Float64Array(count * 2); let offset = 0, batch = 0;
  for (const feature of features) {
    const geometry = feature.geometry;
    const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) for (const point of ring) {
      if (point.length !== 2) throw new TypeError('Country mesh coordinates must be two dimensional');
      coordinates[offset++] = point[0]; coordinates[offset++] = point[1];
      if (++batch >= 8192) {
        batch = 0; await yieldTask();
        if (!isCurrent()) throw Object.assign(new Error('Obsolete mesh transfer'), { name: 'AbortError' });
      }
    }
  }
  if (!isCurrent()) throw Object.assign(new Error('Obsolete mesh transfer'), { name: 'AbortError' });
  return { rows, coordinates };
}

export function unpackCountryMeshFeatures({ rows, coordinates }) {
  let offset = 0;
  const features = rows.map(row => {
    const polygons = row.rings.map(polygon => polygon.map(length => Array.from({ length }, () => [coordinates[offset++], coordinates[offset++]])));
    return { id: row.id, geometry: row.type ? { type: row.type, coordinates: row.type === 'Polygon' ? polygons[0] : polygons } : null };
  });
  if (offset !== coordinates.length) throw new TypeError('Invalid country mesh coordinate transfer');
  return features;
}
