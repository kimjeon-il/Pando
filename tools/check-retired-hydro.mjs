#!/usr/bin/env node
// Permanent all-branch regression gate: only the pinned v0.13.2 Hydro package may be active.
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const WEB='kimjeon-il/Pando',APP='kimjeon-il/PandoEditor';
const BASELINE='8de07030cccff5e7ec3c68e6beb6bb288c95afb2';
const RETIRED=/^assets\/data\/hydro\/(?:v0\.12\.[2-6]|v0\.13\.[01])\//;
const ACTIVE=/^assets\/data\/hydro\/v0\.13\.2\//;
const NATIVE_RETIRED=/^assets\/world\/hydro\/(?:v0\.12\.[2-6]|v0\.13\.[01])\//;
const NATIVE_ACTIVE=/^assets\/world\/hydro\/v0\.13\.2\//;
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
const toBlobs=(tree)=>{
  ensure(tree?.truncated===false&&Array.isArray(tree.tree),'Complete Git tree required');
  return tree.tree.filter(x=>x.type==='blob');
};
const asMap=(tree)=>new Map(toBlobs(tree).map(x=>[x.path,x]));

export function verifyWeb(tree,baseline) {
  const refs=asMap(tree),expected=toBlobs(baseline).filter(x=>ACTIVE.test(x.path));
  const retired=[...refs.keys()].filter(x=>RETIRED.test(x));
  const active=[...refs.keys()].filter(x=>ACTIVE.test(x));
  const changed=expected.filter(x=>refs.get(x.path)?.sha!==x.sha||refs.get(x.path)?.size!==x.size);
  const unexpected=active.filter(x=>!expected.some(y=>y.path===x));
  const restoreToolPresent=refs.has('tools/restore-archival-hydro.py');
  const valid=retired.length===0&&expected.length===2&&active.length===2&&
    changed.length===0&&unexpected.length===0&&restoreToolPresent;
  return {retiredFiles:retired.length,activeFiles:active.length,
    baselineActiveFiles:expected.length,changedActiveFiles:changed.length,
    unexpectedActiveFiles:unexpected.length,restoreToolPresent,
    retiredSample:retired.slice(0,12),valid};
}

export function verifyApp(tree,world,webManifestSha,webContainerSha) {
  const refs=asMap(tree),paths=[...refs.keys()];
  const retired=paths.filter(x=>NATIVE_RETIRED.test(x));
  const active=paths.filter(x=>NATIVE_ACTIVE.test(x));
  const nativeManifest=refs.get('assets/world/hydro/v0.13.2/manifest.json');
  const nativeContainer=refs.get('assets/world/hydro/v0.13.2/hydro.bin');
  const valid=world?.schema==='pandoeditor-world-dataset'&&[1,2].includes(world.version)&&
    world.hydro?.path==='hydro/v0.13.2/manifest.json'&&
    world.hydro?.version==='0.13.2'&&world.hydro.gitBlobSha===webManifestSha&&
    nativeManifest?.sha===webManifestSha&&nativeContainer?.sha===webContainerSha&&
    active.length===2&&retired.length===0;
  return {retiredFiles:retired.length,activeFiles:active.length,
    version:world?.version,pinnedWebBlob:world?.hydro?.gitBlobSha||null,
    retiredSample:retired.slice(0,12),valid};
}

