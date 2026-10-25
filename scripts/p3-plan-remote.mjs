// P3: classify remote preview/browser work with no third-party dependencies.
// Common core and application builds use their own dedicated workflows.
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, classifyPaths } from './p1-plan-remote-checks.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
const present=(dir,path)=>existsSync(resolve(dir,path));

export function classifyP3(paths,{web}={},scope='auto') {
  if(!['auto','all','acceptance','preview','browser','off'].includes(scope))
    throw Error('P3_INVALID_SCOPE: '+scope);
  if(scope==='acceptance')return {...classifyP3(paths,{web},'all'),scope,acceptance:true};
  paths=paths.filter(path=>!path.endsWith('.md'));
  const availableWeb=web ?? present(root,'apps/viewer/templates/index.html');
  const infra=paths.some(path=>[
    '.github/workflows/remote-preview-p3.yml',
    'scripts/p3-plan-remote.mjs','scripts/p3-stage-preview.mjs',
    'tests/unit/p3-remote-plan.test.mjs','tests/browser/p3-remote-preview.spec.mjs',
    'CMakePresets.json','config/toolchain-versions.json'
  ].includes(path));
  const webTouched=infra||paths.some(p=>/^(apps\/(?:editor|viewer)\/|assets\/|index\.html$|\.nojekyll$|contracts\/|tests\/browser\/|playwright\.config\.js$|shared\/)/.test(p));
  const preview=availableWeb && scope!=='off' && (scope==='all'||
    scope==='preview'||scope==='browser'||(scope==='auto'&&webTouched));
  const browser=availableWeb && scope!=='off' && (scope==='all'||
    scope==='browser'||(scope==='auto'&&webTouched));
  const webContracts=classifyPaths(paths,{web:availableWeb},scope==='all'?'all':'auto');
  const contracts=availableWeb&&(scope==='all'||(scope==='auto'&&webContracts.web));
  return {preview,browser,contracts,ui:webContracts.ui,objects:webContracts.objects,gis:webContracts.gis,places:webContracts.places,availableWeb,infra,
    webTouched,scannedPaths:paths.length,scope};
}

export function scheduleP3(result,{event='push',manual='auto',artifactState}={}) {
  const pending=artifactState && (artifactState.statuses.wasm.needed ||
    artifactState.selectedFamilies.length || artifactState.blockedFamilies.length);
  const deferredToArtifacts=event==='push'&&manual==='auto'&&!!pending;
  return {...result,...(deferredToArtifacts?{preview:false,browser:false,contracts:false}:{}),deferredToArtifacts};
}

export function previewSlug(branch) {
  if(!/^work\/[a-z0-9][a-z0-9-]{0,63}$/.test(branch))
    throw Error('P3_UNSUPPORTED_PREVIEW_BRANCH: '+branch);
  return branch.replace('/','-');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const change=changedPaths({base:process.env.PANDO_P3_BASE_SHA||''});
  const branch=process.env.PANDO_P3_BRANCH||'work/objects';
  const slug=previewSlug(branch);
  const manual=process.env.PANDO_P3_SCOPE||'auto',event=process.env.GITHUB_EVENT_NAME||'local';
  const {plan}=await import('./p2-artifact-plan.mjs');
  const artifactState=event==='push'&&manual==='auto'?plan(root,{changes:change.paths}):null;
  const result=scheduleP3(classifyP3(change.paths,{},manual),{event,manual,artifactState});
  if(process.argv.includes('--github-output')) {
    if(!process.env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT missing');
    appendFileSync(process.env.GITHUB_OUTPUT,
      [['preview',result.preview],['browser',result.browser],
       ['contracts',result.contracts],['ui',result.ui],['objects',result.objects],['gis',result.gis],['places',result.places],
       ['slug',slug]].map(([k,v])=>k+'='+String(v)).join('\n')+'\n');
  }
  console.log(JSON.stringify({branch,slug,changed:change.paths,fallBackDiff:change.fallback,...result},null,2));
}
