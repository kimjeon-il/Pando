// Projects own content identity and catalog roles; Viewer only consumes their contract.
// IDs and temporal members reside in the document/catalog, never duplicated here.
export const MAP_PROJECT_ROLES=Object.freeze([
  'world','territorial','rivers','lakes','places','placeLifetimes',
  'terrain','physicalLand','preparedMeshes',
]);
const ROLES=new Set(MAP_PROJECT_ROLES);
const PROJECT_ID=/^[a-z][a-z0-9-]{0,63}$/;
const CATALOG_PATH=/^assets\/data\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const DEFAULT_DEPENDENCIES=Object.freeze({
  placeLifetimes:Object.freeze(['places']),
  physicalLand:Object.freeze(['terrain']),
  preparedMeshes:Object.freeze(['territorial']),
});
function requireOnly(value,allowed,label){
  if(!isRecord(value)||Object.keys(value).some(key=>!allowed.includes(key)))
    throw new TypeError('Invalid '+label+' fields');
}
function documentContract(value){
  const document=value??{sourceRole:'territorial',identityPolicy:'runtime-instance'};
  requireOnly(document,['sourceRole','identityPolicy'],'map project document');
  if(document.sourceRole!=='territorial'||document.identityPolicy!=='runtime-instance')
    throw new TypeError('Unsupported map project document identity contract');
  // A project ID is a stable content identity; each opened C++ document keeps
  // its own documentId. No project ID may be substituted for that document ID.
  return Object.freeze({sourceRole:document.sourceRole,identityPolicy:document.identityPolicy});
}
function timelineContract(value){
  const timeline=value??{sourceRole:'territorial',precision:'month',bounds:'catalog'};
  requireOnly(timeline,['sourceRole','precision','bounds'],'map project timeline');
  if(timeline.sourceRole!=='territorial'||timeline.precision!=='month'||timeline.bounds!=='catalog')
    throw new TypeError('Unsupported map project timeline contract');
  // Dated members and validity come from the source timeline, not this manifest.
  return Object.freeze({sourceRole:timeline.sourceRole,precision:timeline.precision,bounds:timeline.bounds});
}
export function mapProjectManifestSourcePath(projectId){
  if(typeof projectId!=='string'||!PROJECT_ID.test(projectId))
    throw new TypeError('Invalid map project ID');
  return 'projects/'+projectId+'/manifest.json';
}
export function validateMapProjectManifest(input){
  requireOnly(input,['format','schemaVersion','projectId','documentFormat','document','timeline','resources'],
    'map project manifest');
  if(input.format!=='pandolab-map-project-manifest'||input.schemaVersion!==1||
    input.documentFormat!=='pandolab-project-state'||typeof input.projectId!=='string'||
    !PROJECT_ID.test(input.projectId))
    throw new TypeError('Unsupported map project manifest identity or format');
  const document=documentContract(input.document),timeline=timelineContract(input.timeline);
  if(!isRecord(input.resources)||Object.keys(input.resources).length!==ROLES.size||
    Object.keys(input.resources).some(key=>!ROLES.has(key)))
    throw new TypeError('Map project requires each supported resource role exactly once');
  const resources={};
  for(const role of MAP_PROJECT_ROLES){
    const entry=input.resources[role];
    requireOnly(entry,['catalog','required','dependsOn'],'map project resource');
    const path=entry.catalog;
    if(typeof path!=='string'||!CATALOG_PATH.test(path)||
      path.split('/').some(part=>!part||part==='.'||part==='..')||
      /[?#\\]/.test(path))
      throw new TypeError('Unsafe map project resource path: '+role);
    const required=entry.required??role!=='preparedMeshes';
    if(typeof required!=='boolean')throw new TypeError('Invalid map project resource requirement: '+role);
    const dependsOn=entry.dependsOn??DEFAULT_DEPENDENCIES[role]??[];
    if(!Array.isArray(dependsOn)||dependsOn.some(dep=>typeof dep!=='string'||!ROLES.has(dep)||dep===role)
      ||new Set(dependsOn).size!==dependsOn.length)
      throw new TypeError('Invalid map project resource dependencies: '+role);
    resources[role]=Object.freeze({catalog:path,required,dependsOn:Object.freeze([...dependsOn])});
  }
  // Detect cycles and mandatory dependencies on nonmandatory roles. Shared
  // catalogs (rivers/lakes) are allowed: roles are not separate file copies.
  const visiting=new Set(),visited=new Set();
  const visit=role=>{
    if(visiting.has(role))throw new TypeError('Cyclic map project resource dependencies: '+role);
    if(visited.has(role))return;
    visiting.add(role);
    for(const dep of resources[role].dependsOn){
      if(resources[role].required&&!resources[dep].required)
        throw new TypeError('Required map project resource depends on optional role: '+role);
      visit(dep);
    }
    visiting.delete(role);visited.add(role);
  };
  for(const role of MAP_PROJECT_ROLES)visit(role);
  if(!resources[document.sourceRole].required||!resources[timeline.sourceRole].required)
    throw new TypeError('Map project document/timeline source must be required');
  return Object.freeze({format:input.format,schemaVersion:input.schemaVersion,
    projectId:input.projectId,documentFormat:input.documentFormat,document,timeline,
    resources:Object.freeze(resources)});
}
export function mapProjectResourcePath(project,role){
  if(!ROLES.has(role))throw new TypeError('Unknown map resource role');
  return validateMapProjectManifest(project).resources[role].catalog;
}
export function mapProjectResourcePaths(project){
  const {resources}=validateMapProjectManifest(project);
  return Object.freeze([...new Set(MAP_PROJECT_ROLES.map(role=>resources[role].catalog))]);
}
// This receipt binds an admitted runtime document to its content project.
export function mapProjectDocumentIdentity(project,document){
  const p=validateMapProjectManifest(project);
  if(!isRecord(document)||document.format!==p.documentFormat)
    throw new TypeError('Map project document format mismatch');
  if(typeof document.documentId!=='string'||!document.documentId.trim()||
    document.documentId.length>128)
    throw new TypeError('Invalid map project runtime document ID');
  return Object.freeze({projectId:p.projectId,documentId:document.documentId,
    documentFormat:p.documentFormat,sourceRole:p.document.sourceRole});
}
// Immutable fetched bytes can be reused for one project revision; derived
// selection/scene state is scoped further by actual documentId. Stage 4 will
// apply these keys on runtime project transitions.
export function mapProjectResourceScope(project,{documentId,dataRevision}={}){
  const p=validateMapProjectManifest(project);
  if(typeof documentId!=='string'||!documentId.trim()||documentId.length>128||
    typeof dataRevision!=='string'||!dataRevision.trim()||dataRevision.length>128)
    throw new TypeError('Invalid map project resource scope identity');
  const catalogKey=JSON.stringify([p.projectId,dataRevision]);
  return Object.freeze({projectId:p.projectId,documentId,dataRevision,catalogKey,
    documentKey:JSON.stringify([p.projectId,dataRevision,documentId])});
}
