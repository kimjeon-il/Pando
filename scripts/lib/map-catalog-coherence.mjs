import {validateTerrainManifest} from '../../src/data/terrain-manifest.js';
import {mapProjectResourcePath} from '../../src/data/map-project-manifest.js';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const invalid=message=>{throw new TypeError('Incompatible project catalogs: '+message);};

// Prepared mesh inputs
// must instead match the selected project's source catalogs byte-for-byte.
export function validateMapCatalogCoherence(project,metadata,sha256ForPath){
 if(typeof sha256ForPath!=='function')invalid('source hash reader required');
 const path=role=>mapProjectResourcePath(project,role),get=role=>metadata[path(role)];
 const world=get('world'),country=get('territorial'),mesh=get('preparedMeshes');
 const land=get('physicalLand'),terrain=get('terrain'),hydro=get('rivers');
 const places=get('places'),lifetimes=get('placeLifetimes');
 if(world?.schema!=='pandolab-world-bundle'||world.schemaVersion!==1||!record(world.assets))
   invalid('unsupported world catalog');
 if(country?.schema!=='pandolab-builtin-world'||country.schemaVersion!==2||
   country.storageLayout!=='descriptor-geometries-v1'||
   !Array.isArray(country.entities)||!Array.isArray(country.geometryAssets))
   invalid('unsupported territorial index');
 if(mesh?.schema!=='pandolab-prepared-polygon-meshes'||mesh.schemaVersion!==2||
   !record(mesh.meshes)||!record(mesh.inputHashes))
   invalid('unsupported prepared mesh index');
 // Prepared polygon meshes are an optional acceleration cache. A pinned
 // previous release remains byte-integrity checked but cannot be admitted
 // against a different territory/land source; the C++ renderer recomputes.
 const preparedMeshesCurrent=['territorial','physicalLand'].every(role=>{
   const catalog=path(role),expected=mesh.inputHashes[catalog];
   return sha(expected)&&sha256ForPath(catalog)===expected;
 });
 if(land?.schema!=='pando-physical-land-v3'||!sha(land.sourceSha256)||
   !record(land.asset)||!sha(land.asset.sha256))invalid('unsupported physical land index');
 // Elevation and shade are independent numeric samples; only physicalLand
 // classifies coverage. Historical land changes never invalidate DEM bytes.
 validateTerrainManifest(terrain);
 if(hydro?.schema!=='pandolab-water-shards-v5'||typeof hydro.version!=='string'||!hydro.version||
   !record(hydro.container)||!Array.isArray(hydro.shards))
   invalid('unsupported immutable Hydro catalog');
 if(!record(places?.shards)||!Array.isArray(lifetimes?.entries)||
   lifetimes.schema!=='pando-place-urban-lifetimes-v1'||lifetimes.schemaVersion!==1)
   invalid('unsupported place and lifetime catalogs');
 return Object.freeze({hydroVersion:hydro.version,preparedMeshesCurrent});
}
