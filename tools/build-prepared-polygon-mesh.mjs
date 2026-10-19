import { createHash } from 'node:crypto';
import { sharedSourceManifest } from './package-shared-core-assets.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import '../assets/js/workers/gpu-mesh-core.js';
import { encodePolygonMesh, POLYGON_MESH_FORMAT_VERSION } from '../assets/js/modules/polygon-mesh-codec.js';
import './load-spherical-core.mjs';
import '../assets/js/vendor/polygon-clipping.min.js';
import { createGeometryVersionStore } from '../assets/js/modules/geometry-version-store.js';
import { resolveWorld } from '../assets/js/modules/timeline-resolver.js';
import { createTerritorialScopeResolver } from '../assets/js/modules/territorial-scope.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = 'assets/data/prepared-polygons/generated/v2';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(file.endsWith('.gz') ? gunzipSync(readFileSync(resolve(root, file))) : readFileSync(resolve(root, file), 'utf8'));
const geometries = new Map(), inputHashes = {};
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (['Polygon', 'MultiPolygon'].includes(value.type) && Array.isArray(value.coordinates)) {
    const digest = sha256(JSON.stringify([value.type, value.coordinates]));
    geometries.set(digest, value);
    return;
  }
  Object.values(value).forEach(collect);
}
function source(file) {
  if (inputHashes[file]) return;
  inputHashes[file] = sha256(readFileSync(resolve(root, file))); collect(readJson(file));
}
const historical = readJson('assets/data/historical-world/generated/v1/manifest.json');
source(historical.project.url);
source('assets/data/territorial-entities/generated/current-world.geojson');
source('assets/data/physical-land/v1/geometry.json.gz');
const index = readJson('assets/data/territorial-entities/generated/v2/index.json');
for (const entity of index.entities) source(`assets/data/territorial-entities/generated/v2/${entity.file}`);
// Derived parent display extents use the same resolver and C++ normalization as
// the application. Visit only timeline change months, reusing unchanged scopes.
const project = readJson(historical.project.url), archive = createGeometryVersionStore(project.geometries);
const months = new Set([historical.sourceMonth]);
for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) for (const row of project.timelineRecords[name]) {
  for (const value of [row.validFrom, row.validTo]) if (value) {
    const date = String(value), year = Number(date.slice(0, 4));
    const month = date.length >= 7 ? Number(date.slice(5, 7)) : date === String(row.validFrom) ? 1 : 12;
    for (const offset of [-1, 0, 1]) {
      const ordinal = year * 12 + month - 1 + offset;
      months.add(`${Math.floor(ordinal / 12)}-${String(ordinal % 12 + 1).padStart(2, '0')}`);
    }
  }
}
let world, features = [], byId = new Map();
const precisionDiscards = [];
const scopes = createTerritorialScopeResolver({ clipper: () => globalThis.polygonClipping,
  entityRepository: { list: () => features, get: id => byId.get(id), descendants: id => world.entities
    .filter(row => row.identity.properties.entityKind === 'general' && row.ancestors.includes(id)).map(row => byId.get(row.id)) } });
for (const month of [...months].sort()) {
  world = resolveWorld(project.territorialEntities, project.timelineRecords, archive, month);
  features = world.entities.map(row => ({ ...row.identity, geometry: row.geometry,
    properties: { ...row.identity.properties, parentId: row.parentId } }));
  byId = new Map(features.map(feature => [feature.id, feature]));
  for (const id of new Set(world.entities.filter(row => row.identity.properties.entityKind === 'general' && row.parentId).map(row => row.parentId))) {
    try {
      const scope = scopes.scope(id); collect(scope.extent?.geometry); collect(scope.extra?.geometry);
      if (scope.precisionDiscards.length) precisionDiscards.push({ id, month, discards: scope.precisionDiscards });
    } catch (error) { throw new Error(`Fixed display scope ${id} at ${month}: ${error.message}`, { cause: error }); }
  }
}
const engine = globalThis.PandoLabGpuMeshCore;
const meshes = {};
let count = 0, bytes = 0;
for (const [digest, geometry] of [...geometries].sort(([a], [b]) => a.localeCompare(b))) {
  const packet = engine.buildPolygonGeometryPacket(geometry);
  const encoded = Buffer.from(encodePolygonMesh(packet));
  const compressed = gzipSync(encoded, { level: 9, mtime: 0 });
  // The payload is identical across hosts; pin the gzip OS byte too so the
  // published content hashes do not change when generated on Windows.
  compressed[9] = 3;
  const hash = sha256(compressed), url = `${destination}/polygon-mesh-sha256-${hash}.bin.gz`;
  mkdirSync(dirname(resolve(root, url)), { recursive: true }); writeFileSync(resolve(root, url), compressed);
  meshes[digest] = { url, sha256: hash, encoding: 'gzip', compressedBytes: compressed.length, decodedBytes: encoded.length };
  bytes += compressed.length; count++;
  if (count % 25 === 0) console.log(`Prepared ${count}/${geometries.size} fixed polygon meshes`);
}
const algorithmSourceSha256 = sharedSourceManifest(root).sourceSha256;
const manifest = { schema: 'pandolab-prepared-polygon-meshes', schemaVersion: 2,
  meshFormatVersion: POLYGON_MESH_FORMAT_VERSION,
  algorithmVersion: engine.MESH_ALGORITHM_REVISION, algorithmSourceSha256,
  maxEdgeDegrees: engine.MAX_RENDER_EDGE_DEGREES, inputHashes, precisionDiscards, meshes };
writeFileSync(resolve(root, `${destination}/manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${count} fixed polygon meshes (${bytes} compressed bytes).`);
