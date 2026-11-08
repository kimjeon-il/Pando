import {builtinCountryAssets} from './builtin-country-files.js';

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


export function collectRuntimeDataAssets({availablePaths,readManifest,entryPaths=[],verifyAsset=()=>{}}){
 const available=new Set(availablePaths),selected=new Set();
 const include=(path,spec)=>{
  if(typeof path!=='string'||!path.startsWith('assets/data/')||!/^[-A-Za-z0-9_./]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid runtime data dependency: '+path);
  if(!available.has(path))throw Error('Missing runtime data dependency: '+path);
  if(spec)verifyAsset(path,spec);
  selected.add(path);return path;
 };
  // Current runtime manifests own data dependencies. Source/provenance fields
  // describe how data was built and must not publish the original GIS inputs.
  const manifests=[
    'assets/data/world/current.json',
    'assets/data/builtin-world/generated/v1/index.json',
    'assets/data/prepared-polygons/generated/v2/manifest.json',
    'assets/data/hydro/v0.13.4/manifest.json',
    'assets/data/places/manifest.json',
    'assets/data/terrain-preview/v0.13.3-p2/manifest.json',
    'assets/data/physical-land/v1/manifest.json',
  ];
  const dataAsset=(url,base,spec)=>{
    if(typeof url!=='string'||!url||/[?#\\]/.test(url))throw Error(`Invalid manifest resource: ${url}`);
    return include(url.startsWith('assets/')?url:base+url,spec);
  };
  for (const path of entryPaths) if (available.has(path)) include(path);
  for(const path of manifests){
    if(!available.has(path))continue;
    include(path);
    const manifest=readManifest(path),base=path.slice(0,path.lastIndexOf('/')+1);
    if(path==='assets/data/world/current.json'){
      for(const item of Object.values(manifest.assets||{}))dataAsset(item.url,'assets/data/',item);
      for(const url of Object.values(manifest.compatibility?.sharedBoundaries||{}))dataAsset(url,'assets/data/');
    }else if(path.includes('/builtin-world/')){
      for(const item of builtinCountryAssets(manifest))dataAsset(item.file,base,item);
    }
    else if(path.includes('/prepared-polygons/')){
      for(const item of Object.values(manifest.meshes))dataAsset(item.url,base,item);
    }else if(path.includes('/hydro/')){
      dataAsset(manifest.container.url,base,manifest.container);
      for(const item of [manifest.index,manifest.metadata?.core,manifest.metadata?.detail,...manifest.shards])if(item?.url)dataAsset(item.url,base,item);
      for(const receipt of hydroSourceReceiptFiles(manifest))dataAsset(receipt,base);
    }else if(path.includes('/places/')){
      for(const item of Object.values(manifest.shards))dataAsset(item.url,base,item);
    }else if(path.includes('/physical-land/')){
      dataAsset(manifest.asset.url,base,manifest.asset);
      for(const context of manifest.waterObjects?.geometries||[])
        for(const item of [context.land,context.asset])dataAsset(item.url,'assets/data/',item);
    }
    else if(path.includes('/terrain-preview/')){
      for(const key of Object.keys(manifest.tiles))dataAsset(key,base);
    }
  }

 return selected;
}
