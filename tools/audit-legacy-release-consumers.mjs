#!/usr/bin/env node
// Read-only, fail-closed cross-branch and public-deployment evidence for GIS archive review.
// No branch, published asset, release or user project is modified.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {audit,parseGitHubTree,groupOf,dataRelative} from './audit-legacy-gis-assets.mjs';

const WEB='kimjeon-il/Pando';
const APP='kimjeon-il/PandoEditor';
const requireThat=(c,m)=>{if(!c)throw new Error(m);};
const isSha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const now=()=>new Date().toISOString();
const apiBase='https://api.github.com/repos/';
const limited=(rows,n=100)=>rows.length>n?rows.slice(0,n):rows;
const asUri=(repo,path)=>apiBase+repo+'/'+path;
const sortedUnique=a=>[...new Set(a)].sort();
const fullPath=path=>'assets/data/'+path;

function safeDataPath(value){
  requireThat(typeof value==='string' && value.length>0 &&
    !value.startsWith('/') && !value.startsWith('../') &&
    !value.includes('\\') && !value.includes('://'),
    'Unsafe data asset reference '+value);
  return value;
}
function addReference(refs,tree,asset,why,unknown){
  const p=safeDataPath(asset);
  const found=tree.get(fullPath(p));
  if(!found)unknown.push({type:'missing-in-pinned-tree',asset:p,why});
  refs.push({asset:p,why,exists:!!found,gitBlob:found?.sha||null});
}
export function collectWebReferences(tree,blobs,branch){
  const refs=[],unknown=[];
  const readText=path=>{
    const meta=tree.get(path);
    return meta?blobs.get(meta.sha)??null:null;
  };
  const readJson=path=>{
    const text=readText(path);
    if(text===null)return null;
    try{return JSON.parse(text);}
    catch{unknown.push({type:'invalid-json',path});return null;}
  };
  const textEnv=readText('assets/js/modules/app-environment.js')||'';
  const textTerrain=readText('assets/js/modules/terrain-manifest.js')||'';
  const worker=readText('assets/js/workers/data-loader-worker.js')||'';
  const pkg=readJson('package.json')||{};
  const hydro=textEnv.match(/HYDRO_DATA_VERSION\s*=\s*['"]([0-9.]+)['"]/);
  const terrain=textTerrain.match(/TERRAIN_RASTER_VERSION\s*=\s*['"]([0-9.]+)['"]/);
  if(!hydro||!terrain)unknown.push({type:'unresolved-physical-version',branch});
  const usesBundle=worker.includes('world/current.json');
  const legacyPath='world-preview-v'+String(pkg.version||'')+'.json';
  const manifestPath=usesBundle?'world/current.json':legacyPath;
  const manifest=readJson(fullPath(manifestPath));
  if(!manifest){
    unknown.push({type:'missing-runtime-world-manifest',branch,path:manifestPath});
  }else{
    addReference(refs,tree,manifestPath,'web:'+branch+':startup-manifest',unknown);
    const source=usesBundle?manifest.source?.url:manifest.source;
    if(source && typeof source==='string')addReference(refs,tree,source,'web:'+branch+':world-source',unknown);
    if(usesBundle && source && typeof source==='object' && typeof source.url==='string')
      addReference(refs,tree,source.url,'web:'+branch+':world-source',unknown);
    for(const [role,a] of Object.entries(manifest.assets||{}))
      if(typeof a?.url==='string')addReference(refs,tree,a.url,'web:'+branch+':'+role,unknown);
    if(usesBundle)for(const [key,p] of Object.entries(manifest.compatibility?.sharedBoundaries||{}))
      addReference(refs,tree,p,'web:'+branch+':boundary-'+key,unknown);
    else if(worker.includes('world-preview-v')) {
      // A legacy loader is a real retained consumer even when GIS uses SHA paths.
      if(!pkg.version)unknown.push({type:'unknown-package-version',branch});
    }
  }
  const hydroPath=hydro?'hydro/v'+hydro[1]+'/manifest.json':null;
  if(hydroPath){
    const m=readJson(fullPath(hydroPath));
    if(m){
      addReference(refs,tree,hydroPath,'web:'+branch+':hydro-manifest',unknown);
      const roles=[['index',m.index],['core',m.metadata?.core],['detail',m.metadata?.detail],
        ...(m.shards||[]).map(s=>['shard-'+s.id,s])];
      for(const [kind,spec] of roles)if(spec?.url){
        const rel=dataRelative(hydroPath,spec.url);
        addReference(refs,tree,rel,'web:'+branch+':hydro-'+kind,unknown);
      }
    }else unknown.push({type:'missing-hydro-manifest',branch,path:hydroPath});
  }
  const terrainPath=terrain?'terrain/v'+terrain[1]+'/manifest.json':null;
  if(terrainPath){
    const m=readJson(fullPath(terrainPath));
    if(m){
      addReference(refs,tree,terrainPath,'web:'+branch+':terrain-manifest',unknown);
      if(!m.urlTemplate||!Array.isArray(m.levels))unknown.push({type:'invalid-terrain-tiling',branch});
      else for(const l of m.levels){
        if(!Number.isInteger(l.id)||!Number.isInteger(l.columns)||!Number.isInteger(l.rows)||
          l.columns<1||l.rows<1||l.columns*l.rows>2000){
          unknown.push({type:'invalid-terrain-level',branch});continue;
        }
        // Use one group representative here: stage 6 checks all 334 current tiles.
        const p=m.urlTemplate.replace('{level}',String(l.id)).replace('{column}','0').replace('{row}','0');
        addReference(refs,tree,p,'web:'+branch+':terrain-sample-level-'+l.id,unknown);
      }
    }else unknown.push({type:'missing-terrain-manifest',branch,path:terrainPath});
  }
  return {branch,worldContract:usesBundle?'sha-bundle':'versioned-legacy',version:pkg.version||null,
    hydroVersion:hydro?.[1]||null,terrainVersion:terrain?.[1]||null,
    referenceCount:refs.length,references:refs,unknown};
}
export function collectAppReferences(tree,blobs,branch,webDataTree){
  const unknown=[],refs=[];
  const spec=tree.get('assets/world/manifest.json');
  let manifest=null;
  if(!spec){unknown.push({type:'missing-app-manifest',branch});}
  else {
    const text=blobs.get(spec.sha);
    try{manifest=JSON.parse(text||'');}catch{unknown.push({type:'unreadable-app-manifest',branch});}
  }
  if(manifest){
    if(manifest.schema!=='pandoeditor-world-dataset')unknown.push({type:'unknown-app-schema',branch});
    for(const [role,entry] of Object.entries(manifest)){
      if(!entry||typeof entry!=='object'||typeof entry.path!=='string')continue;
      const p=entry.source?.path?.startsWith('assets/data/')
        ?entry.source.path.slice('assets/data/'.length):entry.path;
      const record=webDataTree.get(fullPath(p));
      if(!record)unknown.push({type:'no-corresponding-web-path',role,branch,path:p});
      if(record?.sha!==entry.gitBlobSha)unknown.push({type:'web-blob-drift',role,branch,path:p});
      refs.push({asset:p,why:'app:'+branch+':'+role,exists:!!record,
        gitBlob:record?.sha||null,expectedGitBlob:entry.gitBlobSha});
    }
  }
  return {branch,manifestVersion:manifest?.version??null,referenceCount:refs.length,references:refs,unknown};
}
export function selectSamples(stage6,tree){
  const rows=stage6.groups.filter(g=>g.classification==='archive-review-not-delete-ready');
  const paths=[...tree.keys()].filter(p=>p.startsWith('assets/data/'))
    .map(p=>p.slice('assets/data/'.length)).sort();
  return rows.map(g=>{
    const matches=paths.filter(p=>groupOf(p)===g.group);
    // A manifest and a representative chunk/tile when relevant.
    const manifest=matches.find(p=>p.endsWith('/manifest.json'));
    const physical=matches.find(p=>p.endsWith('.webp')||p.endsWith('.bin')||p.endsWith('.bin.gz'));
    const samples=sortedUnique([manifest,physical,matches[0]].filter(Boolean)).slice(0,3);
    return {group:g.group,expectedFiles:g.files,trackedFiles:matches.length,samples};
  });
}
function classifyHttpProbe(result){
  if(!result)return 'not-checked';
  if(result.ok===true&&[200,206].includes(result.status))return 'publicly-reachable-sample';
  if(result.status===404||result.status===410)return 'not-found-on-tested-origin';
  return 'unknown';
}
export function assess(stage6,evidence){
  requireThat(stage6?.passed===true&&Array.isArray(stage6.groups),'Stage 6 active-asset verification required');
  requireThat(evidence?.schema==='pando-legacy-release-evidence','Invalid stage 7 evidence');
  requireThat(evidence.webBranches?.length>0&&evidence.appBranches?.length>0,'Missing cross-branch evidence');
  const webSet=new Set(),appSet=new Set();
  for(const b of evidence.webBranches)for(const r of b.references||[])if(r.exists)webSet.add(groupOf(r.asset));
  for(const b of evidence.appBranches)for(const r of b.references||[])if(r.exists)appSet.add(groupOf(r.asset));
  const publicResults=new Map();
  for(const p of evidence.publicProbes||[]){
    if(!publicResults.has(p.group))publicResults.set(p.group,[]);
    publicResults.get(p.group).push(p);
  }
  const candidates=stage6.groups.filter(g=>g.classification==='archive-review-not-delete-ready');
  const groups=candidates.map(g=>{
    const crossBranch=webSet.has(g.group),appPinned=appSet.has(g.group);
    const results=publicResults.get(g.group)||[];
    const publicReachable=results.some(r=>classifyHttpProbe(r)==='publicly-reachable-sample');
    const state=crossBranch?'retain-web-branch-consumer':
      appPinned?'retain-native-app-consumer':
      publicReachable?'retain-public-asset-url':'archive-review-blocked';
    const reasons=[
      ...(crossBranch?['Another Web branch references a tracked asset in this group']:[]),
      ...(appPinned?['An App branch pins an asset in this group']:[]),
      ...(publicReachable?['A historical public asset URL is responsive']:[]),
      ...(results.some(r=>classifyHttpProbe(r)==='unknown')?['Some public origin checks were inconclusive']:[]),
      ...(evidence.appReleases?.count>0?['Past native releases exist; deployed binaries were not decompiled']:[]),
      'Previously distributed URLs and external consumers cannot be proven absent'
    ];
    return {group:g.group,files:g.files,bytes:g.bytes,state,reasons,
      urlSamples:results.map(r=>({path:r.path,status:r.status,outcome:classifyHttpProbe(r),url:r.url||null})),
      recovery:{webGitCommit:stage6.gitHead,requiresRetainedGitHistory:true},
      approvedForDeletion:false};
  });
  const totals={};
  for(const g of groups){
    const t=totals[g.state]||(totals[g.state]={groups:0,files:0,bytes:0});
    t.groups++;t.files+=g.files;t.bytes+=g.bytes;
  }
  const issues=[...(evidence.webBranches||[]).flatMap(b=>b.unknown||[]),
    ...(evidence.appBranches||[]).flatMap(b=>b.unknown||[])];
  const scanned=groups.reduce((v,g)=>v+g.files,0);
  return {schema:'pandolab-legacy-release-readiness',version:1,
    stage6WebGitHead:stage6.gitHead,branchCoverage:{web:evidence.webBranches.length,app:evidence.appBranches.length},
    candidateGroups:groups.length,candidateFiles:scanned,
    candidateBytes:groups.reduce((v,g)=>v+g.bytes,0),
    publicEvidence:evidence.pages,
    appReleases:evidence.appReleases,referenceUncertainties:limited(issues),
    states:totals,groups,
    deleteReadyGroups:0,deleteReadyFiles:0,
    decision:'retain-until-explicit-approval-and-external-consumer/release-evidence',
    passed:issues.length===0&&groups.every(g=>g.files>0&&g.recovery.webGitCommit===stage6.gitHead)};
}
async function readAPI(url,token,{optional=false}={}){
  const res=await fetch(url,{headers:{Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(25000)});
  if(optional&&res.status===404)return {missing:true};
  if(!res.ok)throw new Error('GitHub API '+res.status+' '+url);
  return await res.json();
}
async function paged(repo,suffix,token,maxPages=4){
  const result=[];
  for(let i=1;i<=maxPages;i++){
    const page=await readAPI(asUri(repo,suffix+'?per_page=100&page='+i),token);
    requireThat(Array.isArray(page),'Expected GitHub array: '+suffix);
    result.push(...page);
    if(page.length<100)return result;
  }
  throw Error('GitHub listing exceeds pagination cap: '+suffix);
}
async function collectBranches(repo,token){
  const branches=await paged(repo,'branches',token);
  requireThat(branches.some(b=>b.name==='main')&&branches.some(b=>b.name==='work/gis'),
    'Required permanent Git branches missing from '+repo);
  const blobs=new Map(),output=[];
  async function content(tree,sha){
    if(blobs.has(sha))return;
    const b=await readAPI(asUri(repo,'git/blobs/'+sha),token);
    requireThat(b.encoding==='base64'&&typeof b.content==='string'&&b.size<=1500000,
      'Invalid or oversized source Git blob '+sha);
    blobs.set(sha,Buffer.from(b.content.replace(/\s/g,''),'base64').toString('utf8'));
  }
  for(const branch of branches){
    const sha=branch.commit?.sha;
    requireThat(isSha(sha),'Invalid branch SHA '+branch.name);
    const t=await readAPI(asUri(repo,'git/trees/'+sha+'?recursive=1'),token);
    const tree=new Map([...parseGitHubTree(t)].map(([p,v])=>[fullPath(p),v]));
    for(const r of t.tree||[])if(r.type==='blob'&&
      (!r.path.startsWith('assets/data/')))tree.set(r.path,{sha:r.sha,bytes:r.size});
    const needed=repo===WEB?['package.json','assets/js/modules/app-environment.js',
      'assets/js/modules/terrain-manifest.js','assets/js/workers/data-loader-worker.js',
      'assets/data/world/current.json',
      'assets/data/world-preview-v'+(branch.name||'')+'.json']:['assets/world/manifest.json'];
    for(const path of needed){
      const rec=tree.get(path);if(rec)await content(tree,rec.sha);
    }
    if(repo===WEB){
      // App version controls the legacy startup name. Avoid assuming the page uses the GIS bundle.
      const p=tree.get('package.json');
      const version=p?JSON.parse(blobs.get(p.sha)).version:'';
      const workerRec=tree.get('assets/js/workers/data-loader-worker.js');
      const usesBundle=workerRec&&blobs.get(workerRec.sha).includes('world/current.json');
      const startup=usesBundle?'assets/data/world/current.json':
        'assets/data/world-preview-v'+String(version||'')+'.json';
      if(tree.has(startup))await content(tree,tree.get(startup).sha);
      const env=tree.get('assets/js/modules/app-environment.js');
      const terra=tree.get('assets/js/modules/terrain-manifest.js');
      const hv=env?blobs.get(env.sha).match(/HYDRO_DATA_VERSION\s*=\s*['"]([0-9.]+)['"]/)?.[1]:null;
      const tv=terra?blobs.get(terra.sha).match(/TERRAIN_RASTER_VERSION\s*=\s*['"]([0-9.]+)['"]/)?.[1]:null;
      for(const path of [hv?'assets/data/hydro/v'+hv+'/manifest.json':null,
        tv?'assets/data/terrain/v'+tv+'/manifest.json':null]){
        if(path&&tree.has(path))await content(tree,tree.get(path).sha);
      }
      const v=collectWebReferences(tree,blobs,branch.name);
      output.push({...v,sha});
    }else{
      // App schema v1 does not have source.path. The packaged file path itself
      // still pins an exact Web Git blob.
      output.push({...collectAppReferences(tree,blobs,branch.name,new Map()),sha});
    }
  }
  return output;
}
function reconcileAppRefs(app,webTree){
  const refs=app.map(b=>({...b,references:b.references.map(r=>{
    const match=webTree.get(fullPath(r.asset));
    return {...r,exists:!!match,gitBlob:match?.sha||null};
  }),unknown:b.unknown.filter(x=>x.type!=='no-corresponding-web-path'&&x.type!=='web-blob-drift')}));
  for(const b of refs)for(const r of b.references){
    if(!r.exists)b.unknown.push({type:'no-web-tracked-source',branch:b.branch,asset:r.asset});
    if(r.expectedGitBlob&&r.gitBlob!==r.expectedGitBlob)
      b.unknown.push({type:'web-source-hash-drift',branch:b.branch,asset:r.asset});
  }
  return refs;
}
function pageCandidatesFromConfig(cfg){
  if(!cfg?.html_url)return [];
  try{
    const url=new URL(cfg.html_url);
    if(url.protocol!=='https:')return [];
    return [{base:url.toString().endsWith('/')?url.toString():url.toString()+'/',source:'github-pages-api'}];
  }catch{return [];}
}
async function publicRootProbe(root){
  const u=new URL(root.base);
  if(u.protocol!=='https:')return {...root,kind:'rejected'};
  try{
    const res=await fetch(u,{signal:AbortSignal.timeout(12000),redirect:'follow'});
    const contentType=res.headers.get('content-type')||'';
    const text=contentType.includes('text/html')&&res.ok?(await res.text()).slice(0,300000):'';
    const signature=/PANDOLAB_APP_VERSION|PANDOLAB_BUILD_META|판도연구소|판도편집기|PandoLab/i.test(text);
    return {...root,status:res.status,verifiedSite:res.ok&&signature,kind:res.ok&&signature?'identified-web-app':'not-verified'};
  }catch(error){return {...root,status:null,verifiedSite:false,kind:'probe-error',error:String(error).slice(0,180)};}
}
async function headProbe(root,path,group){
  const base=root.base.endsWith('/')?root.base:root.base+'/';
  const url=new URL('assets/data/'+path,base).toString();
  try{
    const res=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(13000)});
    const mime=res.headers.get('content-type')||'';
    const contentOK=!mime.toLowerCase().startsWith('text/html');
    return {path,group,url,status:res.status,ok:[200,206].includes(res.status)&&contentOK,
      mime:mime.slice(0,100),source:root.source};
  }catch(error){return{path,group,url,status:null,ok:false,error:String(error).slice(0,180),source:root.source};}
}
async function inBatches(rows,worker,limit=6){
  const result=[];
  for(let i=0;i<rows.length;i+=limit){
    result.push(...await Promise.all(rows.slice(i,i+limit).map(worker)));
  }
  return result;
}
export async function collectEvidence(stage6,rootTree,token){
  requireThat(token&&token.length>10,'GitHub read token required for branch/release provenance');
  const web=await collectBranches(WEB,token),app=await collectBranches(APP,token);
  const appRefs=reconcileAppRefs(app,rootTree);
  const releases=await paged(APP,'releases',token);
  const releaseCount=releases.length;
  const appReleases={count:releaseCount,tagSamples:releases.slice(0,40).map(x=>({
    tag:x.tag_name,published_at:x.published_at,assets:(x.assets||[]).map(a=>({name:a.name,size:a.size})),
    prerelease:x.prerelease,html_url:x.html_url})),
    assessment:'Release artifact contents not inspected; a release remains a potential historical consumer'};
  const pageConfig=await readAPI(asUri(WEB,'pages'),token,{optional:true}).catch(error=>({error:String(error)}));
  const configRoots=pageCandidatesFromConfig(pageConfig.missing?null:pageConfig);
  // These paths are hypotheses from the repo naming history, not verified URLs.
  const hypotheses=[{base:'https://kimjeon-il.github.io/world-map/',source:'old-repo-name-hypothesis'},
    {base:'https://kimjeon-il.github.io/Pando/',source:'renamed-repo-hypothesis'}];
  const tested=await inBatches([...configRoots,...hypotheses],publicRootProbe,3);
  const verified=tested.filter(t=>t.verifiedSite);
  const roots=verified.length?verified:[];
  const sampled=selectSamples(stage6,rootTree);
  const candidates=sampled.flatMap(g=>g.samples.map(path=>({group:g.group,path})));
  // Do not attempt thousands of old binary GETs; HEAD is observational only.
  const first=[...new Map(roots.map(r=>[r.base,r])).values()].slice(0,2);
  const publicProbes=[];
  for(const root of first)publicProbes.push(...await inBatches(candidates,
    x=>headProbe(root,x.path,x.group),6));
  return {schema:'pando-legacy-release-evidence',version:1,collectedAt:now(),
    webBranches:web,appBranches:appRefs,appReleases,
    pages:{api:pageConfig.missing?'not-configured-or-inaccessible':
      pageConfig.error?'unavailable':'configured',configuredUrl:pageConfig.html_url||null,
      source:pageConfig.source||null,buildType:pageConfig.build_type||null,
      publishingStatus:pageConfig.status||null,
      candidates:tested,verifiedRoots:first.map(x=>({base:x.base,source:x.source}))},
    publicProbes,scope:'HEAD samples only; does not establish absence of third-party clients',
    sampledGroups:sampled};
}
function argsMap(argv){
  const parsed=new Map();
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i],v=argv[i+1];
    requireThat(['--root','--tree-json','--app-manifest','--out','--evidence-out'].includes(k) &&
      v&&!v.startsWith('--')&&!parsed.has(k),'Unsupported argument '+k);
    parsed.set(k,v);
  }
  return parsed;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const a=argsMap(process.argv.slice(2));
    requireThat(a.has('--tree-json')&&a.has('--app-manifest')&&a.has('--out'),
      'Expected --tree-json, --app-manifest and --out');
    const stage6=audit(a.get('--root')||resolve(dirname(fileURLToPath(import.meta.url)),'..'),
      {treeJson:a.get('--tree-json'),appManifest:a.get('--app-manifest')});
    const tree=parseGitHubTree(JSON.parse(readFileSync(resolve(a.get('--tree-json')),'utf8')));
    const data=new Map([...tree].map(([k,v])=>[fullPath(k),v]));
    const evidence=await collectEvidence(stage6,data,process.env.GITHUB_TOKEN);
    const decision=assess(stage6,evidence);
    requireThat(decision.passed,'Stage 7 branch coverage/reference integrity failed');
    for(const [path,value] of [[a.get('--out'),decision],[a.get('--evidence-out'),evidence]]){
      if(!path)continue;
      const target=resolve(path);mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,JSON.stringify(value,null,2)+'\n');
    }
    console.log(JSON.stringify({passed:decision.passed,candidateGroups:decision.candidateGroups,
      candidateFiles:decision.candidateFiles,candidateBytes:decision.candidateBytes,
      states:decision.states,branchCoverage:decision.branchCoverage,
      pages:decision.publicEvidence,appReleaseCount:decision.appReleases.count,
      referenceUncertainties:decision.referenceUncertainties,deleteReadyFiles:0},null,2));
  }catch(error){console.error('Stage 7 GIS release-consumer audit failed: '+error.stack);process.exitCode=1;}
}
