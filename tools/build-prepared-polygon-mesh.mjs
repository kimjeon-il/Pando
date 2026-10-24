import { writeLibraryOutput } from './library-data.mjs';
import { createHash } from 'node:crypto';
import { sharedSourceManifest } from './package-shared-core-assets.mjs';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import '../assets/js/workers/gpu-mesh-core.js';
import { encodePolygonMesh, POLYGON_MESH_FORMAT_VERSION } from '../assets/js/modules/polygon-mesh-codec.js';
import './load-spherical-core.mjs';
import '../assets/js/vendor/polygon-clipping.min.js';
import { createGeometryVersionStore } from '../assets/js/modules/geometry-version-store.js';
import {temporalContains,temporalMonthEnd,shiftTemporalMonth} from '../assets/js/modules/temporal.js';
import { resolveWorld } from '../assets/js/modules/timeline-resolver.js';
import { createTerritorialScopeResolver } from '../assets/js/modules/territorial-scope.js';
import {assembleBuiltinWorld,selectBuiltinCountries} from '../assets/js/modules/builtin-world-loader.js';

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
const indexPath='assets/data/builtin-world/generated/v1/index.json';
const index=readJson(indexPath);source(indexPath);
const countries=index.entities.map(entry=>{
 const file='assets/data/builtin-world/generated/v1/'+entry.file;source(file);return readJson(file);
});
source('assets/data/territorial-entities/generated/current-world.geojson');
source('assets/data/physical-land/v1/geometry.json.gz');
const sourceIndex=readJson('assets/data/territorial-entities/generated/v2/index.json');
for(const entity of sourceIndex.entities)source(`assets/data/territorial-entities/generated/v2/${entity.file}`);
const months=new Set();
for(const country of countries)for(const rows of Object.values(country.modes))for(const row of [...rows.geometryBindings,...rows.parentRelations])
 for(const value of [row.validFrom,row.validTo])if(value)for(const offset of [-1,0,1])months.add(shiftTemporalMonth(value.slice(0,-3),offset));
const precisionDiscards=[],seenScopes=new Set();
for(const month of [...months].sort())for(const currentMonth of [null,month]){
 const mode=currentMonth===null?'dated':'current',wanted=selectBuiltinCountries(index,month,currentMonth),ids=new Set(wanted.map(row=>row.entityId));
 const active=countries.filter(row=>ids.has(row.entityId));
 const relation=country=>country.modes[mode].parentRelations.find(row=>temporalContains(row,temporalMonthEnd(month)));
 const needed=new Set();
 for(const country of active){const row=relation(country);if(row?.parentId){needed.add(country.entityId);needed.add(row.parentId);}}
 let expanded=true;
 while(expanded){expanded=false;for(const country of active)if(needed.has(country.entityId)){
  const parent=relation(country)?.parentId;if(parent&&!needed.has(parent)){needed.add(parent);expanded=true;}
 }}
 if(!needed.size)continue;
 const selected=active.filter(country=>needed.has(country.entityId));
 const signature=JSON.stringify(selected.map(country=>[country.entityId,relation(country)?.parentId,
  country.modes[mode].geometryBindings.find(row=>temporalContains(row,temporalMonthEnd(month)))?.geometryRef]));
 if(seenScopes.has(signature))continue;seenScopes.add(signature);
 const project=assembleBuiltinWorld({...index,entities:wanted.filter(row=>needed.has(row.entityId))},selected,month,currentMonth);
 const archive=createGeometryVersionStore(project.geometries),world=resolveWorld(project.territorialEntities,project.timelineRecords,archive,month);
 const features=world.entities.map(row=>({...row.identity,geometry:row.geometry,properties:{...row.identity.properties,parentId:row.parentId}}));
 const byId=new Map(features.map(feature=>[feature.id,feature]));
 const scopes=createTerritorialScopeResolver({clipper:()=>globalThis.polygonClipping,
  entityRepository:{list:()=>features,get:id=>byId.get(id),descendants:id=>world.entities.filter(row=>row.identity.properties.entityKind==='general'&&row.ancestors.includes(id)).map(row=>byId.get(row.id))}});
 for(const id of new Set(world.entities.filter(row=>row.identity.properties.entityKind==='general'&&row.parentId).map(row=>row.parentId))){
  const scope=scopes.scope(id);collect(scope.extent?.geometry);collect(scope.extra?.geometry);
  if(scope.precisionDiscards.length)precisionDiscards.push({id,month,discards:scope.precisionDiscards});
 }
}
const engine = globalThis.PandoLabGpuMeshCore;
const meshes = {};
const algorithmSourceSha256 = sharedSourceManifest(root).sourceSha256;
const oldManifestPath=resolve(root,`${destination}/manifest.json`);
const oldManifest=existsSync(oldManifestPath)?readJson(`${destination}/manifest.json`):null;
const reusable=oldManifest?.schemaVersion===2 && oldManifest.meshFormatVersion===POLYGON_MESH_FORMAT_VERSION
  && oldManifest.algorithmSourceSha256===algorithmSourceSha256 && oldManifest.algorithmVersion===engine.MESH_ALGORITHM_REVISION;
let count = 0, bytes = 0, reused = 0;
for (const [digest, geometry] of [...geometries].sort(([a], [b]) => a.localeCompare(b))) {
  const previous=reusable?oldManifest.meshes[digest]:null;
  if(previous && existsSync(resolve(root,previous.url))){
    const stored=readFileSync(resolve(root,previous.url));
    if(stored.length===previous.compressedBytes && sha256(stored)===previous.sha256){
      meshes[digest]=previous;bytes+=stored.length;count++;reused++;continue;
    }
  }
  const packet = engine.buildPolygonGeometryPacket(geometry);
  const encoded = Buffer.from(encodePolygonMesh(packet));
  const compressed = gzipSync(encoded, { level: 9, mtime: 0 });
  // The payload is identical across hosts; pin the gzip OS byte too so the
  // published content hashes do not change when generated on Windows.
  compressed[9] = 3;
  const hash = sha256(compressed), url = `${destination}/polygon-mesh-sha256-${hash}.bin.gz`;
  mkdirSync(dirname(resolve(root, url)), { recursive: true }); writeLibraryOutput(resolve(root, url), compressed);
  meshes[digest] = { url, sha256: hash, encoding: 'gzip', compressedBytes: compressed.length, decodedBytes: encoded.length };
  bytes += compressed.length; count++;
  if (count % 25 === 0) console.log(`Prepared ${count}/${geometries.size} fixed polygon meshes`);
}
const manifest = { schema: 'pandolab-prepared-polygon-meshes', schemaVersion: 2,
  meshFormatVersion: POLYGON_MESH_FORMAT_VERSION,
  algorithmVersion: engine.MESH_ALGORITHM_REVISION, algorithmSourceSha256,
  maxEdgeDegrees: engine.MAX_RENDER_EDGE_DEGREES, inputHashes, precisionDiscards, meshes };
writeLibraryOutput(resolve(root, `${destination}/manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${count} fixed polygon meshes (${bytes} compressed bytes; ${reused} unchanged meshes reused).`);
