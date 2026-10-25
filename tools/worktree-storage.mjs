// Local application storage owner. Library bytes remain owned by library-data.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, statfsSync, openSync, closeSync, lstatSync, rmdirSync, statSync, chmodSync, renameSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicStorageJSON, containedPath, contentHash, contentFiles, contentPath, publishContent, linkContentView, removeContentView, recoverContentPermissions } from './library-content.mjs';
import { libraryStagingContent, librarySharedCheckout, withLibraryLock, discardDeadLibraryLock } from './library-data.mjs';
import { previewGeneratedCleanup, applyGeneratedCleanup } from './worktree-generated.mjs';
import { snapshotGitStorage, repackLocalObjects } from './library-git.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const schema='pando-worktree-storage-v1';
export const cacheLimit=2*1024**3;
const stageMarker='.pandolab-web-shell-stage';
export function workspaceOutputRoot(root,settings=storageSettings(root)){
  return settings?containedPath(settings.cacheRoot,'workspaces/'+contentHash(Buffer.from(resolve(root).toLowerCase())).slice(0,16)):resolve(root,'.library-data/output');
}
export function editorStageRoot(root,settings=storageSettings(root)){return resolve(workspaceOutputRoot(root,settings),'editor');}
export function dependencyPreparationArguments({root,store}){
  return ['--dir',root,'install','--frozen-lockfile','--config.enableGlobalVirtualStore=true','--store-dir='+store,'--package-import-method=hardlink','--config.confirmModulesPurge=false'];
}
export function prepareDependencies(root=repository){
  const settings=storageSettings(root);if(!settings)throw Error('Activate application storage before dependency preparation');
  const version=JSON.parse(readFileSync(resolve(root,'package.json'))).packageManager;
  const executable=process.env.npm_execpath||resolve(dirname(execFileSync(process.platform==='win32'?'where.exe':'which',['pnpm'],{encoding:'utf8'}).split(/\r?\n/)[0]),'node_modules/pnpm/bin/pnpm.cjs');
  const pnpm=execFileSync(process.execPath,[executable,'--version'],{encoding:'utf8'}).trim();if(version!=='pnpm@'+pnpm)throw Error('Use the pinned pnpm version: '+version);
  const store=containedPath(settings.cacheRoot,'pnpm/store');
  atomicStorageJSON(resolve(root,'.library-data/dependencies.json'),{schema:'pando-dependency-store-v1',store});
  for(const project of [root,resolve(root,'apps/editor')]){
    const args=dependencyPreparationArguments({root:project,store});
    execFileSync(process.execPath,[executable,...args],{cwd:root,stdio:'inherit',windowsHide:true});
  }
  return {pnpm,store,projects:[root,resolve(root,'apps/editor')]};
}
export function installFrontendSnapshot({root,snapshot,settings=storageSettings(root)||{cacheRoot:resolve(root,'.library-data/cache')},afterFile=()=>{}}){
  if(!/^[a-f0-9]{64}$/.test(snapshot.sourceSha256))throw Error('Invalid frontend input identity');
  return withStorageLock(root,settings,()=>{
    const install=()=>{
    const store={root:settings.cacheRoot,blobDirectory:'blobs'},directory=containedPath(settings.cacheRoot,'frontend/'+snapshot.sourceSha256),pending=directory+'.pending',marker='frontend-manifest.json';
    const journal=containedPath(settings.cacheRoot,'frontend-install.pending.json');
    const files=[...snapshot.assets].map(([path,entry])=>({path,sourcePath:entry.sourcePath||null,bytes:entry.bytes.length,sha256:contentHash(entry.bytes)}));
    const manifest={schema:'pando-frontend-v1',product:snapshot.product||'common',sourceCommit:snapshot.sourceCommit,sourceSha256:snapshot.sourceSha256,dataCommit:snapshot.dataCommit,files};
    if(existsSync(journal)&&JSON.stringify(JSON.parse(readFileSync(journal)).manifest)!==JSON.stringify(manifest))throw Error('Resume the pending frontend installation first');
    const verify=dir=>{for(const file of files){const target=containedPath(dir,file.path),s=lstatSync(target);if(s.size!==file.bytes||contentHash(readFileSync(target))!==file.sha256||(s.mode&0o200))throw Error('Frontend immutable output differs: '+file.path);}};
    if(!existsSync(directory)){
      const peak=files.reduce((n,f)=>n+f.bytes,0),disk=statfsSync(settings.cacheRoot);
      if(peak>=1024**3&&disk.bavail*disk.bsize<peak+5*1024**3)throw Error('Frontend output requires payload plus 5GiB headroom');
      mkdirSync(pending,{recursive:true});atomicStorageJSON(journal,{root,manifest});atomicStorageJSON(resolve(pending,marker),manifest);
      for(const file of files){
        const shared=libraryStagingContent({root,sha256:file.sha256,bytes:file.bytes}),view={viewRoot:pending,marker};
        if(shared)linkContentView(shared,file.sha256,containedPath(pending,file.path),view);
        else{const blob=publishContent(store,snapshot.assets.get(file.path).bytes);linkContentView(store,blob.sha256,containedPath(pending,file.path),view);}
        afterFile(file);
      }
      verify(pending);renameSync(pending,directory);
    }
    if(JSON.stringify(JSON.parse(readFileSync(resolve(directory,marker))))!==JSON.stringify(manifest))throw Error('Frontend identity collision');
    verify(directory);if(existsSync(journal))unlinkSync(journal);
    const pointer=resolve(root,'.library-data/frontend-artifacts.json'),references=existsSync(pointer)?JSON.parse(readFileSync(pointer)):{};
    references[manifest.product]={directory,sourceSha256:snapshot.sourceSha256};atomicStorageJSON(pointer,references);return directory;
    };
    return existsSync(resolve(root,'config/library-data.json'))?withLibraryLock(root,install):install();
  });
}
export function retireFrontendSnapshots({root=repository,roots=permanentWorktrees(root),settings=storageSettings(root),apply=false,processes=runningStorageConsumers(),afterFile=()=>{}}={}){
  if(!settings)throw Error('Application storage is not activated');
  const operation=()=>{
    if(processes.length)throw Error('Active consumers block frontend retirement');
    const base=containedPath(settings.cacheRoot,'frontend'),journal=containedPath(settings.cacheRoot,'frontend-retirement.pending.json');
    for(const name of ['frontend-install.pending.json','native-install.pending.json','generated-retirement.pending.json'])if(existsSync(containedPath(settings.cacheRoot,name)))throw Error('Pending installation blocks frontend retirement');
    const referenced=new Set();
    for(const app of roots){const pointer=resolve(app,'.library-data/frontend-artifacts.json');if(existsSync(pointer))for(const ref of Object.values(JSON.parse(readFileSync(pointer))))referenced.add(containedPath(base,ref.directory));}
    let state=existsSync(journal)?JSON.parse(readFileSync(journal)):null;
    if(state&&(state.schema!=='pando-frontend-retirement-v1'||containedPath(base,state.directory)!==state.directory||referenced.has(state.directory)||!Number.isInteger(state.completedCount)||state.completedCount<0||state.completedCount>state.manifest.files.length))throw Error('Pending retirement scope changed');
    const entries=[];let deletedBytes=state?.deletedBytes||0,payloadBytesUnlinked=state?.payloadBytesUnlinked||0;
    const directories=existsSync(base)?readdirSync(base).filter(name=>/^[a-f0-9]{64}$/.test(name)).map(name=>containedPath(base,name)):[];
    if(state&&!directories.includes(state.directory)){
      if(!apply||!state.markerRetirement||state.completedCount!==state.manifest.files.length)throw Error('Pending frontend directory is missing');
      deletedBytes+=state.markerRetirement.bytes;payloadBytesUnlinked+=state.markerRetirement.bytes;unlinkSync(journal);state=null;
    }
    if(state)directories.sort((a,b)=>Number(b===state.directory)-Number(a===state.directory));
    for(const directory of directories){
      if(referenced.has(directory)){entries.push({directory,status:'referenced'});continue;}
      const marker=containedPath(directory,'frontend-manifest.json'),manifest=existsSync(marker)?JSON.parse(readFileSync(marker)):state?.directory===directory&&state.markerRetirement?state.manifest:null;
      if(!manifest)throw Error('Frontend ownership marker is missing');
      if(manifest.schema!=='pando-frontend-v1'||directory!==containedPath(base,manifest.sourceSha256)||!Array.isArray(manifest.files)||new Set(manifest.files.map(f=>f.path)).size!==manifest.files.length||manifest.files.some(f=>f.path==='frontend-manifest.json'))throw Error('Unknown frontend ownership');
      const resumed=state?.directory===directory;
      if(resumed&&JSON.stringify(state.manifest)!==JSON.stringify(manifest))throw Error('Pending frontend manifest changed');
      const completed=resumed?state.completedCount:0,expected=new Set(['frontend-manifest.json',...manifest.files.slice(completed).map(file=>file.path)]);
      for(const file of contentFiles(directory))if(!expected.has(file.logical))throw Error('Unlisted frontend file must be preserved: '+file.path);
      for(const file of manifest.files.slice(completed)){
        const target=containedPath(directory,file.path);
        if(!existsSync(target)){if(resumed&&state.pending?.path===file.path)continue;throw Error('Frontend file is missing');}
        const s=lstatSync(target);if(!/^[a-f0-9]{64}$/.test(file.sha256)||s.size!==file.bytes||contentHash(readFileSync(target))!==file.sha256||(s.mode&0o200))throw Error('Modified frontend output must be preserved');
      }
      const markerBytes=existsSync(marker)?lstatSync(marker).size:state.markerRetirement.bytes;
      const row={directory,status:'eligible',bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)+markerBytes};entries.push(row);
      if(!apply)continue;
      state=resumed?state:{schema:'pando-frontend-retirement-v1',directory,manifest,completedCount:0,pending:null,deletedBytes,payloadBytesUnlinked};
      atomicStorageJSON(journal,state);
      while(state.completedCount<manifest.files.length){
        const file=manifest.files[state.completedCount],target=containedPath(directory,file.path);
        if(existsSync(target)){
          const s=lstatSync(target);if(s.size!==file.bytes||contentHash(readFileSync(target))!==file.sha256)throw Error('Frontend changed before retirement');
          state.pending={path:file.path,physicalBytes:s.nlink===1?file.bytes:0};atomicStorageJSON(journal,state);
          const shared=existsSync(resolve(root,'config/library-data.json'))?libraryStagingContent({root,sha256:file.sha256,bytes:file.bytes}):null;
          removeContentView(shared||{root:settings.cacheRoot,blobDirectory:'blobs'},target,{viewRoot:directory,marker:'frontend-manifest.json'});
        }else if(state.pending?.path!==file.path)throw Error('Missing unjournaled frontend file');
        state.deletedBytes+=file.bytes;state.payloadBytesUnlinked+=state.pending.physicalBytes;state.pending=null;state.completedCount++;atomicStorageJSON(journal,state);afterFile(file);
      }
      state.markerRetirement={bytes:markerBytes};atomicStorageJSON(journal,state);
      if(existsSync(marker))unlinkSync(marker);state.deletedBytes+=markerBytes;state.payloadBytesUnlinked+=markerBytes;
      const prune=folder=>{for(const child of readdirSync(folder,{withFileTypes:true})){if(!child.isDirectory()||child.isSymbolicLink())throw Error('Unexpected frontend retirement remnant');prune(containedPath(folder,child.name));}rmdirSync(folder);};prune(directory);
      deletedBytes=state.deletedBytes;payloadBytesUnlinked=state.payloadBytesUnlinked;unlinkSync(journal);state=null;row.status='removed';
    }
    return{apply,entries,deletedBytes,payloadBytesUnlinked};
  };
  if(!apply)return operation();
  return withStorageLock(root,settings,()=>existsSync(resolve(root,'config/library-data.json'))?withLibraryLock(root,operation):operation());
}
function ownedStage(root,directory,settings=storageSettings(root)){
  const allowed=['dist','.dist-pending','.dist-previous'].map(name=>resolve(editorStageRoot(root,settings),name));
  if(!allowed.includes(resolve(directory)))throw Error('Not an owned App stage destination');
  directory=containedPath(editorStageRoot(root,settings),directory);
  const marker=containedPath(directory,stageMarker);
  if(!existsSync(marker)||!lstatSync(marker).isFile())throw Error('App stage ownership is not established');
  return {viewRoot:directory,marker:stageMarker};
}
function withStorageLock(root,settings,operation){
  mkdirSync(settings.cacheRoot,{recursive:true});
  const path=containedPath(settings.cacheRoot,'storage.lock');
  discardDeadLibraryLock(path);let fd;
  try{fd=openSync(path,'wx');}catch(error){throw Error('Worktree storage is already running; preserve its journal and retry',{cause:error});}
  try{writeFileSync(fd,JSON.stringify({pid:process.pid,root}));recoverContentPermissions({root:settings.cacheRoot,blobDirectory:'blobs'});return operation();}
  finally{closeSync(fd);unlinkSync(path);}
}
function removePreviousAppLink(settings,target,view,newStore,sha256){
  const appStore={root:settings.cacheRoot,blobDirectory:'blobs'},previous=contentPath(appStore,sha256),next=contentPath(newStore,sha256);
  if(existsSync(target)&&existsSync(previous)&&previous!==next&&statSync(target,{bigint:true}).ino===statSync(previous,{bigint:true}).ino)removeContentView(appStore,target,view);
}
export function writeStagedContent({root,directory,path,bytes,settings=storageSettings(root)}){
  const view=ownedStage(root,directory,settings),target=containedPath(directory,path);mkdirSync(dirname(target),{recursive:true});
  if(!settings){writeFileSync(target,bytes);return;}
  return withStorageLock(root,settings,()=>{
    const sha256=contentHash(bytes),shared=libraryStagingContent({root,sha256,bytes:bytes.length});
    if(shared)return withLibraryLock(root,()=>{removePreviousAppLink(settings,target,view,shared,sha256);return linkContentView(shared,sha256,target,view);});
    const store={root:settings.cacheRoot,blobDirectory:'blobs'},blob=publishContent(store,bytes);
    return linkContentView(store,blob.sha256,target,view);
  });
}
export function installNativeArtifactView({root,source,manifest,settings=storageSettings(root),afterFile=()=>{}}){
  if(!settings)throw Error('Activate application storage before installing native artifacts');
  if(manifest.schema!==1||!/^[a-f0-9]{64}$/.test(manifest.nativeInputSha256)||!['windows','android','android-x86_64'].includes(manifest.platform)||!['development','offline','verification'].includes(manifest.mode))throw Error('Invalid native artifact identity');
  return withStorageLock(root,settings,()=>{
    const store={root:settings.cacheRoot,blobDirectory:'blobs'},directory=containedPath(settings.cacheRoot,'native/'+manifest.nativeInputSha256),pending=directory+'.pending',journal=containedPath(settings.cacheRoot,'native-install.pending.json');
    if(existsSync(journal)&&JSON.parse(readFileSync(journal)).manifest.nativeInputSha256!==manifest.nativeInputSha256)throw Error('Resume the pending native artifact installation first');
    const checkFiles=(dir,value)=>{for(const f of value.files){const target=containedPath(dir,f.path);if(statSync(target).size!==f.bytes||contentHash(readFileSync(target))!==f.sha256||(statSync(target).mode&0o200))throw Error('Native artifact view changed or became writable');}};
    if(!existsSync(directory)){
      const bytes=manifest.files.reduce((n,f)=>n+f.bytes,0),disk=statfsSync(settings.cacheRoot);
      if(bytes>=1024**3&&disk.bavail*disk.bsize<bytes+5*1024**3)throw Error('Native installation requires payload plus 5GiB headroom');
      mkdirSync(pending,{recursive:true});
      if(existsSync(join(pending,'native-artifact.json'))&&JSON.stringify(JSON.parse(readFileSync(join(pending,'native-artifact.json'))))!==JSON.stringify(manifest))throw Error('Pending native artifact differs; preserve it for recovery');
      atomicStorageJSON(join(pending,'native-artifact.json'),manifest);atomicStorageJSON(journal,{root,source,manifest});
      const view={viewRoot:pending,marker:'native-artifact.json'};
      for(const f of manifest.files){if(!['pandolab-web-shell.exe','WebView2Loader.dll','app.apk'].includes(f.path))throw Error('Unexpected native artifact path');const input=containedPath(source,f.path),bytes=readFileSync(input);if(bytes.length!==f.bytes||contentHash(bytes)!==f.sha256)throw Error('Downloaded native artifact changed');publishContent(store,bytes);linkContentView(store,f.sha256,containedPath(pending,f.path),view);afterFile(f);}
      checkFiles(pending,manifest);renameSync(pending,directory);
    }
    const current=JSON.parse(readFileSync(containedPath(directory,'native-artifact.json')));
    if(current.nativeInputSha256!==manifest.nativeInputSha256||current.platform!==manifest.platform||current.mode!==manifest.mode)throw Error('Native view identity changed');checkFiles(directory,current);
    if(existsSync(journal))unlinkSync(journal);
    const pointer=containedPath(root,'.library-data/native-artifacts.json'),bindings=existsSync(pointer)?JSON.parse(readFileSync(pointer)):{};
    bindings[manifest.platform+'-'+manifest.mode]={directory,nativeInputSha256:manifest.nativeInputSha256};atomicStorageJSON(pointer,bindings);return directory;
  });
}
const fileIdentity=path=>{const s=lstatSync(path,{bigint:true});return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;};
const payloadIdentity=path=>fileIdentity(path).split(':').slice(0,4).join(':');
export function runningStorageConsumers(){
  if(process.platform!=='win32')throw Error('Consumer inventory requires this Windows host');
  const command="Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(cargo|rustc|rust-lld|cmake|ninja|msbuild|gradle|emulator|qemu-system-[\\w-]+|pandolab.*|baseline-ui_tests|candidate-ui_tests)\\.exe$' -or ($_.Name -match '^java(w)?\\.exe$' -and $_.CommandLine -match 'gradle') -or ($_.Name -match '^(msedgewebview2|chrome|msedge)\\.exe$' -and $_.CommandLine -match 'PandoLab|worktrees') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'stage\\.mjs|dev\\.mjs|frontend-dev-server\\.mjs|tests[\\\\/]browser[\\\\/]server\\.mjs|tools[\\\\/]build-[\\w-]+\\.mjs|tauri.*(dev|build)') } | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress";
  const json=execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true}).trim();
  return json?[JSON.parse(json)].flat():[];
}
export function permanentWorktrees(root=repository){return execFileSync('git',['-C',root,'worktree','list','--porcelain'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).filter(line=>line.startsWith('worktree ')).map(line=>resolve(line.slice(9)));}
export function protectedWorktreeFiles(roots){return roots.flatMap(app=>execFileSync('git',['-C',app,'ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean).map(path=>resolve(app,path)));}
function stageBusy(root,processes,settings=storageSettings(root)){
  if(existsSync(join(editorStageRoot(root,settings),'.stage-lock')))return 'Active App stage writer lock';
  if(processes.length)return `Active build/App/development consumer: ${processes.map(p=>p.ProcessId+':'+p.Name).join(', ')}`;
  return null;
}
function stageContentStore(root,settings,file){
  const shared=libraryStagingContent({root,sha256:file.sha256,bytes:file.bytes});
  return shared||{root:settings.cacheRoot,blobDirectory:'blobs'};
}
export function previewWorktreeStorage({root=repository,roots=permanentWorktrees(root),settings=storageSettings(root),processes=runningStorageConsumers()}={}){
  if(!settings)throw Error('Activate worktree storage before planning shared views');
  const entries=[];
  for(const app of roots){
    const directory=join(editorStageRoot(app,settings),'dist');if(!existsSync(directory))continue;
    const busy=stageBusy(app,processes,settings);
    if(busy){entries.push({root:app,directory,status:'protected',reason:busy});continue;}
    try{
      ownedStage(app,directory,settings);
      const evidence=JSON.parse(readFileSync(containedPath(directory,'shell/stage-evidence.json'),'utf8'));
      if(evidence.schema!=='pandolab-web-shell-stage'||!Array.isArray(evidence.files))throw Error('Unknown stage evidence');
      for(const file of evidence.files){
          const row={path:file.path,sha256:file.sha256,bytes:file.bytes,sourcePath:file.sourcePath,root:app,directory,status:'protected'};entries.push(row);
        try{
          if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||[stageMarker,'shell/stage-evidence.json'].includes(file.path))throw Error('Invalid stage path/hash/size');
          const path=containedPath(directory,file.path);const s=lstatSync(path);
          row.identity=fileIdentity(path);
          if(!s.isFile()||s.size!==file.bytes||contentHash(readFileSync(path))!==file.sha256||row.identity!==fileIdentity(path))throw Error('Changed stage file; private or unfinished bytes preserved');
          const store=stageContentStore(app,settings,file),blob=contentPath(store,file.sha256);
          const shared=existsSync(blob)&&statSync(blob,{bigint:true}).ino===statSync(path,{bigint:true}).ino;
          if(shared&&!(s.mode&0o200)){row.status='already-shared';continue;}
          const appBlob=contentPath({root:settings.cacheRoot,blobDirectory:'blobs'},file.sha256);
          const ownedAppLink=existsSync(appBlob)&&statSync(appBlob,{bigint:true}).ino===statSync(path,{bigint:true}).ino;
          if((s.nlink>1||!(s.mode&0o200))&&!ownedAppLink)throw Error('Unowned hardlink/readonly file preserved');
          row.status='eligible';row.ownedAppLink=ownedAppLink;row.payloadIdentity=payloadIdentity(path);
        }catch(error){row.reason=error.message;}
      }
    }catch(error){entries.push({root:app,directory,status:'protected',reason:error.message});}
  }
  return {schema,at:new Date().toISOString(),apply:false,entries};
}
export function applyWorktreeStorage(options={}){
  const root=options.root||repository,roots=options.roots||permanentWorktrees(root),settings=options.settings||storageSettings(root);
  if(!settings)throw Error('Activate worktree storage first');
  return withStorageLock(root,settings,()=>{
    const journal=containedPath(settings.cacheRoot,'migration.pending.json');
    const consumers=()=>options.processes??runningStorageConsumers();
    // Reclaim only this migration's explicit lease after proving its PID dead.
    // Empty, unknown, foreign-root and live-owner stage locks stay protected.
    for(const app of roots){
      const lease=containedPath(editorStageRoot(app,settings),'.stage-lock');if(!existsSync(lease)||!lstatSync(lease).isFile())continue;
      let owner;try{owner=JSON.parse(readFileSync(lease,'utf8'));}catch{continue;}
      if(owner.schema==='pando-worktree-stage-migration-v1'&&owner.operation==='share immutable stage'&&owner.root===app)discardDeadLibraryLock(lease);
    }
    const withStageLease=(app,operation)=>{
      if(!roots.map(x=>resolve(x)).includes(resolve(app)))throw Error('Unknown migration lease owner');
      const busy=stageBusy(app,consumers(),settings);if(busy)throw Error(busy);
      const lease=containedPath(editorStageRoot(app,settings),'.stage-lock'),fd=openSync(lease,'wx');
      try{writeFileSync(fd,JSON.stringify({schema:'pando-worktree-stage-migration-v1',pid:process.pid,root:app,operation:'share immutable stage'}));return operation();}
      finally{closeSync(fd);unlinkSync(lease);}
    };
    const finish=(entry,ownedStageLease=false)=>{
      if(!roots.map(x=>resolve(x)).includes(resolve(entry.root)))throw Error('Recovery entry is outside registered worktrees');
      if(!ownedStageLease){const busy=stageBusy(entry.root,consumers(),settings);if(busy)throw Error(busy);}
      const view=ownedStage(entry.root,entry.directory,settings),target=containedPath(entry.directory,entry.path),store=stageContentStore(entry.root,settings,entry),blob=contentPath(store,entry.sha256);
      if(!existsSync(blob)||contentHash(readFileSync(blob))!==entry.sha256||statSync(blob).size!==entry.bytes)throw Error('Recovery content integrity failed');
      if(existsSync(target)&&contentHash(readFileSync(target))!==entry.sha256)throw Error('Changed recovery target must be preserved');
      if(typeof store==='string')withLibraryLock(entry.root,()=>{removePreviousAppLink(settings,target,view,store,entry.sha256);linkContentView(store,entry.sha256,target,view);});
      else linkContentView(store,entry.sha256,target,view);
      if(statSync(target,{bigint:true}).ino!==statSync(blob,{bigint:true}).ino||(statSync(target).mode&0o200))throw Error('Shared view verification failed');
      unlinkSync(journal);
    };
    let recovered=null;
    if(existsSync(journal)){const record=JSON.parse(readFileSync(journal,'utf8'));if(record.schema!==schema)throw Error('Unknown migration journal');withStageLease(record.entry.root,()=>finish(record.entry,true));recovered=record.entry;}
    const result=previewWorktreeStorage({root,roots,settings,processes:consumers()});result.apply=true;result.recovered=recovered;
    const fs=statfsSync(settings.cacheRoot);result.freeBytesBefore=fs.bavail*fs.bsize;
    const unique=new Map();
    for(const row of result.entries.filter(x=>x.status==='eligible')){const store=stageContentStore(row.root,settings,row);if(!existsSync(contentPath(store,row.sha256)))unique.set(row.sha256,row.bytes);}
    result.peakAdditionalBytes=[...unique.values()].reduce((a,b)=>a+b,0);
    if(result.peakAdditionalBytes>3*1024**3||result.freeBytesBefore<result.peakAdditionalBytes+5*1024**3)throw Error('Insufficient migration peak/headroom');
    for(const app of roots){
      const rows=result.entries.filter(x=>x.status==='eligible'&&x.root===app);if(!rows.length)continue;
      withStageLease(app,()=>{
        for(const row of rows){
          const target=containedPath(row.directory,row.path);
          // Removing another owned hardlink changes ctime for this same inode.
          // Its file ID, size, payload mtime and exact hash must still match.
          if((fileIdentity(target)!==row.identity&&!(row.ownedAppLink&&payloadIdentity(target)===row.payloadIdentity))||contentHash(readFileSync(target))!==row.sha256)throw Error('Stale cleanup inventory; re-preview before applying');
          const store=stageContentStore(row.root,settings,row);
          if(typeof store!=='string')publishContent(store,readFileSync(target));
          atomicStorageJSON(journal,{schema,entry:row});options.afterPrepared?.(row);
          finish(row,true);row.status='shared';
        }
      });
    }
    const after=statfsSync(settings.cacheRoot);result.freeBytesAfter=after.bavail*after.bsize;result.freeBytesDelta=result.freeBytesAfter-result.freeBytesBefore;
    return result;
  });
}
export function pruneApplicationBlobs({root=repository,roots=permanentWorktrees(root),settings=storageSettings(root),apply=false,processes=runningStorageConsumers()}={}){
  if(!settings)throw Error('Worktree storage is not activated');
  const operation=()=>{
    for(const name of ['migration.pending.json','runtime-migration.pending.json','generated-retirement.pending.json','app-git-compaction.pending.json','native-install.pending.json','frontend-install.pending.json','frontend-retirement.pending.json'])if(existsSync(containedPath(settings.cacheRoot,name)))throw Error(`Pending recovery journal blocks blob pruning: ${name}`);
    const busy=roots.map(app=>stageBusy(app,processes,settings)).find(Boolean);if(busy)throw Error(busy);
    const store={root:settings.cacheRoot,blobDirectory:'blobs'},directory=containedPath(settings.cacheRoot,'blobs'),entries=[];
    const before=statfsSync(settings.cacheRoot);
    for(const file of contentFiles(directory)){
      const s=lstatSync(file.path);if(s.nlink!==1)continue;
      const row={path:file.path,bytes:s.size,status:'protected'};entries.push(row);
      if(!/^[a-f0-9]{64}$/.test(file.logical)||contentHash(readFileSync(file.path))!==file.logical){row.reason='Unknown or modified pool object';continue;}
      const identity=fileIdentity(file.path);row.status='unused-blob';
      if(apply){
        if(lstatSync(file.path).nlink!==1||fileIdentity(file.path)!==identity)throw Error('Pool object changed before removal');
        containedPath(settings.cacheRoot,file.path);chmodSync(file.path,0o600);unlinkSync(file.path);row.status='removed';
      }
    }
    recoverContentPermissions(store);
    const after=statfsSync(settings.cacheRoot);
    return {schema,apply,entries,deletedBytes:entries.filter(x=>x.status==='removed').reduce((n,x)=>n+x.bytes,0),freeBytesBefore:before.bavail*before.bsize,freeBytesAfter:after.bavail*after.bsize,freeBytesDelta:(after.bavail-before.bavail)*after.bsize};
  };
  return apply?withStorageLock(root,settings,operation):operation();
}
const retiredQtRuns=['qt-pair-70789caf-failed','qt-pair-4418b791','qt-pair-9bd078c7','qt-pair-ad3ba73b-baseline','qt-pair-ad3ba73b-candidate','qt-pair-b81c6173-baseline','qt-pair-b81c6173-candidate'];
export function shareRetiredQtRuntimes({root=repository,roots=permanentWorktrees(root),settings=storageSettings(root),apply=false,processes=runningStorageConsumers(),retire=false}={}){
  if(!settings)throw Error('Worktree storage is not activated');
  const store={root:settings.cacheRoot,blobDirectory:'blobs'};
  const validate=(app,directory,scan=true)=>{
    if(!roots.map(resolvePath=>resolve(resolvePath)).includes(resolve(app)))throw Error('Unknown runtime worktree');
    const path=containedPath(app,directory),relativePath=path.slice(resolve(app).length+1).replaceAll('\\','/');
    if(!retiredQtRuns.some(run=>relativePath.startsWith(`build-native/p9/${run}/`))||!path.endsWith('qt-runtime'))throw Error('Unknown retired runtime scope');
    const marker=containedPath(path,'source-identity.json');
    if(!existsSync(marker))throw Error('No source identity: preserve unique SDK material');
    const identity=JSON.parse(readFileSync(marker,'utf8'));
    if(identity.qtVersion!=='6.8.3'||!identity.binaries||Object.values(identity.binaries).some(row=>typeof row.file!=='string'))throw Error('Unknown runtime ownership');
    for(const binary of Object.values(identity.binaries))if(existsSync(containedPath(path,binary.file)))throw Error('A historical executable still consumes this runtime');
    const files=scan?contentFiles(path):[];
    if(files.some(file=>file.logical.endsWith('.exe')))throw Error('A historical executable still consumes this runtime');
    if(processes.length)throw Error('A build/application consumer is active');
    return {view:{viewRoot:path,marker:'source-identity.json'},files};
  };
  const operation=()=>{
    const entries=[],journal=containedPath(settings.cacheRoot,'runtime-migration.pending.json'),before=statfsSync(settings.cacheRoot);
    const finish=row=>{
      const {view}=validate(row.root,row.directory,false),target=containedPath(row.directory,row.path),blob=contentPath(store,row.sha256);
      if(!existsSync(blob)||contentHash(readFileSync(blob))!==row.sha256||statSync(blob).size!==row.bytes)throw Error('Runtime recovery blob differs');
      if(existsSync(target)&&contentHash(readFileSync(target))!==row.sha256)throw Error('Runtime changed; preserve recovery journal');
      linkContentView(store,row.sha256,target,view);
      if(statSync(target,{bigint:true}).ino!==statSync(blob,{bigint:true}).ino)throw Error('Runtime sharing did not preserve file identity');
      unlinkSync(journal);
    };
    if(apply&&existsSync(journal)){const record=JSON.parse(readFileSync(journal));if(record.schema!==schema)throw Error('Unknown runtime journal');finish(record.entry);}
    for(const app of roots)for(const run of retiredQtRuns){
      const runRoot=containedPath(app,`build-native/p9/${run}`);if(!existsSync(runRoot))continue;
      const directories=[join(runRoot,'qt-runtime'),...readdirSync(runRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.startsWith('p9-windows-qt-')).map(x=>join(runRoot,x.name,'qt-runtime'))].filter(existsSync);
      for(const directory of directories){
        let checked;try{checked=validate(app,directory);}catch(error){entries.push({root:app,directory,status:'protected',reason:error.message});continue;}
        if(retire){
          const files=checked.files.filter(f=>f.logical!=='source-identity.json'),marker=containedPath(directory,'source-identity.json');
          // Only already-owned shared SDK views qualify; unknown local bytes stay.
          const owned=files.every(f=>{const blob=contentPath(store,contentHash(readFileSync(f.path)));return existsSync(blob)&&statSync(blob,{bigint:true}).ino===statSync(f.path,{bigint:true}).ino;});
          if(!owned){entries.push({root:app,directory,status:'protected',reason:'Runtime includes unowned bytes'});continue;}
          const sourceIdentityText=readFileSync(marker,'utf8');
          const row={root:app,directory,status:apply?'removed-runtime':'retired-runtime',bytes:files.reduce((n,f)=>n+f.bytes,0),sourceIdentity:JSON.parse(sourceIdentityText),sourceIdentityText,sourceIdentitySha256:contentHash(Buffer.from(sourceIdentityText))};entries.push(row);
          if(apply){for(const f of files)removeContentView(store,f.path,checked.view);unlinkSync(marker);const prune=p=>{for(const e of readdirSync(p,{withFileTypes:true})){if(!e.isDirectory()||e.isSymbolicLink())throw Error('Unexpected runtime remnant');prune(containedPath(p,e.name));}rmdirSync(p);};prune(directory);}
          continue;
        }
        for(const file of checked.files.filter(x=>x.logical!=='source-identity.json')){
          const identity=fileIdentity(file.path),bytes=readFileSync(file.path),sha256=contentHash(bytes),blob=contentPath(store,sha256),s=lstatSync(file.path);
          const row={root:app,directory,path:file.logical,sha256,bytes:bytes.length,status:'eligible'};entries.push(row);
          if(existsSync(blob)&&statSync(blob,{bigint:true}).ino===statSync(file.path,{bigint:true}).ino){row.status='already-shared';continue;}
          if(s.nlink>1){row.status='protected';row.reason='Unknown shared SDK inode';continue;}
          if(apply){
            if(fileIdentity(file.path)!==identity)throw Error('Runtime changed before sharing');
            publishContent(store,bytes);atomicStorageJSON(journal,{schema,entry:row});finish(row);row.status='shared';
          }
        }
      }
    }
    const after=statfsSync(settings.cacheRoot);return {schema,apply,entries,freeBytesBefore:before.bavail*before.bsize,freeBytesAfter:after.bavail*after.bsize,freeBytesDelta:(after.bavail-before.bavail)*after.bsize};
  };
  return apply?withStorageLock(root,settings,operation):operation();
}
export function removeStagedDirectory({root,directory,settings=storageSettings(root)}){
  const view=ownedStage(root,directory,settings);
  const libraryStore=existsSync(join(root,'config/library-data.json'))?librarySharedCheckout(root):null;
  const operation=()=>{
    const files=contentFiles(directory);
    for(const file of files.filter(f=>f.logical!==stageMarker)){
      const s=lstatSync(file.path);
      if(s.nlink===1&&(s.mode&0o200)){unlinkSync(file.path);continue;}
      const sha256=contentHash(readFileSync(file.path)),stores=[];
      if(settings)stores.push({root:settings.cacheRoot,blobDirectory:'blobs'});
      if(libraryStore)stores.push(libraryStore);
      const store=stores.find(store=>{const blob=contentPath(store,sha256);return existsSync(blob)&&statSync(blob,{bigint:true}).ino===statSync(file.path,{bigint:true}).ino;});
      if(!store)throw Error(`Unowned readonly staging file must be preserved: ${file.path}`);
      removeContentView(store,file.path,view);
    }
    const prune=path=>{for(const entry of readdirSync(path,{withFileTypes:true}))if(entry.isDirectory()){const child=containedPath(directory,join(path,entry.name));prune(child);rmdirSync(child);}};
    prune(directory);unlinkSync(join(directory,stageMarker));rmdirSync(directory);
  };
  const remove=()=>libraryStore?withLibraryLock(root,operation):operation();
  return settings?withStorageLock(root,settings,remove):remove();
}
export function commonGit(root){return resolve(root,execFileSync('git',['-C',root,'rev-parse','--git-common-dir'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim());}
export function storageSettings(root){
  if(!existsSync(join(root,'.git')))return null;
  const path=join(commonGit(root),'pando-storage.json');
  if(!existsSync(path))return null;
  const settings=JSON.parse(readFileSync(path,'utf8'));
  if(settings.schema===schema&&settings.compilerEnabled===false)return settings;
  if(settings.schema!==schema||settings.version!=='0.19.0'||!/^[a-f0-9]{64}$/.test(settings.toolSha256))throw Error('Invalid activated worktree storage configuration');
  return settings;
}
export function assertCompilerCacheServer(settings,server){
  const normalize=value=>value.replace(/\\+/g,'/').replace(/\/$/,'').toLowerCase();
  const location=server.cache_location?.match(/^Local disk: "(.+)"$/)?.[1];
  if(server.version!==settings.version||server.max_cache_size!==cacheLimit||!location||normalize(location)!==normalize(join(settings.cacheRoot,'sccache'))||server.basedirs?.length)throw Error('Activated compiler cache server ownership/configuration mismatch');
}
export function compilerCacheEnvironment({root=repository,env=process.env,settings=storageSettings(root)}={}){
  const result={...env};if(!settings)return result;
  if(settings.schema!==schema)throw Error('Invalid compiler cache configuration');
  if(settings.compilerEnabled===false){
    for(const key of ['RUSTC_WRAPPER','CMAKE_C_COMPILER_LAUNCHER','CMAKE_CXX_COMPILER_LAUNCHER','EM_COMPILER_WRAPPER'])if(result[key]===settings.tool)delete result[key];
    if(result.SCCACHE_DIR&&resolve(result.SCCACHE_DIR)===resolve(settings.cacheRoot,'sccache'))for(const key of Object.keys(result))if(key.startsWith('SCCACHE_'))delete result[key];
    return result;
  }
  if(settings.schema!==schema||!Number.isInteger(settings.port)||settings.port<1024||settings.port>65535)throw Error('Invalid compiler cache configuration');
  if(!existsSync(settings.tool)||contentHash(readFileSync(settings.tool))!==settings.toolSha256)throw Error('Activated compiler cache tool integrity failed');
  const values={RUSTC_WRAPPER:settings.tool,CMAKE_C_COMPILER_LAUNCHER:settings.tool,CMAKE_CXX_COMPILER_LAUNCHER:settings.tool,
    EM_COMPILER_WRAPPER:settings.tool,SCCACHE_DIR:join(settings.cacheRoot,'sccache'),SCCACHE_CACHE_SIZE:String(cacheLimit),
    SCCACHE_SERVER_PORT:String(settings.port),SCCACHE_SERVER_UDS:'',SCCACHE_IGNORE_SERVER_IO_ERROR:'0',SCCACHE_BASEDIRS:settings.basedirs?.join(';')||''};
  for(const [key,value]of Object.entries(values)){
    if(result[key]&&result[key]!==value)throw Error(`Compiler cache configuration conflict: ${key}`);
    if(value)result[key]=value;
  }
  if(settings.version){
    const server=JSON.parse(execFileSync(settings.tool,['--show-stats','--stats-format=json'],{env:result,encoding:'utf8',windowsHide:true,timeout:15000}));
    assertCompilerCacheServer(settings,server);
  }
  return result;
}
function stopOwnedCompilerServer(settings){
  const command=`@(Get-NetTCPConnection -LocalPort ${settings.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {Get-CimInstance Win32_Process -Filter ('ProcessId='+$_)} | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress`;
  const text=execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true}).trim(),owners=text?[JSON.parse(text)].flat():[];
  if(!owners.length)return;
  if(owners.length!==1||resolve(owners[0].ExecutablePath||'')!==resolve(settings.tool))throw Error('Compiler port belongs to another process; preserve it');
  if(contentHash(readFileSync(settings.tool))!==settings.toolSha256)throw Error('Compiler server executable changed');
  const env={...process.env,SCCACHE_DIR:join(settings.cacheRoot,'sccache'),SCCACHE_SERVER_PORT:String(settings.port),SCCACHE_CACHE_SIZE:String(cacheLimit)};
  const server=JSON.parse(execFileSync(settings.tool,['--show-stats','--stats-format=json'],{env,encoding:'utf8',windowsHide:true}));assertCompilerCacheServer(settings,server);
  execFileSync(settings.tool,['--stop-server'],{env,stdio:'pipe',windowsHide:true});
}
export function deactivateCompilerCache({root=repository,settings=storageSettings(root),processes=runningStorageConsumers(),stopServer=stopOwnedCompilerServer}={}){
  if(!settings)throw Error('Application storage is not activated');
  if(processes.some(p=>/^(cargo|rustc|rust-lld|cmake|ninja|msbuild|gradle)\.exe$/i.test(p.Name||'')||/^java(w)?\.exe$/i.test(p.Name||'')&&/gradle/i.test(p.CommandLine||'')))throw Error('An active native build blocks compiler deactivation');
  return withStorageLock(root,settings,()=>{if(settings.compilerEnabled!==false)stopServer(settings);const next={...settings,compilerEnabled:false};atomicStorageJSON(join(commonGit(root),'pando-storage.json'),next);return{compilerActive:false,applicationStorageActive:true,cacheRoot:settings.cacheRoot};});
}
export async function activateCompilerCache(root=repository){
  const versions=JSON.parse(readFileSync(join(root,'config/toolchain-versions.json'),'utf8')).sccache;
  const toolDirectory=`D:/build/toolchains/sccache/${versions.version}`,tool=join(toolDirectory,'sccache.exe');
  const cacheRoot='D:/build/cache/pandolab';
  const existing=storageSettings(root),receipt=join(toolDirectory,'installation.json');
  mkdirSync(cacheRoot,{recursive:true});containedPath(cacheRoot,'blobs');
  const fs=statfsSync(cacheRoot);if(fs.bavail*fs.bsize<8*1024**3)throw Error('Insufficient headroom for 3GiB peak + 5GiB');
  if(!existsSync(tool)){
    if(existsSync(toolDirectory)&&readdirSync(toolDirectory).length)throw Error('Preserve unexpected existing tool installation');
    mkdirSync(toolDirectory,{recursive:true});
    const archive=join(toolDirectory,'download.zip'),unpacked=join(toolDirectory,'unpacked');
    if(existsSync(archive)||existsSync(unpacked))throw Error('Preserve unfinished sccache download; inspect before resuming installation');
    const response=await fetch(versions.url);if(!response.ok)throw Error(`sccache download failed: ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(contentHash(bytes)!==versions.sha256)throw Error('Official sccache archive integrity failed');
    writeFileSync(archive,bytes,{flag:'wx'});
    execFileSync('tar.exe',['-xf',archive,'-C',toolDirectory],{windowsHide:true,stdio:'pipe'});
    // Only the fixed official executable is installed. Extraction remnants are task-owned.
    const {copyFileSync,rmSync}=await import('node:fs');
    const extracted=join(toolDirectory,`sccache-v${versions.version}-x86_64-pc-windows-msvc`);
    copyFileSync(join(extracted,'sccache.exe'),tool,1);
    atomicStorageJSON(receipt,{version:versions.version,archiveSha256:versions.sha256,toolSha256:contentHash(readFileSync(tool))});
    rmSync(extracted,{recursive:true});unlinkSync(archive);
  }
  const recorded=existsSync(receipt)?JSON.parse(readFileSync(receipt,'utf8')):null;
  if(recorded ? recorded.version!==versions.version||recorded.archiveSha256!==versions.sha256||recorded.toolSha256!==contentHash(readFileSync(tool)) : !existing||existing.tool!==tool||existing.toolSha256!==contentHash(readFileSync(tool)))throw Error('Unowned or modified compiler cache installation; preserve it for inspection');
  const version=execFileSync(tool,['--version'],{encoding:'utf8',windowsHide:true}).trim();
  if(version!==`sccache ${versions.version}`)throw Error('Unexpected sccache version');
  const settings={schema,cacheRoot,tool,toolSha256:contentHash(readFileSync(tool)),port:42427,version:versions.version};
  if(existing&&JSON.stringify(existing)!==JSON.stringify(settings))throw Error('Preserve existing storage activation; configuration differs');
  compilerCacheEnvironment({root,settings});
  if(!existing){
    const {createServer}=await import('node:net');
    const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(settings.port,'127.0.0.1',yes);});
    await new Promise(yes=>server.close(yes));
    atomicStorageJSON(join(commonGit(root),'pando-storage.json'),settings);
  }
  console.log(JSON.stringify(settings));return settings;
}

async function main(){
  const args=process.argv.slice(2),root=resolve(args.find(x=>x.startsWith('--root='))?.slice(7)||repository);
  if(args.includes('--compact-git')){
    const shared=dirname(commonGit(root)),settings=storageSettings(root),progress=message=>console.error('App Git storage: '+message);
    if(!settings)throw Error('Worktree storage activation required');
    const operation=()=>{
      const journalPath=containedPath(settings.cacheRoot,'app-git-compaction.pending.json');
      const busy=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(git|git-pack-objects|git-index-pack)\\.exe$' }).Count"],{encoding:'utf8',windowsHide:true}).trim();
      if(busy!=='0')throw Error('Another Git operation is active; retry after it finishes');
      const journal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):snapshotGitStorage(shared,progress);
      const save=()=>atomicStorageJSON(journalPath,journal);
      if(args.includes('--apply')){save();progress('packing and independently verifying all local objects');repackLocalObjects(shared,journal,save);}
      const output=args.find(x=>x.startsWith('--output='))?.slice(9);if(output)atomicStorageJSON(resolve(output),journal);
      if(args.includes('--apply'))unlinkSync(journalPath);
      console.log(JSON.stringify({objects:journal.objects.length,phase:journal.phase,deletedBytes:journal.deleted.reduce((n,x)=>n+x.bytes,0),output}));
    };
    return args.includes('--apply')?withStorageLock(root,settings,operation):operation();
  }
  const retirement=args.find(x=>x.startsWith('--retire-generated='))?.slice('--retire-generated='.length);
  if(retirement){
    const worktrees=permanentWorktrees(root),settings=storageSettings(root),input=JSON.parse(readFileSync(retirement,'utf8'));
    const compilerScopes=args.includes('--retire-compilers')?[...worktrees.map(root=>({root,kind:'worktree'})),{root:'D:/build/toolchains',kind:'toolchains'},{root:'C:/Users/taeeu/AppData/Local/Android/Sdk',kind:'android-sdk'},{root:'D:/Android/Sdk',kind:'retired-android-sdk'},{root:'D:/Android/avd',kind:'avd'},{root:'C:/Users/taeeu/.android/avd',kind:'avd'},{root:'D:/build/cache/pandolab',kind:'compiler-cache'}]:[];
    if(compilerScopes.length&&settings?.compilerEnabled!==false)throw Error('Disable local compilers after actual runtime acceptance before retiring SDKs');
    const roots=[...new Set([...worktrees,...compilerScopes.map(s=>s.root)])];
    if(!settings)throw Error('Worktree storage activation required');
    const protectedPaths=protectedWorktreeFiles(worktrees);
    const relocationRoots=[resolve(librarySharedCheckout(root),'private-evidence/worktree-storage/generated-cleanup-20261025'),resolve(librarySharedCheckout(root),'private-evidence/worktree-storage/workspace-layout-20261025'),resolve('D:/build/toolchains')];
    const proof=args.find(x=>x.startsWith('--verified-compiler-preview='))?.slice('--verified-compiler-preview='.length);
    const options={roots,compilerScopes,consumers:runningStorageConsumers(),refreshConsumers:runningStorageConsumers,protectedPaths,relocationRoots,verifiedPreview:proof?JSON.parse(readFileSync(proof,'utf8')):null,progress:message=>console.error('Generated cleanup: '+message)};
    const operation=()=>input.schema?applyGeneratedCleanup({...options,manifest:input,journal:resolve(settings.cacheRoot,'generated-retirement.pending.json')}):previewGeneratedCleanup({...options,requests:input.requests});
    if(!!input.schema!==args.includes('--apply'))throw Error('Preview requires requests; apply requires the exact preview manifest');
    const result=args.includes('--apply')?withStorageLock(root,settings,operation):operation();
    const output=args.find(x=>x.startsWith('--output='))?.slice(9);if(output)atomicStorageJSON(resolve(output),result);
    console.log(JSON.stringify({entries:result.entries?.length,deletedBytes:result.deletedBytes,relocatedBytes:result.relocatedBytes,payloadBytesUnlinked:result.payloadBytesUnlinked,output}));return;
  }
  if(args.includes('--prepare-dependencies')){console.log(JSON.stringify(prepareDependencies(root)));return;}
  if(args.includes('--retire-frontend')){console.log(JSON.stringify(retireFrontendSnapshots({root,apply:args.includes('--apply')})));return;}
  if(args.includes('--activate-compiler-cache'))return activateCompilerCache(root);
  if(args.includes('--disable-local-compiler')){console.log(JSON.stringify(deactivateCompilerCache({root})));return;}
  const compilerValues=()=>storageSettings(root)?.compilerEnabled===false?{}:Object.fromEntries(Object.entries(compilerCacheEnvironment({root})).filter(([key])=>/^(RUSTC_WRAPPER|CMAKE_C_COMPILER_LAUNCHER|CMAKE_CXX_COMPILER_LAUNCHER|EM_COMPILER_WRAPPER|SCCACHE_\w+)$/.test(key)));
  if(args.includes('--compiler-config')){const settings=storageSettings(root);console.log(JSON.stringify({active:!!settings&&settings.compilerEnabled!==false,env:settings?compilerValues():{}}));return;}
  if(args.includes('--compiler-env')){console.log(JSON.stringify(storageSettings(root)?compilerValues():{}));return;}
  if(args.includes('--with-compiler-cache')){
    const index=args.indexOf('--'),command=args.slice(index+1);
    if(index<0||!command.length)throw Error('Expected --with-compiler-cache -- command arguments');
    const result=spawnSync(command[0],command.slice(1),{cwd:process.cwd(),env:compilerCacheEnvironment({root}),stdio:'inherit',windowsHide:true});
    if(result.error)throw result.error;process.exitCode=result.status??1;return;
  }
  const result=args.includes('--retire-qt-runtimes')?shareRetiredQtRuntimes({root,apply:args.includes('--apply'),retire:true}):args.includes('--share-retired-qt')?shareRetiredQtRuntimes({root,apply:args.includes('--apply')}):args.includes('--prune-blobs')?pruneApplicationBlobs({root,apply:args.includes('--apply')}):args.includes('--apply')||args.includes('--resume')?applyWorktreeStorage({root}):previewWorktreeStorage({root});
  const output=args.find(x=>x.startsWith('--output='))?.slice(9);
  if(output)atomicStorageJSON(resolve(output),result);
  console.log(JSON.stringify({apply:result.apply,entries:result.entries.length,statuses:Object.fromEntries([...new Set(result.entries.map(x=>x.status))].map(status=>[status,result.entries.filter(x=>x.status===status).length])),freeBytesDelta:result.freeBytesDelta,output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
