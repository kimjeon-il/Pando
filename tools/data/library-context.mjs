import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,statfsSync,unlinkSync,writeFileSync} from "node:fs";
import {basename,dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {decodeLibraryArchiveBytes,archiveStoredResources} from "./library-archive.mjs";
import {contentHash,contentPath,recoverContentPermissions} from "./library-content.mjs";
import {compactDuplicatePacks} from "./library-git.mjs";

export const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));

export const gitOptions = ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', '-c', 'core.autocrlf=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];

export const git = (root, args, { allowFetch = false } = {}) => {
  const output = execFileSync('git', [...gitOptions, ...args], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: allowFetch ? '0' : '1' }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  return args.includes('-z') || args.includes('-rz') ? output : output.trim();
};

export function libraryConfig(root = defaultRoot) {
  const config = JSON.parse(readFileSync(resolve(root, 'config/library-data.json'), 'utf8'));
  if (!/^[\w-]+\/[\w.-]+$/.test(config.repository) || !/^[a-f0-9]{40}$/.test(config.revision)) throw Error('Invalid pinned library configuration');
  return config;
}

export function libraryCheckout(root = defaultRoot) {
  const checkout = resolve(process.env.PANDOLAB_LIBRARY_DATA_ROOT || resolve(root, '.library-data/repository'));
  return existsSync(checkout) ? realpathSync(checkout) : checkout;
}

export function libraryMaterializedRoot(root = defaultRoot,{scopeId}={}) {
  const ownerBase=resolve(librarySharedCheckout(root), '.pando-cache/materialized', libraryOwnerId(root));
  const base=resolve(ownerBase, libraryConfig(root).revision);
  if(scopeId!==undefined){
    if(!/^[a-f0-9]{64}$/.test(scopeId))throw Error('Invalid preparation scope identity');
    return resolve(base,'scopes',scopeId);
  }
  const mount=resolve(root,'assets/data');
  if(existsSync(mount)&&lstatSync(mount).isSymbolicLink()){
    const target=realpathSync(mount),view=dirname(dirname(target));
    const parts=relative(ownerBase,view).split(sep);
    if(parts.length===3&&/^[a-f0-9]{40}$/.test(parts[0])&&parts[1]==='scopes'
      &&/^[a-f0-9]{64}$/.test(parts[2])&&target===resolve(view,'assets/data'))return view;
  }
  return base;
}

/** Read one explicit input without broadening the mounted preparation scope.
 * An owned missing working file is an error; unprepared archive bytes are not
 * a second mutable source and never overwrite the working edition. */
export function readLibraryDataFile(path,{root=defaultRoot,fetch=false}={}){
  const config=libraryConfig(root);
  if(typeof path!=='string'||!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path)||path.split('/').some(part=>part==='.'||part==='..')
    ||!config.mounts.some(mount=>mount!=='reports'&&(path===mount||path.startsWith(mount+'/'))))throw Error('Invalid explicit library input path');
  const view=libraryMaterializedRoot(root),file=safeChild(view,path);
  if(existsSync(file)){
    const stamp=lstatSync(file);if(!stamp.isFile()||stamp.isSymbolicLink())throw Error('Invalid library input: '+path);
    return readFileSync(file);
  }
  const manifest=resolve(view,'.cache-owner.json');
  if(existsSync(manifest)&&Object.hasOwn(JSON.parse(readFileSync(manifest,'utf8')).files,path))throw Error('Owned library input is missing: '+path);
  const checkout=libraryCheckout(root);
  const archive=JSON.parse(git(checkout,['show',config.revision+':archive/index.json'],{allowFetch:fetch}));
  const entry=archive.files[path];if(!entry)throw Error('Pinned library input is missing: '+path);
  return decodeArchiveEntry(checkout,entry,config.revision,{fetch});
}

export function libraryRuntimeLeasePath(root,product,pid=process.pid){
  if(!['viewer','editor','verification'].includes(product)||!Number.isInteger(pid)||pid<1)throw Error('Invalid frontend runtime lease');
  return resolve(root,'.library-data/runtime-leases',product+'-'+pid+'.json');
}

