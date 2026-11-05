// Conservative source selection. Unknown work triggers acceptance; docs do not.
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

export function remoteOnlyAcceptanceScope(paths,{event='push',baselineKnown=true}={}) {
  if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'))throw Error('Invalid remote-only source change list');
  if(event==='workflow_dispatch'||!baselineKnown||!paths.length)
    return {runHeavy:true,reason:'Explicit acceptance or unavailable source baseline'};
  // A Codespaces-only configuration/contract change never changes the
  // C++/WASM/GIS source. The dedicated contract job still runs on every push.
  const previewOnly=new Set([
    'playwright.codespaces.config.js','scripts/remote-only-doctor.mjs',
    'scripts/remote-only-ci-scope.mjs','tests/browser/codespaces-live.spec.mjs',
    'tests/unit/remote-only-contract.test.mjs',
    'tests/unit/codespaces-acceptance-contract.test.mjs',
    // These files plan and verify publication but never change WASM/GIS inputs.
    'scripts/p2-artifact-plan.mjs','tests/unit/p2-artifact-plan.test.mjs'
  ]);
  const runtime=paths.filter(path=>!(path==='README.md'||path.endsWith('.md')
    ||path.startsWith('.devcontainer/')||previewOnly.has(path)));
  return {runHeavy:runtime.length>0,
    reason:runtime.length?'Changed build, test or runtime inputs':'Docs or on-demand preview configuration only'};
}
const validSha=s=>/^[a-f0-9]{40}$/.test(s||'')&&!/^0+$/.test(s);
export function gitRemoteOnlyScope({rootPath=root,env=process.env,
  git=args=>execFileSync('git',args,{cwd:rootPath,encoding:'utf8',windowsHide:true}).trim()}={}) {
  if(env.GITHUB_EVENT_NAME==='workflow_dispatch')
    return {...remoteOnlyAcceptanceScope([],{event:'workflow_dispatch'}),paths:[]};
  let base=env.PANDO_REMOTE_ONLY_BASE_SHA,known=validSha(base);
  if(!known) {
    try{base=git(['rev-parse','HEAD^']);known=validSha(base);}
    catch{known=false;}
  }
  if(!known)return {...remoteOnlyAcceptanceScope([],{baselineKnown:false}),paths:[]};
  try{
    const files=git(['diff','--name-only',base,'HEAD']).split('\n').filter(Boolean);
    return {...remoteOnlyAcceptanceScope(files),paths:files};
  }catch{
    return {...remoteOnlyAcceptanceScope([],{baselineKnown:false}),paths:[]};
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const scope=gitRemoteOnlyScope();
  if(process.argv.includes('--github-output')){
    if(!process.env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT required');
    appendFileSync(process.env.GITHUB_OUTPUT,'run_heavy='+scope.runHeavy+'\n');
  }
  console.log(JSON.stringify(scope));
}
