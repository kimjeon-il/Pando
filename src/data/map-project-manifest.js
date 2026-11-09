// Map content belongs to the selected project; Viewer owns only resource roles
// and safe loading rules. A catalog, not this manifest, owns member IDs and dates.
export const MAP_PROJECT_ROLES=Object.freeze([
  'world','territorial','rivers','lakes','places','placeLifetimes',
  'terrain','physicalLand','preparedMeshes',
]);
const ROLES=new Set(MAP_PROJECT_ROLES);
const CATALOG_PATH=/^assets\/data\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function requireOnly(value,allowed,label){
  if(!isRecord(value)||Object.keys(value).some(key=>!allowed.includes(key)))
    throw new TypeError('Invalid '+label+' fields');
}
export function mapProjectManifestSourcePath(projectId){
  if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(projectId))
    throw new TypeError('Invalid map project ID');
  return 'projects/'+projectId+'/manifest.json';
}
export function validateMapProjectManifest(input){
  requireOnly(input,['format','schemaVersion','projectId','documentFormat','resources'],
    'map project manifest');
  if(input.format!=='pandolab-map-project-manifest'||input.schemaVersion!==1||
    input.documentFormat!=='pandolab-project-state'||typeof input.projectId!=='string'||
    !/^[a-z][a-z0-9-]{0,63}$/.test(input.projectId))
    throw new TypeError('Unsupported map project manifest identity or format');
  if(!isRecord(input.resources)||Object.keys(input.resources).length!==ROLES.size||
    Object.keys(input.resources).some(key=>!ROLES.has(key)))
    throw new TypeError('Map project requires each supported resource role exactly once');
  const resources={};
  for(const role of MAP_PROJECT_ROLES){
    const entry=input.resources[role];
    requireOnly(entry,['catalog'],'map project resource');
    const path=entry.catalog;
    if(typeof path!=='string'||!CATALOG_PATH.test(path)||
      path.split('/').some(part=>!part||part==='.'||part==='..')||
      /[?#\\]/.test(path))
      throw new TypeError('Unsafe map project resource path: '+role);
    resources[role]=Object.freeze({catalog:path});
  }
  // One immutable Hydro shard catalog owns both river and lake identities.
  // Do not advertise separate catalogs until the rendering and cache owners support them.
  if(resources.rivers.catalog!==resources.lakes.catalog)
    throw new TypeError('River and lake roles must share one Hydro catalog');
  return Object.freeze({format:input.format,schemaVersion:input.schemaVersion,
    projectId:input.projectId,documentFormat:input.documentFormat,
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
