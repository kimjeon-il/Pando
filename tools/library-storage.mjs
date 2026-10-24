// Scoped migration/maintenance. Runtime preparation and write ownership stay in
// library-data.mjs. Every deletion below has a locally verified retained copy.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync, statfsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRoot, discardDeadLibraryLock, libraryCheckout, libraryConfig, libraryMaterializedRoot, libraryOwnerId, librarySharedCheckout, libraryWriteLeases, prepareOwnedLibraryData, reportContext, runtimeMaterializationPeak, synchronizeRuntimeManifest, withLibraryLock } from './library-data.mjs';
import { atomicStorageJSON, containedPath, contentFiles, contentHash, contentPath, linkContent, removeContentLink, shareContentFile } from './library-content.mjs';

const environment = () => ({ ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' });
const git = (root, args, input = undefined) => execFileSync('git', ['-c','gc.auto=0','-c','maintenance.auto=false',...args], { cwd: root, env: environment(), input, encoding:'utf8', maxBuffer:128*1024**2, stdio:['pipe','pipe','pipe'] }).trim();
const hashBuffer = Buffer.allocUnsafe(4*1024**2);
export function fileHash(path) {
  const hash = createHash('sha256'), handle = openSync(path, 'r'), buffer = hashBuffer;
  try { for (;;) { const size = readSync(handle, buffer, 0, buffer.length, null); if (!size) break; hash.update(buffer.subarray(0,size)); } }
  finally { closeSync(handle); }
  return hash.digest('hex');
}
const recordFile = (base, path) => { const s = statSync(path,{bigint:true}); return { path:relative(base,path).replaceAll('\\','/'), bytes:Number(s.size), sha256:fileHash(path), id:`${s.dev}:${s.ino}` }; };
const same = (path, item) => existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && statSync(path).size === item.bytes && fileHash(path) === item.sha256;
function space(shared) { const s = statfsSync(shared); return s.bavail * s.bsize; }
function footprint(shared) {
  const ids = new Set(); let logical = 0, physical = 0, files = 0;
  for (const file of contentFiles(shared)) { const s=statSync(file.path,{bigint:true}), id=`${s.dev}:${s.ino}`; logical+=file.bytes; files++; if(!ids.has(id)){ ids.add(id); physical+=file.bytes; } }
  return {files,logicalBytes:logical,fileIdBytes:physical,freeBytes:space(shared)};
}
function rootsFor(root, shared) {
  return git(root,['worktree','list','--porcelain']).split('\n').filter(s=>s.startsWith('worktree ')).map(s=>resolve(s.slice(9))).filter(r=>existsSync(resolve(r,'config/library-data.json')) && librarySharedCheckout(r)===shared);
}
function processAlive(pid) { if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid consumer process ID');try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;throw e;} }
function consumers(roots, shared, {allowRoot=null,reclaim=false}={}) {
  if (libraryWriteLeases(shared).some(lease=>lease.alive)) throw Error('A library writer is running; finish its lease before maintenance.');
  for(const root of roots) {
    if(root!==allowRoot&&reclaim)discardDeadLibraryLock(resolve(root,'.library-data/prepare.lock'));
    if(root!==allowRoot && existsSync(resolve(root,'.library-data/prepare.lock'))) throw Error(`Preparation is running: ${root}`);
    const server=resolve(root,'.library-data/dev-server.json');
    if(existsSync(server)){
      const lease=JSON.parse(readFileSync(server,'utf8'));
      if(processAlive(lease.pid)) throw Error(`Development server ${lease.pid} must be normally stopped before storage migration: ${root}`);
    }
  }
}
function state(shared) {
  const common=resolve(shared,git(shared,['rev-parse','--git-common-dir']));
  const worktrees=git(shared,['worktree','list','--porcelain']);
  const roots=worktrees.split('\n').filter(s=>s.startsWith('worktree ')).map(s=>resolve(s.slice(9)));
  return { refs:git(shared,['for-each-ref','--format=%(refname) %(objectname) %(symref)']), worktrees,
    heads:roots.map(root=>({root,head:git(root,['rev-parse','HEAD']),status:git(root,['status','--porcelain','--untracked-files=no'])})),
    reflogs:contentFiles(common).filter(f=>f.logical.startsWith('logs/')||/^worktrees\/[^/]+\/logs\//.test(f.logical)).map(f=>({path:f.logical,sha256:fileHash(f.path)})) };
}
function assertState(shared, before) { if(JSON.stringify(state(shared))!==JSON.stringify(before))throw Error('Git refs, HEAD, reflogs or working state changed during storage maintenance; old objects remain protected.'); }
export function localObjects(shared) {
  return git(shared,['cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype) %(objectsize)']).split('\n').filter(Boolean).map(line=>{const [oid,type,bytes]=line.split(' ');if(!/^[a-f0-9]{40}$/.test(oid)||!/^\d+$/.test(bytes))throw Error('Invalid local object enumeration');return {oid,type,bytes:Number(bytes)};}).sort((a,b)=>a.oid.localeCompare(b.oid));
}
function packObjects(index) {
  return git(dirname(index),['verify-pack','-v',index]).split('\n').filter(line=>/^[a-f0-9]{40} /.test(line)).map(line=>line.slice(0,40)).sort();
}
function indexObjects(index) {
  return git(dirname(index),['show-index'],readFileSync(index)).split('\n').filter(Boolean).map(line=>{const oid=line.split(' ')[1];if(!/^[a-f0-9]{40}$/.test(oid))throw Error('Invalid pack index object');return oid;}).sort();
}
const sameSet=(a,b)=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
function removeEmpty(directory) { for(const name of readdirSync(directory)){const p=containedPath(directory,name);if(!lstatSync(p).isDirectory())throw Error(`Unexpected migration remnant: ${p}`);removeEmpty(p);}rmdirSync(directory); }
function snapshot(root, shared, roots, progress=()=>{}, reclaim=false) {
  consumers(roots,shared,{allowRoot:root,reclaim});
  progress('hashing legacy cache sources');
  const legacy=[];
  const base=resolve(shared,'.pando-cache/materialized');
  if(existsSync(base))for(const name of readdirSync(base))if(/^[a-f0-9]{40}$/.test(name)){
    const directory=containedPath(base,name), owners=roots.filter(r=>libraryConfig(r).revision===name);
    legacy.push({revision:name,owners,files:contentFiles(directory).map(file=>recordFile(shared,file.path))});
  }
  const immutable=[];
  progress('hashing report and private originals');
  for(const scope of ['reports','private-evidence'])for(const file of contentFiles(resolve(shared,scope))){
    if(scope==='reports' && (file.logical.startsWith('.edits/')||file.logical.startsWith('.views/.manifests/')||file.logical.split('/').length===1 && file.logical.startsWith('.')))continue;
    immutable.push(recordFile(shared,file.path));
  }
  const misplaced=[];
  for(const file of contentFiles(resolve(shared,'.local-preserved'))){
    const bytes=readFileSync(file.path), oid=git(root,['hash-object','--stdin'],bytes);
    let archived;try{archived=execFileSync('git',['--no-lazy-fetch','cat-file','blob',oid],{cwd:root,maxBuffer:bytes.length+1024,env:environment(),stdio:['pipe','pipe','pipe']});}catch{continue;}
    if(!archived.equals(bytes))throw Error('Local script recovery bytes differ');
    misplaced.push({...recordFile(shared,file.path),oid,recoveryRepository:root});
  }
  const indexes=['migration.index','finalize.index'].map(name=>resolve(shared,'.git',name)).filter(existsSync).map(path=>recordFile(shared,path));
  const liveViews=roots.filter(r=>existsSync(resolve(libraryMaterializedRoot(r),'.complete'))).map(root=>({root,files:contentFiles(libraryMaterializedRoot(root)).filter(f=>!['.complete','.cache-owner.json'].includes(f.logical)).map(f=>recordFile(shared,f.path))}));
  progress('hashing Git packs and enumerating every local object');
  const packs=contentFiles(resolve(shared,'.git/objects/pack')).filter(f=>/^pack-[a-f0-9]{40}\.(pack|idx|rev|promisor|mtimes)$/.test(f.logical)).map(f=>recordFile(shared,f.path));
  const objects=localObjects(shared), promisor=new Set(),packed=new Set();let entries=0;
  for(const p of packs.filter(f=>f.path.endsWith('.idx'))){const ids=indexObjects(resolve(shared,p.path));entries+=ids.length;ids.forEach(oid=>packed.add(oid));if(existsSync(resolve(shared,p.path.slice(0,-4)+'.promisor')))ids.forEach(oid=>promisor.add(oid));}
  progress('measuring file IDs and Git reference state');
  return {schema:'pando-library-storage-v1',id:randomUUID(),startedAt:new Date().toISOString(),roots:roots.map(r=>({root:r,owner:libraryOwnerId(r),config:libraryConfig(r),configHash:fileHash(resolve(r,'config/library-data.json'))})),before:footprint(shared),legacy,liveViews,immutable,misplaced,indexes,packs,objects,promisor:[...promisor].sort(),gitState:state(shared),packEntries:entries,packedUnique:packed.size,phase:'inventoried',deleted:[],relocated:[]};
}
function migrationHeadroom(shared,journal) {
  const directory=resolve(shared,'.pando-store/blobs'),pool=new Set(existsSync(directory)?readdirSync(directory):[]),indexes=new Map();
  for(const owner of journal.roots)if(!indexes.has(owner.config.revision))indexes.set(owner.config.revision,JSON.parse(git(libraryCheckout(owner.root),['show',`${owner.config.revision}:archive/index.json`])));
  for(const old of journal.legacy)for(const file of old.files){const logical=file.path.split('/').slice(3).join('/'),entry=indexes.get(old.revision)?.files[logical];if(entry?.sha256===file.sha256&&entry.bytes===file.bytes)pool.add(file.sha256);}
  let peak=0;
  for(const owner of journal.roots){
    if(existsSync(resolve(libraryMaterializedRoot(owner.root),'.complete')))continue;
    const source=journal.legacy.find(old=>old.revision===owner.config.revision)?.files.map(f=>({...f,logical:f.path.split('/').slice(3).join('/')}))||[];
    peak+=runtimeMaterializationPeak(indexes.get(owner.config.revision),source,pool).totalBytes;
    for(const [logical,entry] of Object.entries(indexes.get(owner.config.revision).files))if(!logical.startsWith('reports/'))pool.add(entry.sha256);
  }
  peak+=journal.legacy.filter(old=>!old.owners.length).flatMap(old=>old.files).reduce((sum,file)=>sum+file.bytes,0);
  if(peak>=1024**3&&space(shared)<peak+5*1024**3)throw Error('Runtime migration needs all independent private copies plus 5 GiB headroom');
  journal.runtimePeakAdditionalBytes=peak;
}
function preserveSources(shared,journal,save) {
  for(const item of journal.immutable){
    const source=containedPath(shared,item.path);
    if(!existsSync(source)){if(!same(contentPath(shared,item.sha256),item))throw Error(`Missing original: ${source}`);linkContent(shared,item.sha256,source);}
    if(!same(source,item))throw Error(`Original changed since inventory: ${source}`);
    shareContentFile(shared,source,item);
  }
  // Adopt archived immutable runtime bytes before constructing per-owner views.
  for(const old of journal.legacy){
    if(!old.owners.length)continue;
    const index=JSON.parse(git(libraryCheckout(old.owners[0]),['show',`${old.revision}:archive/index.json`]));
    for(const item of old.files){
      const logical=item.path.split('/').slice(3).join('/'),entry=index.files[logical];
      if(!entry||entry.sha256!==item.sha256||entry.bytes!==item.bytes)continue;
      const source=containedPath(shared,item.path);
      if(!existsSync(source)&&same(contentPath(shared,item.sha256),item))linkContent(shared,item.sha256,source);
      if(!same(source,item))throw Error(`Old runtime changed: ${source}`);
      shareContentFile(shared,source,item);
    }
  }
  journal.phase='shared';save();
}
function switchViews(root,shared,journal,save){
  const views=new Map(journal.roots.map(owner=>[owner.root,resolve(shared,'.pando-cache/materialized',owner.owner,owner.config.revision)]));
  for(const owner of journal.roots){
    if(fileHash(resolve(owner.root,'config/library-data.json'))!==owner.configHash)throw Error('A runtime pin changed during migration');
    if(libraryOwnerId(owner.root)!==owner.owner)throw Error('A worktree branch changed during migration');
    prepareOwnedLibraryData({root:owner.root,fetch:false});
    synchronizeRuntimeManifest(shared,views.get(owner.root));
  }
  // Every old source must have an exact retained destination before deletion.
  for(const old of journal.legacy)for(const item of old.files){
    const logical=item.path.split('/').slice(3).join('/');
    if(['.complete','.cache-owner.json'].includes(logical))continue;
    const destinations=[];item.ownerDifferences=[];
    for(const root of old.owners){
      const output=resolve(views.get(root),logical);
      if(same(output,item))destinations.push(output);
      else item.ownerDifferences.push({root,retained:existsSync(output)?recordFile(shared,output):null});
    }
    if(!destinations.length){
      const output=containedPath(shared,`private-evidence/storage-migrations/${journal.id}/previous-cache/${item.sha256}`);
      if(!existsSync(output)){
        const source=containedPath(shared,item.path);
        if(!same(source,item)&&!same(contentPath(shared,item.sha256),item))throw Error('Previous cache edition changed');
        if(existsSync(source))shareContentFile(shared,source,item);
        linkContent(shared,item.sha256,output);
      }
      destinations.push(output);
    }
    for(const destination of destinations)if(!same(destination,item))throw Error(`Retained branch bytes differ: ${destination}`);
    item.destinations=destinations.map(p=>relative(shared,p).replaceAll('\\','/'));
  }
  journal.phase='switched';save();
}
function removeLegacy(root,shared,journal,save){
  consumers(journal.roots.map(r=>r.root),shared,{allowRoot:root,reclaim:true});
  for(const old of journal.legacy){
    const directory=containedPath(shared,`.pando-cache/materialized/${old.revision}`);
    if(!existsSync(directory))continue;
    // Mount checks are repeated immediately before removing each old cache.
    for(const owner of journal.roots)for(const mount of owner.config.mounts){const p=resolve(owner.root,mount);if(existsSync(p)&&realpathSync(p).startsWith(directory))throw Error(`Old cache is still mounted: ${p}`);}
    const listed=new Set(old.files.map(f=>f.path));
    for(const file of contentFiles(directory))if(!listed.has(relative(shared,file.path).replaceAll('\\','/')))throw Error(`New old-cache work appeared: ${file.path}`);
    for(const item of old.files){
      const source=containedPath(shared,item.path);if(!existsSync(source))continue;
      if(!same(source,item))throw Error(`Deletion source changed: ${source}`);
      if(item.destinations) { for(const destination of item.destinations)if(!same(containedPath(shared,destination),item))throw Error(`Deletion recovery bytes changed: ${destination}`); }
      else if(!['.complete','.cache-owner.json'].includes(basename(source)))throw Error('Deletion has no recovery proof');
      removeContentLink(shared,source);journal.deleted.push({path:item.path,bytes:item.bytes,reason:item.destinations?'exact retained view':'regenerated marker; original recorded in journal'});
    }
    removeEmpty(directory);save();
  }
  for(const item of journal.indexes){
    const source=containedPath(shared,item.path),destination=containedPath(shared,`private-evidence/storage-migrations/${journal.id}/${basename(item.path)}`);
    if(existsSync(source)){if(!same(source,item))throw Error('Historical Git index changed');mkdirSync(dirname(destination),{recursive:true});renameSync(source,destination);}
    if(!same(destination,item))throw Error('Relocated historical index differs');
    shareContentFile(shared,destination,item);
    journal.relocated.push({...item,destination:relative(shared,destination).replaceAll('\\','/')});
  }
  for(const item of journal.misplaced){
    const source=containedPath(shared,item.path);if(!existsSync(source))continue;
    const archived=execFileSync('git',['--no-lazy-fetch','cat-file','blob',item.oid],{cwd:item.recoveryRepository,env:environment(),maxBuffer:item.bytes+1024,stdio:['pipe','pipe','pipe']});
    if(!same(source,item)||contentHash(archived)!==item.sha256)throw Error('Old script recovery changed');
    unlinkSync(source);journal.deleted.push({...item,reason:'byte-exact local application Git blob'});
  }
  const oldScripts=resolve(shared,'.local-preserved');if(existsSync(oldScripts)&&!readdirSync(oldScripts).length)rmdirSync(oldScripts);
  for(const owner of journal.roots){const path=resolve(owner.root,'.library-data/dev-server.json');if(existsSync(path)&&!processAlive(JSON.parse(readFileSync(path,'utf8')).pid))unlinkSync(path);}
  journal.phase='caches-removed';save();
}
export function repackLocalObjects(shared,journal,save=()=>{}){
  const packRoot=containedPath(shared,'.git/objects/pack'),staging=containedPath(shared,`.pando-store/repack-${journal.id}`);
  if(!journal.newPacks){
    assertState(shared,journal.gitState);
    if(!sameSet(localObjects(shared).map(o=>o.oid),journal.objects.map(o=>o.oid)))throw Error('Local object set changed before packing');
    const peak=Math.ceil(journal.objects.reduce((sum,o)=>sum+o.bytes,0)*1.06);
    if(space(shared)<peak+5*1024**3)throw Error(`New Git packs need ${peak} bytes plus 5 GiB headroom`);
    mkdirSync(staging,{recursive:true});
    const promised=new Set(journal.promisor),newPacks=[];
    for(const [name,ids] of [['promisor',journal.promisor],['local',journal.objects.filter(o=>!promised.has(o.oid)).map(o=>o.oid)]]){
      if(!ids.length)continue;
      const prefix=containedPath(staging,name),hash=git(shared,['pack-objects','--non-empty','--threads=2',prefix],ids.join('\n')+'\n');
      if(!/^[a-f0-9]{40}$/.test(hash))throw Error('Unexpected pack output');
      const base=`${prefix}-${hash}`,actual=packObjects(base+'.idx');
      if(!sameSet(actual,ids))throw Error('New standalone pack does not contain its exact local object partition');
      if(name==='promisor')writeFileSync(base+'.promisor','');
      newPacks.push({base,hash,promisor:name==='promisor',objects:actual});
    }
    if(!sameSet(newPacks.flatMap(p=>p.objects),journal.objects.map(o=>o.oid)))throw Error('New pack union differs');
    journal.newPacks=newPacks;save();
  }
  for(const pack of journal.newPacks)for(const ext of ['pack','idx',...(pack.promisor?['promisor']:[])]){
    const source=pack.base+'.'+ext,target=containedPath(packRoot,`pack-${pack.hash}.${ext}`);
    if(existsSync(source)){if(existsSync(target)){if(fileHash(source)!==fileHash(target))throw Error('Pack destination collision');}else renameSync(source,target);}
    if(!existsSync(target))throw Error('New pack installation incomplete');
  }
  for(const pack of journal.newPacks)if(!sameSet(packObjects(resolve(packRoot,`pack-${pack.hash}.idx`)),pack.objects))throw Error('Installed pack differs');
  assertState(shared,journal.gitState);
  if(!sameSet(localObjects(shared).map(o=>o.oid),journal.objects.map(o=>o.oid)))throw Error('Local object set changed during packing');
  git(shared,['multi-pack-index','write','--stdin-packs'],journal.newPacks.map(p=>`pack-${p.hash}.idx`).join('\n')+'\n');
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
function verify(shared,journal){
  let originals=0,viewFiles=0,sharedFiles=0,privateFiles=0;
  for(const item of journal.immutable){if(!same(containedPath(shared,item.path),item))throw Error(`Original bytes differ: ${item.path}`);originals++;}
  for(const view of journal.liveViews||[])for(const item of view.files)if(!same(containedPath(shared,item.path),item))throw Error('Preexisting owner work changed during migration');
  for(const old of journal.legacy)for(const item of old.files)if(item.destinations)for(const path of item.destinations)if(!same(containedPath(shared,path),item))throw Error('Former source bytes are not recoverable');
  for(const owner of journal.roots){
    if(fileHash(resolve(owner.root,'config/library-data.json'))!==owner.configHash)throw Error('Runtime pin changed');
    const view=libraryMaterializedRoot(owner.root),record=JSON.parse(readFileSync(resolve(view,'.cache-owner.json'),'utf8'));
    for(const [logical,item] of Object.entries(record.files)){
      const path=containedPath(view,logical);if(!same(path,item))throw Error(`Runtime byte verification failed: ${path}`);viewFiles++;
      const s=statSync(path,{bigint:true});
      if(item.storage==='shared'){const blob=contentPath(shared,item.sha256);if(s.ino!==statSync(blob,{bigint:true}).ino||statSync(path).mode&0o200)throw Error('Shared inode/readonly verification failed');sharedFiles++;}
      else {if(s.nlink!==1n||!(statSync(path).mode&0o200))throw Error('Private runtime is not independently writable');privateFiles++;}
    }
  }
  return {originals,viewFiles,sharedFiles,privateFiles,objects:journal.objects.length};
}
export function libraryStorage({root=defaultRoot,apply=false,repack=true,stopAfter=null,progress=()=>{}}={}){
  root=resolve(root);const shared=librarySharedCheckout(root),roots=rootsFor(root,shared),pending=containedPath(shared,'.pando-store/storage-migration.pending.json');
  const run=()=>{
    if(apply&&!existsSync(pending)){
      consumers(roots,shared,{allowRoot:root,reclaim:true});
      // Register missing report protection before capturing the immutable Git
      // baseline. Runtime preparation must not introduce refs during repacking.
      for(const ownerRoot of roots)reportContext(ownerRoot,{allowFetch:false});
    }
    const journal=existsSync(pending)?JSON.parse(readFileSync(pending,'utf8')):snapshot(root,shared,roots,progress,apply);
    if(!apply)return {mode:'preview',shared,roots:journal.roots.map(r=>({owner:r.owner,revision:r.config.revision})),legacyCaches:journal.legacy.map(c=>({revision:c.revision,consumers:c.owners,files:c.files.length,bytes:c.files.reduce((s,f)=>s+f.bytes,0)})),immutableFiles:journal.immutable.length,objects:journal.objects.length,packEntries:journal.packEntries,duplicatePackEntries:journal.packEntries-journal.packedUnique,before:journal.before,continuation:existsSync(pending)};
    const save=()=>atomicStorageJSON(pending,journal);save();
    consumers(roots,shared,{allowRoot:root,reclaim:true});
    if(journal.phase==='inventoried'){migrationHeadroom(shared,journal);save();}
    if(journal.phase==='inventoried'){progress('sharing immutable originals');preserveSources(shared,journal,save);}
    if(stopAfter===journal.phase)return {interruptedAt:journal.phase};
    if(journal.phase==='shared'){progress('preparing and verifying owner views; switching mounts');switchViews(root,shared,journal,save);}
    if(stopAfter===journal.phase)return {interruptedAt:journal.phase};
    if(journal.phase==='switched'){progress('removing verified legacy copies');removeLegacy(root,shared,journal,save);}
    if(repack && ['caches-removed','packs-installed'].includes(journal.phase)){progress('repacking all local Git objects and verifying new packs');repackLocalObjects(shared,journal,save);}
    progress('verifying original bytes, private copies, shared file IDs and final space');
    const verification=verify(shared,journal),after=footprint(shared);
    const result={mode:'applied',id:journal.id,shared,startedAt:journal.startedAt,completedAt:new Date().toISOString(),before:journal.before,after,logicalBytesRemoved:journal.deleted.reduce((s,f)=>s+f.bytes,0),fileIdBytesReduction:journal.before.fileIdBytes-after.fileIdBytes,driveFreeBytesChange:after.freeBytes-journal.before.freeBytes,verification,relocated:journal.relocated,deleted:journal.deleted,retainedPrivate:journal.roots.map(o=>({owner:o.owner,view:libraryMaterializedRoot(o.root)}))};
    const evidence=containedPath(shared,`private-evidence/storage-migrations/${journal.id}`);mkdirSync(evidence,{recursive:true});
    atomicStorageJSON(resolve(evidence,'source-records.json'),journal);atomicStorageJSON(resolve(evidence,'result.json'),result);
    for(const name of ['source-records.json','result.json'])shareContentFile(shared,resolve(evidence,name));
    unlinkSync(pending);return {...result,evidence};
  };
  if(apply)return withLibraryLock(root,run,{maintenance:true});
  if(existsSync(resolve(shared,'.git/pando-library.lock')))throw Error('Storage is running; preview must wait');
  return run();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.argv.find(a=>a.startsWith('--root='))?.slice(7)||defaultRoot;
  const result=libraryStorage({root,apply:process.argv.includes('--apply'),repack:!process.argv.includes('--skip-repack'),progress:message=>console.error('Library storage: '+message)});
  // Full source/deletion lists live in evidence; keep terminal output concise.
  console.log(JSON.stringify({...result,deleted:result.deleted?{files:result.deleted.length,bytes:result.logicalBytesRemoved}:undefined}));
}
