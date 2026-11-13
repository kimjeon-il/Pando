import {builtinCountryAssets} from './builtin-country-files.js';
import {regionalLandLayout} from './physical-land-patch.js';
import {preparedMeshDeltaLayout} from './prepared-mesh-delta.js';
import {isPublishedPreparedMeshSpec} from './prepared-mesh-publication.js';
import {MAP_PROJECT_ROLES,validateMapProjectManifest} from './map-project-manifest.js';

/** All independently source-verified name receipts that belong with a Hydro release.
 * Prehistoric/old production manifests may only have the 42-system receipt.
 */
function hydroSourceReceiptFiles(manifest){
  const kinds=['independentHydronymReplacements','independentHydronymFollowup',
    'independentHydronymBulk'];
  return kinds.flatMap(key=>{
    const value=manifest.sources?.[key];
    if(!value) return [];
    if(value.file==null){
      if(value.replacedSystems>0)throw Error('Nonzero independent count without receipt: '+key);
      return [];
    }
    if(typeof value.file!=='string'||!/^[\w.-]+\.json$/.test(value.file)
      ||!/^[0-9a-f]{64}$/.test(value.sha256||''))
      throw Error('Invalid independent source receipt: '+key);
    return [value.file];
  });
}


export function collectRuntimeDataAssets({availablePaths,readManifest,entryPaths=[],projectManifest=null,
  preparedMeshesCurrent=true,verifyAsset=()=>{}}){
 const available=new Set(availablePaths),selected=new Set();
 const include=(path,spec)=>{
  if(typeof path!=='string'||!path.startsWith('assets/data/')||!/^[-A-Za-z0-9_./]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid runtime data dependency: '+path);
  if(!available.has(path))throw Error('Missing runtime data dependency: '+path);
  if(spec)verifyAsset(path,spec);
  selected.add(path);return path;
 };
  // Current runtime manifests own data dependencies. Source/provenance fields
  // describe how data was built and must not publish the original GIS inputs.
  // Product builds use the project selection. Legacy archive queries without
  // one keep their existing scope until the publishing tools are migrated.
  const legacy=[
    ['world','assets/data/world/current.json'],
    ['territorial','assets/data/builtin-world/generated/v1/index.json'],
    ['preparedMeshes','assets/data/prepared-polygons/generated/v2/manifest.json'],
    ['rivers','assets/data/hydro/v0.13.4/manifest.json'],
    ['places','assets/data/places/manifest.json'],
    ['placeLifetimes','assets/data/places/urban-lifetimes-v1.json'],
    ['terrain','assets/data/terrain/v0.13.3/manifest.json'],
    ['physicalLand','assets/data/physical-land/v1/manifest.json'],
  ];
  const project=projectManifest?validateMapProjectManifest(projectManifest):null;
  const catalogs=project?MAP_PROJECT_ROLES.map(role=>[role,project.resources[role].catalog]):legacy;
  const dataAsset=(url,base,spec)=>{
    if(spec?.storageLayout!==undefined){
      if(![regionalLandLayout,preparedMeshDeltaLayout].includes(spec.storageLayout)||spec.base?.storageLayout!==undefined||!spec.base||!spec.replacement)throw Error('Invalid composed resource dependencies');
      dataAsset(spec.base.url,'assets/data/',spec.base);dataAsset(spec.replacement.url,'assets/data/',spec.replacement);return;
    }
    if(typeof url!=='string'||!url||/[?#\\]/.test(url))throw Error(`Invalid manifest resource: ${url}`);
    return include(url.startsWith('assets/')?url:base+url,spec);
  };
  for (const path of entryPaths) if (available.has(path)) include(path);
  const visited=new Set();
  for(const [role,path] of catalogs){
    if(visited.has(path))continue;
    visited.add(path);
    if(!available.has(path)){
      if(project)throw Error('Missing project-owned catalog: '+role+' '+path);
      continue;
    }
    include(path);
    if(role==='placeLifetimes')continue;
    const manifest=readManifest(path),base=path.slice(0,path.lastIndexOf('/')+1);
    if(role==='world'){
      for(const role of ['canonicalCountryPacket','canonicalMesh','labelAnchors','preparedCountryScene']) {
        const item=manifest.assets?.[role];if(item)dataAsset(item.url,'assets/data/',item);
      }
      const boundary=manifest.compatibility?.sharedBoundaries?.canonical;
      if(boundary)dataAsset(boundary,'assets/data/');
    }else if(role==='territorial'){
      for(const item of builtinCountryAssets(manifest))dataAsset(item.file,base,item);
    }
    else if(role==='preparedMeshes'){
      // Immutable source catalog remains published. Optional accelerator packets
      // outside the bounded Viewer subset are reconstructed from canonical geometry.
      if(!project||preparedMeshesCurrent)
        for(const item of Object.values(manifest.meshes))
          if(!project||isPublishedPreparedMeshSpec(item))dataAsset(item.url,base,item);
    }else if(role==='rivers'||role==='lakes'){
      dataAsset(manifest.container.url,base,manifest.container);
      for(const item of [manifest.index,manifest.metadata?.core,manifest.metadata?.detail,...manifest.shards])if(item?.url)dataAsset(item.url,base,item);
      for(const receipt of hydroSourceReceiptFiles(manifest))dataAsset(receipt,base);
    }else if(role==='places'){
      for(const item of Object.values(manifest.shards))dataAsset(item.url,base,item);
    }else if(role==='physicalLand'){
      dataAsset(manifest.asset.url,base,manifest.asset);
      for(const context of manifest.waterObjects?.geometries||[])
        for(const item of [context.land,context.asset])dataAsset(item.url,'assets/data/',item);
    }
    else if(role==='terrain'){
      for(const [key,tile] of Object.entries(manifest.tiles))dataAsset(key,base,tile);
    }
  }

 return selected;
}
