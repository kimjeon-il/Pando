import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {mapProjectManifestSourcePath,validateMapProjectManifest,mapProjectResourcePath}
 from '../../src/data/map-project-manifest.js';

export const GENERATION_INPUT_ROLES=Object.freeze([
 'territorialSourceRoot','territorialSourceIndex','territorialCurrentWorld',
 'worldView','historicalPolicy','displayPolicy','worldBuildRecipe',
]);
const validPath=value=>typeof value==='string'&&/^assets\/data\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
 &&!value.split('/').some(part=>!part||part==='.'||part==='..')
 &&!/[?#\\]/.test(value);
export function validateProjectGenerationInputs(raw,projectId){
 if(!raw||raw.format!=='pandolab-map-generation-inputs'||raw.schemaVersion!==1
   ||raw.projectId!==projectId||!raw.inputs||typeof raw.inputs!=='object'
   ||Array.isArray(raw.inputs)
   ||Object.keys(raw).some(key=>!['format','schemaVersion','projectId','inputs'].includes(key))
   ||Object.keys(raw.inputs).length!==GENERATION_INPUT_ROLES.length
   ||Object.keys(raw.inputs).some(key=>!GENERATION_INPUT_ROLES.includes(key)))
    throw new TypeError('Invalid selected project generation input receipt');
 const sources={};
 for(const role of GENERATION_INPUT_ROLES){
  const value=raw.inputs[role];
  if(!validPath(value))throw new TypeError('Unsafe project generation source: '+role);
  sources[role]=value;
 }
 return Object.freeze({format:raw.format,schemaVersion:raw.schemaVersion,
   projectId,inputs:Object.freeze(sources)});
}
export function readProjectGenerationContext({root=process.cwd(),projectId='default-world',
 readSource=path=>readFileSync(resolve(root,path),'utf8')}={}){
 const projectPath=mapProjectManifestSourcePath(projectId);
 const project=validateMapProjectManifest(JSON.parse(readSource(projectPath)));
 if(project.projectId!==projectId)throw new TypeError('Selected project manifest identity mismatch');
 const generationPath='projects/'+projectId+'/generation-inputs.json';
 const generation=validateProjectGenerationInputs(JSON.parse(readSource(generationPath)),projectId);
 return Object.freeze({
  projectId,project,generation,
  catalogs:Object.freeze(Object.fromEntries(
   ['world','territorial','preparedMeshes','physicalLand','rivers','places'].map(role=>
    [role,mapProjectResourcePath(project,role)]))),
  source:path=>generation.inputs[path],
 });
}

// Validate one project's own world source recipe before any generator writes
// immutable data. The Viewer release manifest never publishes this receipt.
export function readProjectWorldGenerationContext(options = {}) {
  const selection = readProjectGenerationContext(options);
  const {root = process.cwd(),readSource = path=>readFileSync(resolve(root,path),'utf8')} = options;
  const worldRecipePath = selection.source('worldBuildRecipe');
  const worldRecipe = JSON.parse(readSource(worldRecipePath));
  const canonicalSource = selection.source('territorialCurrentWorld').slice('assets/data/'.length);
  if(worldRecipe?.schema!=='pandolab-world-build-input'||worldRecipe.schemaVersion!==1
    ||worldRecipe.canonicalSource!==canonicalSource)
    throw new TypeError('Selected project world recipe differs from its territorial source');
  if(typeof worldRecipe.legacyPreviewManifest!=='string'
    ||!worldRecipe.legacyPreviewManifest
    ||worldRecipe.legacyPreviewManifest.split('/').some(part=>!part||part==='.'||part==='..')
    ||!/^[-a-zA-Z0-9_./]+$/.test(worldRecipe.legacyPreviewManifest))
    throw new TypeError('Unsafe selected project world source descriptor path');
  if(selection.projectId!=='default-world') {
    const prefix='assets/data/'+selection.projectId+'/';
    if(!selection.catalogs.world.startsWith(prefix))
      throw new TypeError('Nondefault project world catalog must have a project-owned output path');
    if(!worldRecipe.legacyPreviewManifest.startsWith(selection.projectId+'/'))
      throw new TypeError('Nondefault project world source descriptor must have a project-owned output path');
  }
  return Object.freeze({...selection,worldRecipePath,worldRecipe});
}
