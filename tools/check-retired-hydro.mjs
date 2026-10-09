#!/usr/bin/env node
// Permanent Stage-3 regression gate: no retired hydro binaries may re-enter any branch.
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const WEB='kimjeon-il/Pando',APP='kimjeon-il/PandoEditor';
const BASELINE='6dce59ea427e0728ef29bea31e2e51afbf27d9c8';
const OLD=/^assets\/data\/hydro\/v0\.12\.[2-6]\//;
const NEW=/^assets\/data\/hydro\/v0\.13\.[01]\//;
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const toBlobs=(tree)=>{
  ensure(tree?.truncated===false&&Array.isArray(tree.tree),'Complete Git tree required');
  return tree.tree.filter(x=>x.type==='blob');
};
const map=(tree)=>new Map(toBlobs(tree).map(x=>[x.path,x]));
export function verifyWeb(tree,baseline){
  const refs=map(tree),expected=toBlobs(baseline).filter(x=>NEW.test(x.path));
  const older=[...refs.keys()].filter(x=>OLD.test(x));
  const active=[...refs.keys()].filter(x=>NEW.test(x));
  const changed=expected.filter(x=>refs.get(x.path)?.sha!==x.sha||refs.get(x.path)?.size!==x.size);
  const unexpected=active.filter(x=>!expected.some(z=>z.path===x));
  const restoreScript=refs.get('tools/restore-archival-hydro.py');
  return {retiredFiles:older.length,activeFiles:active.length,
    baselineActiveFiles:expected.length,changedActiveFiles:changed.length,
    unexpectedActiveFiles:unexpected.length,restoreToolPresent:!!restoreScript,
    valid:older.length===0&&expected.length===9&&changed.length===0&&
      unexpected.length===0&&!!restoreScript,
    retiredSample:older.slice(0,12)};
}
export function verifyApp(tree,world,webManifestSha){
  const blobs=toBlobs(tree);
  const legacy=blobs.filter(x=>/^assets\/world\/hydro\/v0\.12\.[2-6]\//.test(x.path));
  const nativeCurrent=blobs.find(x=>x.path==='assets/world/hydro/v0.13.1/manifest.json');
  const valid=world?.schema==='pandoeditor-world-dataset'&&[1,2].includes(world.version)&&
    world.hydro?.path==='hydro/v0.13.1/manifest.json'&&
    world.hydro.gitBlobSha===webManifestSha&&
    nativeCurrent?.sha===webManifestSha&&legacy.length===0;
  return {legacyFiles:legacy.length,version:world?.version,
    pinnedWebBlob:world?.hydro?.gitBlobSha||null,valid};
}
async function gh(repo,path,token){
  const response=await fetch('https://api.github.com/repos/'+repo+'/'+path,{
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('GitHub HTTP '+response.status+' '+repo+'/'+path+
    ' '+(await response.text()).slice(0,300));
  return response.json();
}
async function allBranches(repo,token){
  const b=await gh(repo,'branches?per_page=100',token);
  ensure(b.length>0&&b.length<100,'Incomplete branch listing '+repo);
  ensure(b.some(x=>x.name==='main')&&b.some(x=>x.name==='work/gis'),
    'Main and GIS branches required '+repo);
  return b.map(x=>({name:x.name,sha:x.commit.sha}));
}
async function publicProbe(url){
  try {
    const r=await fetch(url,{method:'HEAD',cache:'no-store',redirect:'follow',
      signal:AbortSignal.timeout(15000)});
    return {url,status:r.status,ok:r.ok};
  }catch(e){return {url,status:null,error:String(e).slice(0,200)};}
}
export async function audit(token){
  ensure(typeof token==='string'&&token.length>10,'GitHub read token required');
  const baseline=await gh(WEB,'git/trees/'+BASELINE+'?recursive=1',token);
  const original=map(baseline);
  const webPin=original.get('assets/data/hydro/v0.13.1/manifest.json')?.sha;
  ensure(webPin&&/^[a-f0-9]{40}$/.test(webPin),'Original current manifest missing');
  const [webRefs,appRefs]=await Promise.all([
    allBranches(WEB,token),allBranches(APP,token)]);
  const web=[],app=[];
  for(const branch of webRefs){
    const snapshot=await gh(WEB,'git/trees/'+branch.sha+'?recursive=1',token);
    web.push({branch:branch.name,sha:branch.sha,...verifyWeb(snapshot,baseline)});
  }
  for(const branch of appRefs){
    const snapshot=await gh(APP,'git/trees/'+branch.sha+'?recursive=1',token);
    const manifestBlob=toBlobs(snapshot).find(x=>x.path==='assets/world/manifest.json')?.sha;
    ensure(!!manifestBlob,'App manifest missing '+branch.name);
    const data=await gh(APP,'git/blobs/'+manifestBlob,token);
    ensure(data.encoding==='base64','Unexpected App manifest encoding');
    const world=JSON.parse(Buffer.from(data.content.replace(/\s+/g,''),'base64').toString());
    app.push({branch:branch.name,sha:branch.sha,...verifyApp(snapshot,world,webPin)});
  }
  const current=await publicProbe('https://kimjeon-il.github.io/Pando/assets/data/hydro/v0.13.1/manifest.json');
  const past=await publicProbe('https://kimjeon-il.github.io/Pando/assets/data/hydro/v0.12.4/manifest.json');
  const passed=web.every(x=>x.valid)&&app.every(x=>x.valid)&&current.status===200;
  return {schema:'pandolab-retired-hydro-stage3-gate',version:1,
    passed,web,app,pinnedSourceCommit:BASELINE,activeManifestBlob:webPin,
    publicSite:{current,oldSample:past,oldUrlsNotGuaranteed:true},
    warnings:past.status===404||past.status===410?[]:[
      'Historical CDN path may remain cached or is unavailable; retired URLs are not guaranteed'],
    note:'Reads Git trees and Pages status; never mutates repository data'};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)try{
  const args=process.argv.slice(2);
  ensure(args.length===2&&args[0]==='--out','Usage: --out path');
  const report=await audit(process.env.GITHUB_TOKEN);
  const output=resolve(args[1]);mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,web:report.web.length,app:report.app.length,
    obsolete:report.web.map(x=>x.retiredFiles),active:report.web.map(x=>x.activeFiles),
    appPins:report.app.map(x=>x.valid),currentPublicStatus:report.publicSite.current.status,
    oldPublicStatus:report.publicSite.oldSample.status},null,2));
  if(!report.passed)process.exitCode=1;
}catch(error){console.error('Retired hydro gate failed: '+(error.stack||error));process.exitCode=1;}
