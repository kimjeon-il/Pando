import {MAP_PROJECT_ROLES,validateMapProjectManifest,mapProjectResourcePath}
  from './map-project-manifest.js';

// One runtime source choice for country-dependent physical and reference data.
// The bundled catalog bytes are immutable. Document-specific overlays, search
// and tile worker state are never shared across a different C++ documentId.
export function createMapProjectResourceSelection({buildMeta=null}={}){
  const pinned=buildMeta?.mapProject?validateMapProjectManifest(buildMeta.mapProject):null;
  const receipts=buildMeta?.mapProjectCatalogs||null;
  const managed=!!pinned;
  function assertPinned(source){
    if(!managed||!receipts)throw new TypeError('No pinned map project resources are available');
    const manifest=validateMapProjectManifest(source?.manifest);
    if(manifest.projectId!==pinned.projectId
      ||JSON.stringify(manifest)!==JSON.stringify(pinned)
      ||source?.dataRevision!==buildMeta.dataRevision
      ||source?.catalogSha256!==buildMeta.builtinWorld?.sha256)
      throw new TypeError('Project resource selection differs from the published map');
    for(const role of MAP_PROJECT_ROLES){
      const item=receipts[role],catalog=mapProjectResourcePath(manifest,role);
      if(!item||item.catalog!==catalog||!/^[a-f0-9]{64}$/.test(item.sha256||''))
        throw new TypeError('Missing or mismatched pinned map project resource: '+role);
    }
    if(typeof source.documentId!=='string'||!source.documentId.trim())
      throw new TypeError('Project resource selection requires the accepted C++ documentId');
    return Object.freeze({projectId:manifest.projectId,documentId:source.documentId,
      manifest,dataRevision:source.dataRevision,scope:source.scope||null});
  }
  const bootstrap=managed?Object.freeze({projectId:pinned.projectId,documentId:null,
    manifest:pinned,dataRevision:buildMeta.dataRevision,scope:null}):null;
  let active=bootstrap,revision=0;
  const signature=value=>value?JSON.stringify([value.projectId,value.documentId,value.dataRevision,
    value.scope?.documentKey||null]):null;
  function select(source){
    if(!managed)return false; // legacy injected fixtures have no project manifest
    const next=source===null?null:assertPinned(source);
    if(signature(next)===signature(active))return false;
    active=next;revision++;
    return true;
  }
  function resource(role){
    if(!MAP_PROJECT_ROLES.includes(role))throw new TypeError('Unknown map project resource role');
    if(!managed)return null;
    if(!active)return null;
    const receipt=receipts?.[role];
    return Object.freeze({role,catalog:mapProjectResourcePath(active.manifest,role),
      sha256:receipt?.sha256||null,required:active.manifest.resources[role].required,
      dataRevision:active.dataRevision,documentId:active.documentId});
  }
  return Object.freeze({managed,select,resource,
    current:()=>active,revision:()=>revision,
    hasContent:()=>!managed||!!active,
  });
}
