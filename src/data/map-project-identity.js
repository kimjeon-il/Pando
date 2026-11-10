import {validateMapProjectManifest} from './map-project-manifest.js';

const fail=(code,message)=>{throw Object.assign(new TypeError(message),{code});};
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const revision=value=>typeof value==='string'&&/^data-[0-9a-f]{32}$/.test(value);

export function mapProjectDocumentIdentity(meta){
 const project=validateMapProjectManifest(meta?.mapProject);
 const manifestSha256=meta?.mapProjectManifest?.sha256,dataRevision=meta?.dataRevision;
 if(!sha(manifestSha256)||!revision(dataRevision))
   fail('PL-PROJECT-IDENTITY','Project requires a verified manifest digest and data revision');
 return Object.freeze({projectId:project.projectId,manifestSha256,dataRevision});
}

// The source catalog is build-selected. A file may not silently rebind the
// contents of another map. Old pre-identity files migrate only on the original
// default-world: neither an unknown nor a foreign source becomes another map.
export function bindProjectDocumentIdentity(project,meta){
 if(!project||project.format!=='pandolab-project-state')return project;
 const expected=mapProjectDocumentIdentity(meta),identity=project.mapProjectIdentity;
 if(identity==null){
   if(expected.projectId!=='default-world')
     fail('PL-PROJECT-UNBOUND','An unbound legacy document cannot enter a non-default map project');
   return {...project,mapProjectIdentity:expected};
 }
 if(!identity||typeof identity!=='object'||Array.isArray(identity)||
   Object.keys(identity).length!==3||
   identity.projectId!==expected.projectId||identity.manifestSha256!==expected.manifestSha256||
   identity.dataRevision!==expected.dataRevision)
   fail('PL-PROJECT-IDENTITY','The saved project belongs to another map or pinned catalog revision');
 return project;
}
