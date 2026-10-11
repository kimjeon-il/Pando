#!/usr/bin/env node
// Read-only permanent regression check for user-approved terrain v0.12.0 retirement.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const WEB='kimjeon-il/Pando',APP='kimjeon-il/PandoEditor';
const LEGACY='assets/data/terrain/v0.12.0/';
const CURRENT='assets/data/terrain/v0.12.6/';
const OLD_URL='https://kimjeon-il.github.io/Pando/assets/data/terrain/v0.12.0/manifest.json';
const CURRENT_URL='https://kimjeon-il.github.io/Pando/assets/data/terrain/v0.12.6/manifest.json';
const POLICY='docs/data-url-retention-policy.md';
const POLICY_BLOB='d0549afe76a41d27a69a6fb66d18be89c11cbc93';
const CURRENT_RUNTIME_BLOB='419ca1b7e155eb2cd7c81f0ef57a5732084b9416';
const requireThat=(x,message)=>{if(!x)throw Error(message)};
export function summarizeWebTree(items){
  const blobs=items.filter(x=>x.type==='blob');
  const retired=blobs.filter(x=>x.path.startsWith(LEGACY));
  const current=blobs.filter(x=>x.path.startsWith(CURRENT));
  const policy=blobs.find(x=>x.path===POLICY);
  const runtime=blobs.find(x=>x.path==='assets/js/modules/terrain-manifest.js');
  return {retiredFiles:retired.length,currentFiles:current.length,
    currentBytes:current.reduce((n,x)=>n+x.size,0),
    policyBlob:policy?.sha||null,terrainRuntimeBlob:runtime?.sha||null,
    valid:retired.length===0&&current.length===335&&
      current.reduce((n,x)=>n+x.size,0)===367620868&&
      policy?.sha===POLICY_BLOB&&runtime?.sha===CURRENT_RUNTIME_BLOB};
}
export function verifyNativeTerrainManifest(manifest){
  return manifest?.schema==='pandoeditor-world-dataset'&&
    (manifest.version===1||manifest.version===2)&&
    manifest.terrain?.path==='terrain/v0.12.6/manifest.json'&&
    (!manifest.terrain?.source?.path||
      manifest.terrain.source.path==='assets/data/terrain/v0.12.6/manifest.json');
}
async function call(url,token){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(24000)});
  if(!r.ok)throw Error('GitHub '+r.status+' '+url);
  return r.json();
}
const gh=(repo,path)=>'https://api.github.com/repos/'+repo+'/'+path;
async function branches(repo,token){
  const rows=await call(gh(repo,'branches?per_page=100'),token);
  requireThat(rows.length>0&&rows.length<100,'Git branch listing incomplete');
  return rows.map(x=>({name:x.name,sha:x.commit.sha}));
}
async function releaseProbe(url){
  try{
    const r=await fetch(url,{method:'HEAD',redirect:'follow',
      cache:'no-store',signal:AbortSignal.timeout(15000)});
    return {url,status:r.status,contentType:r.headers.get('content-type'),
      ok:r.ok};
  }catch(error){return{url,status:null,error:String(error).slice(0,130)};}
}
async function verify(repo,refs,token){
  const rows=[];
  for(let i=0;i<refs.length;i+=3){
    const batch=await Promise.all(refs.slice(i,i+3).map(async ref=>{
      const t=await call(gh(repo,'git/trees/'+ref.sha+'?recursive=1'),token);
      requireThat(!t.truncated,'Truncated Git tree '+repo+' '+ref.name);
      const policy=t.tree.find(x=>x.type==='blob'&&x.path===POLICY);
      if(repo===WEB){
        return{branch:ref.name,head:ref.sha,...summarizeWebTree(t.tree)};
      }
      const mf=t.tree.find(x=>x.type==='blob'&&x.path==='assets/world/manifest.json');
      requireThat(!!mf,'Missing App world manifest '+ref.name);
      const blob=await call(gh(repo,'git/blobs/'+mf.sha),token);
      requireThat(blob.encoding==='base64','Unrecognized App manifest encoding');
      const data=JSON.parse(Buffer.from(blob.content.replace(/\s/g,''),'base64').toString('utf8'));
      return{branch:ref.name,head:ref.sha,manifestVersion:data.version,
        nativeTerrain:'terrain/v0.12.6/manifest.json',
        policyBlob:policy?.sha||null,
        valid:verifyNativeTerrainManifest(data)&&policy?.sha===POLICY_BLOB};
    }));
    rows.push(...batch);
  }
  return rows;
}
export async function audit(token){
  requireThat(token?.length>10,'GitHub read token required');
  const [webRefs,appRefs]=await Promise.all([branches(WEB,token),branches(APP,token)]);
  requireThat(webRefs.length===7&&appRefs.length===5,'Branch set changed, review before cleanup');
  const [web,app,oldSite,currentSite]=await Promise.all([
    verify(WEB,webRefs,token),verify(APP,appRefs,token),
    releaseProbe(OLD_URL),releaseProbe(CURRENT_URL)]);
  const sourceValid=web.every(x=>x.valid)&&app.every(x=>x.valid);
  const deployedNewOK=currentSite.status===200;
  const oldGone=oldSite.status===404||oldSite.status===410;
  const report={schema:'pandolab-v0120-retirement-audit',version:1,
    policyEffectiveDate:'2026-10-09',
    web,app,sourceValid,publicSite:{retiredManifest:oldSite,currentManifest:currentSite,
      retiredUrlNoLongerGuaranteed:true,deployedCurrentHealthy:deployedNewOK,
      retiredUrlNoLongerServed:oldGone},
    passed:sourceValid&&deployedNewOK,
    warnings:[...(oldGone?[]:['CDN still responds or cannot check retired URL: propagation is informational; old URLs are not guaranteed']),
      ...(deployedNewOK?[]:['Current terrain manifest is unavailable on the public Pages site'])],
    note:'Historical URL can return 404 by explicit policy; Git history retains original binary blobs'};
  return report;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const args=process.argv.slice(2);
    requireThat(args.length===2&&args[0]==='--out'&&args[1],'Usage: --out path');
    const result=await audit(process.env.GITHUB_TOKEN);
    const f=resolve(args[1]);mkdirSync(dirname(f),{recursive:true});
    writeFileSync(f,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({passed:result.passed,webBranches:result.web.length,
      appBranches:result.app.length,oldFiles:result.web.map(x=>x.retiredFiles),
      currentFiles:result.web.map(x=>x.currentFiles),
      oldUrlStatus:result.publicSite.retiredManifest.status,
      currentUrlStatus:result.publicSite.currentManifest.status,
      warnings:result.warnings},null,2));
    if(!result.passed)process.exitCode=1;
  }catch(error){console.error('Retired terrain audit failed: '+error.stack);process.exitCode=1;}
}
