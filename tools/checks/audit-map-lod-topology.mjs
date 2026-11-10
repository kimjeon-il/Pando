/**
 * Read-only, topology-only P1 audit of the selected current-world geometry.
 * This is NOT the repository's full GIS validator or test suite. It never
 * rewrites canonical source or derives historical versions.
 *
 * node tools/checks/audit-map-lod-topology.mjs --country-ids=KOR,PRK,CHN
 * node tools/checks/audit-map-lod-topology.mjs --world-current
 * Optional: --source=<GeoJSON> --physical-land=<GeoJSON or .json.gz>
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const normal = value => Math.round(Number(value) * 1e7);
const pointKey = point => `${normal(point[0])},${normal(point[1])}`;
const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const polygonsFor = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const geometryFor = row => row?.type === 'Feature' ? row.geometry : row?.geometry || row;
function geometryRows(payload) {
  if (payload?.type === 'FeatureCollection') return payload.features;
  if (payload?.type === 'Polygon' || payload?.type === 'MultiPolygon') return [payload];
  if (payload?.type === 'Feature') return [payload];
  if (Array.isArray(payload?.features)) return payload.features;
  if (Array.isArray(payload?.geometries)) return payload.geometries.map(geometryFor);
  const geometry = geometryFor(payload);
  if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') return [geometry];
  throw new TypeError('Topology audit input is not a GeoJSON collection or polygon geometry.');
}

export function inspectMapLodTopology(features, { physicalLand = null, maxIssues = 60 } = {}) {
  if (!Array.isArray(features) || !features.length) throw new TypeError('Topology audit requires a source feature list.');
  const report = { featureCount: features.length, polygonCount: 0, ringCount: 0,
    vertexCount: 0, edgeCount: 0, sharedEdges: 0, coastCandidateEdges: 0,
    holeRingCount: 0, datelineRings: 0, invalidRings: 0,
    repeatedEdges: 0, nonManifoldEdges: 0, sharedWindingConflicts: 0,
    exactPhysicalCoastEdges: null, physicalCoastCandidates: null,
    issues: [], complete: true };
  const issues = (code, context) => {
    if (report.issues.length < maxIssues) report.issues.push({ code, ...context });
    else report.complete = false;
  };
  const edges = new Map(), seenCountries = new Set();
  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    const feature = features[featureIndex], id = String(feature?.id ?? featureIndex);
    if (seenCountries.has(id)) issues('duplicate-country-id', { id });
    seenCountries.add(id);
    const geometry = geometryFor(feature);
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
      issues('non-polygon-geometry', { id });
      report.invalidRings++;
      continue;
    }
    for (const [polygonIndex, polygon] of polygonsFor(geometry).entries()) {
      report.polygonCount++;
      for (const [ringIndex, ring] of polygon.entries()) {
        report.ringCount++;
        if (ringIndex) report.holeRingCount++;
        if (!Array.isArray(ring) || ring.length < 4
          || ring.some(point => !Array.isArray(point) || point.length < 2
            || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
          report.invalidRings++; issues('invalid-ring', { id, polygonIndex, ringIndex });
          continue;
        }
        const keys = ring.map(pointKey);
        if (keys[0] !== keys.at(-1)) {
          report.invalidRings++; issues('unclosed-ring', { id, polygonIndex, ringIndex });
          continue;
        }
        if (ring.some((point, i) => i && Math.abs(point[0] - ring[i - 1][0]) > 180))
          report.datelineRings++;
        report.vertexCount += ring.length - 1;
        for (let i = 0; i < ring.length - 1; i++) {
          const a = keys[i], b = keys[i + 1];
          if (a === b) {
            report.invalidRings++; issues('zero-length-edge', { id, polygonIndex, ringIndex, vertex: i });
            continue;
          }
          const key = edgeKey(a, b), row = edges.get(key) || { owners: new Map(), occurrences: 0 };
          row.occurrences++;
          const forward = a < b;
          const previous = row.owners.get(id);
          if (previous !== undefined) {
            report.repeatedEdges++;
            issues('repeated-edge-in-country', { id, polygonIndex, ringIndex, vertex: i });
          }
          row.owners.set(id, forward);
          edges.set(key, row);
        }
      }
    }
  }
  report.edgeCount = edges.size;
  for (const [edge, row] of edges) {
    if (row.owners.size === 1) {
      report.coastCandidateEdges++;
      continue;
    }
    if (row.owners.size > 2) {
      report.nonManifoldEdges++;
      issues('nonmanifold-edge', { edge, owners: [...row.owners.keys()].slice(0, 8) });
      continue;
    }
    report.sharedEdges++;
    if (new Set(row.owners.values()).size !== 2) {
      report.sharedWindingConflicts++;
      issues('shared-winding-conflict', { edge, owners: [...row.owners.keys()] });
    }
  }
  // The physical-land mask is authoritative for coastal coverage, but it is
  // NOT required to use the same tessellation as country borders. Therefore
  // equality of undirected source edges is diagnostic, never a blanket fail.
  if (physicalLand) {
    const physicalEdges = new Set();
    for (const row of geometryRows(physicalLand))
      for (const polygon of polygonsFor(geometryFor(row))) for (const ring of polygon) {
        if (!Array.isArray(ring)) continue;
        for (let i = 1; i < ring.length; i++) {
          const a = pointKey(ring[i - 1]), b = pointKey(ring[i]);
          if (a !== b) physicalEdges.add(edgeKey(a, b));
        }
      }
    report.physicalCoastCandidates = physicalEdges.size;
    let matches = 0;
    for (const [key, edge] of edges)
      if (edge.owners.size === 1 && physicalEdges.has(key)) matches++;
    report.exactPhysicalCoastEdges = matches;
  }
  report.valid = report.invalidRings === 0 && report.repeatedEdges === 0
    && report.nonManifoldEdges === 0 && report.sharedWindingConflicts === 0
    && !report.issues.some(issue => issue.code === 'duplicate-country-id'
      || issue.code === 'non-polygon-geometry');
  report.scope = 'current world source: closed rings / edge incidence / physical-coast exact-edge diagnostic';
  report.notAssessed = ['nonmatching Coastline segments may have different tessellation',
    'polygon interior overlaps or containment', 'historical geometry not in selected source',
    'coast positional error / third-party source accuracy', 'tiny unindexed T-junctions'];
  return report;
}

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const option = key => process.argv.find(value => value.startsWith('--' + key + '='))?.slice(key.length + 3);
  const source = path.resolve(ROOT, option('source') || 'assets/data/territorial-entities/generated/current-world.geojson');
  const world = process.argv.includes('--world-current'), focus = option('country-ids');
  if (!world && !focus)
    throw new Error('Topology scope required: --country-ids=KOR,PRK or --world-current');
  if (world && focus) throw new Error('Choose one topology scope.');
  const collection = readJson(source), input = geometryRows(collection);
  const targets = focus
    ? new Set(focus.split(',').map(value => value.trim()).filter(Boolean))
    : null;
  const selected = targets ? input.filter(feature => targets.has(String(feature.id))) : input;
  if (targets?.size !== selected.length)
    throw new Error('Requested country IDs are not all in the selected source.');
  const landPath = option('physical-land');
  const report = inspectMapLodTopology(selected, {
    physicalLand: landPath ? readJson(path.resolve(ROOT, landPath)) : null,
  });
  console.log(JSON.stringify({
    source: path.relative(ROOT, source), explicitCountryScope: [...targets || []],
    physicalLandSource: landPath || null, ...report,
  }, null, 2));
  if (!report.valid || !report.complete) process.exitCode = 1;
}
