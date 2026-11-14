import {closeSync,existsSync,fstatSync,lstatSync,openSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defaultRoot,git,librarySharedCheckout} from './library-context.mjs';
import {libraryWriteLeases,scopesOverlap} from './library-runtime.mjs';
import {assertRawBranchTarget,readRawGitBlob,stageRawBranchCommit} from './library-raw-branch-git.mjs';
import {planRawCoastStore} from './library-raw-coast-plan.mjs';

const pinPath='config/library-data.json',indexPath='archive/index.json';
const sha=/^[a-f0-9]{40}$/;
const fail=message=>{throw Error('Raw coast storage: '+message)};

function controlPath(repository){
  const path=resolve(repository,'.git'), item=lstatSync(path);
  if(!item.isDirectory()||item.isSymbolicLink()||realpathSync.native(path)!==path)fail('single, physical Git checkout required');
  return path;
}

function context(root,expectedAppRevision,expectedDataRevision,scopes){
  root=realpathSync.native(root);
  const library=realpathSync.native(librarySharedCheckout(root));
  if(root===library||!sha.test(expectedAppRevision||'')||!sha.test(expectedDataRevision||''))fail('explicit paired app and library revisions required');
  controlPath(root);
  const control=controlPath(library);
  assertRawBranchTarget(root,expectedAppRevision);
  assertRawBranchTarget(library,expectedDataRevision);
  const pin=JSON.parse(readRawGitBlob(root,expectedAppRevision,pinPath));
  const archive=JSON.parse(readRawGitBlob(library,expectedDataRevision,indexPath));
  if(pin.schemaVersion!==1||pin.repository!=='kimjeon-il/PandoLab-library'||pin.revision!==expectedDataRevision||
    archive.branch!=='work/gis-raw-modern'||!pin.mounts?.includes('assets/data')||!pin.mounts?.includes('reports'))
    fail('existing raw app pin and archive branch must match the requested data revision');
  if(git(root,['--no-optional-locks','status','--porcelain=v1','--untracked-files=all'])||
     git(library,['--no-optional-locks','status','--porcelain=v1','--untracked-files=all']))fail('preserve unrelated checkout edits before storing');
  const blockedBy=[];
  for(const [path,reason] of [
    [resolve(root,'.library-data/prepare.lock'),'app preparation lock'],[resolve(control,'pando-git-compaction.pending.json'),'pending library Git compaction'],
    [resolve(library,'.pando-store/storage-migration.pending.json'),'pending library storage migration'],
    [resolve(library,'.pando-store/report-organization.pending.json'),'pending report organization'],
    [resolve(library,'.pando-store/.permission-restore.json'),'pending content permission recovery']]){
    if(existsSync(path))blockedBy.push(reason);
  }
  if(libraryWriteLeases(library).some(lease=>lease.alive&&
    (!Array.isArray(lease.prefixes)||lease.prefixes.some(a=>scopes.some(b=>scopesOverlap(a,b))))))
    blockedBy.push('overlapping library write lease');
  return {root,library,control,pin,archive,blockedBy};
}

function readContext(options){
  if(process.env.PANDOLAB_LIBRARY_DATA_ROOT||process.env.PANDOLAB_LIBRARY_WRITE_TOKEN||process.env.PANDOLAB_LIBRARY_WRITE_LEASE||
     Object.keys(process.env).some(key=>/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_|$)|REPLACE_REF_BASE)/i.test(key)))
    fail('inherited write credentials, lease or Git overrides are not accepted');
  const {root=defaultRoot,expectedAppRevision,expectedDataRevision,updates,proofs}=options;
  if(!(updates instanceof Map)||!(proofs instanceof Map))fail('explicit runtime and evidence maps required');
  const inspect=()=>context(root,expectedAppRevision,expectedDataRevision,[...updates.keys(),...proofs.keys()]);
  const prepare=({library,archive})=>planRawCoastStore({index:archive,
    readStored:path=>readRawGitBlob(library,expectedDataRevision,path),sourceRevision:expectedAppRevision,updates,proofs});
  return {inspect,prepare,expectedAppRevision,expectedDataRevision};
}

