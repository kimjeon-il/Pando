import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { buildRiverTerritoryPartitions, createRiverPartitionWorkspace } from '../../assets/js/modules/river-territory-partition.js';
import '../../assets/js/vendor/polygon-clipping.min.js';

const root = new URL('../../', import.meta.url);
const read = relative => fs.readFileSync(new URL(relative, root));
const collection = JSON.parse(read('assets/data/countries-ne-5.1.1.geojson'));
const serbia = collection.features.find(feature => feature.id === 'SRB');
const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

function loadSerbiaRivers() {
  const base = 'assets/data/hydro/v0.13.0/';
  const manifest = JSON.parse(read(`${base}manifest.json`));
  // Execute the production decoder, without network, cache or Worker startup.
  const context = vm.createContext({ TextDecoder, URL, performance, structuredClone, inputManifest: manifest });
  context.self = context;
  context.onmessage = null;
  context.importScripts = () => {};
  for (const file of ['vendor/earcut.min.js', 'workers/geographic-boundary-core.js', 'workers/hydro-tile-worker.js']) {
    vm.runInContext(read(`assets/js/${file}`).toString(), context);
  }
  vm.runInContext('manifest = inputManifest', context);
  const decoder = vm.runInContext('({ readGlobalIndex, readFeatureMetadata, readPack, mergeLogicalFragments, logicalPacks, packSpecs, featureMetadata })', context);
  decoder.readGlobalIndex(gunzipSync(read(base + manifest.index.url)));
  decoder.readFeatureMetadata(gunzipSync(read(base + manifest.metadata.core.url)));
  const bounds = polygons(serbia.geometry).flat(2).reduce((b, p) => [
    Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1]),
  ], [180, 90, -180, -90]);
  const ids = new Set([...decoder.featureMetadata.values()].filter(row => row.category === 'river'
    && row.bounds[0] / 1e6 <= bounds[2] && row.bounds[2] / 1e6 >= bounds[0]
    && row.bounds[1] / 1e6 <= bounds[3] && row.bounds[3] / 1e6 >= bounds[1]).map(row => row.logicalFid));
  const packs = new Set([...ids].flatMap(id => decoder.logicalPacks.get(id) || []));
  const shards = new Map();
  const features = [];
  for (const id of packs) {
    const spec = decoder.packSpecs.get(id);
    if (!shards.has(spec.shard)) {
      shards.set(spec.shard, read(base + manifest.shards.find(shard => Number(shard.id) === spec.shard).url));
    }
    const bytes = shards.get(spec.shard).subarray(spec.offset, spec.offset + spec.length);
    features.push(...decoder.readPack(gunzipSync(bytes), id).features);
  }
  return structuredClone([...ids].map(id => decoder.mergeLogicalFragments(features.filter(feature => feature.properties.__logicalFid === id))).filter(Boolean));
}

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

test('production Serbia rivers separate three northern cells from the southern mainland', () => {
  const rivers = loadSerbiaRivers();
  const donors = [{ countryId: 'SRB', geometry: serbia.geometry, geometryRevision: 1 }];
  const before = structuredClone({ donors, rivers });
  const clipper = globalThis.polygonClipping;
  const result = buildRiverTerritoryPartitions({ donors, riverFeatures: rivers, clipper });
  assert.equal(result.donorResults[0].status, 'ready');
  // River-defined northern cells, not a substituted administrative boundary.
  const samples = [[19.6, 45.7], [20.7, 45.5], [19.8, 45.0], [20.8, 44.3]];
  const cells = samples.map(point => {
    const matches = result.candidates.filter(candidate => polygons(candidate.geometry).some(rings => insideRing(point, rings[0])
      && !rings.slice(1).some(ring => insideRing(point, ring))));
    assert.equal(matches.length, 1, `unique cell at ${point}`);
    return matches[0];
  });
  assert.equal(new Set(cells.map(cell => cell.key)).size, 4);
  for (const [index, expectedKm2] of [9022, 9036, 4228].entries()) {
    assert.ok(Math.abs(cells[index].areaM2 / 1e6 - expectedKm2) < 2);
  }
  const workspace = createRiverPartitionWorkspace(polygons(serbia.geometry)[0]);
  const area = multi => multi.reduce((total, rings) => total + rings.reduce((sum, ring, index) => {
    const points = ring.map(workspace.toMeters);
    let value = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) value += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    return sum + (index ? -1 : 1) * Math.abs(value / 2);
  }, 0), 0);
  const geometries = result.candidates.map(candidate => polygons(candidate.geometry));
  const coverage = clipper.union(...geometries);
  assert.ok(area(clipper.difference(polygons(serbia.geometry), coverage)) <= 1000);
  assert.ok(area(clipper.difference(coverage, polygons(serbia.geometry))) <= 1000);
  for (let i = 0; i < geometries.length; i++) for (let j = i + 1; j < geometries.length; j++) {
    assert.ok(area(clipper.intersection(geometries[i], geometries[j])) <= 1);
  }
  const reordered = buildRiverTerritoryPartitions({ donors, riverFeatures: [...rivers].reverse(), clipper });
  assert.deepEqual(reordered.candidates.map(candidate => candidate.key), result.candidates.map(candidate => candidate.key));
  assert.deepEqual({ donors, rivers }, before);
});
