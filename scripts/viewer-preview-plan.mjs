// Source-matched branch preview selection. Compiled WASM and data artifacts
// are validated by the existing publication owner, not rebuilt here.
import {appendFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectChanges} from './lib/check-changes.mjs';

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
    /^(?:apps\/viewer\/|shared\/|assets\/|projects\/|src\/|config\/library-data\.json$|index\.html$|\.nojekyll$|contracts\/|tests\/browser\/|tests\/unit\/(?:viewer|builtin|map|gpu|terrain|hydro|current-browser)-|tools\/stage-monorepo-pages\.mjs$|scripts\/(?:stage-viewer-preview|viewer-preview-plan)\.mjs$|\.github\/workflows\/viewer-preview\.yml$|playwright\.config\.js$)/.test(path));
  const active=availableWeb&&scope!=='off';
  const explicit=scope!=='auto'&&scope!=='off';
  return {
    preview: active&&(scope==='preview'||scope==='all'||scope==='browser'||scope==='acceptance'||(scope==='auto'&&touched)),
    browser: active&&(scope==='browser'||scope==='all'||scope==='acceptance'||(scope==='auto'&&touched)),
    contracts: active&&(scope==='browser'||scope==='all'||scope==='acceptance'||(scope==='auto'&&touched)),
    touched,availableWeb,scope,explicit,scannedPaths:paths.length
  };
}

export function scheduleViewerPreview(selection,{event='push',scope='auto',artifactState}={}) {
  const pending=artifactState&&(artifactState.statuses.wasm.needed||
    artifactState.selectedFamilies.length||artifactState.blockedFamilies.length);
  const deferredToArtifacts=event==='push'&&scope==='auto'&&Boolean(pending);
  return {...selection,...(deferredToArtifacts?{preview:false,browser:false,contracts:false}:{}),deferredToArtifacts};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const env=process.env,scope=env.PANDO_PREVIEW_SCOPE||'auto';
  const event=env.GITHUB_EVENT_NAME||'local';
  const branch=env.PANDO_PREVIEW_BRANCH||env.GITHUB_REF_NAME||'work/objects';
  let changes=[];
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
  const artifactState=event==='push'&&scope==='auto'?plan(root,{changes}):null;
  const selected=classifyViewerPreview(changes,{},scope);
  // The artifact publisher dispatches even when it verified unchanged bytes.
  // An explicit dispatch must still provide the requested preview evidence.
  if(event==='workflow_dispatch'&&scope==='auto'&&selected.availableWeb)
    Object.assign(selected,{preview:true,browser:true,contracts:true});
  const result=scheduleViewerPreview(selected,{event,scope,artifactState});
  const slug=previewSlug(branch);
  if(process.argv.includes('--github-output')){
    if(!env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT missing');
    appendFileSync(env.GITHUB_OUTPUT,[['preview',result.preview],['browser',result.browser],
      ['contracts',result.contracts],['slug',slug]].map(([k,v])=>k+'='+v).join('\n')+'\n');
  }
  console.log(JSON.stringify({branch,slug,changes,result},null,2));
}
