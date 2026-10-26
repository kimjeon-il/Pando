// Fixed, opt-in C-profile policy. File mutations belong to worktree-generated;
// live application DBs are never maintained by the online phase.
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync,mkdirSync,openSync,closeSync,unlinkSync,writeFileSync,statfsSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {atomicStorageJSON,containedPath,contentHash} from './library-content.mjs';
import {fileHash} from './library-git.mjs';
import {previewGeneratedCleanup,applyGeneratedCleanup} from './worktree-generated.mjs';

const task='c-drive-cleanup-20261026';
const databaseNames=['goals_1.sqlite','logs_2.sqlite','memories_1.sqlite','memories_v2_1.sqlite','queue_1.sqlite','state_5.sqlite','thread_history_1.sqlite'];
const release=/^(?:integration-[^-]+-release-\d+|m91-release-[^-]+-\d+|main-[^-]+-release-\d+)$/;
export function classifyEditorChild(path){
 const [parent,child]=path.split('/');
 if(parent==='android')return /^(?:sdk|gradle|downloads|java|build-x86_64)$/.test(child)?'delete':'preserve';
 if(['cache','installer','windows-portable','m91-linker-tools'].includes(parent))return 'delete';
 if(release.test(parent))return /^(?:build|zip-[^/]+|portable|publish|retired-[^/]+|previous-portable[^/]*|previous-integration[^/]*|windows-portable|download-[^/]+|Pandoeditor-[^/]+\.zip)$/.test(child)?'delete':child?'relocate':'preserve';
 if(/^crash-analysis-/.test(parent))return /^(?:windbg[^/]*\.(?:msix|msixbundle)|debugger|symbols)$/.test(child)?'delete':child?'relocate':'preserve';
 if(/^gpu-verification-/.test(parent)||['m91-validation-source','m91-fixtures-c0bd31d1'].includes(parent)||/^(?:anchor|autosave|history|physical|preview)-test-(?:stdout|stderr)\.txt$/.test(parent)||parent==='physical_data_store_tests.moc')return 'relocate';
 return 'preserve';
}
export function cacheDirectories(home){
 const local=join(home,'AppData/Local'),roaming=join(home,'AppData/Roaming');
 const paths=[join(home,'.codex/cache'),...['pnpm-cache','npm-cache','pip/Cache'].map(p=>join(local,p))];
 for(const base of [join(local,'Microsoft/Edge/User Data/Default'),join(roaming,'Codex/web/Codex'),join(local,'Temp/pandolab-release-20261021/native-profile-packaged/EBWebView/Default')]){
  const profiles=base.endsWith('Codex')?[join(base,'Default'),join(base,'Default/Partitions')]:[base];
  for(const profile of profiles){
   if(basename(profile)==='Partitions'&&existsSync(profile))for(const name of readdirSync(profile))for(const cache of ['Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache'])paths.push(join(profile,name,cache));
   else for(const cache of ['Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache'])paths.push(join(profile,cache));
  }
 }
 return paths;
}
export function pcProcesses(){
 const raw=execFileSync('powershell.exe',['-NoProfile','-Command','@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024**2});
 return [JSON.parse(raw)].flat();
}
export function assertOffline(processes){
 const busy=processes.filter(p=>/^(?:codex|msedge|msedgewebview2)\.exe$/i.test(p.Name||''));
 if(busy.length)throw Error('Close Codex and Edge normally before offline maintenance: '+busy.map(p=>p.Name+':'+p.ProcessId).join(', '));
}
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const cell=value=>typeof value==='bigint'?['int',String(value)]:value instanceof Uint8Array?['blob',Buffer.from(value).toString('hex')]:[typeof value,value];
export function sqliteProof(db){
 if(db.prepare('PRAGMA integrity_check').all().some(r=>Object.values(r)[0]!=='ok'))throw Error('SQLite integrity check failed');
 const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
 const tables=[];
 for(const {name,sql} of schema.filter(r=>r.type==='table')){
  const columns=db.prepare('PRAGMA table_xinfo('+quote(name)+')').all(),keys=db.prepare('PRAGMA foreign_key_list('+quote(name)+')').all();
  const rowid=!/WITHOUT\s+ROWID/i.test(sql||'')&&!columns.some(c=>c.name==='_rowid_');
  const stmt=db.prepare('SELECT '+(rowid?'_rowid_,':'')+'* FROM '+quote(name));stmt.setReadBigInts(true);stmt.setReturnArrays(true);
  const hashes=[];for(const row of stmt.iterate())hashes.push(contentHash(Buffer.from(JSON.stringify(row.map(cell)))));
  hashes.sort();const hash=createHash('sha256');for(const item of hashes)hash.update(item);
  tables.push({name,columns,keys,rows:hashes.length,sha256:hash.digest('hex')});
 }
 const proof={schema,tables};return{logicalSha256:contentHash(Buffer.from(JSON.stringify(proof))),...proof};
}
const dbSize=db=>({pageSize:Number(db.prepare('PRAGMA page_size').get().page_size),pages:Number(db.prepare('PRAGMA page_count').get().page_count),freePages:Number(db.prepare('PRAGMA freelist_count').get().freelist_count)});
export async function compactDatabase({path,recovery,receipt,guard,afterBatch=()=>{},afterBackup=()=>{}}){
 guard();const db=new DatabaseSync(path,{timeout:0});let record;
 try{
  if(db.prepare('PRAGMA auto_vacuum').get().auto_vacuum!==2)throw Error('Only existing INCREMENTAL auto_vacuum databases are approved');
  db.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN IMMEDIATE; COMMIT;');
  const before=sqliteProof(db);
  if(existsSync(receipt)){
   record=JSON.parse(readFileSync(receipt,'utf8'));
   if(record.schema!=='pando-offline-sqlite-v1'||record.path!==resolve(path)||record.recovery!==resolve(recovery)||record.proof.logicalSha256!==before.logicalSha256)throw Error('DB or recovery receipt changed; preserve backup and stop');
  }else{
   if(existsSync(recovery))throw Error('Unreceipted recovery backup must be preserved');
   record={schema:'pando-offline-sqlite-v1',path:resolve(path),recovery:resolve(recovery),proof:before,before:dbSize(db),phase:'backup-pending'};atomicStorageJSON(receipt,record);
  }
  if(record.phase==='backup-pending'){
   mkdirSync(dirname(recovery),{recursive:true});const disk=statfsSync(dirname(recovery)),bytes=lstatSync(path).size;
   if(disk.bavail*disk.bsize<bytes+5*1024**3)throw Error('DB backup needs source size plus 5GiB free headroom');
   if(!existsSync(recovery)){guard();await backup(db,recovery);afterBackup();}
   if(lstatSync(recovery).isSymbolicLink())throw Error('Linked recovery backup must be preserved');
   const copy=new DatabaseSync(recovery,{readOnly:true});let copyProof;try{copyProof=sqliteProof(copy);}finally{copy.close();}
   if(copyProof.logicalSha256!==before.logicalSha256)throw Error('DB backup logical proof mismatch');
   record={...record,backupSha256:fileHash(recovery),phase:'backed-up'};atomicStorageJSON(receipt,record);
  }
  if(!['backed-up','verified-awaiting-reopen'].includes(record.phase)||!existsSync(recovery)||lstatSync(recovery).isSymbolicLink()||fileHash(recovery)!==record.backupSha256)throw Error('DB recovery backup changed; preserve and stop');
  let previous=dbSize(db).freePages;
  while(previous>0){
   guard();db.exec('PRAGMA incremental_vacuum(4096); PRAGMA wal_checkpoint(TRUNCATE);');
   const current=dbSize(db).freePages;if(current>=previous)throw Error('Incremental vacuum made no progress');
   previous=current;afterBatch(current);
  }
  const after=sqliteProof(db);if(after.logicalSha256!==record.proof.logicalSha256)throw Error('SQLite logical proof mismatch; recovery backup retained');
  record={...record,after:dbSize(db),phase:'verified-awaiting-reopen',verifiedAt:new Date().toISOString()};atomicStorageJSON(receipt,record);return record;
 }finally{db.close();}
}
const free=()=>Object.fromEntries(['C:/','D:/'].map(p=>{const s=statfsSync(p);return[p,s.bavail*s.bsize];}));
export function confirmRecovery(directory){
 for(const name of databaseNames){
  const receipt=join(directory,name+'.receipt.json');if(!existsSync(receipt))continue;const r=JSON.parse(readFileSync(receipt,'utf8'));
  if(r.recovery!==resolve(directory,'db-backups',name))throw Error('Recovery backup path changed');
  if(r.phase==='reopened-confirmed')continue;
  const recovery=()=>{const path=containedPath(directory,'db-backups/'+name);if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('Linked or non-file recovery backup must be preserved');return path;};
  recovery();
  if(!['verified-awaiting-reopen','reopen-confirmed-removing'].includes(r.phase)||(!existsSync(r.recovery)&&r.phase!=='reopen-confirmed-removing')||(existsSync(r.recovery)&&fileHash(r.recovery)!==r.backupSha256))throw Error('Recovery backup changed');
  atomicStorageJSON(receipt,{...r,phase:'reopen-confirmed-removing'});if(existsSync(recovery()))unlinkSync(recovery());
  atomicStorageJSON(receipt,{...r,phase:'reopened-confirmed',backupRemovedAt:new Date().toISOString()});
 }
}
export function checkedConsumers({processes,offline,policy}){
 if(offline)assertOffline(processes);
 if(policy?.requests.some(r=>/^playwright/.test(r.path))&&processes.some(p=>/^(?:msedge|chrome|chrome-headless-shell)\.exe$/i.test(p.Name||'')))throw Error('An active automation browser owner blocks saved Temp scopes');
 if(policy?.requests.some(r=>/[\\/]Pandoeditor$/i.test(r.root)&&/^cache(?:[\\/]|$)/.test(r.path))&&processes.some(p=>/^pandoeditor\.exe$/i.test(p.Name||'')))throw Error('An active Qt editor owner blocks its profile cache');
 return processes;
}
function children(root){return existsSync(root)?readdirSync(root,{withFileTypes:true}):[];}
function linkedDescendant(root){
 for(const child of children(root)){
  const path=join(root,child.name);if(child.isSymbolicLink())return path;
  if(child.isDirectory()){const linked=linkedDescendant(path);if(linked)return linked;}
 }
 return null;
}
export function discoverProfile({home,library,offline=false,processes=[]}){
 const requests=[],preserved=[],rootKinds=new Map();
 const evidence=join(library,'private-evidence/worktree-storage',task);
 function add(root,path,kind,action,reason,destination){
  const source=containedPath(root,path);if(!existsSync(source))return;
  const normalize=value=>String(value||'').replaceAll('\\','/').toLowerCase();
  if(/[\\/]Pandoeditor$/i.test(root)&&/^cache(?:[\\/]|$)/.test(path)&&processes.some(p=>/^pandoeditor\.exe$/i.test(p.Name||''))){preserved.push({path:source,reason:'active Qt editor owns profile cache'});return;}
  if(processes.some(p=>normalize(p.ExecutablePath).startsWith(normalize(source)+'/')||normalize(p.CommandLine).includes(normalize(source)))){preserved.push({path:source,reason:'active process references exact target'});return;}
  if(lstatSync(source).isSymbolicLink()){preserved.push({path:source,reason:'reparse point: never traverse'});return;}
  if(lstatSync(source).isDirectory()){
   const linked=linkedDescendant(source);if(linked){preserved.push({path:source,reason:'contains a reparse point; preserve whole scope without following it',linked});return;}
  }
  rootKinds.set(root+'|'+kind,{root,kind});
  requests.push({root,path,action,reason,...destination?{destination}:{}});
 }
 const cargo=join(home,'AppData/Local/PandoLab/build-cache');
 for(const branch of ['main','gis','objects'])add(cargo,branch+'-cargo-gnu','retired-cargo','delete','retired GNU target; current native apps are verified CI artifacts; compilers disabled');
 const editor=join(home,'AppData/Local/Pandoeditor');
 for(const top of children(editor)){
  const paths=top.isDirectory()&&!top.isSymbolicLink()&&(top.name==='android'||release.test(top.name)||/^crash-analysis-/.test(top.name))?children(join(editor,top.name)).map(c=>top.name+'/'+c.name):[top.name];
  for(const path of paths){
   const action=classifyEditorChild(path);
   if(action==='preserve'){preserved.push({path:join(editor,path),reason:'source link, signing key/user directory or unclassified content'});continue;}
   // Separate capability roots for evidence so that they can never be deleted.
   if(action==='relocate'){const source=join(editor,path);add(dirname(source),basename(source),'pc-evidence',action,'ended source/evidence retained with verified SHA-256',join(evidence,'Pandoeditor',path));}
   else add(editor,path,'retired-editor',action,'retired dedicated toolchain, build output or packaging; no current configuration/consumer');
  }
 }
 for(const cache of cacheDirectories(home)){
  const isLive=/[\\/]Codex[\\/]|[\\/]Edge[\\/]|native-profile-packaged/i.test(cache)||cache===join(home,'.codex/cache');
  if(isLive&&!offline){preserved.push({path:cache,reason:'offline phase: live Codex/Edge cache'});continue;}
  for(const child of children(cache))add(cache,child.name,'pc-cache','delete','reproducible metadata/download/browser cache; persistent profile state excluded');
 }
 const temp=join(home,'AppData/Local/Temp');
 for(const entry of children(temp)){
  if(/^playwright/.test(entry.name)&&processes.some(p=>/^(?:msedge|chrome|chrome-headless-shell)\.exe$/i.test(p.Name||''))){preserved.push({path:join(temp,entry.name),reason:'automation browsers active; defer profile/artifact cleanup to offline phase'});continue;}
  if(/^(?:pando-(?:check-plan|viewer-assets|worker-assets|pages|check-diff|assembly-test|core-assets|provenance-check|publication-test|cleanup-test)-|playwright(?:_chromiumdev_profile|-artifacts|-transform)-)/.test(entry.name)){
   add(temp,entry.name,'pc-temp','delete','ended synthetic fixture or automation-only browser profile; producer verified in application tests');
  }else if(/^pando-checks-/.test(entry.name)){
   add(temp,entry.name+'/web-site','pc-temp','delete','ended run-application-checks Pages staging generated from published inputs');
   for(const child of children(join(temp,entry.name)).filter(c=>c.name!=='web-site'))add(join(temp,entry.name),child.name,'pc-evidence','relocate','completed check evidence kept with provenance',join(evidence,'Temp',entry.name,child.name));
  }else if(/^pandolab-ne-europe-20261021-(?:bkg-vg250-2021|lsib10_2)\.zip$/.test(entry.name))add(temp,entry.name,'pc-evidence','relocate','original GIS download preserved; never treat source as temporary cache',join(evidence,'Temp',entry.name));
 }
 return{requests,compilerScopes:[...rootKinds.values()],roots:[...new Set([...rootKinds.values()].map(s=>s.root))],relocationRoots:[evidence],preserved};
}
async function withPcLock(directory,operation){
 mkdirSync(directory,{recursive:true});const lock=join(directory,'maintenance.lock');
 if(existsSync(lock)){const old=JSON.parse(readFileSync(lock,'utf8'));try{process.kill(old.pid,0);throw Error('PC maintenance already running');}catch(e){if(e.code!=='ESRCH')throw e;}unlinkSync(lock);}
 const fd=openSync(lock,'wx');writeFileSync(fd,JSON.stringify({pid:process.pid}));
 try{return await operation();}finally{closeSync(fd);unlinkSync(lock);}
}
export async function cleanupCDrive({mode,root,settings,library}){
 if(process.platform!=='win32'||settings?.compilerEnabled!==false)throw Error('C cleanup requires Windows and disabled local compilers');
 const home=homedir(),directory=join(settings.cacheRoot,task);mkdirSync(directory,{recursive:true});
 if(/[\r\n%&]/.test(root+process.execPath))throw Error('Unsupported external command path');
 writeFileSync(join(directory,'run-offline.cmd'),`@echo off\r\n"${process.execPath}" "${join(root,'tools/worktree-storage.mjs')}" "--root=${root}" --cleanup-c-drive=offline\r\nif errorlevel 1 (echo Maintenance stopped safely. Keep receipts and backups. & pause & exit /b 1)\r\necho Reopen Codex and verify projects, chats and login before removing backups.\r\npause\r\n`);
 const processGuard=()=>assertOffline(pcProcesses());
 if(mode==='offline')processGuard();
 return withPcLock(directory,async()=>{
  const offline=mode==='offline',prefix=offline?'offline':'online',manifestPath=join(directory,prefix+'.manifest.json'),resultPath=join(directory,prefix+'.result.json');
  if(mode==='preview'||mode==='apply'||offline){
   const getConsumers=()=>pcProcesses().filter(p=>p.ProcessId!==process.pid),snapshot=getConsumers();
   const policy=mode==='apply'&&existsSync(join(directory,prefix+'.policy.json'))?JSON.parse(readFileSync(join(directory,prefix+'.policy.json'),'utf8')):discoverProfile({home,library,offline,processes:snapshot});
   const options={...policy,consumers:checkedConsumers({policy,offline,processes:snapshot}),refreshConsumers:()=>checkedConsumers({policy,offline,processes:getConsumers()}),progress:message=>console.error('C cleanup: '+message)};
   if(mode==='preview'){
    const startedAtNs=String(BigInt(Date.now())*1000000n),manifest=previewGeneratedCleanup(options);
    atomicStorageJSON(manifestPath,manifest);atomicStorageJSON(join(directory,prefix+'.proof.json'),{schema:'pando-compiler-preview-proof-v1',startedAtNs,manifestSha256:contentHash(Buffer.from(JSON.stringify(manifest))),policySha256:contentHash(Buffer.from(JSON.stringify(policy)))});
    atomicStorageJSON(join(directory,prefix+'.policy.json'),policy);console.log(JSON.stringify({manifest:manifestPath,entries:manifest.entries.length,logicalBytes:manifest.entries.reduce((s,e)=>s+e.bytes,0),preserved:policy.preserved}));return;
   }
   if(!existsSync(resultPath)){
    // Offline previews must be made after the applications exit. Resume the exact
    // prior manifest when interrupted instead of replacing its durable cursor.
    if(offline&&!existsSync(manifestPath)){const manifest=previewGeneratedCleanup(options);atomicStorageJSON(manifestPath,manifest);atomicStorageJSON(join(directory,prefix+'.policy.json'),policy);atomicStorageJSON(join(directory,prefix+'.proof.json'),{manifestSha256:contentHash(Buffer.from(JSON.stringify(manifest))),policySha256:contentHash(Buffer.from(JSON.stringify(policy)))});}
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    const saved=JSON.parse(readFileSync(join(directory,prefix+'.policy.json'),'utf8'));
    const proof=JSON.parse(readFileSync(join(directory,prefix+'.proof.json'),'utf8'));if(proof.manifestSha256!==contentHash(Buffer.from(JSON.stringify(manifest)))||proof.policySha256!==contentHash(Buffer.from(JSON.stringify(saved))))throw Error('Changed PC cleanup manifest/policy; stop');
    const allocationPath=join(directory,prefix+'.allocation.json');
    if(!existsSync(allocationPath)){
     if(existsSync(join(directory,prefix+'.journal.json')))throw Error('Original allocation audit missing on interrupted cleanup');
     const python=join(home,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
     if(!existsSync(python))throw Error('Existing read-only metadata runtime missing; do not install another runtime');
     const allocation=JSON.parse(execFileSync(python,[join(root,'tools/pc-file-allocation.py'),manifestPath],{encoding:'utf8',windowsHide:true,maxBuffer:1024**2}));
     atomicStorageJSON(allocationPath,{manifestSha256:proof.manifestSha256,...allocation});
    }
    const allocation=JSON.parse(readFileSync(allocationPath,'utf8'));if(allocation.manifestSha256!==proof.manifestSha256)throw Error('Allocation manifest mismatch');
    const moved=manifest.entries.filter(e=>e.action==='relocate').reduce((sum,e)=>sum+e.bytes,0),d=statfsSync('D:/');
    if(moved>=1024**3&&d.bavail*d.bsize<moved+5*1024**3)throw Error('Evidence relocation needs peak bytes plus 5GiB headroom');
    const baseline=join(directory,prefix+'.before.json'),before=existsSync(baseline)?JSON.parse(readFileSync(baseline,'utf8')):free();if(!existsSync(baseline))atomicStorageJSON(baseline,before);
    const result=applyGeneratedCleanup({...options,...saved,manifest,consumers:checkedConsumers({policy:saved,offline,processes:getConsumers()}),refreshConsumers:()=>checkedConsumers({policy:saved,offline,processes:getConsumers()}),verifiedPreview:proof.schema?proof:null,journal:join(directory,prefix+'.journal.json'),retainCompletedJournal:true});
    atomicStorageJSON(resultPath,{...result,allocation,before,after:free(),completedAt:new Date().toISOString()});
   }
   const completedJournal=join(directory,prefix+'.journal.json');if(existsSync(completedJournal)){
    const result=JSON.parse(readFileSync(resultPath,'utf8')),journal=JSON.parse(readFileSync(completedJournal,'utf8'));
    if(journal.digest!==result.digest||journal.completedCount!==result.completedCount||journal.deletedBytes!==result.deletedBytes||journal.relocatedBytes!==result.relocatedBytes)throw Error('Completed cleanup result/journal mismatch');unlinkSync(completedJournal);
   }
   if(!offline){console.log(readFileSync(resultPath,'utf8'));return;}
   for(const name of databaseNames){
    processGuard();const path=containedPath(home,'.codex/'+name);if(!existsSync(path))continue;
    await compactDatabase({path,recovery:containedPath(directory,'db-backups/'+name),receipt:join(directory,name+'.receipt.json'),guard:processGuard});
   }
   atomicStorageJSON(join(directory,'offline.completed.json'),{phase:'verified-awaiting-reopen',at:new Date().toISOString(),free:free()});
   console.log('Offline maintenance verified. Reopen Codex; verify projects, chats and login. Keep DB backups until --cleanup-c-drive=confirm.');return;
  }
  if(mode==='confirm'){
   if(!existsSync(join(directory,'offline.completed.json')))throw Error('Offline phase not verified');
   confirmRecovery(directory);
   console.log('Verified recovery copies removed after user restart confirmation.');return;
  }
  throw Error('Expected --cleanup-c-drive=preview|apply|offline|confirm');
 });
}