async function gh(repo,path,token) {
  const response=await fetch('https://api.github.com/repos/'+repo+'/'+path,{
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('GitHub HTTP '+response.status+' '+repo+'/'+path+
    ' '+(await response.text()).slice(0,300));
  return response.json();
}
async function allBranches(repo,token) {
  const branches=await gh(repo,'branches?per_page=100',token);
  ensure(branches.length>0&&branches.length<100,'Incomplete branch listing '+repo);
  ensure(branches.some(x=>x.name==='main')&&branches.some(x=>x.name==='work/gis'),
    'Main and GIS branches required '+repo);
  return branches.map(x=>({name:x.name,sha:x.commit.sha}));
}
async function publicProbe(url) {
  try {
    const response=await fetch(url,{method:'HEAD',cache:'no-store',redirect:'follow',
      signal:AbortSignal.timeout(20000)});
    return {url,status:response.status,ok:response.ok};
  }catch(error){return {url,status:null,error:String(error).slice(0,200)};}
}
export async function audit(token) {
  ensure(typeof token==='string'&&token.length>10,'GitHub read token required');
  const baseline=await gh(WEB,'git/trees/'+BASELINE+'?recursive=1',token);
  const original=asMap(baseline);
  const webManifestSha=original.get('assets/data/hydro/v0.13.2/manifest.json')?.sha;
  const webContainerSha=original.get('assets/data/hydro/v0.13.2/hydro.bin')?.sha;
  ensure(/^[a-f0-9]{40}$/.test(webManifestSha||'')&&/^[a-f0-9]{40}$/.test(webContainerSha||''),
    'Original pinned 2-file package is missing');
  const [webRefs,appRefs]=await Promise.all([allBranches(WEB,token),allBranches(APP,token)]);
  const web=[],app=[];
  for(const branch of webRefs) {
    const snapshot=await gh(WEB,'git/trees/'+branch.sha+'?recursive=1',token);
    web.push({branch:branch.name,sha:branch.sha,...verifyWeb(snapshot,baseline)});
  }
  for(const branch of appRefs) {
    const snapshot=await gh(APP,'git/trees/'+branch.sha+'?recursive=1',token);
    const manifestBlob=toBlobs(snapshot).find(x=>x.path==='assets/world/manifest.json')?.sha;
    ensure(!!manifestBlob,'App manifest missing '+branch.name);
    const data=await gh(APP,'git/blobs/'+manifestBlob,token);
    ensure(data.encoding==='base64','Unexpected App manifest encoding');
    const world=JSON.parse(Buffer.from(data.content.replace(/\s+/g,''),'base64').toString());
    app.push({branch:branch.name,sha:branch.sha,
      ...verifyApp(snapshot,world,webManifestSha,webContainerSha)});
  }
  const base='https://kimjeon-il.github.io/Pando/assets/data/hydro/';
  const [currentManifest,currentContainer,oldManifest,olderManifest]=await Promise.all([
    publicProbe(base+'v0.13.2/manifest.json'),publicProbe(base+'v0.13.2/hydro.bin'),
    publicProbe(base+'v0.13.1/manifest.json'),publicProbe(base+'v0.12.4/manifest.json')]);
  const passed=web.every(x=>x.valid)&&app.every(x=>x.valid)&&
    currentManifest.status===200&&currentContainer.status===200;
  return {schema:'pandolab-retired-hydro-stage4-gate',version:2,passed,
    web,app,pinnedSourceCommit:BASELINE,activeManifestBlob:webManifestSha,
    activeContainerBlob:webContainerSha,
    publicSite:{currentManifest,currentContainer,oldManifest,olderManifest,
      oldUrlsNotGuaranteed:true},
    warnings:[oldManifest,olderManifest].filter(x=>![404,410].includes(x.status)).map(x=>
      'Retired CDN path may still be cached or unavailable: '+x.url+' status '+x.status),
    note:'Read-only comparison of 7 Web/5 App Git trees and live Pages; never mutates source'};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)try{
  const args=process.argv.slice(2);
  ensure(args.length===2&&args[0]==='--out','Usage: --out path');
  const report=await audit(process.env.GITHUB_TOKEN);
  const output=resolve(args[1]);mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,web:report.web.length,app:report.app.length,
    retiredWeb:report.web.map(x=>x.retiredFiles),activeWeb:report.web.map(x=>x.activeFiles),
    retiredApp:report.app.map(x=>x.retiredFiles),activeApp:report.app.map(x=>x.activeFiles),
    nativePins:report.app.map(x=>x.valid),publicManifest:report.publicSite.currentManifest.status,
    publicContainer:report.publicSite.currentContainer.status},null,2));
  if(!report.passed)process.exitCode=1;
}catch(error){console.error('Current Hydro retirement gate failed: '+(error.stack||error));process.exitCode=1;}
