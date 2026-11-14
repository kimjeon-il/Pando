import {collectRuntimeDataAssets} from '../../src/data/runtime-manifest-assets.js';
import {createHash} from 'node:crypto';
import {viewerDataEntryPaths} from '../../scripts/lib/product-assets.mjs';
import {validateTerritorialSourceGeometry,territorialSourceLayout} from '../../src/data/territorial-source-format.js';

export const isRetiredLibraryDocumentation = path => /\.(?:md|markdown|mdx)$/i.test(path)
 && !/(?:^|\/)[^/]*(?:license|licence|copying|copyright|notice)[^/]*$/i.test(path)
 && !/semap-diverse\/sources\/(?:README|license_images)\.md$/i.test(path);

// Archive metadata remains complete. A preparation scope is only a view over it.
export function runtimeArchiveIndex(index,readVerified,{purpose='viewer',prefixes=[],projectManifest=null}={}){
 let selected;
 if(purpose==='reports')selected=new Set();
 else if(purpose==='viewer'&&!projectManifest)throw Error('Viewer runtime archive requires a map project manifest');
 else if(purpose==='viewer'||purpose==='viewer-legacy')selected=collectRuntimeDataAssets({
  availablePaths:Object.keys(index.files),
  entryPaths:viewerDataEntryPaths,
  projectManifest,
  readManifest:path=>JSON.parse(readVerified(index.files[path],path)),
  verifyAsset:(path,spec)=>{
   const entry=index.files[path];
   // Hydro ranges address part of the independently verified container. Their
   // subresource hash is not the archive's whole-file identity.
   if(spec.offset!==undefined){
    if(!Number.isSafeInteger(spec.offset)||spec.offset<0||!Number.isSafeInteger(spec.bytes)
      ||spec.bytes<0||spec.offset+spec.bytes>entry.bytes)throw Error('Invalid runtime archive range: '+path);
    return;
   }
   if(spec.sha256&&(entry.sha256!==spec.sha256
    ||Number.isSafeInteger(spec.compressedBytes??spec.bytes)&&entry.bytes!==(spec.compressedBytes??spec.bytes)))
    throw Error('Runtime archive integrity identity mismatch: '+path);
  },
 });
 else if(purpose==='gis'){
  if(!Array.isArray(prefixes)||!prefixes.length)throw Error('Selected GIS input prefixes are required');
  for(const p of prefixes)if(typeof p!=='string'||!p||p.startsWith('/')||p.includes('\\')||p.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid GIS input scope');
  selected=new Set(Object.keys(index.files).filter(path=>!path.startsWith('reports/')&&!isRetiredLibraryDocumentation(path)
   &&prefixes.some(prefix=>path===prefix||path.startsWith(prefix+'/'))));
  const source='assets/data/territorial-entities/source/';
  for(const p of [...selected])if(p.startsWith(source+'countries/')&&p.endsWith('.json')){
   const descriptor=JSON.parse(readVerified(index.files[p],p));
   if(descriptor.storageLayout!==territorialSourceLayout)throw Error('Current source descriptor is required for GIS preparation: '+p);
   for(const version of descriptor.geometryVersions){
    const resource=validateTerritorialSourceGeometry(version,descriptor.entityId),file=source+resource.file,entry=index.files[file];
    if(!entry||entry.sha256!==resource.sha256||entry.bytes!==resource.bytes)throw Error('Missing or mismatched GIS source geometry: '+file);
    selected.add(file);
   }
  }
 }else throw Error('Unknown library preparation purpose: '+purpose);
 const files=Object.fromEntries([...selected].sort().map(path=>[path,index.files[path]]));
 const scopeId=createHash('sha256').update(JSON.stringify({purpose,prefixes:[...new Set(prefixes)].sort(),
  files:Object.entries(files).map(([path,spec])=>[path,spec.sha256,spec.bytes])})).digest('hex');
 return {...index,files,preparation:{purpose,prefixes:[...new Set(prefixes)].sort(),scopeId}};
}
