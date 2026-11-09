import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {withLibraryOutputs} from '../data/library-runtime.mjs';
import {readBuiltinCountry} from '../data/builtin-country-bytes.mjs';
import {createCanonicalCountryStore} from '../../src/rendering/canonical-country-packet.js';
import {decodeCountryMesh,encodeCountryMesh,extractCountryMeshSlot,encodePreparedCountryScene,decodePreparedCountryScene} from '../../src/rendering/country-mesh-codec.js';
import {createCountryMeshPreparation} from '../../src/rendering/country-mesh-preparation.js';
import {prepareCountryStroke} from '../../src/rendering/country-stroke-preparation.js';
import {prepareMeshSpatialBlocks} from '../../src/rendering/mesh-spatial-blocks.js';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=g=>sha(JSON.stringify([g.type,g.coordinates]));
const asBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);

/** Build only a display derivative from pinned runtime inputs. No GIS regeneration. */
export async function buildPreparedCountryScene({root=defaultRoot,month,write=true}={}) {
  if(!/^\d{4}-\d{2}$/.test(month||''))throw new Error('An explicit reference month is required');
  await import('./load-spherical-core.mjs');
  await import('../../src/rendering/workers/gpu-mesh-core.js');
  const [{assembleBuiltinWorld},{createCanonicalGeometryVersionStore:createGeometryVersionStore},{resolveWorld},
    {territorialSceneDisplayId},{territorialRootId},{createCountrySharedBoundaryState,prepareCountrySharedBoundaryPacket}]=await Promise.all([
    import('../../src/data/builtin-world-loader.js'),import('../../src/geometry/geometry-version-store.js'),
    import('../../src/document/timeline-resolver.js'),import('../../src/document/builtin-subunits.js'),
    import('../../src/document/territorial-units.js'),import('../../src/rendering/country-shared-boundary-packet.js')]);
  const data=resolve(root,'assets/data'),worldPath=resolve(data,'world/current.json');
  const world=JSON.parse(readFileSync(worldPath,'utf8'));
  const readAsset=spec=>{
    const raw=readFileSync(resolve(data,spec.url));
    if(raw.length!==spec.compressedBytes||sha(raw)!==spec.sha256)throw new Error('Pinned world asset integrity mismatch: '+spec.url);
    const decoded=spec.encoding==='gzip'?gunzipSync(raw):raw;
    if(decoded.length!==spec.decodedBytes)throw new Error('Pinned world decoded size mismatch');
    return asBuffer(decoded);
  };
  const source=createCanonicalCountryStore(readAsset(world.assets.canonicalCountryPacket),
    {expectedHeader:world.assets.canonicalCountryPacket.header}).materializeCollectionSync();
  const sourceIds=source.features.map(f=>String(f.id));
  const baseline=decodeCountryMesh(readAsset(world.assets.canonicalMesh),sourceIds).mesh;
  const byDigest=new Map();
  source.features.forEach((feature,slot)=>{const key=digest(feature.geometry);if(!byDigest.has(key))byDigest.set(key,slot);});
  const indexBytes=readFileSync(resolve(data,'builtin-world/generated/v1/index.json')),index=JSON.parse(indexBytes);
  const countryBytes=new Map();
  const readCountry=path=>{if(!countryBytes.has(path))countryBytes.set(path,readFileSync(resolve(data,'builtin-world/generated/v1',path)));return countryBytes.get(path);};
  const countries=index.entities.map(entry=>readBuiltinCountry(entry,index,readCountry));
  const project=assembleBuiltinWorld(index,countries,month);
  const resolved=resolveWorld(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month);
  const features=resolved.entities.map(row=>({...row.identity,geometry:row.geometry,
    properties:{...row.identity.properties,parentId:row.parentId,coverageMode:row.coverageMode,validFrom:row.validFrom,validTo:row.validTo}}));
  const roots=features.filter(f=>f.properties.entityKind==='general'&&!f.properties.parentId);
  const rootIds=new Set(roots.map(f=>String(f.id))),byId=new Map(features.map(f=>[String(f.id),f]));
  const boundaries=[...roots,...features.filter(f=>f.properties.entityKind==='general'&&f.properties.parentId).map(f=>({...f,
    id:territorialSceneDisplayId(f,rootIds),boundaryRootId:territorialRootId(f,id=>byId.get(String(id)))}))];
  const hashes=new Map(features.map(f=>[f.geometry,digest(f.geometry)]));
  const identity={fills:roots.map(f=>[String(f.id),hashes.get(f.geometry)]),
    boundaries:boundaries.map(f=>[String(f.id),hashes.get(f.geometry),String(f.boundaryRootId||f.id),String(f.properties.parentId||''),String(f.properties.entityKind||'')])};
  const reused=[],built=[];
  const engine=globalThis.PandoLabGpuMeshCore;
  engine.setSharedCore(globalThis.PandoLabSphericalCore);
  if(world.derivation.meshAlgorithmRevision!==engine.MESH_ALGORITHM_REVISION)throw new Error('Canonical mesh algorithm identity mismatch');
  const preparation=createCountryMeshPreparation({engine,loadPreparedPart:async (_key,feature)=>{
    const slot=byDigest.get(hashes.get(feature.geometry));
    if(slot===undefined){built.push(String(feature.id));return null;}
    reused.push({id:String(feature.id),sourceId:sourceIds[slot],sourceSlot:slot});
    return extractCountryMeshSlot(baseline,slot);
  }});
  const mesh=await preparation.build(roots,{throwIfCancelled(){}});
  const ids=roots.map(f=>String(f.id));
  const preparedStroke=prepareCountryStroke(mesh,ids);
  prepareMeshSpatialBlocks(mesh);
  const state=createCountrySharedBoundaryState();
  state.replace(boundaries.map(f=>({...f,boundaryGeometryRevision:'sha256:'+hashes.get(f.geometry)})));
  const boundaryPacket=prepareCountrySharedBoundaryPacket(state.segments(),state.features(),
    {preparedStore:state.preparedStore,maxEdgeDegrees:0.499,includeOutlines:true});
  const coordinateCount=g=>{let count=0;const visit=a=>{if(typeof a[0]==='number')count++;else a.forEach(visit);};visit(g.coordinates);return count;};
  const packet={identity,countryIds:ids,
    meshBuffer:encodeCountryMesh(mesh,ids,roots.reduce((sum,f)=>sum+coordinateCount(f.geometry),0)),
    preparedStroke,spatialBlocks:mesh.spatialBlocks,boundaryPacket};
  // Timings are evidence, never content-addressed packet inputs.
  delete preparedStroke.preparationMs;
  const encoded=encodePreparedCountryScene(packet);
  const verified=decodePreparedCountryScene(encoded,identity);
  if(verified.identity.countryIds.join('\0')!==ids.join('\0'))throw new Error('Generated prepared slot mismatch');
  const compressed=gzipSync(Buffer.from(encoded),{level:9,mtime:0});compressed[9]=3;
  const hash=sha(compressed),url=`world/objects/country-scene-sha256-${hash}.bin.gz`;
  const spec={url,encoding:'gzip',sha256:hash,compressedBytes:compressed.length,decodedBytes:encoded.byteLength,
    algorithmVersion:engine.MESH_ALGORITHM_REVISION,referenceMonth:month,identity,
    source:{countryPacket:world.assets.canonicalCountryPacket.sha256,canonicalMesh:world.assets.canonicalMesh.sha256,builtinIndex:sha(indexBytes)}};
  const output=resolve(data,url),summary={month,fillCount:ids.length,boundaryCount:boundaries.length,reused,built,
    compressedBytes:compressed.length,decodedBytes:encoded.byteLength,assetSha256:hash};
  if(write)withLibraryOutputs({root,paths:[worldPath,output]},()=>{
    mkdirSync(dirname(output),{recursive:true});
    if(existsSync(output)&&sha(readFileSync(output))!==hash)throw new Error('Corrupt existing immutable country scene');
    if(!existsSync(output))writeFileSync(output,compressed,{flag:'wx'});
    world.assets.preparedCountryScene=spec;
    writeFileSync(worldPath,JSON.stringify(world,null,2)+'\n');
  });
  return {spec,summary,packet:verified};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){const month=process.argv.find(a=>a.startsWith('--month='))?.slice(8);
  try {const {summary}=await buildPreparedCountryScene({month});console.log('PREPARED_COUNTRY_SCENE '+JSON.stringify(summary));}
  catch(error){console.error(error);process.exitCode=1;}}