export function libraryRuntimeLeasePaths(root){
  const directory=resolve(root,'.library-data/runtime-leases');
  return existsSync(directory)?readdirSync(directory).filter(name=>/^(viewer|editor|verification)-[1-9]\d*\.json$/.test(name)).map(name=>resolve(directory,name)):[];
}

export function libraryReportRoot(root = defaultRoot) {
  return resolve(librarySharedCheckout(root), 'reports');
}

export function libraryReportEditRoot(root = defaultRoot) {
  return resolve(libraryReportRoot(root), '.edits', libraryOwnerId(root));
}

const sharedGitContexts=new Map();

function sharedGitDirectory(checkout){
  const control=resolve(checkout,'.git'),stamp=lstatSync(control,{bigint:true});
  const identity=stamp.isFile()?readFileSync(control,'utf8'):String(stamp.dev)+':'+String(stamp.ino);
  const prior=sharedGitContexts.get(checkout);
  if(prior?.identity===identity)return prior.directory;
  const directory=resolve(checkout,git(checkout,['rev-parse','--git-common-dir']));
  sharedGitContexts.set(checkout,{identity,directory});return directory;
}

export function librarySharedCheckout(root = defaultRoot) {
  const checkout = libraryCheckout(root);
  if (!existsSync(resolve(checkout, '.git'))) return checkout;
  return dirname(sharedGitDirectory(checkout));
}

const stagingContexts=new Map();

export function libraryStagingContent({root=defaultRoot,sha256,bytes}) {
  if(!existsSync(resolve(root,'config/library-data.json')))return null;
  libraryConfig(root);const checkout=libraryCheckout(root);
  let context=stagingContexts.get(root);
  if(context?.checkout!==checkout){context={checkout,shared:librarySharedCheckout(root)};stagingContexts.set(root,context);}
  const {shared}=context,blob=contentPath(shared,sha256);
  if(!existsSync(blob))return null;
  const a=lstatSync(blob,{bigint:true});
  if(a.isSymbolicLink()||!a.isFile()||Number(a.size)!==bytes||contentHash(readFileSync(blob))!==sha256||(Number(a.mode)&0o200))throw Error('Immutable staging snapshot integrity failed');
  return shared;
}

export const reportDigest = bytes => createHash('sha256').update(bytes).digest('hex');

export function libraryOwnerId(root) {
  const configPath=resolve(root,'config/library-data.json');
  if(existsSync(configPath)){
    const {reportOwner}=JSON.parse(readFileSync(configPath,'utf8'));
    if(reportOwner!==undefined){
      if(reportOwner!=='map-toolkit')throw Error('Unknown independent report owner');
      return reportOwner;
    }
  }
  const control=resolve(root,'.git');if(!existsSync(control))return 'main';
  if(!lstatSync(control).isFile())return 'main';
  const match=/^gitdir: (.+)\r?\n?$/.exec(readFileSync(control,'utf8'));
  if(!match)throw Error('Invalid permanent worktree Git directory');
  const directory=resolve(root,match[1]);
  const owner=basename(directory);
  if(basename(dirname(directory))!=='worktrees'||!['ui','objects','gis','places','optimization','pando-work-optimization'].includes(owner))
    throw Object.assign(Error('Unknown permanent worktree owner'),{code:'PANDO_LIBRARY_OWNER_UNKNOWN'});
  return owner;
}

export function plainReportFiles(base) {
  const files = [];
  if (!existsSync(base)) return files;
  const walk = path => {
    const stamp = lstatSync(path);
    if (stamp.isSymbolicLink()) throw Error(`Linked report source must be preserved: ${path}`);
    if (stamp.isDirectory()) for (const name of readdirSync(path)) walk(resolve(path, name));
    else if (stamp.isFile()) files.push({ path, logical: relative(base, path).replaceAll('\\', '/'), bytes: stamp.size, mtime: stamp.mtimeMs, ctime: stamp.ctimeMs });
  };
  walk(base); return files;
}

