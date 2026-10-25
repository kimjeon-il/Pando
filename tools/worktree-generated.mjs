// Explicit generated-output retirement used by the permanent-worktree owner.
// Discovery is separate from apply: no directory is disposable merely by age.
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmdirSync,statfsSync,unlinkSync,chmodSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {atomicStorageJSON,containedPath,contentFiles,contentHash} from './library-content.mjs';
import {fileHash} from './library-storage.mjs';

const schema='pando-generated-cleanup-v1';
export function cargoRetirementRequests({root,seeds,protectedPartitions=[]}){
 const target=containedPath(root,'apps/web-shell/src-tauri/target'),files=contentFiles(target),nodes=new Map(),hashes=new Map(),directories=new Map();
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
const scopePattern=/^(?:apps\/web-shell\/(?:src-tauri\/(?:target|gen\/android\/(?:app\/build|build|\.gradle)))(?:\/|$)|build-native\/(?:p9|core-ci-webgl|predicate-comparison|wasm|cache-probe)(?:\/|$)|\.superpowers\/sdd\/[^/]+(?:\/|$)|test-results(?:\/|$))/;
const compilerPatterns={
 'android-sdk':/^(?:build-tools|cmake|cmdline-tools|extras|ndk|platforms|emulator|system-images|sources|patcher|\.temp)(?:\/|$)/,
 toolchains:/^(?:binutils-new|cargo|cmake|gradle|rustup|sccache)(?:\/|$)/,
 'compiler-cache':/^sccache(?:\/|$)/,
 worktree:/^build-native\/(?:emsdk|p1)(?:\/|$)/,
};
function validate(root,path,roots,protectedPaths=[],compilerScopes=[]){
 if(!roots.map(resolvePath=>resolve(resolvePath)).includes(resolve(root)))throw Error('Unknown worktree scope');
 const target=containedPath(root,path),rel=relative(root,target).replaceAll('\\','/');
 if(!scopePattern.test(rel)&&!compilerScopes.some(scope=>resolve(scope.root)===resolve(root)&&compilerPatterns[scope.kind]?.test(rel)))throw Error(`Unknown generated scope: ${rel}`);
 if(protectedPaths.some(p=>resolve(p)===target||resolve(p).startsWith(target+'/')||resolve(p).startsWith(target+'\\')))throw Error(`Protected source or WIP: ${target}`);
 return target;
}
function assertIdle(roots,consumers){
 const norm=p=>String(p||'').replaceAll('\\','/').toLowerCase();
 for(const c of consumers)for(const root of roots){const r=norm(root),build=/^(cargo|rustc|rust-lld|cmake|ninja|msbuild|gradle)\.exe$/i.test(c.Name||'')||(/^java(?:w)?\.exe$/i.test(c.Name||'')&&/gradle/i.test(c.CommandLine||''));if(norm(c.ExecutablePath).startsWith(r+'/')||norm(c.CommandLine).includes(r)||c.globalBuild||build)throw Error(`Active consumer blocks cleanup: ${c.ProcessId||''} ${c.Name||''}`);}
 for(const root of roots)for(const p of ['apps/web-shell/.stage-lock','.library-data/prepare.lock'])if(existsSync(containedPath(root,p)))throw Error(`Active consumer lock: ${root}/${p}`);
}
function destination(entry,relocationRoots){
 const base=relocationRoots.find(p=>{const rel=relative(resolve(p),resolve(entry.destination));return rel&&!rel.startsWith('..')&&!resolve(entry.destination).startsWith(resolve(entry.root)+'/');});
 if(!base)throw Error('Relocation destination is outside the approved storage scope');
 return containedPath(base,entry.destination);
}
export function previewGeneratedCleanup({roots,requests,consumers=[],protectedPaths=[],relocationRoots=[],compilerScopes=[]}){
 assertIdle(roots,consumers);const entries=[],seen=new Set();
 for(const request of requests){
  if(!['delete','relocate'].includes(request.action)||!request.reason?.trim())throw Error('Explicit action and recovery/producer reason required');
  const target=validate(request.root,request.path,roots,protectedPaths,compilerScopes);if(!existsSync(target))continue;
  const directory=lstatSync(target).isDirectory();const files=directory?contentFiles(target):[{path:target}];
  for(const f of files){
   const path=validate(request.root,f.path,roots,protectedPaths,compilerScopes);if(seen.has(path))throw Error('Overlapping generated requests');seen.add(path);
   const s=lstatSync(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink())throw Error('Linked or non-file output must be preserved');
   const row={root:resolve(request.root),path:relative(request.root,path).replaceAll('\\','/'),scope:request.path,action:request.action,reason:request.reason,bytes:Number(s.size),identity:identity(path),sha256:fileHash(path),links:Number(s.nlink),mode:Number(s.mode)};
   if(request.action==='relocate'){row.destination=directory?resolve(request.destination,relative(target,path)):resolve(request.destination);destination(row,relocationRoots);}
   entries.push(row);
  }
 }
 return {schema,compilerScopes,roots:roots.map(p=>resolve(p)),relocationRoots:relocationRoots.map(p=>resolve(p)),createdAt:new Date().toISOString(),entries};
}
export function applyGeneratedCleanup({roots,manifest,consumers=[],refreshConsumers=()=>consumers,protectedPaths=[],relocationRoots=manifest.relocationRoots||[],journal=null,afterRemoved=()=>{},afterMutation=()=>{},progress=()=>{},compilerScopes=[]}){
 if(JSON.stringify(manifest.compilerScopes||[])!==JSON.stringify(compilerScopes))throw Error('Compiler retirement scope mismatch');
 if(manifest.schema!==schema||JSON.stringify(manifest.roots)!==JSON.stringify(roots.map(p=>resolve(p))))throw Error('Manifest scope mismatch');
 assertIdle(roots,consumers);
 const digest=contentHash(Buffer.from(JSON.stringify(manifest)));let state={schema,digest,completedCount:0,pending:null,deletedBytes:0,relocatedBytes:0,payloadBytesUnlinked:0};
 if(journal&&existsSync(journal)){state=JSON.parse(readFileSync(journal,'utf8'));if(state.digest!==digest)throw Error('A different cleanup journal is pending');}
 if(!Number.isInteger(state.completedCount)||state.completedCount<0||state.completedCount>manifest.entries.length)throw Error('Invalid cleanup completion cursor');
 const save=()=>{if(journal)atomicStorageJSON(journal,state);};
 const check=e=>{const p=validate(e.root,e.path,roots,protectedPaths,compilerScopes);if(!existsSync(p))return p;if(identity(p)!==e.identity||fileHash(p)!==e.sha256)throw Error(`Stale or changed output: ${p}`);return p;};
 // Preflight the entire remaining batch, so a stale late entry removes nothing.
 progress('checking remaining manifest hashes');
 for(const e of manifest.entries.slice(state.completedCount)){check(e);if(e.action==='relocate'){const d=destination(e,relocationRoots);if(existsSync(d)&&fileHash(d)!==e.sha256)throw Error(`Different relocation evidence: ${d}`);}else if(e.action!=='delete')throw Error('Unknown manifest action');}
 save();
 const finish=(index,e,account=true)=>{if(account){if(e.action==='delete'){state.deletedBytes+=e.bytes;state.payloadBytesUnlinked+=state.pending?.physicalBytes||0;}else state.relocatedBytes+=e.bytes;}state.pending=null;state.completedCount=index+1;save();};
 assertIdle(roots,refreshConsumers());progress('applying verified manifest');
 for(let index=state.completedCount;index<manifest.entries.length;index++){
  if(index%250===0){assertIdle(roots,refreshConsumers());progress(`${index}/${manifest.entries.length}`);}
  const e=manifest.entries[index],p=check(e);
  if(!existsSync(p)){if(e.action==='relocate'&&(!existsSync(destination(e,relocationRoots))||fileHash(e.destination)!==e.sha256))throw Error('Missing relocation original and destination');finish(index,e,state.pending?.index===index);continue;}
  state.pending={index,physicalBytes:e.action==='delete'&&lstatSync(p).nlink===1?e.bytes:0};save();
  const s=lstatSync(p);if(e.action==='relocate'){
   const d=destination(e,relocationRoots);mkdirSync(dirname(d),{recursive:true});if(!existsSync(d)){renameSync(p,d);if(fileHash(d)!==e.sha256||lstatSync(d).size!==e.bytes)throw Error('Relocation verification failed');}else unlinkSync(p);
  }else{
   if(!(s.mode&0o200)){if(s.nlink>1)throw Error('Readonly shared output requires its content-store owner');chmodSync(p,0o600);}
   unlinkSync(p);
  }
  afterMutation(e);finish(index,e);afterRemoved(e);
 }
 const prune=p=>{if(!existsSync(p)||!lstatSync(p).isDirectory())return;for(const e of readdirSync(p,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Linked output encountered during empty-directory cleanup');if(e.isDirectory())prune(containedPath(p,e.name));}if(!readdirSync(p).length)rmdirSync(p);};
 const scopes=new Map(manifest.entries.map(e=>[e.root+'|'+e.scope,e]));
 for(const e of scopes.values()){const p=validate(e.root,e.scope,roots,protectedPaths,compilerScopes);if(existsSync(p)&&lstatSync(p).isDirectory())prune(p);}
 if(journal&&existsSync(journal))unlinkSync(journal);
 return {...state,freeBytes:statfsSync(roots[0]).bavail*statfsSync(roots[0]).bsize};
}
