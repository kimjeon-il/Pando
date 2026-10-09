#!/usr/bin/env node
// Legacy hydro Stage 2: read-only review, never delete tracked files.
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const VERSIONS=['v0.12.2','v0.12.3','v0.12.4','v0.12.5','v0.12.6'];
const WEB='kimjeon-il/Pando',APP='kimjeon-il/PandoEditor';
const ACTIVE='assets/data/hydro/v0.13.1/manifest.json';
const CODE_DIR=/^(assets\/js\/|scripts\/|tools\/|tests\/|\.github\/|app\/|core\/|engine\/|renderer\/|platform\/|ui\/|resources\/)/;
const TEXT=/\.(?:js|mjs|cjs|jsx|ts|tsx|py|cpp|cc|c|hpp|h|sh|ps1|cmake|yml|yaml|json|qrc|xml|html|css|gradle|ini|toml|txt|md)$/i;
const check=(ok,why)=>{if(!ok)throw Error(why)};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const versionFor=p=>VERSIONS.find(v=>p.startsWith('assets/data/hydro/'+v+'/'))||null;
const bytes=rows=>rows.reduce((s,x)=>s+x.size,0);

export function normalizeTree(doc){
  check(doc?.truncated===false&&Array.isArray(doc.tree),'Full non-truncated Git tree required');
  const files=new Map();
  for(const e of doc.tree){
    if(e.type!=='blob')continue;
    check(typeof e.path==='string'&&sha(e.sha)&&Number.isSafeInteger(e.size)&&e.size>=0,
      'Invalid blob metadata '+e.path);
    check(!files.has(e.path),'Duplicate Git path '+e.path);
    files.set(e.path,{path:e.path,sha:e.sha,size:e.size});
  }
  return files;
}
export function legacyInventory(tree){
  const files=[...tree.values()].filter(x=>versionFor(x.path)).sort((a,b)=>a.path.localeCompare(b.path));
  const groups=VERSIONS.map(version=>{
    const subset=files.filter(x=>versionFor(x.path)===version);
    check(subset.length>0&&subset.some(x=>x.path.endsWith('/manifest.json')),
      'Missing legacy manifest '+version);
    return {version,files:subset.length,bytes:bytes(subset)};
  });
  return {files,groups,fileCount:files.length,byteCount:bytes(files)};
}
export function compareLegacy(baseline,other){
  const now=legacyInventory(other),base=new Map(baseline.files.map(f=>[f.path,f]));
  const changed=now.files.filter(f=>!base.has(f.path)||base.get(f.path).sha!==f.sha||
    base.get(f.path).size!==f.size);
  const missing=baseline.files.filter(f=>!other.has(f.path));
  return {identical:changed.length===0&&missing.length===0,files:now.fileCount,
    bytes:now.byteCount,changed:changed.slice(0,6),missing:missing.slice(0,6)};
}
export function normalizeActiveReference(url){
  check(typeof url==='string'&&!url.startsWith('/')&&!url.includes('\\')&&
    !url.includes('?')&&!url.includes('#'),'Unsafe current hydro URL '+url);
  const parts=[];
  for(const part of ('hydro/v0.13.1/'+url).split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){check(parts.length>0,'Hydro path escape');parts.pop();}
    else parts.push(part);
  }
  const p='assets/data/'+parts.join('/');
  check(/^assets\/data\/hydro\/v0\.13\.[01]\/[A-Za-z0-9._/-]+$/.test(p),
    'Current hydro depends on obsolete/outside version '+p);
  return p;
}
export function activeClosure(m){
  check(m?.version==='0.13.1'&&m?.schema==='pandolab-water-shards-v5',
    'Unexpected active hydro manifest');
  const roles=[m.index,m.metadata?.core,m.metadata?.detail,...(m.shards||[])];
  check(roles.length===6,'Unexpected active hydro role count');
  const refs=new Map();
  for(const a of roles){
    check(a&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&digest(a.sha256),
      'Invalid active role size/SHA');
    const path=normalizeActiveReference(a.url);
    check(!refs.has(path),'Duplicated active hydro reference '+path);
    refs.set(path,{path,bytes:a.bytes,sha256:a.sha256});
  }
  return refs;
}
export function classify(path,line,version){
  const found={path,version,line:line.slice(0,260)};
  if(/^(docs\/|reports\/)/.test(path)||path.endsWith('.md'))return {...found,kind:'documentation'};
  if(['tools/plan-legacy-hydro-retirement.mjs',
    'tests/unit/legacy-hydro-retirement.test.mjs'].includes(path))
    return {...found,kind:'audit-self'};
  if(path==='tools/report-hydro-v0124.py'&&['v0.12.3','v0.12.4'].includes(version))
    return {...found,kind:'historical-input'};
  if(path==='tools/repack-water-v0125.py'){
    if(version==='v0.12.4')return {...found,kind:'historical-input'};
    if(version==='v0.12.5')return {...found,kind:'obsolete-generator-output'};
  }
  if(/hydro|water|river/i.test(path)||
    /hydro.{0,120}0\.12\.[2-6]|0\.12\.[2-6].{0,120}hydro/i.test(line))
    return {...found,kind:'unexpected-consumer'};
  return {...found,kind:'other-version-domain'};
}
export function codePaths(tree){
  const files=[],unscanned=[];
  for(const f of tree.values()){
    const p=f.path;
    if(p.startsWith('assets/data/')||p.startsWith('assets/js/vendor/')||
      p.startsWith('third_party/'))continue;
    const eligible=CODE_DIR.test(p)||/^(docs\/|reports\/)/.test(p)||
      ['index.html','package.json','CMakeLists.txt','AGENTS.md'].includes(p);
    if(!eligible||(!TEXT.test(p)&&p!=='CMakeLists.txt'))continue;
    if(f.size>1500000){
      unscanned.push({path:p,size:f.size,
        class:/^(docs\/|reports\/)/.test(p)?'document':'source'});continue;
    }
    files.push(p);
  }
  return {files:files.sort(),unscanned};
}
export function parseGrep(stdout,commit){
  const refs=[];
  for(const row of stdout.split(/\r?\n/)){
    if(!row)continue;
    check(row.startsWith(commit+':'),'Git grep result wrong commit');
    const m=/^([^:]+):(\d+):(.*)$/.exec(row.slice(commit.length+1));
    check(!!m,'Cannot parse Git grep output');
    for(const hit of m[3].matchAll(/v?0\.12\.[2-6]/g)){
      refs.push({...classify(m[1],m[3],'v'+hit[0].replace(/^v/,'')),lineNumber:Number(m[2])});
    }
  }
  return refs;
}
export function decide(baseline,refs){
  const groups=baseline.groups.map(g=>{
    const mentions=refs.filter(r=>r.version===g.version);
    const blocking=mentions.filter(r=>['historical-input','unexpected-consumer'].includes(r.kind));
    const mentionCounts={};for(const r of mentions)mentionCounts[r.kind]=(mentionCounts[r.kind]||0)+1;
    return {...g,mentionCounts,blockingSamples:blocking.slice(0,15),
      status:blocking.length?'hold-historical-inputs':'candidate-for-deletion-preflight'};
  });
  return {groups,candidateFiles:groups.filter(g=>g.status.startsWith('candidate')).reduce((n,g)=>n+g.files,0),
    candidateBytes:groups.filter(g=>g.status.startsWith('candidate')).reduce((n,g)=>n+g.bytes,0),
    holdFiles:groups.filter(g=>g.status.startsWith('hold')).reduce((n,g)=>n+g.files,0),
    holdBytes:groups.filter(g=>g.status.startsWith('hold')).reduce((n,g)=>n+g.bytes,0)};
}
function git(dir,args){
  const x=spawnSync('git',['-C',dir,...args],{encoding:'utf8',maxBuffer:16*1024*1024});
  check(!x.error&&x.status===0,'Git failed: '+args[0]+': '+String(x.stderr||x.error).slice(0,600));
  return x.stdout;
}
const gitText=(dir,commit,path)=>git(dir,['show',commit+':'+path]);
const gitJson=(dir,commit,path)=>JSON.parse(gitText(dir,commit,path));
function grep(dir,commit,files){
  const hits=[],terms=VERSIONS.flatMap(v=>['-e',v.slice(1)]);
  for(let i=0;i<files.length;i+=90){
    const x=spawnSync('git',['-C',dir,'grep','-I','-n','-F',...terms,
      commit,'--',...files.slice(i,i+90)],{encoding:'utf8',maxBuffer:6*1024*1024});
    check(!x.error&&[0,1].includes(x.status),'Git grep failed: '+String(x.stderr||x.error).slice(0,700));
    if(x.status===0)hits.push(...parseGrep(x.stdout,commit));
  }
  return hits;
}
async function gh(repo,path,token){
  const res=await fetch('https://api.github.com/repos/'+repo+'/'+path,{
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
      ...(token?{Authorization:'Bearer '+token}:{})},
    signal:AbortSignal.timeout(90000)});
  check(res.ok,'GitHub API '+res.status+' '+repo+'/'+path+': '+(await res.text()).slice(0,350));
  return res.json();
}
async function branches(repo,token){
  const list=await gh(repo,'branches?per_page=100',token);
  check(list.length>0&&list.length<100,'Incomplete repository branch listing: '+repo);
  return list.map(x=>({name:x.name,sha:x.commit.sha})).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function audit({webDir,appDir,token}){
  const [wr,ar]=await Promise.all([branches(WEB,token),branches(APP,token)]);
  check(wr.some(x=>x.name==='main')&&wr.some(x=>x.name==='work/gis')&&
    ar.some(x=>x.name==='main')&&ar.some(x=>x.name==='work/gis'),
    'Main/GIS branch missing');
  const web=[],app=[],refs=[],coverage=[];
  const repoGroups=[[WEB,webDir,wr],[APP,appDir,ar]];
  for(const [repo,dir,branches] of repoGroups)for(const b of branches){
    check(git(dir,['rev-parse','refs/remotes/origin/'+b.name]).trim()===b.sha,
      'Git branch HEAD changed during audit: '+repo+'/'+b.name);
  }
  let baseline,activeManifestBlob;
  for(const [repo,dir,branches] of repoGroups)for(const b of branches){
    const tree=normalizeTree(await gh(repo,'git/trees/'+b.sha+'?recursive=1',token));
    if(repo===WEB&&b.name==='main'){
      baseline=legacyInventory(tree);
      activeManifestBlob=tree.get(ACTIVE)?.sha;
      check(sha(activeManifestBlob),'No current Web hydro manifest');
    }
    if(repo===WEB){
      const match=compareLegacy(baseline,tree);
      check(match.identical,'Old hydro Blob/size drift '+b.name+': '+JSON.stringify(match));
      check(/HYDRO_DATA_VERSION\s*=\s*['"]0\.13\.1['"]/.test(
        gitText(dir,b.sha,'assets/js/modules/app-environment.js')),
        'Web runtime points to unexpected hydro on '+b.name);
      check(tree.get(ACTIVE)?.sha===activeManifestBlob,'Current hydro manifest differs on '+b.name);
      const active=activeClosure(gitJson(dir,b.sha,ACTIVE));
      for(const item of active.values())
        check(tree.get(item.path)?.size===item.bytes,'Missing active data '+item.path);
      web.push({branch:b.name,sha:b.sha,...match,activeRoles:active.size});
    }else{
      const world=gitJson(dir,b.sha,'assets/world/manifest.json');
      const inventory=gitJson(dir,b.sha,'assets/world/physical-inventory-c0bd31d1.json');
      check(world.schema==='pandoeditor-world-dataset'&&[1,2].includes(world.version)&&
        world.hydro?.path==='hydro/v0.13.1/manifest.json'&&
        world.hydro.gitBlobSha===activeManifestBlob,'App hydro pin drift '+b.name);
      check(Array.isArray(inventory.assets)&&inventory.assets.some(x=>x.path?.startsWith('hydro/'))&&
        inventory.assets.every(x=>!/^hydro\/v0\.12\.[2-6]\//.test(x.path||'')),
        'Native physical data refers to obsolete hydro '+b.name);
      check(![...tree.keys()].some(x=>/^assets\/world\/hydro\/v0\.12\.[2-6]\//.test(x)),
        'App contains old hydro version '+b.name);
      app.push({branch:b.name,sha:b.sha,manifestSchema:world.version,pinnedWebBlob:activeManifestBlob});
    }
    const selected=codePaths(tree);
    check(!selected.unscanned.some(x=>x.class==='source'),
      'Code was omitted from text scan: '+JSON.stringify(selected.unscanned.filter(x=>x.class==='source')));
    coverage.push({repo,branch:b.name,files: selected.files.length,
      skippedLargeDocuments:selected.unscanned.length});
    refs.push(...grep(dir,b.sha,selected.files).map(x=>({...x,repo,branch:b.name})));
  }
  const unexpected=refs.filter(x=>x.kind==='unexpected-consumer');
  check(unexpected.length===0,'Unclassified code usage: '+JSON.stringify(unexpected.slice(0,15)));
  const historic=refs.filter(x=>x.kind==='historical-input');
  for(const [p,v] of [
    ['tools/report-hydro-v0124.py','v0.12.3'],
    ['tools/report-hydro-v0124.py','v0.12.4'],
    ['tools/repack-water-v0125.py','v0.12.4']])
    check(historic.some(x=>x.path===p&&x.version===v),'Archival tool input unverified: '+p+' '+v);
  const result=decide(baseline,refs);
  check(result.holdFiles+result.candidateFiles===baseline.fileCount,'Incomplete groups');
  const counts={};for(const x of refs)counts[x.kind]=(counts[x.kind]||0)+1;
  return {schema:'pandolab-legacy-hydro-stage2-plan',version:1,passed:true,
    source:{web:WEB,app:APP,webBranches:wr,appBranches:ar},
    baseline:{groups:baseline.groups,totalFiles:baseline.fileCount,totalBytes:baseline.byteCount},
    web,app,coverage,referenceCounts:counts,decisions:result,references:refs.slice(0,1200),
    lockedCandidates:baseline.files.map(x=>({...x,
      restore:{repository:WEB,commit:wr.find(y=>y.name==='main').sha,path:x.path}})),
    unresolvedRisks:['Historical user projects may contain custom old-data URLs.',
      'Old native release ZIP/EXE download dependencies were not individually inspected.',
      'Historical comparison/repack scripts must be migrated before their input files are deleted.',
      'Git history remains recoverable but deleting branch HEAD files does not reclaim existing Git objects.'],
    deletionExecuted:false,deletionApproved:false};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)try{
  const args=process.argv.slice(2),options=new Map();
  check(args.length%2===0,'Key/value flags required');
  for(let i=0;i<args.length;i+=2){
    check(['--web-dir','--app-dir','--out'].includes(args[i])&&!options.has(args[i]),'Invalid flag '+args[i]);
    options.set(args[i],args[i+1]);
  }
  check(options.size===3,'Require --web-dir, --app-dir, --out');
  const value=await audit({webDir:resolve(options.get('--web-dir')),
    appDir:resolve(options.get('--app-dir')),token:process.env.GITHUB_TOKEN});
  const dest=resolve(options.get('--out'));mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,JSON.stringify(value,null,2)+'\n');
  console.log(JSON.stringify({passed:value.passed,webBranches:value.web.length,
    appBranches:value.app.length,baseline:value.baseline,decisions:value.decisions,
    references:value.referenceCounts},null,2));
}catch(error){console.error('Stage2 hydro audit failed: '+(error.stack||error));process.exitCode=1;}
