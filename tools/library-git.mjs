// Git object storage only. Library originals, pins and working files are owned elsewhere.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,renameSync,rmdirSync,statfsSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,relative,resolve} from 'node:path';
import {atomicStorageJSON,containedPath,contentFiles} from './library-content.mjs';
const environment=()=>({...process.env,GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0'});
const git=(root,args,input=undefined)=>execFileSync('git',['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:root,env:environment(),input,encoding:'utf8',maxBuffer:128*1024**2,stdio:['pipe','pipe','pipe']}).trim();
const same=(path,item)=>existsSync(path)&&lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink()&&statSync(path).size===item.bytes&&fileHash(path)===item.sha256;
function space(shared){const s=statfsSync(shared);return s.bavail*s.bsize;}
function packHeadroom(shared,objects,wanted){
  const ids=new Set(wanted),peak=Math.ceil(objects.filter(o=>ids.has(o.oid)).reduce((sum,o)=>sum+o.bytes,0)*1.06);
  if(peak&&space(shared)<peak+5*1024**3)throw Error(`New Git packs need ${peak} bytes plus 5 GiB headroom`);
}
function temporaryPackCopies(shared,packRoot,indexes){
  const copies=[];
  for(const file of contentFiles(packRoot).filter(f=>/^tmp_pack_[A-Za-z0-9]+$/.test(f.logical)&&f.bytes>=12)){
    const sample=fileHash(file.path,Math.min(file.bytes,4096));
    for(const index of indexes){
      if(index.bytes<=file.bytes)continue;
      const source=containedPath(packRoot,index.name.slice(0,-4)+'.pack');
      if(fileHash(source,Math.min(file.bytes,4096))!==sample)continue;
      const original=recordFile(shared,file.path);
      if(fileHash(source,file.bytes)!==original.sha256)continue;
      packObjects(containedPath(packRoot,index.name));
      copies.push({...original,recovery:{pack:relative(shared,source).replaceAll('\\','/'),prefixBytes:file.bytes,prefixSha256:original.sha256}});break;
    }
  }
  return copies;
}

// Git fetch can repeat objects already present in another pack. Retain the
// largest independent packs; repack only unique objects from overlapping packs.
// This is bounded to Git bytes and runs under the library owner's write lock.
export function compactDuplicatePacks(checkout,{stopAfter=null}={}){
  const common=resolve(checkout,git(checkout,['rev-parse','--git-common-dir'])),shared=dirname(common);
  const pending=containedPath(common,'pando-git-compaction.pending.json');
  let journal=existsSync(pending)?JSON.parse(readFileSync(pending,'utf8')):null;
  if(journal){
    const current=localObjects(shared);
    if(JSON.stringify(gitStorageState(shared))!==JSON.stringify(journal.gitState)||!sameSet(current.map(o=>o.oid),journal.objects.map(o=>o.oid))){
      // Restart only while every original source is still present and exact.
      // No changed/deleted source, missing old object or unique bytes are discarded.
      if(!journal.packs.every(item=>same(containedPath(shared,item.path),item)))throw Error('Changed compaction sources require explicit recovery; originals remain protected');
      const ids=new Set(current.map(o=>o.oid));
      if(journal.objects.some(o=>!ids.has(o.oid)))throw Error('Missing local objects require explicit recovery; originals remain protected');
      const staging=containedPath(shared,journal.stagingPath);
      for(const file of contentFiles(staging))unlinkSync(containedPath(staging,file.path));
      if(existsSync(staging))removeEmpty(staging);
      unlinkSync(pending);journal=null;
    }
  }
  if(!journal){
    const packRoot=containedPath(common,'objects/pack');
    const indexes=contentFiles(packRoot).filter(f=>/^pack-[a-f0-9]{40}\.idx$/.test(f.logical)).map(f=>({name:f.logical,ids:indexObjects(f.path),bytes:statSync(f.path.slice(0,-4)+'.pack').size,promisor:existsSync(f.path.slice(0,-4)+'.promisor')})).sort((a,b)=>b.bytes-a.bytes||a.name.localeCompare(b.name));
    const promisor=new Set(indexes.filter(p=>p.promisor).flatMap(p=>p.ids));
    const seen=new Set(),keep=[],overlapping=[];
    for(const pack of indexes){
      if(pack.ids.some(oid=>seen.has(oid)||!pack.promisor&&promisor.has(oid)))overlapping.push(pack);
      else {keep.push(pack);for(const oid of pack.ids)seen.add(oid);}
    }
    const temporary=temporaryPackCopies(shared,packRoot,indexes);
    if(!overlapping.length&&!temporary.length)return {compacted:false,deletedBytes:0};
    const packObjectIds=[...new Set(overlapping.flatMap(p=>p.ids))].filter(oid=>!seen.has(oid));
    const names=new Set(overlapping.map(p=>p.name.slice(0,-4)));
    const packs=[...contentFiles(packRoot).filter(f=>/\.(pack|idx|rev|promisor|mtimes|keep)$/.test(f.logical)&&names.has(f.logical.replace(/\.[^.]+$/,''))).map(f=>recordFile(shared,f.path)),...temporary];
    const id=randomUUID();journal={schema:'pando-git-storage-v1',id,stagingPath:'.git/pando-repack-'+id,packs,objects:localObjects(shared),promisor:[...promisor],packObjectIds,retainedIndexes:keep.map(p=>p.name),gitState:gitStorageState(shared),deleted:[],phase:'inventoried'};
    packHeadroom(shared,journal.objects,packObjectIds);
    atomicStorageJSON(pending,journal);
  }
  const save=()=>atomicStorageJSON(pending,journal);
  if(stopAfter==='inventoried')return {interruptedAt:'inventoried'};
  repackLocalObjects(shared,journal,save);
  unlinkSync(pending);
  return {compacted:true,deletedBytes:journal.deleted.reduce((sum,f)=>sum+f.bytes,0),objects:journal.objects.length,deleted:journal.deleted};
}
const hashBuffer = Buffer.allocUnsafe(4*1024**2);
export function fileHash(path, bytes=Infinity) {
  const hash = createHash('sha256'), handle = openSync(path, 'r'), buffer = hashBuffer;
  try { while(bytes>0) { const size = readSync(handle, buffer, 0, Math.min(buffer.length,bytes), null); if (!size) break; hash.update(buffer.subarray(0,size));bytes-=size; } }
  finally { closeSync(handle); }
  return hash.digest('hex');
}
export const recordFile = (base, path) => { const s = statSync(path,{bigint:true}); return { path:relative(base,path).replaceAll('\\','/'), bytes:Number(s.size), sha256:fileHash(path), id:`${s.dev}:${s.ino}` }; };
export function gitStorageState(shared) {
  const common=resolve(shared,git(shared,['rev-parse','--git-common-dir']));
  const worktrees=git(shared,['worktree','list','--porcelain']);
  const roots=worktrees.split('\n').filter(s=>s.startsWith('worktree ')).map(s=>resolve(s.slice(9)));
  return { refs:git(shared,['for-each-ref','--format=%(refname) %(objectname) %(symref)']), worktrees,
    heads:roots.map(root=>({root,head:git(root,['rev-parse','HEAD']),status:git(root,['status','--porcelain','--untracked-files=no'])})),
    reflogs:contentFiles(common).filter(f=>f.logical.startsWith('logs/')||/^worktrees\/[^/]+\/logs\//.test(f.logical)).map(f=>({path:f.logical,sha256:fileHash(f.path)})) };
}
function assertState(shared, before) { if(JSON.stringify(gitStorageState(shared))!==JSON.stringify(before))throw Error('Git refs, HEAD, reflogs or working state changed during storage maintenance; old objects remain protected.'); }
export function localObjects(shared) {
  return git(shared,['cat-file','--batch-all-objects','--unordered','--buffer','--batch-check=%(objectname) %(objecttype) %(objectsize)']).split('\n').filter(Boolean).map(line=>{const [oid,type,bytes]=line.split(' ');if(!/^[a-f0-9]{40}$/.test(oid)||!/^\d+$/.test(bytes))throw Error('Invalid local object enumeration');return {oid,type,bytes:Number(bytes)};}).sort((a,b)=>a.oid.localeCompare(b.oid));
}
function packObjects(index) {
  return git(dirname(index),['verify-pack','-v',index]).split('\n').filter(line=>/^[a-f0-9]{40} /.test(line)).map(line=>line.slice(0,40)).sort();
}
export function indexObjects(index) {
  return git(dirname(index),['show-index'],readFileSync(index)).split('\n').filter(Boolean).map(line=>{const oid=line.split(' ')[1];if(!/^[a-f0-9]{40}$/.test(oid))throw Error('Invalid pack index object');return oid;}).sort();
}
const sameSet=(a,b)=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
export function removeEmpty(directory) { for(const name of readdirSync(directory)){const p=containedPath(directory,name);if(!lstatSync(p).isDirectory())throw Error(`Unexpected migration remnant: ${p}`);removeEmpty(p);}rmdirSync(directory); }
export function snapshotGitStorage(shared,progress=()=>{}){
  if(resolve(shared,git(shared,['rev-parse','--git-common-dir']))!==resolve(shared,'.git'))throw Error('Git storage must run at the common repository root');
  progress('hashing existing local Git packs');
  const packs=contentFiles(containedPath(shared,'.git/objects/pack')).filter(f=>/^pack-[a-f0-9]{40}\.(pack|idx|rev|promisor|mtimes|keep)$/.test(f.logical)).map(f=>recordFile(shared,f.path));
  const promisor=new Set();for(const p of packs.filter(p=>p.path.endsWith('.promisor')))for(const oid of indexObjects(resolve(shared,p.path.slice(0,-9)+'.idx')))promisor.add(oid);
  progress('enumerating every local Git object, including unreachable objects');
  const objects=localObjects(shared),id=randomUUID();progress(`inventoried ${objects.length} local objects`);
  return {id,schema:'pando-git-storage-v1',stagingPath:`.git/pando-repack-${id}`,packs,objects,promisor:[...promisor].sort(),gitState:gitStorageState(shared),deleted:[],phase:'inventoried'};
}
export function repackLocalObjects(shared,journal,save=()=>{}){
  const packRoot=containedPath(shared,'.git/objects/pack'),staging=containedPath(shared,journal.stagingPath||`.pando-store/repack-${journal.id}`);
  const wanted=journal.packObjectIds||journal.objects.map(o=>o.oid),wantedSet=new Set(wanted);
  if(!journal.newPacks){
    assertState(shared,journal.gitState);
    if(!sameSet(localObjects(shared).map(o=>o.oid),journal.objects.map(o=>o.oid)))throw Error('Local object set changed before packing');
    packHeadroom(shared,journal.objects,wanted);
    mkdirSync(staging,{recursive:true});
    const promised=new Set(journal.promisor),newPacks=[];
    for(const [name,ids] of [['promisor',journal.promisor.filter(oid=>wantedSet.has(oid))],['local',wanted.filter(oid=>!promised.has(oid))]]){
      if(!ids.length)continue;
      const prefix=containedPath(staging,name),hash=git(shared,['pack-objects','--non-empty','--threads=2',prefix],ids.join('\n')+'\n');
      if(!/^[a-f0-9]{40}$/.test(hash))throw Error('Unexpected pack output');
      const base=`${prefix}-${hash}`,actual=packObjects(base+'.idx');
      if(!sameSet(actual,ids))throw Error('New standalone pack does not contain its exact local object partition');
      if(name==='promisor')writeFileSync(base+'.promisor','');
      newPacks.push({base,hash,promisor:name==='promisor',objects:actual});
    }
    if(!sameSet(newPacks.flatMap(p=>p.objects),wanted))throw Error('New pack union differs');
    journal.newPacks=newPacks;save();
  }
  for(const pack of journal.newPacks)for(const ext of ['pack','idx',...(pack.promisor?['promisor']:[])]){
    const source=pack.base+'.'+ext,target=containedPath(packRoot,`pack-${pack.hash}.${ext}`);
    if(existsSync(source)){if(existsSync(target)){if(fileHash(source)!==fileHash(target))throw Error('Pack destination collision');}else renameSync(source,target);}
    if(!existsSync(target))throw Error('New pack installation incomplete');
  }
  for(const pack of journal.newPacks)if(!sameSet(packObjects(resolve(packRoot,`pack-${pack.hash}.idx`)),pack.objects))throw Error('Installed pack differs');
  for(const index of journal.retainedIndexes||[]){
    const path=containedPath(packRoot,index);
    if(!sameSet(packObjects(path),indexObjects(path)))throw Error('Retained pack payload integrity differs from its index');
  }
  assertState(shared,journal.gitState);
  if(!sameSet(localObjects(shared).map(o=>o.oid),journal.objects.map(o=>o.oid)))throw Error('Local object set changed during packing');
  git(shared,['multi-pack-index','write','--stdin-packs'],[...(journal.retainedIndexes||[]),...journal.newPacks.map(p=>`pack-${p.hash}.idx`)].join('\n')+'\n');
  git(shared,['multi-pack-index','verify']);
  journal.phase='packs-installed';save();
  const keep=new Set(journal.newPacks.flatMap(p=>['pack','idx','promisor'].map(ext=>`pack-${p.hash}.${ext}`)));
  for(const item of journal.packs){
    if(keep.has(basename(item.path)))continue;
    const path=containedPath(packRoot,resolve(shared,item.path));if(!existsSync(path))continue;
    if(!same(path,item))throw Error(`Old pack changed: ${path}`);
    unlinkSync(path);journal.deleted.push({...item,reason:'exact complete object set verified in new local packs'});
  }
  const loose=contentFiles(resolve(shared,'.git/objects')).filter(f=>/^[a-f0-9]{2}\/[a-f0-9]{38}$/.test(f.logical)).map(f=>recordFile(shared,f.path));
  git(shared,['prune-packed']);
  for(const item of loose)if(!existsSync(resolve(shared,item.path)))journal.deleted.push({...item,reason:'verified packed local object'});
  if(!sameSet(localObjects(shared).map(o=>o.oid),journal.objects.map(o=>o.oid)))throw Error('Local objects missing after pack replacement');
  for(const pack of journal.newPacks)packObjects(resolve(packRoot,`pack-${pack.hash}.idx`));
  assertState(shared,journal.gitState);
  // Failed writes in this journal-owned staging folder are no longer useful:
  // every local object has been independently verified in the installed packs.
  for(const file of contentFiles(staging))unlinkSync(containedPath(staging,file.path));
  if(existsSync(staging))removeEmpty(staging);journal.phase='git-compacted';save();
}