/** Run canonical gates and compute exact scoped archive writes without modifying either repository. */
export function inspectRawCoastStore(options){
  const {inspect,prepare,expectedAppRevision,expectedDataRevision}=readContext(options);
  const state=inspect();
  if(existsSync(resolve(state.control,'pando-library.lock')))state.blockedBy.push('shared library store lock');
  const plan=prepare(state);
  return {appRevision:expectedAppRevision,dataRevision:expectedDataRevision,paths:[...plan.paths.keys()].sort(),blockedBy:state.blockedBy};
}

/** Store only audited current source + evidence on the existing local raw data ref, then pair the raw app pin.
 * Neither checked-out branch can be the target, and no source checkout, mount or report registry is updated.
 */
export function storeRawCoastData(options){
  const {inspect,prepare,expectedAppRevision,expectedDataRevision}=readContext(options);
  const assertClear=state=>{if(state.blockedBy.length)fail(state.blockedBy.join('; '));return state;};
  const initial=assertClear(inspect()),lock=resolve(initial.control,'pando-library.lock');
  const handle=openSync(lock,'wx');
  try{
    writeFileSync(handle,JSON.stringify({pid:process.pid,checkout:initial.library}));
    const state=assertClear(inspect());
    if(state.control!==initial.control||state.root!==initial.root)fail('paired checkout changed while taking the lock');
    const plan=prepare(state);
    const data=stageRawBranchCommit({repository:state.library,expectedRevision:expectedDataRevision,paths:plan.paths,
      message:'Store reviewed current coastline on local raw branch'});
    plan.verify(path=>readRawGitBlob(state.library,data.revision,path));
    const newPin=Buffer.from(JSON.stringify({...state.pin,revision:data.revision},null,2)+'\n');
    const app=stageRawBranchCommit({repository:state.root,expectedRevision:expectedAppRevision,
      paths:new Map([[pinPath,newPin]]),message:'Pair raw GIS app with reviewed local coastline data'});
    assertClear(inspect());
    try{
      data.publish();
      app.publish();
      assertRawBranchTarget(state.library,data.revision);
      assertRawBranchTarget(state.root,app.revision);
      plan.verify(path=>readRawGitBlob(state.library,data.revision,path));
      if(!readRawGitBlob(state.root,app.revision,pinPath).equals(newPin))fail('paired pin byte readback does not match');
    }catch(cause){
      // A CAS may have completed before its post-write readback failed. Never
      // roll back or rerun writes without inspecting the two live revisions.
      const live=repo=>{
        try{return git(repo,['--no-replace-objects','show-ref','--verify','--hash','refs/heads/work/gis-raw-modern']);}
        catch{return null;}
      };
      const liveData=live(state.library),liveApp=live(state.root);
      if(liveData===expectedDataRevision&&liveApp===expectedAppRevision)throw cause;
      throw Object.assign(new Error('Raw pair changed or could not be read back; inspect recorded revisions before retrying.',{cause}),{
        code:liveData===data.revision&&liveApp===expectedAppRevision?'PANDO_RAW_COAST_PIN_PENDING':'PANDO_RAW_COAST_VERIFY_REQUIRED',
        dataRevision:data.revision,pendingAppRevision:app.revision,liveDataRevision:liveData,liveAppRevision:liveApp,
      });
    }
    return {dataRevision:data.revision,appRevision:app.revision};
  }finally{
    const owned=fstatSync(handle,{bigint:true});closeSync(handle);
    const current=lstatSync(lock,{bigint:true,throwIfNoEntry:false});
    if(current?.isFile()&&current.dev===owned.dev&&current.ino===owned.ino&&current.mtimeNs===owned.mtimeNs)unlinkSync(lock);
  }
}