export function safeChild(root, path) {
  const target = resolve(root, path), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Unsafe library path: ${path}`);
  return target;
}

export function decodeArchiveEntry(checkout, entry, revision = null, {fetch=false}={}) {
  const local=stored=>readFileSync(safeChild(checkout,stored));
  const atRevision=(stored,part)=>execFileSync('git',[...gitOptions,'show',revision+':'+stored],{cwd:checkout,env:{...process.env,GIT_NO_LAZY_FETCH:fetch?'0':'1'},maxBuffer:Math.max((part?.bytes||entry.bytes)*2,16*1024*1024),stdio:['pipe','pipe','pipe']});
  const decode=read=>decodeLibraryArchiveBytes(read(entry.stored,entry.encoding==='gzip-chunks'?{bytes:entry.manifestBytes}:entry),entry,{readStored:read});
  try{return decode(local);}catch(error){if(!revision)throw error;}
  return decode(atRevision);
}

export function prefetchArchiveEntries({checkout,revision,entries,additionalBytes=0}){
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid archive revision');
  const resources=entries.flatMap(archiveStoredResources),byPath=new Map();for(const entry of resources){const old=byPath.get(entry.stored);if(!old||old.bytes<entry.bytes)byPath.set(entry.stored,entry);}const wanted=new Set(byPath.keys()),objects=new Map();
  const tree=git(checkout,['ls-tree','-rz',revision]);
  for(const row of tree.split('\0').filter(Boolean)){
    const match=/^\d+ blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);
    if(match&&wanted.has(match[2])){const entry=byPath.get(match[2]);objects.set(match[1],Math.max(objects.get(match[1])||0,2*entry.bytes+1024));wanted.delete(match[2]);}
  }
  if(wanted.size)throw Error('Pinned archive paths are missing: '+[...wanted].join(', '));
  const ids=[...objects.keys()];if(!ids.length)return {fetched:0};
  const check=oids=>execFileSync('git',[...gitOptions,'cat-file','--batch-check=%(objectname) %(objecttype)'],{cwd:checkout,input:oids.join('\n')+'\n',encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1'},maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']}).trim().split('\n');
  const missing=check(ids).filter(line=>line.endsWith(' missing')).map(line=>line.split(' ')[0]);
  if(!missing.length)return {fetched:0};
  const peak=additionalBytes+missing.reduce((n,oid)=>n+objects.get(oid),0);
  if(peak>=1024**3){const disk=statfsSync(checkout);if(disk.bavail*disk.bsize<peak+5*1024**3)throw Error('Archive fetch and materialization require their peak plus 5GiB headroom');}
  // Match Git's promisor fetch recipe: commit negotiation assumes local blobs
  // are present and can omit a delta base from a metadata-only partial clone.
  for(let at=0;at<missing.length;at+=128)execFileSync('git',[...gitOptions,'-c','fetch.negotiationAlgorithm=noop','fetch','--no-tags','--no-write-fetch-head','--recurse-submodules=no','--filter=blob:none','--stdin','origin'],{cwd:checkout,input:missing.slice(at,at+128).join('\n')+'\n',env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:['pipe','pipe','pipe']});
  if(check(missing).some(line=>!line.endsWith(' blob')))throw Error('Archive prefetch did not restore the requested blobs');
  return {fetched:missing.length};
}

export function withLibraryLock(root, operation, { maintenance = false, organizing = false, compact = false } = {}) {
  const lockPath = resolve(root, '.library-data/prepare.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  let lock;
  try { discardDeadLibraryLock(lockPath); lock = openSync(lockPath, 'wx'); }
  catch (error) { throw Error('Library preparation is already running; preserve its outputs and retry after it finishes.', { cause: error }); }
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, root })); return withCheckoutLock(libraryCheckout(root), operation, maintenance, organizing, compact); }
  finally { closeSync(lock); unlinkSync(lockPath); }
}

export function withCheckoutLock(checkout, operation, maintenance = false, organizing = false, compact = false) {
  if (!existsSync(resolve(checkout, '.git'))) return operation();
  const common = sharedGitDirectory(checkout);
  const path = resolve(common, 'pando-library.lock');
  let handle;
  try { discardDeadLibraryLock(path); handle = openSync(path, 'wx'); }
  catch (error) { throw Error('Library storage is already running in another worktree; retry after it finishes.', { cause: error }); }
  try {
    writeFileSync(handle, JSON.stringify({ pid: process.pid, checkout })); recoverContentPermissions(dirname(common));
    if (!maintenance && existsSync(resolve(dirname(common), '.pando-store/storage-migration.pending.json'))) throw Error('Library storage migration must resume before preparing or editing data.');
    if (!organizing && existsSync(resolve(dirname(common), '.pando-store/report-organization.pending.json'))) throw Error('Report organization must resume before preparing or editing data.');
    // Routine scoped preparation leaves whole-object-store maintenance explicit.
    if(compact&&(!maintenance||existsSync(resolve(common,'pando-git-compaction.pending.json'))))compactDuplicatePacks(checkout);
    const result=operation();
    if(compact&&!maintenance)compactDuplicatePacks(checkout);
    return result;
  }
  finally { closeSync(handle); unlinkSync(path); }
}

export function discardDeadLibraryLock(path) {
  const inspect=()=>{
    try{return lstatSync(path,{bigint:true});}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  };
  const before=inspect();
  if(!before||!before.isFile()||before.isSymbolicLink())return false;
  let owner;
  try{owner=JSON.parse(readFileSync(path,'utf8'));}catch{return false;}
  if(!Number.isInteger(owner.pid)||owner.pid<=0||!(typeof owner.root==='string'||typeof owner.checkout==='string'))return false;
  try{process.kill(owner.pid,0);return false;}catch(error){if(error.code!=='ESRCH')return false;}
  const after=inspect();
  if(!after||before.ino!==after.ino||before.mtimeNs!==after.mtimeNs||before.size!==after.size)return false;
  unlinkSync(path);return true;
}

export const libraryCodeDirectories = Object.freeze(['tools', 'tests', 'scripts', 'config', '.github']);
const sparseMetadata = ['/*', '!/*/', '/archive/', '!/archive/*', '/archive/index.json'];

export function setMetadataCheckout(checkout,{fetch=false}={}) {
  const shared = dirname(resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir'])));
  const keepReports = checkout === shared && existsSync(resolve(shared, 'reports/.owners.json'));
  const patterns=[...sparseMetadata,...(checkout===shared?libraryCodeDirectories.map(path=>'/'+path+'/'):[])],directories=new Set();
  const literal=path=>path.replace(/[\\*?[\]]/g,'\\$&');
  const includeDirectory=path=>{if(directories.has(path))return;const parent=path.slice(0,path.lastIndexOf('/'));if(parent)includeDirectory(parent);directories.add(path);patterns.push('/'+literal(path)+'/','!/'+literal(path)+'/*');};
  const reports=resolve(shared,'reports');
  if(keepReports)for(const name of readdirSync(reports).filter(name=>!name.startsWith('.'))){
    for(const file of plainReportFiles(resolve(reports,name))){
      const path='reports/'+relative(reports,file.path).replaceAll('\\','/');
      includeDirectory(path.slice(0,path.lastIndexOf('/')));patterns.push('/'+literal(path));
    }
  }
  execFileSync('git', [...gitOptions, 'sparse-checkout', 'set', '--no-cone', '--stdin'], {
    cwd: checkout, env:{...process.env,GIT_NO_LAZY_FETCH:fetch?'0':'1'}, input: patterns.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function organizationTree(shared, revision) {
  return git(shared, ['ls-tree', '-rz', revision]).split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'), [mode, type, oid] = row.slice(0, tab).split(' ');
    if (type !== 'blob') throw Error('Unexpected report tree entry');
    return { mode, oid, path: row.slice(tab + 1) };
  });
}
