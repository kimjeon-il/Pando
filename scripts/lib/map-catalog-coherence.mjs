import {mapProjectResourcePath} from '../../src/data/map-project-manifest.js';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const invalid=message=>{throw new TypeError('Incompatible project catalogs: '+message);};

// Modern preview is not equated to a dated C++ territory. Prepared mesh inputs
// must instead match the selected project's source catalogs byte-for-byte.
export function validateMapCatalogCoherence(project,metadata,sha256ForPath){
 if(typeof sha256ForPath!=='function')invalid('source hash reader required');
 const path=role=>mapProjectResourcePath(project,role),get=role=>metadata[path(role)];
 const world=get('world'),country=get('territorial'),mesh=get('preparedMeshes');
 const land=get('physicalLand'),terrain=get('terrain'),hydro=get('rivers');
 const places=get('places'),lifetimes=get('placeLifetimes');
 if(world?.schema!=='pandolab-world-bundle'||world.schemaVersion!==1||!record(world.assets))
   invalid('unsupported world preview');
 if(country?.schema!=='pandolab-builtin-world'||country.schemaVersion!==2||
   country.storageLayout!=='descriptor-geometries-v1'||
   !Array.isArray(country.entities)||!Array.isArray(country.geometryAssets))
   invalid('unsupported territorial index');
 if(mesh?.schema!=='pandolab-prepared-polygon-meshes'||mesh.schemaVersion!==2||
   !record(mesh.meshes)||!record(mesh.inputHashes))
   invalid('unsupported prepared mesh index');
 for(const role of ['territorial','physicalLand']){
   const catalog=path(role),expected=mesh.inputHashes[catalog];
   if(!sha(expected)||sha256ForPath(catalog)!==expected)
     invalid('prepared meshes do not match selected '+role+' catalog');
 }
 if(land?.schema!=='pando-physical-land-v3'||!sha(land.sourceSha256)||
   !record(land.asset)||!sha(land.asset.sha256))invalid('unsupported physical land index');
 if(!terrain?.sourceDem||terrain.sourceDem.landMaskSha256!==land.sourceSha256)
   invalid('terrain and physical land lineage differ');
 if(hydro?.schema!=='pandolab-water-shards-v5'||typeof hydro.version!=='string'||!hydro.version||
   !record(hydro.container)||!Array.isArray(hydro.shards))
   invalid('unsupported immutable Hydro catalog');
 if(!record(places?.shards)||!Array.isArray(lifetimes?.entries)||
   lifetimes.schema!=='pando-place-urban-lifetimes-v1'||lifetimes.schemaVersion!==1)
   invalid('unsupported place and lifetime catalogs');
 return Object.freeze({hydroVersion:hydro.version});
}
