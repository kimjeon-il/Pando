// Source-matched branch preview selection. Compiled WASM and data artifacts
// are validated by the existing publication owner, not rebuilt here.
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import YAML from 'yaml';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectChanges} from './lib/check-changes.mjs';
import {prepareLibraryMetadata} from '../tools/data/library-runtime.mjs';
import {decodeArchiveEntry} from '../tools/data/library-context.mjs';
import {runtimeArchiveIndex} from '../tools/data/library-runtime-index.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
const validScope=new Set(['auto','preview','browser','acceptance','all','off']);

export function previewSlug(branch) {
  if(!/^(?:work|integration)\/[a-z0-9][a-z0-9-]{0,63}$/.test(branch))
    throw Error('VIEWER_PREVIEW_UNSUPPORTED_BRANCH: '+branch);
  return branch.replace('/','-');
}

export function classifyViewerPreview(paths,{web}={},scope='auto') {
  if(!validScope.has(scope)) throw Error('VIEWER_PREVIEW_INVALID_SCOPE: '+scope);
  if(!Array.isArray(paths)||paths.some(path=>typeof path!=='string'))
    throw Error('VIEWER_PREVIEW_INVALID_CHANGE_LIST');
  const availableWeb=web??existsSync(resolve(root,'src/app/index.html'));
  const touched=paths.some(path=>!path.endsWith('.md') &&
    /^(?:apps\/viewer\/|shared\/|assets\/|projects\/|src\/|config\/library-data\.json$|index\.html$|\.nojekyll$|tests\/fixtures\/|tests\/browser\/|tests\/unit\/(?:viewer|builtin|map|gpu|terrain|hydro|current-browser)-|tools\/stage-monorepo-pages\.mjs$|scripts\/(?:stage-viewer-preview|viewer-preview-plan)\.mjs$|\.github\/workflows\/viewer-preview\.yml$|playwright\.config\.js$)/.test(path));
  const active=availableWeb&&scope!=='off';
  const explicit=scope!=='auto'&&scope!=='off';
  return {
    preview: active&&(scope==='preview'||scope==='all'||scope==='browser'||scope==='acceptance'||(scope==='auto'&&touched)),
    browser: active&&(scope==='browser'||scope==='all'||scope==='acceptance'||(scope==='auto'&&touched)),
    contracts: active&&(scope==='browser'||scope==='all'||scope==='acceptance'||(scope==='auto'&&touched)),
    touched,availableWeb,scope,explicit,scannedPaths:paths.length
  };
}

export function scheduleViewerPreview(selection,{event='push',scope='auto',artifactState,branch,applicationWorkflow}={}) {
  const pending=artifactState&&(artifactState.statuses.wasm.needed||
    artifactState.selectedFamilies.length||artifactState.blockedFamilies.length);
  const deferredToArtifacts=event==='push'&&scope==='auto'&&Boolean(pending);
  const push=applicationWorkflow?.on?.push;
  const delegated=event==='push'&&scope==='auto'&&Array.isArray(push?.branches)
    &&push.branches.includes(branch)&&!push.paths&&!push['paths-ignore']&&!push['branches-ignore'];
  return {...selection,...(delegated?{contracts:false}:{}),
    ...(deferredToArtifacts?{preview:false,browser:false,contracts:false}:{}),deferredToArtifacts};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const env=process.env,scope=env.PANDO_PREVIEW_SCOPE||'auto';
  const event=env.GITHUB_EVENT_NAME||'local';
  const branch=env.PANDO_PREVIEW_BRANCH||env.GITHUB_REF_NAME||'work/objects';
  let changes;
  // Exact source and base commits are checked out/fetched by the calling job.
  // Never interpret missing history as a clean, unaffected change.
  try {
    changes=collectChanges({root,base:env.PANDO_PREVIEW_BASE_SHA||'origin/main',
      event:event==='workflow_dispatch'?'push':event,head:'HEAD'}).files;
  }catch(error){
    if(scope==='auto'){
      changes=['src/app/viewer.js'];
      console.warn('Viewer preview comparison unavailable; validating conservatively:',error.message);
    }else throw error;
  }
  const {plan}=await import('./p2-artifact-plan.mjs');
  let artifactState=null;
  if(event==='push'&&scope==='auto'){
    const {index,checkout,revision}=prepareLibraryMetadata({root});
    const cache=new Map();
    const read=path=>{
      if(cache.has(path))return cache.get(path);
      const entry=index.files[path];
      if(!entry)throw Error('Pinned planning input unavailable: '+path);
      const bytes=decodeArchiveEntry(checkout,entry,revision,{fetch:true});cache.set(path,bytes);return bytes;
    };
    const projectManifest=JSON.parse(readFileSync(resolve(root,'projects/default-world/manifest.json'),'utf8'));
    const selected=runtimeArchiveIndex(index,(_entry,path)=>read(path),{purpose:'viewer',projectManifest});
    artifactState=plan(root,{changes,archive:{files:selected.files,read}});
  }
  const selected=classifyViewerPreview(changes,{},scope);
  // The artifact publisher dispatches even when it verified unchanged bytes.
  // An explicit dispatch must still provide the requested preview evidence.
  if(event==='workflow_dispatch'&&scope==='auto'&&selected.availableWeb)
    Object.assign(selected,{preview:true,browser:true,contracts:true});
  const applicationWorkflow=YAML.parse(readFileSync(resolve(root,'.github/workflows/application-architecture.yml'),'utf8'));
  const result=scheduleViewerPreview(selected,{event,scope,artifactState,branch,applicationWorkflow});
  const slug=previewSlug(branch);
  if(process.argv.includes('--github-output')){
    if(!env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT missing');
    appendFileSync(env.GITHUB_OUTPUT,[['preview',result.preview],['browser',result.browser],
      ['contracts',result.contracts],['slug',slug]].map(([k,v])=>k+'='+v).join('\n')+'\n');
  }
  console.log(JSON.stringify({branch,slug,changes,result},null,2));
}
