// Explicit generated-output retirement used by the permanent-worktree owner.
// Discovery is separate from apply: no directory is disposable merely by age.
import {existsSync,lstatSync,mkdirSync,readFileSync,readlinkSync,readdirSync,renameSync,rmdirSync,statfsSync,unlinkSync,chmodSync,realpathSync,copyFileSync,constants} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {atomicStorageJSON,containedPath,contentFiles,contentHash} from './library-content.mjs';
import {fileHash} from './library-git.mjs';

const schema='pando-generated-cleanup-v1';
const presentPath=path=>{try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export function cargoRetirementRequests({root,seeds,protectedPartitions=[]}){
 const target=containedPath(root,'apps/editor/src-tauri/target'),files=contentFiles(target),nodes=new Map(),hashes=new Map(),directories=new Map();
 const exactJSON=text=>JSON.parse(text,(key,value,context)=>typeof value==='number'?context.source:value);
 for(const f of files.filter(f=>f.logical.includes('/.fingerprint/')&&f.logical.endsWith('.json'))){
  const fingerprint=f.path.slice(0,-5);if(!existsSync(fingerprint))continue;
  const raw=readFileSync(fingerprint,'utf8').trim();if(!/^[0-9a-f]{16}$/.test(raw))continue;
  const value=String(Buffer.from(raw,'hex').readBigUInt64LE()),json=exactJSON(readFileSync(f.path,'utf8'));
  const node={path:f.path,logical:f.logical,directory:dirname(f.path),partition:f.logical.split('/.fingerprint/')[0],value,json};nodes.set(f.logical,node);
  if(!hashes.has(value))hashes.set(value,[]);hashes.get(value).push(node);
  if(!directories.has(node.directory))directories.set(node.directory,[]);directories.get(node.directory).push(node);
 }
 const keep=new Set(),unresolved=[];function visit(n){if(keep.has(n.path))return;keep.add(n.path);for(const d of n.json.deps||[]){const found=hashes.get(String(d[3]));if(!found?.length){unresolved.push({node:n.logical,dependency:d[1],fingerprint:d[3]});continue;}for(const dep of found)visit(dep);}}
 for(const seed of seeds){const n=nodes.get(seed);if(!n)throw Error(`Cargo seed is missing or incomplete: ${seed}`);visit(n);}
 for(const n of nodes.values())if(protectedPartitions.includes(n.partition))visit(n);
 if(unresolved.length)throw Error('Current Cargo dependency fingerprint is unresolved: '+JSON.stringify(unresolved.slice(0,4)));
 const requests=[],kept=[],retired=[];const add=path=>requests.push({root,path:relative(root,path).replaceAll('\\','/'),action:'delete',reason:'Cargo fingerprint is outside all explicitly retained current dependency closures'});
 for(const [directory,group]of directories){if(protectedPartitions.includes(group[0].partition)||group.some(n=>keep.has(n.path))){kept.push(relative(target,directory).replaceAll('\\','/'));continue;}
  retired.push(relative(target,directory).replaceAll('\\','/'));add(directory);
  const build=directory.replace(/([\\/])\.fingerprint([\\/])/,'$1build$2');if(existsSync(build))add(build);
  const hash=directory.match(/-([a-f0-9]{16})$/)?.[1],partition=group[0].partition;if(!hash)continue;
  for(const f of files)if(f.logical.startsWith(partition+'/deps/')&&new RegExp('-'+hash+'(?:\\.|$)').test(f.logical))add(f.path);
 }
 const requested=new Set(requests.map(r=>r.path));
 for(const f of files){const match=f.logical.match(/^((?:[^/]+\/)?(?:debug|release))\/build\/([^/]+)\//);if(!match||protectedPartitions.includes(match[1]))continue;
  const fp=resolve(target,match[1],'.fingerprint',match[2]);if(directories.get(fp)?.some(n=>keep.has(n.path)))continue;
  const build=resolve(target,match[1],'build',match[2]),rel=relative(root,build).replaceAll('\\','/');if(!requested.has(rel)){add(build);requested.add(rel);}
 }
 return {requests,seeds,kept,retired,unresolved};
}
const identity=path=>{const s=lstatSync(path,{bigint:true});return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}`;};
const scopePattern=/^(?:apps\/editor\/(?:src-tauri\/(?:target|gen\/android\/(?:app\/build|build|\.gradle)))(?:\/|$)|apps\/web-shell(?:\/|$)|(?:apps\/editor\/)?node_modules\/\.pnpm(?:\/|$)|assets\/(?:worker-runtime(?:\/|$)|css\/ui(?:-modal|-viewer)?\.bundle\.css$|js\/(?:build-meta\.js$|workers\/resource-update-policy-core\.js$))|(?:index\.html|\.nojekyll)$|build-native\/(?:p9|core-ci-webgl|predicate-comparison|wasm|cache-probe)(?:\/|$)|\.superpowers\/sdd\/[^/]+(?:\/|$)|test-results(?:\/|$))/;
const dependencyPattern=/^(?:(?:apps\/editor\/)?node_modules\/\.pnpm|apps\/web-shell\/node_modules(?:\.before-[^/]+)?)(?:\/|$)/;
const evidencePattern=/^build-native\/(?:reference-analysis(?:\/|$)|reference-release(?:\/|$)|ui-main-sync-20261021(?:\/|$)|(?:editable-library-|polygon-quality-|resource-update-)[^/]+\.(?:log|png|md|txt)$|macro-source-preview\.png$|library-merge-paths\.txt$)/;
const compilerPatterns={
 'retired-cargo':/^(?:main|gis|objects)-cargo-gnu(?:\/|$)/,
 'pc-cache':/^[^/]+(?:\/|$)/,
 'pc-evidence':/^[^/]+(?:\/|$)/,
 'discarded-evidence':/^(?!.*\.(?:keystore|jks|pem|key|p12|pfx)$)(?:Pandoeditor(?:\/|$)|Temp\/pando-checks-[^/]+(?:\/|$))/i,
 'pc-temp':/^(?:pando-(?:check-plan|viewer-assets|worker-assets|pages|check-diff|assembly-test|core-assets|provenance-check|publication-test|cleanup-test)-[^/]+|playwright(?:_chromiumdev_profile|-artifacts|-transform)-[^/]+|pando-checks-[^/]+\/web-site)(?:\/|$)/,
 'retired-editor':/^(?:android\/(?:sdk|gradle|downloads|java|build-x86_64)|cache|installer|windows-portable|m91-linker-tools|crash-analysis-[^/]+\/(?:windbg[^/]*\.(?:msix|msixbundle)|debugger|symbols)|(?:integration-[^/]+-release-\d+|m91-release-[^/]+|main-[^/]+-release-\d+)\/(?:build|zip-[^/]+|portable|publish|retired-[^/]+|previous-portable[^/]*|previous-integration[^/]*|windows-portable|download-[^/]+|Pandoeditor-[^/]+\.zip))(?:\/|$)/,
 'android-sdk':/^(?:build-tools|cmake|cmdline-tools|extras|ndk|platforms|emulator|system-images|sources|patcher|\.temp)(?:\/|$)/,
 toolchains:/^(?:binutils-new|cargo|cmake|gradle|rustup|sccache)(?:\/|$)/,
 'retired-android-sdk':/^(?:build-tools|cmake|cmdline-tools|extras|ndk|platforms|emulator|system-images|sources|patcher|platform-tools|licenses|\.knownPackages|\.sdk|\.temp)(?:\/|$)/,
 avd:/^medium_phone(?:\.avd(?:\/|$)|\.ini$)/,
 'compiler-cache':/^sccache(?:\/|$)/,
 worktree:/^build-native\/(?:emsdk|p1)(?:\/|$)/,
};
function retirementPath(root,path){
 const base=resolve(root),target=resolve(base,path),rel=relative(base,target);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Generated target escaped its scope');
 if(dependencyPattern.test(rel.replaceAll('\\','/'))&&existsSync(target)&&lstatSync(target).isSymbolicLink()){containedPath(base,dirname(target));return target;}
 let existing=target;while(!existsSync(existing)&&dirname(existing)!==existing)existing=dirname(existing);
 const actual=resolve(realpathSync.native(existing));
 const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
 // Native canonical resolution detects reparse points anywhere in the path
 // before bytes are read or unlinked, without statting each ancestor repeatedly.
 // MSIX redirects AppData into the package's LocalCache without a reparse
 // point. Canonical names can differ there; retain the explicit ancestor
 // reparse checks to distinguish namespace redirection from a real junction.
 if(normalized(actual)!==normalized(existing))return containedPath(base,target);
 return target;
}
function validate(root,path,roots,protectedPaths=[],compilerScopes=[],action='delete'){
 if(!roots.includes(resolve(root)))throw Error('Unknown worktree scope');
 const target=retirementPath(root,path),rel=relative(root,target).replaceAll('\\','/');
 if(!scopePattern.test(rel)&&!evidencePattern.test(rel)&&!compilerScopes.some(scope=>resolve(scope.root)===resolve(root)&&compilerPatterns[scope.kind]?.test(rel)&&(scope.kind!=='pc-evidence'||action==='relocate')))throw Error(`Unknown generated scope: ${rel}`);
 if(protectedPaths.some(p=>p===target||p.startsWith(target+sep)))throw Error(`Protected source or WIP: ${target}`);
 return target;
}
function assertIdle(roots,consumers,targets=roots){
 const norm=p=>String(p||'').replaceAll('\\','/').toLowerCase();
 for(const c of consumers)for(const root of targets){const r=norm(root),build=/^(cargo|rustc|rust-lld|cmake|ninja|msbuild|gradle|emulator|qemu-system-[\w-]+)\.exe$/i.test(c.Name||'')||(/^java(?:w)?\.exe$/i.test(c.Name||'')&&/gradle/i.test(c.CommandLine||''));if(norm(c.ExecutablePath).startsWith(r+'/')||norm(c.CommandLine).includes(r)||c.globalBuild||build)throw Error(`Active consumer blocks cleanup: ${c.ProcessId||''} ${c.Name||''}`);}
 for(const root of roots)for(const p of ['apps/editor/.stage-lock','.library-data/prepare.lock'])if(existsSync(containedPath(root,p)))throw Error(`Active consumer lock: ${root}/${p}`);
}
function destination(entry,relocationRoots){
 const base=relocationRoots.find(p=>{const rel=relative(resolve(p),resolve(entry.destination));return rel&&!rel.startsWith('..')&&!resolve(entry.destination).startsWith(resolve(entry.root)+'/');});
 if(!base)throw Error('Relocation destination is outside the approved storage scope');
 return containedPath(base,entry.destination);
}
export function previewGeneratedCleanup({roots,requests,consumers=[],protectedPaths=[],relocationRoots=[],compilerScopes=[],progress=()=>{}}){
 roots=roots.map(p=>resolve(p));protectedPaths=protectedPaths.map(p=>resolve(p));
 const targets=compilerScopes.length?requests.map(r=>containedPath(r.root,r.path)):roots;
 assertIdle(roots,consumers,targets);const entries=[],seen=new Set();
 for(const request of requests){
  if(!['delete','relocate'].includes(request.action)||!request.reason?.trim())throw Error('Explicit action and recovery/producer reason required');
  if(evidencePattern.test(relative(request.root,resolve(request.root,request.path)).replaceAll('\\','/'))&&request.action!=='relocate')throw Error('Unique retired evidence must be relocated');
  const target=validate(request.root,request.path,roots,protectedPaths,compilerScopes,request.action);if(!existsSync(target))continue;
  const directory=lstatSync(target).isDirectory();let files;
  if(directory&&dependencyPattern.test(relative(request.root,target).replaceAll('\\','/'))){files=[];const scan=p=>{const s=lstatSync(p);if(s.isDirectory()&&!s.isSymbolicLink())for(const name of readdirSync(p))scan(resolve(p,name));else files.push({path:p});};scan(target);}else files=directory?contentFiles(target):[{path:target}];
  for(const f of files){
   const path=validate(request.root,f.path,roots,protectedPaths,compilerScopes,request.action);if(seen.has(path))throw Error('Overlapping generated requests');seen.add(path);
   const s=lstatSync(path,{bigint:true}),link=s.isSymbolicLink()&&dependencyPattern.test(relative(request.root,path).replaceAll('\\','/'))&&request.action==='delete';if((!s.isFile()||s.isSymbolicLink())&&!link)throw Error('Linked or non-file output must be preserved');
   const row={root:resolve(request.root),path:relative(request.root,path).replaceAll('\\','/'),scope:request.path,action:request.action,reason:request.reason,bytes:link?0:Number(s.size),identity:identity(path),sha256:link?contentHash(Buffer.from(readlinkSync(path))):fileHash(path),links:Number(s.nlink),mode:Number(s.mode),...link?{kind:'dependency-link'}:{}};
   if(request.action==='relocate'){row.destination=directory?resolve(request.destination,relative(target,path)):resolve(request.destination);destination(row,relocationRoots);}
   entries.push(row);
   if(entries.length%1000===0)progress(`hashed ${entries.length} files`);
  }
 }
 return {schema,compilerScopes,roots:roots.map(p=>resolve(p)),relocationRoots:relocationRoots.map(p=>resolve(p)),createdAt:new Date().toISOString(),entries};
}
export function applyGeneratedCleanup({roots,manifest,consumers=[],refreshConsumers=()=>consumers,protectedPaths=[],relocationRoots=manifest.relocationRoots||[],journal=null,afterRemoved=()=>{},afterMutation=()=>{},progress=()=>{},compilerScopes=[],verifiedPreview=null,copyForRelocation=copyFileSync,retainCompletedJournal=false}){
 roots=roots.map(p=>resolve(p));protectedPaths=protectedPaths.map(p=>resolve(p));
 if(JSON.stringify(manifest.compilerScopes||[])!==JSON.stringify(compilerScopes))throw Error('Compiler retirement scope mismatch');
 if(manifest.schema!==schema||JSON.stringify(manifest.roots)!==JSON.stringify(roots.map(p=>resolve(p))))throw Error('Manifest scope mismatch');
 const targets=compilerScopes.length?[...new Map(manifest.entries.map(e=>[e.root+'|'+e.scope,e])).values()].map(e=>containedPath(e.root,e.scope)):roots;
 assertIdle(roots,consumers,targets);
 const digest=contentHash(Buffer.from(JSON.stringify(manifest)));let state={schema,digest,completedCount:0,pending:null,deletedBytes:0,relocatedBytes:0,payloadBytesUnlinked:0};
 let previewStart=null;
 if(verifiedPreview){
  if(!compilerScopes.length||verifiedPreview.schema!=='pando-compiler-preview-proof-v1'||verifiedPreview.manifestSha256!==digest||!/^\d+$/.test(verifiedPreview.startedAtNs||''))throw Error('Verified compiler preview receipt mismatch');
  previewStart=BigInt(verifiedPreview.startedAtNs);
  if(previewStart<=0n||previewStart>BigInt(Date.parse(manifest.createdAt))*1000000n)throw Error('Invalid verified compiler preview start');
 }
 if(journal&&existsSync(journal)){state=JSON.parse(readFileSync(journal,'utf8'));if(state.digest!==digest)throw Error('A different cleanup journal is pending');}
 if(!Number.isInteger(state.completedCount)||state.completedCount<0||state.completedCount>manifest.entries.length)throw Error('Invalid cleanup completion cursor');
 const save=()=>{if(journal)atomicStorageJSON(journal,state);};
 const verified=new Map();
 const stamp=s=>`${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.nlink}:${s.mode}`;
 const check=(e,reuse=false)=>{
  const p=validate(e.root,e.path,roots,protectedPaths,compilerScopes,e.action);if(!presentPath(p))return p;
  const before=lstatSync(p,{bigint:true}),current=stamp(before);
  if(`${before.dev}:${before.ino}:${before.size}:${before.mtimeNs}`!==e.identity)throw Error(`Stale or changed output: ${p}`);
  // Preflight hashes all bytes once. Before unlinking, reuse only an unchanged
  // OS change-time/file-ID stamp; any intervening write or link change rehashes.
  const unchangedSincePreview=previewStart!==null&&before.ctimeNs<previewStart&&Number(before.nlink)===e.links&&Number(before.mode)===e.mode;
  if((!reuse||verified.get(p)!==current)&&!unchangedSincePreview){
   const hash=e.kind==='dependency-link'&&before.isSymbolicLink()?contentHash(Buffer.from(readlinkSync(p))):fileHash(p);
   if(hash!==e.sha256||stamp(lstatSync(p,{bigint:true}))!==current)throw Error(`Stale or changed output: ${p}`);
  }
  verified.set(p,current);
  return p;
 };
 // Preflight the entire remaining batch, so a stale late entry removes nothing.
 progress('checking remaining manifest hashes');
 for(const e of manifest.entries.slice(state.completedCount)){check(e);if(e.action==='relocate'){const d=destination(e,relocationRoots);if(existsSync(d)&&fileHash(d)!==e.sha256)throw Error(`Different relocation evidence: ${d}`);}else if(e.action!=='delete')throw Error('Unknown manifest action');}
 save();
 const finish=(index,e,account=true,physicalBytes=0)=>{if(account){if(e.action==='delete'){state.deletedBytes+=e.bytes;state.payloadBytesUnlinked+=physicalBytes;}else state.relocatedBytes+=e.bytes;}state.pending=null;state.copyPending=null;state.completedCount=index+1;};
 assertIdle(roots,refreshConsumers(),targets);progress('applying verified manifest');
 while(state.completedCount<manifest.entries.length){
  assertIdle(roots,refreshConsumers(),targets);progress(state.completedCount+'/'+manifest.entries.length);
  if(!state.batch){
   const start=state.completedCount,end=Math.min(start+250,manifest.entries.length),links=new Map(),files=[];
   for(let index=start;index<end;index++){
    const e=manifest.entries[index],p=check(e,true),present=presentPath(p);let physicalBytes=0;
    if(present&&e.action==='delete'){const s=lstatSync(p,{bigint:true}),key=s.dev+':'+s.ino,left=links.get(key)??Number(s.nlink);physicalBytes=left===1?e.bytes:0;links.set(key,left-1);}
    files.push({present:present||state.pending?.index===index,physicalBytes:state.pending?.index===index?state.pending.physicalBytes:physicalBytes});
   }
   // Durable write-ahead plan: missing entries are accounted once after a crash.
   // This replaces two atomic journal rewrites for every individual SDK file.
   state.batch={start,end,files};save();
  }
  for(let index=state.completedCount;index<state.batch.end;index++){
   const e=manifest.entries[index],planned=state.batch.files[index-state.batch.start],p=check(e,true);
   if(!presentPath(p)){if(e.action==='relocate'&&(!existsSync(destination(e,relocationRoots))||fileHash(e.destination)!==e.sha256))throw Error('Missing relocation original and destination');finish(index,e,planned.present,planned.physicalBytes);continue;}
   const s=lstatSync(p),physicalBytes=e.action==='delete'&&s.nlink===1?e.bytes:0;
   if(physicalBytes!==planned.physicalBytes){planned.physicalBytes=physicalBytes;save();}
   if(e.action==='relocate'){
    const d=destination(e,relocationRoots);mkdirSync(dirname(d),{recursive:true});
    const verify=path=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size!==e.bytes||fileHash(path)!==e.sha256)throw Error('Relocation verification failed: '+path);};
    if(!existsSync(d)){
     try{renameSync(p,d);}catch(error){
      if(error.code!=='EXDEV')throw error;
      const pending=d+'.pando-relocating-'+e.sha256;
      if(presentPath(pending)){
       const temp=lstatSync(pending),owned=state.copyPending?.index===index&&state.copyPending?.path===pending&&state.copyPending?.sourceIdentity===e.identity;
       if(!temp.isFile()||temp.isSymbolicLink())throw Error('Unknown relocation temporary file',{cause:error});
       if(temp.size!==e.bytes||fileHash(pending)!==e.sha256){
        // Only a journal-owned exact source prefix is an interrupted copy.
        // Unknown, replaced or modified partial data must be preserved.
        if(!owned||temp.size>e.bytes||fileHash(p,temp.size)!==fileHash(pending))throw Error('Changed or unowned partial relocation copy',{cause:error});
        check(e);destination(e,relocationRoots);unlinkSync(pending);
       }
      }
      if(!presentPath(pending)){state.copyPending={index,path:pending,sourceIdentity:e.identity};save();copyForRelocation(p,pending,constants.COPYFILE_EXCL);}
      verify(pending);check(e);destination(e,relocationRoots);
      if(presentPath(d))throw Error('Relocation destination appeared during copy',{cause:error});
      renameSync(pending,d);
     }
    }
    verify(d);
    if(presentPath(p)){check(e);unlinkSync(p);}
   }else if(e.kind==='dependency-link'){
    if(!s.isSymbolicLink()||!dependencyPattern.test(e.path))throw Error('Dependency link changed before removal');
    unlinkSync(p);
   }else{
    if(!(s.mode&0o200)){if(s.nlink>1)throw Error('Readonly shared output requires its content-store owner');chmodSync(p,0o600);}
    unlinkSync(p);
   }
   afterMutation(e);finish(index,e,true,physicalBytes);afterRemoved(e);
  }
  state.batch=null;save();
 }

 const prune=p=>{if(!existsSync(p)||!lstatSync(p).isDirectory())return;for(const e of readdirSync(p,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Linked output encountered during empty-directory cleanup');if(e.isDirectory())prune(containedPath(p,e.name));}if(!readdirSync(p).length)rmdirSync(p);};
 const scopes=new Map(manifest.entries.map(e=>[e.root+'|'+e.scope,e]));
 for(const e of scopes.values()){const p=validate(e.root,e.scope,roots,protectedPaths,compilerScopes,e.action);if(existsSync(p)&&lstatSync(p).isDirectory())prune(p);}
 if(journal&&!retainCompletedJournal&&existsSync(journal))unlinkSync(journal);
 return {...state,freeBytes:statfsSync(roots[0]).bavail*statfsSync(roots[0]).bsize};
}
