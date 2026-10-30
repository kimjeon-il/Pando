/** Manual, opt-in dispatcher for offline GIS source tools.
 * Dry-run is the default. GIS input conversion is never part of application startup.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TASK_SOURCES = Object.freeze({
  'historical-border':'tools/gis/build-german-1914-base.mjs',
  'historical-coast':'tools/build_german_empire_1914_modern_coast.py',
  'terrain-dem':'tools/build-terrain-dem.py',
  'terrain-preview':'tools/build-terrain-preview.mjs',
  'hydro-tiles':'tools/build-hydro-tiles.py',
  'hydro-packfile':'tools/build-hydro-packfile.mjs',
  'hydro-connectivity':'tools/repair-hydro-connectivity.mjs',
  'physical-data':'tools/build-physical-data.py',
  'place-candidates':'tools/build-place-candidates.mjs',
});
const pythonExecutable=()=>process.env.PANDOLAB_PYTHON_EXECUTABLE||(process.platform==='win32'?'python':'python3');
export function buildCommand(task,args=[],{root=ROOT}={}){
  if(!Object.hasOwn(TASK_SOURCES,task))throw Error('Unsupported GIS research task: '+task);
  const rootPath=realpathSync(root);
  const source=realpathSync(resolve(rootPath,TASK_SOURCES[task]));
  const rel=relative(rootPath,source);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))
    throw Error('GIS source path escaped repository');
  const executable=extname(source)==='.mjs'?process.execPath:pythonExecutable();
  const passthrough=args[0]==='--'?args.slice(1):args;
  return [executable,source,...passthrough];
}
export function parseArguments(args=process.argv.slice(2)){
  let task=null,execute=false,raw=[];
  for(let i=0;i<args.length;i++){
    const token=args[i];
    if(token==='--task'){
      if(task||!args[i+1]||args[i+1].startsWith('--'))throw Error('Expected exactly one --task value');
      task=args[++i];
    }else if(token==='--execute')execute=true;
    else if(token==='--'){raw=args.slice(i+1);break;}
    else if(!token.startsWith('--')&&task&&!raw.length){raw=args.slice(i);break;}
    else throw Error('Unknown GIS launcher argument: '+token);
  }
  if(!task)throw Error('--task is required');
  if(!Object.hasOwn(TASK_SOURCES,task))throw Error('invalid choice: '+task);
  return {task,execute,args:raw};
}
export function runSource({argv=process.argv.slice(2),root=ROOT,spawn=spawnSync,
  output=console.log}={}){
  const {task,execute,args}=parseArguments(argv);
  const command=buildCommand(task,args,{root});
  const receipt={schema:'pando-gis-source-manual-v2',mode:execute?'execute':'dry-run',
    task,source:TASK_SOURCES[task],argv:args,requiresExternalOriginals:execute};
  output(JSON.stringify(receipt,null,2));
  if(!execute)return 0;
  const result=spawn(command[0],command.slice(1),{cwd:root,stdio:'inherit',shell:false,env:process.env});
  if(result.error)throw result.error;
  if(result.signal||!Number.isInteger(result.status))throw Error('GIS source subprocess interrupted');
  return result.status;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=runSource();}
  catch(error){console.error('gis-source: '+error.message);process.exitCode=2;}
}
