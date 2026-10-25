/** Read-only spatial comparison of pinned HydroRIVERS mainstems with independently surveyed USGS stations.
 * Government point locations are not proof of the full river name or geometry.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATIONS = Object.freeze([
  ['Brazos', 'USGS-08116650', -95.58246348462062, 29.349686143162536, 'https://waterdata.usgs.gov/monitoring-location/USGS-08116650'],
  ['Brazos', 'USGS-08114000', -95.7577275325698, 29.5824589022502, 'https://waterdata.usgs.gov/monitoring-location/USGS-08114000'],
  ['Brazos', 'USGS-08117300', -95.3816077936518, 28.8980278072396, 'https://waterdata.usgs.gov/monitoring-location/USGS-08117300/'],
  ['Colorado-Texas', 'USGS-08162500', -96.0124587726231, 28.9741462100881, 'https://waterdata.usgs.gov/monitoring-location/USGS-08162500/'],
  ['Colorado-Texas', 'USGS-08162504', -95.9755182378249, 28.6872113055232, 'https://waterdata.usgs.gov/monitoring-location/USGS-08162504/'],
  ['Colorado-Texas', 'USGS-08162501', -95.9975, 28.7741666666667, 'https://waterdata.usgs.gov/monitoring-location/USGS-08162501/'],
]);
export const SYSTEMS = Object.freeze({ '70816878': 'Brazos', '70819626': 'Colorado-Texas' });
export function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}
export function lineDistanceKm(lon, lat, segments) {
  const xScale = 111.195 * Math.cos(lat * Math.PI / 180), yScale = 111.195;
  let best = Infinity;
  for (const segment of segments) {
    if (!segment.length) continue;
    const points = segment.map(([x, y]) => [(Number(x) - lon) * xScale,
      (Number(y) - lat) * yScale]);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
      const ratio = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * ratio, ay + dy * ratio));
    }
    if (points.length === 1) best = Math.min(best, Math.hypot(...points[0]));
  }
  return best;
}
const round3 = value => Math.round(value * 1000) / 1000;
export function compareOfficialUsgsGauges(decoded) {
  if (!Array.isArray(decoded?.features)) throw Error('Missing published Hydro features');
  const geometries = {};
  for (const ident of Object.keys(SYSTEMS)) {
    const rows = decoded.features.filter(item =>
      String(item.metadata?.systemId || '') === ident && item.metadata?.role === 'mainstem');
    if (!rows.length) throw Error('Published mainstem missing: ' + ident);
    geometries[ident] = rows.flatMap(row => lineParts(row.geometry));
    if (!geometries[ident].some(line => line.length)) throw Error('Empty published mainstem: ' + ident);
  }
  const stationRows = STATIONS.map(([watercourse, station, lon, lat, url]) => {
    const distances = Object.fromEntries(Object.entries(geometries).map(([ident, lines]) => {
      const distance = lineDistanceKm(lon, lat, lines);
      if (!Number.isFinite(distance)) throw Error('Invalid Hydro mainstem distance: ' + ident);
      return [ident, round3(distance)];
    }));
    return { station, independentHydrography: watercourse, lon, lat, url,
      distancesToHydroMainstemKm: distances };
  });
  const candidateSystems = {};
  for (const [ident, name] of Object.entries(SYSTEMS)) {
    const matched = stationRows.filter(row => row.independentHydrography === name)
      .map(row => row.distancesToHydroMainstemKm[ident]);
    const other = stationRows.filter(row => row.independentHydrography !== name)
      .map(row => row.distancesToHydroMainstemKm[ident]);
    candidateSystems[ident] = { candidateName: name,
      matchedIndependentStations: matched.filter(value => value <= 12).length,
      maxMatchingStationDistanceKm: Math.max(...matched),
      nearestDifferentBasinStationKm: Math.min(...other),
      criteriaSatisfied: matched.filter(value => value <= 12).length >= 2 && Math.min(...other) >= 20 };
  }
  return { schema: 'pando-hydro-usgs-official-stations-v1',
    referenceNote: 'USGS WGS84 station coordinates independently measured or map-derived; HydroRIVERS display centerline is generalized.',
    stationRows, candidateSystems };
}
export function runUsgsAudit(args = process.argv.slice(2)) {
  if (args.length !== 4 || args[0] !== '--decoded' || args[2] !== '--output')
    throw Error('Usage: --decoded READ_ONLY_DECODED_JSON --output NEW_REPORT_JSON');
  const input = resolve(args[1]), output = resolve(args[3]);
  if (input === output) throw Error('Refusing to overwrite source Hydro geometry');
  const decoded = JSON.parse(readFileSync(input, 'utf8'));
  const result = compareOfficialUsgsGauges(decoded);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log('USGS_HYDRO_PROOF=' + JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runUsgsAudit(); } catch (error) {
    console.error('usgs-hydro: ' + error.message); process.exitCode = 1;
  }
}
