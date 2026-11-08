import { writeLibraryOutput } from './library-data.mjs';
import { createHash } from 'node:crypto';
import { sharedSourceManifest } from './package-shared-core-assets.mjs';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import {builtinCountryAssets} from "../src/data/builtin-country-files.js";
import {readBuiltinCountryStoredBytes} from './builtin-country-bytes.mjs';
import "../src/rendering/workers/gpu-mesh-core.js";
import { decodePolygonMesh, encodePolygonMesh, POLYGON_MESH_FORMAT_VERSION } from "../src/rendering/polygon-mesh-codec.js";
import './load-spherical-core.mjs';
import "../assets/js-vendor/polygon-clipping.min.js";
import { createGeometryVersionStore } from "../src/geometry/geometry-version-store.js";
import {parseTemporal,temporalContains,temporalMonthEnd,shiftTemporalMonth} from "../src/document/temporal.js";
import { resolveWorld } from "../src/document/timeline-resolver.js";
import { createTerritorialScopeResolver } from "../src/document/territorial-scope.js";
import {assembleBuiltinWorld,selectBuiltinCountries} from "../src/data/builtin-world-loader.js";
import {resolvePhysicalWaterObjects,composePhysicalWaterGeometry} from "../src/data/physical-resources.js";
import {builtinSubunitId} from "../src/document/builtin-subunits.js";
import {loadBuiltinDisplayPolicy} from './gis/builtin-display-policy.mjs';
import {timelineObjectKey} from "../src/document/timeline-records.js";

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
export function buildPreparedPolygonMeshes({root=defaultRoot,physicalMonth=null,countryIds=null,countryMonths=null,write=writeLibraryOutput,sourceIdentity=sharedSourceManifest}={}) {
if((countryIds===null)!==(countryMonths===null))throw Error('Countries and query months must be supplied together.');
if(countryIds!==null&&(!Array.isArray(countryIds)||!countryIds.length||new Set(countryIds).size!==countryIds.length||countryIds.some(id=>typeof id!=='string'||!id.trim()||id!==id.trim())||!Array.isArray(countryMonths)||!countryMonths.length||countryMonths.some(month=>parseTemporal(month,{nullable:false}).precision!=='month')||physicalMonth!==null))throw Error('Explicit unique countries and query months are required for scoped meshes.');
const append=physicalMonth!==null||countryIds!==null;
if(physicalMonth!==null&&(!physicalMonth||parseTemporal(physicalMonth,{nullable:false}).precision!=='month'))throw Error('A physical query month is required.');
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
const precisionDiscards=[],seenScopes=new Set(),retiredInputs=new Set();
let currentCountryInputs=null,selectedCountryPrefixes=[];
if(physicalMonth){
 const manifestPath='assets/data/physical-land/v1/manifest.json',manifest=readJson(manifestPath);
 inputHashes[manifestPath]=sha256(readFileSync(resolve(root,manifestPath)));
 const selected=resolvePhysicalWaterObjects(manifest.waterObjects,physicalMonth).sort((a,b)=>timelineObjectKey(a.objectRef).localeCompare(timelineObjectKey(b.objectRef)));
 if(!selected.length)throw Error('No physical-water context is selected for '+physicalMonth);
 const land=selected[0].assets.land;
 if(selected.some(row=>row.assets.land.sha256!==land.sha256))throw Error('Selected waters require one coherent land derivative.');
 const readAsset=spec=>{
  const raw=readFileSync(resolve(root,spec.url));
  if(raw.length!==spec.compressedBytes||sha256(raw)!==spec.sha256)throw Error('Physical source identity mismatch: '+spec.url);
  inputHashes[spec.url]=sha256(raw);return readJson(spec.url);
 };
 collect(readAsset(land));collect(composePhysicalWaterGeometry(selected.map(row=>readAsset(row.assets.asset))));
}else{
const indexPath='assets/data/builtin-world/generated/v1/index.json';
const indexBytes=readFileSync(resolve(root,indexPath)),index=JSON.parse(indexBytes);
inputHashes[indexPath]=sha256(indexBytes);
if(!countryIds)collect(index);
const sourceIndexPath='assets/data/territorial-entities/generated/v2/index.json';
const sourceIndexBytes=readFileSync(resolve(root,sourceIndexPath)),sourceIndex=JSON.parse(sourceIndexBytes);
const selectedIds=countryIds?new Set(countryIds):null,selections=new Map();
let effectiveIds=selectedIds;
if(selectedIds){
 inputHashes[sourceIndexPath]=sha256(sourceIndexBytes);
 currentCountryInputs=new Set(builtinCountryAssets(index).map(row=>'assets/data/builtin-world/generated/v1/'+row.file));
 selectedCountryPrefixes=countryIds.map(id=>'assets/data/builtin-world/generated/v1/countries/'+id.replaceAll(':','-')+'-sha256-');
 const selectedSources=new Set(index.sourceIdentities.filter(row=>selectedIds.has(row.projectEntityId)).flatMap(row=>row.sourceEntityIds));
 for(const entry of sourceIndex.entities)if(selectedSources.has(entry.entityId))retiredInputs.add('assets/data/territorial-entities/generated/v2/'+entry.file);
 const known=new Set(index.entities.map(row=>row.entityId));
 if(countryIds.some(id=>!known.has(id)))throw Error('Unknown scoped mesh country');
 const mapping=new Map(index.sourceIdentities.flatMap(row=>row.sourceEntityIds.map(id=>[id,row.projectEntityId])));
 const subunits=new Map(loadBuiltinDisplayPolicy().subunits.map(row=>[builtinSubunitId(row.sourceCountryId),row.parentId])),neighbors=new Map();
 for(const source of sourceIndex.entities){
  const child=mapping.get(source.entityId),parent=subunits.get(child)||mapping.get(source.parentEntityId)||source.parentEntityId;
  if(!child||!parent||child===parent)continue;
  for(const [a,b]of [[child,parent],[parent,child]]){if(!neighbors.has(a))neighbors.set(a,new Set());neighbors.get(a).add(b);}
 }
 effectiveIds=new Set();
 for(const month of new Set(countryMonths)){
  const wanted=selectBuiltinCountries(index,month),active=new Set(wanted.map(row=>row.entityId));selections.set(month,wanted);
  const required=new Set(countryIds.filter(id=>active.has(id))),queue=[...required];
  for(let at=0;at<queue.length;at++)for(const id of neighbors.get(queue[at])||[])
   if(active.has(id)&&!required.has(id)){required.add(id);queue.push(id);}
  const missing=[...required].filter(id=>!selectedIds.has(id));
  if(missing.length)throw Error('Scoped meshes require active parent/child closure: '+missing.join(','));
  for(const id of required)effectiveIds.add(id);
 }
 if(!effectiveIds.size)throw Error('No selected countries are active in the query months');
}
const countries=index.entities.filter(entry=>!effectiveIds||effectiveIds.has(entry.entityId)).map(entry=>{
 const stored=readBuiltinCountryStoredBytes(entry,relative=>{
  const file='assets/data/builtin-world/generated/v1/'+relative,bytes=readFileSync(resolve(root,file));
  inputHashes[file]=sha256(bytes);return bytes;
 });
 const country=JSON.parse(gunzipSync(stored));if(!selectedIds)collect(country);return country;
});
if(!selectedIds){
 source('assets/data/territorial-entities/generated/current-world.geojson');
 source('assets/data/physical-land/v1/geometry.json.gz');
 const physicalManifestPath='assets/data/physical-land/v1/manifest.json';
 inputHashes[physicalManifestPath]=sha256(readFileSync(resolve(root,physicalManifestPath)));
 for(const context of readJson(physicalManifestPath).waterObjects?.geometries||[])
  for(const item of [context.land,context.asset])source(item.url);
 for(const entity of sourceIndex.entities)source('assets/data/territorial-entities/generated/v2/'+entity.file);
}
const months=new Set(countryMonths||[]);
if(!selectedIds)for(const country of countries)for(const row of [...country.timelineRecords.geometryBindings,...country.timelineRecords.parentRelations])
 for(const value of [row.validFrom,row.validTo])if(value)for(const offset of [-1,0,1])months.add(shiftTemporalMonth(value.slice(0,-3),offset));

for(const month of [...months].sort()){
 const wanted=selections.get(month)||selectBuiltinCountries(index,month),ids=new Set(wanted.map(row=>row.entityId));
 const active=countries.filter(country=>ids.has(country.entityId));
 const relation=country=>country.timelineRecords.parentRelations.find(row=>temporalContains(row,temporalMonthEnd(month)));
 const needed=new Set();
 if(selectedIds){
  const loaded=new Set(active.map(country=>country.entityId));
  for(const country of active){const parent=relation(country)?.parentId;if(parent&&!loaded.has(parent))throw Error('Scoped meshes require active parent/child closure: '+parent);needed.add(country.entityId);}
 }
 for(const country of active){const row=relation(country);if(row?.parentId){needed.add(country.entityId);needed.add(row.parentId);}}
 let expanded=true;
 while(expanded){expanded=false;for(const country of active)if(needed.has(country.entityId)){
  const parent=relation(country)?.parentId;if(parent&&!needed.has(parent)){needed.add(parent);expanded=true;}
 }}
 if(!needed.size)continue;
 const selected=active.filter(country=>needed.has(country.entityId));
 const signature=JSON.stringify(selected.map(country=>[country.entityId,relation(country)?.parentId,
  country.timelineRecords.geometryBindings.find(row=>temporalContains(row,temporalMonthEnd(month)))?.geometryRef]));
 if(seenScopes.has(signature))continue;seenScopes.add(signature);
 const project=assembleBuiltinWorld({...index,entities:wanted.filter(row=>needed.has(row.entityId))},selected,month);
 if(selectedIds){
  const activeRefs=new Set(project.timelineRecords.geometryBindings.filter(row=>temporalContains(row,temporalMonthEnd(month))).map(row=>JSON.stringify([row.geometryRef.id,row.geometryRef.version])));
  for(const geometry of project.geometries)if(activeRefs.has(JSON.stringify([geometry.id,geometry.version])))collect(geometry.geojson);
 }
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
}
const engine = globalThis.PandoLabGpuMeshCore;
const meshes = {};
const algorithmSourceSha256 = sourceIdentity(root).sourceSha256;
const oldManifestPath=resolve(root,`${destination}/manifest.json`);
const oldManifestText=existsSync(oldManifestPath)?readFileSync(oldManifestPath,'utf8'):null;
const oldManifest=oldManifestText===null?null:JSON.parse(oldManifestText);
const reusable=oldManifest?.schemaVersion===2 && oldManifest.meshFormatVersion===POLYGON_MESH_FORMAT_VERSION
  && oldManifest.algorithmVersion===engine.MESH_ALGORITHM_REVISION && oldManifest.maxEdgeDegrees===engine.MAX_RENDER_EDGE_DEGREES;
// Match the runtime's packet algorithm/precision contract. An unrelated Core
// edit (for example reference-image UI) does not change a polygon mesh.
const retainedInputs={...oldManifest?.inputHashes};
if(currentCountryInputs)for(const path of Object.keys(retainedInputs)){
 if(retiredInputs.has(path)){delete retainedInputs[path];continue;}
 if(!/^assets\/data\/builtin-world\/generated\/v1\/(?:countries|country-parts)\//.test(path)||currentCountryInputs.has(path))continue;
 if(selectedCountryPrefixes.some(prefix=>path.startsWith(prefix)&&/^[a-f0-9]{64}\.json\.gz$/.test(path.slice(prefix.length)))){delete retainedInputs[path];continue;}
 throw Error('Scoped append has a stale country input outside the attributable selection: '+path);
}
if(append){
 if(!reusable)throw Error('Scoped append requires a prepared manifest with the current mesh algorithm and precision.');
 Object.assign(meshes,oldManifest.meshes);
}
let count = 0, bytes = 0, reused = 0;
for (const [digest, geometry] of [...geometries].sort(([a], [b]) => a.localeCompare(b))) {
  const previous=reusable?oldManifest.meshes[digest]:null;
  if(previous && existsSync(resolve(root,previous.url))){
    const stored=readFileSync(resolve(root,previous.url));
    if(stored.length===previous.compressedBytes && sha256(stored)===previous.sha256){
      const decoded=gunzipSync(stored);
      decodePolygonMesh(decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength),{algorithmVersion:engine.MESH_ALGORITHM_REVISION});
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
  mkdirSync(dirname(resolve(root, url)), { recursive: true }); write(resolve(root, url), compressed);
  meshes[digest] = { url, sha256: hash, encoding: 'gzip', compressedBytes: compressed.length, decodedBytes: encoded.length };
  bytes += compressed.length; count++;
  if (count % 25 === 0) console.log(`Prepared ${count}/${geometries.size} fixed polygon meshes`);
}
const manifest = { schema: 'pandolab-prepared-polygon-meshes', schemaVersion: 2,
  meshFormatVersion: POLYGON_MESH_FORMAT_VERSION,
  algorithmVersion: engine.MESH_ALGORITHM_REVISION, algorithmSourceSha256,
  maxEdgeDegrees: engine.MAX_RENDER_EDGE_DEGREES,
  inputHashes:append?{...retainedInputs,...inputHashes}:inputHashes,
  precisionDiscards:append?[...oldManifest.precisionDiscards.filter(row=>!countryIds||!countryIds.includes(row.id)||!countryMonths.includes(row.month)),...precisionDiscards]:precisionDiscards, meshes };
const serialized=JSON.stringify(manifest,null,2)+'\n';
if(serialized!==oldManifestText)write(oldManifestPath,serialized);
return {manifest,count,bytes,reused,selectedDigests:[...geometries.keys()]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),physical=args.find(a=>a.startsWith('--physical-month=')),countries=args.find(a=>a.startsWith('--countries=')),months=args.find(a=>a.startsWith('--months='));if(args.some(arg=>!['--physical-month=','--countries=','--months='].some(p=>arg.startsWith(p)))||args.length!==[physical,countries,months].filter(Boolean).length||!!countries!==!!months)throw Error('Use --physical-month=YYYY-MM or --countries=<ids> --months=<YYYY-MM,...>');
 const result=buildPreparedPolygonMeshes({physicalMonth:physical?physical.slice(17):null,countryIds:countries?countries.slice(12).split(','):null,countryMonths:months?months.slice(9).split(','):null});
 console.log(JSON.stringify({selected:result.count,compressedBytes:result.bytes,reused:result.reused,digests:result.selectedDigests}));
}
