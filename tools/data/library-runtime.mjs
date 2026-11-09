import {execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,rmdirSync,statfsSync,symlinkSync,unlinkSync,writeFileSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {atomicStorageJSON,containedPath,contentFiles,contentHash,contentPath,linkContent,makePrivate,publishContent,removeContentLink} from "./library-content.mjs";
import {runtimeArchiveIndex} from "./library-runtime-index.mjs";
import {mapProjectManifestSourcePath,validateMapProjectManifest} from '../../src/data/map-project-manifest.js';
import {defaultRoot,gitOptions,git,libraryConfig,libraryCheckout,libraryMaterializedRoot,libraryRuntimeLeasePaths,libraryReportRoot,librarySharedCheckout,libraryOwnerId,safeChild,decodeArchiveEntry,prefetchArchiveEntries,withLibraryLock,withCheckoutLock,setMetadataCheckout} from "./library-context.mjs";
import {excludeReportStorage,reportContext} from "./library-reports.mjs";

function pristineCache(directory, files) {
  let pristine = true;
  const seen = new Set();
  const visit = (path, prefix = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const logical = prefix + entry.name, file = resolve(path, entry.name);
      if (entry.isSymbolicLink()) { pristine = false; continue; }
      if (entry.isDirectory()) visit(file, logical + '/');
      else if (entry.isFile() && !['.complete', '.cache-owner.json'].includes(logical)) {
        seen.add(logical);
        const entry = files[logical];
        if (entry?.storage === 'private' || (typeof entry === 'string' ? entry : entry?.sha256) !== createHash('sha256').update(readFileSync(file)).digest('hex')) pristine = false;
      }
    }
  };
  visit(directory);
  return pristine && Object.keys(files).every(path => seen.has(path));
}

let lastRetirementSignature;

function retireOwnedCaches(root, current) {
  // Old caches without this ownership record are handled by the separately
  // reviewed cleanup. Never infer ownership from an ignored directory alone.
  const base = dirname(current), active = new Set([current]);
  let roots;
  try { roots = git(root, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => resolve(line.slice(9))); }
  catch { return; }
  for (const worktree of roots) {
    if (!existsSync(resolve(worktree, 'config/library-data.json'))) continue;
    try { active.add(libraryMaterializedRoot(worktree)); }
    catch (error) {
      if (error.code !== 'PANDO_LIBRARY_OWNER_UNKNOWN') throw error;
      // An unrecognized peer may still consume a cache. Preserve every cache
      // rather than guessing its owner or blocking this owner's preparation.
      return { status:'skipped', reason:'unrecognized-peer-owner', worktree };
    }
    for(const lease of libraryRuntimeLeasePaths(worktree))if (existsSync(lease)) {
      const record = JSON.parse(readFileSync(lease, 'utf8'));
      try { process.kill(record.pid, 0); for (const path of record.materialized) active.add(path); }
      catch (error) { if (error.code !== 'ESRCH') return; }
    }
    for (const mount of libraryConfig(worktree).mounts) {
      const output = resolve(worktree, mount);
      if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
        const target = realpathSync(output), rel = relative(base, target);
        if (!rel.startsWith('..') && !isAbsolute(rel)) active.add(resolve(base, rel.split(sep)[0]));
      }
    }
  }
  const directories = readdirSync(base, { withFileTypes: true });
  const signature = JSON.stringify({ base, active: [...active].sort(), directories: directories.map(item => item.name).sort() });
  if (signature === lastRetirementSignature) return;
  for (const item of directories) {
    if (!item.isDirectory() || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.name)) continue;
    const directory = safeChild(base, item.name), owner = resolve(directory, '.cache-owner.json');
    if (active.has(directory) || !existsSync(owner)) continue;
    const record = JSON.parse(readFileSync(owner, 'utf8'));
    const expected = item.name.length === 64 ? record.preparation?.scopeId : record.revision;
    if (expected !== item.name || record.schema !== 'pando-shared-runtime-v1' || record.owner !== libraryOwnerId(root)) continue;
    // Private WIP is never eligible for retirement. Do not hash its entire
    // runtime dataset merely to reach that already-known preservation result.
    if (Object.values(record.files).some(entry => entry.storage !== 'shared')) continue;
    if (libraryWriteLeases(librarySharedCheckout(root)).some(lease => lease.alive && lease.view === directory)) continue;
    if (pristineCache(directory, record.files)) removeRuntimeView(librarySharedCheckout(root), directory, record);
  }
  lastRetirementSignature = signature;
}

export function prepareLibraryData({ root = defaultRoot, fetch = true, purpose = 'viewer', prefixes = [], projectId = null } = {}) {
  return withLibraryLock(root, () => prepareOwnedLibraryData({ root, fetch, purpose, prefixes, projectId }));
}

export function mountLibraryInputs({ source, root }) {
  source = realpathSync(source); root = realpathSync(root);
  const input = safeChild(source, 'assets/data'), output = safeChild(root, 'assets/data');
  for (const parent of [dirname(input), dirname(output)]) {
    try { if (lstatSync(parent).isSymbolicLink()) throw Error('Indirect library input parent is forbidden'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!lstatSync(input).isDirectory() || lstatSync(input).isSymbolicLink()) throw Error('Library inputs must be a regular checkout directory');
  try { lstatSync(output); throw Error('Existing library input target must not be overwritten'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existsSync(resolve(root, '.git'))) {
    const exclude = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']);
    const previous = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (!previous.split(/\r?\n/).includes('/assets/data')) {
      mkdirSync(dirname(exclude), { recursive: true });
      writeFileSync(exclude, previous + (previous.endsWith('\n') || !previous ? '' : '\n') + '/assets/data\n');
    }
  }
  mkdirSync(dirname(output), { recursive: true });
  symlinkSync(input, output, process.platform === 'win32' ? 'junction' : 'dir');
  return output;
}

function plainChild(checkout, path, checkedDirectories = new Map()) {
  const output = safeChild(checkout, path);
  for (let current = dirname(output); current !== checkout; current = dirname(current)) {
    if (checkedDirectories.get(current) === false) return null;
    if (checkedDirectories.get(current) === true) break;
    let stamp;
    try { stamp = lstatSync(current); } catch (error) { if (error.code === 'ENOENT') { checkedDirectories.set(current, false); return null; } throw error; }
    if (stamp.isSymbolicLink()) throw Error(`Linked checkout path must be preserved: ${path}`);
    checkedDirectories.set(current, true);
  }
  return output;
}

export function compactLibraryCheckout({ checkout, apply = false } = {}) {
  checkout = realpathSync(checkout);
  if (!apply) {
    const common = resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir']));
    if (existsSync(resolve(common, 'pando-library.lock'))) throw Error('Library storage is already running.');
    return compactOwnedCheckout(checkout, false);
  }
  return withCheckoutLock(checkout, () => compactOwnedCheckout(checkout, apply));
}

export function compactOwnedCheckout(checkout, apply) {
  const result = { checkout, status: 'protected', eligibleBytes: 0, deletedBytes: 0, files: 0 };
  if (git(checkout, ['status', '--porcelain'])) return { ...result, reason: 'Checkout has local edits or untracked work.' };
  const head = git(checkout, ['rev-parse', 'HEAD']);
  const tree = git(checkout, ['ls-tree', '-rz', 'HEAD']).split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw Error('Unsupported or unavailable archive tree entry; preserve checkout.');
    return { mode: match[1], oid: match[2], path: match[3] };
  });
  const shared = dirname(resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir'])));
  const keepReports = checkout === shared && existsSync(resolve(shared, 'reports/.owners.json'));
  const excluded = tree.filter(item => item.path.includes('/') && item.path !== 'archive/index.json' && !(keepReports && item.path.startsWith('reports/')));
  const parents = [...new Set(excluded.map(item => item.path.split('/')[0]))];
  const unknown = parents.length ? git(checkout, ['ls-files', '--others', '-z', '--', ...parents]) : '';
  if (unknown) return { ...result, reason: 'Excluded directories contain untracked or ignored files.' };
  const checkedDirectories = new Map();
  const candidates = excluded.filter(item => {
    const path = plainChild(checkout, item.path, checkedDirectories);
    if (!path) return false;
    let stamp;
    try { stamp = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!/^100[0-7]{3}$/.test(item.mode) || !stamp.isFile()) throw Error(`Unsupported checkout file: ${item.path}`);
    item.bytes = stamp.size;
    return true;
  });
  const verified = [];
  for (let offset = 0; offset < candidates.length;) {
    const batch = []; let size = 0;
    do { const item = candidates[offset++]; batch.push(item); size += item.bytes; }
    while (offset < candidates.length && size + candidates[offset].bytes < 16 * 1024 * 1024);
    const packed = execFileSync('git', [...gitOptions, 'cat-file', '--batch'], {
      cwd: checkout, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
      input: batch.map(item => item.oid).join('\n') + '\n', maxBuffer: size + batch.length * 128 + 1024,
    });
    let cursor = 0;
    for (const item of batch) {
      const end = packed.indexOf(10, cursor), header = packed.subarray(cursor, end).toString();
      if (header !== `${item.oid} blob ${item.bytes}`) throw Error(`Offline archive object unavailable: ${item.path}`);
      const archived = packed.subarray(end + 1, end + 1 + item.bytes);
      const algorithm = item.oid.length === 64 ? 'sha256' : 'sha1';
      if (createHash(algorithm).update(`blob ${item.bytes}\0`).update(archived).digest('hex') !== item.oid) throw Error(`Corrupt Git archive object: ${item.path}`);
      const path = plainChild(checkout, item.path, checkedDirectories), stamp = lstatSync(path);
      if (!stamp.isFile() || stamp.isSymbolicLink()) throw Error(`Linked checkout file: ${item.path}`);
      if (!readFileSync(path).equals(archived)) return { ...result, reason: `Modified raw checkout bytes: ${item.path}` };
      verified.push({ ...item, stamp });
      cursor = end + 1 + item.bytes + 1;
    }
  }
  result.eligibleBytes = verified.reduce((sum, item) => sum + item.bytes, 0);
  result.files = verified.length;
  result.status = 'verified-unused';
  if (!apply) return result;
  if (git(checkout, ['rev-parse', 'HEAD']) !== head || git(checkout, ['status', '--porcelain'])) throw Error('Checkout changed during compaction review.');
  if (parents.length && git(checkout, ['ls-files', '--others', '-z', '--', ...parents])) throw Error('Untracked files appeared during compaction review.');
  checkedDirectories.clear();
  for (const item of verified) {
    const stamp = lstatSync(plainChild(checkout, item.path, checkedDirectories));
    if (!stamp.isFile() || stamp.isSymbolicLink()) throw Error(`Linked checkout file: ${item.path}`);
    if (stamp.size !== item.stamp.size || stamp.mtimeMs !== item.stamp.mtimeMs || stamp.ctimeMs !== item.stamp.ctimeMs) throw Error('Checkout file changed during review.');
  }
  git(checkout, ['update-index', '--refresh']);
  setMetadataCheckout(checkout);
  result.deletedBytes = verified.filter(item => !existsSync(resolve(checkout, item.path))).reduce((sum, item) => sum + item.bytes, 0);
  if (verified.some(item => existsSync(resolve(checkout, item.path)))) throw Error('Verified checkout copies remain after sparse checkout.');
  // Keep the canonical storage pathspecs usable by the permanent worktrees.
  // Empty directories cost no payload copies and cannot stage sparse deletions.
  for (const path of ['assets', 'assets/data', 'objects', 'reports']) {
    const output = safeChild(checkout, path);
    if (existsSync(output)) {
      const stamp = lstatSync(output);
      if (!stamp.isDirectory() || stamp.isSymbolicLink()) throw Error(`Unexpected library directory: ${path}`);
    } else mkdirSync(output);
  }
  if (git(checkout, ['status', '--porcelain']) || git(checkout, ['rev-parse', 'HEAD']) !== head) throw Error('Unexpected checkout state after compaction.');
  result.status = 'compacted';
  return result;
}

export function runtimeMaterializationPeak(index, sourceFiles, presentHashes) {
  const source = new Map(sourceFiles.filter(file => !['.complete','.cache-owner.json'].includes(file.logical)).map(file=>[file.logical,file]));
  const pool = new Set(presentHashes);let poolBytes=0,privateBytes=0;
  for(const [logical,entry] of Object.entries(index.files)) {
    if(logical.startsWith('reports/'))continue;
    const old=source.get(logical);source.delete(logical);
    if(old&&(old.sha256!==entry.sha256||old.bytes!==entry.bytes))privateBytes+=old.bytes;
    else if(!pool.has(entry.sha256)){poolBytes+=entry.bytes;pool.add(entry.sha256);}
  }
  for(const file of source.values())privateBytes+=file.bytes;
  return {poolBytes,privateBytes,totalBytes:poolBytes+privateBytes};
}

export function materializeRuntimeView({ root, index, source = null, fetch=false,purpose='viewer',prefixes=[],projectManifest=null }) {
  const shared = librarySharedCheckout(root), config = libraryConfig(root), owner = libraryOwnerId(root);
  index=runtimeArchiveIndex(index,entry=>decodeArchiveEntry(libraryCheckout(root),entry,config.revision,{fetch}),{purpose,prefixes,projectManifest});
  source ||= libraryMaterializedRoot(root);
  const sourceOwnerPath=resolve(source,'.cache-owner.json');
  const sourceOwner=existsSync(sourceOwnerPath)?JSON.parse(readFileSync(sourceOwnerPath,'utf8')):null;
  const priorPinnedView=sourceOwner?.schema==='pando-shared-runtime-v1'&&sourceOwner.owner===owner
    &&sourceOwner.revision!==config.revision;
  const selectedPaths = new Set(Object.keys(index.files));
  // New, unarchived GIS outputs belong to the explicitly selected write scope.
  // Never enumerate unrelated originals or another task's private work.
  if (purpose === 'gis') for (const prefix of prefixes) {
    const path = containedPath(source, prefix);
    for (const file of contentFiles(path)) selectedPaths.add(relative(source, file.path).replaceAll('\\', '/'));
  }
  const sourceFiles = [...selectedPaths].sort().flatMap(logical => {
    const path = containedPath(source, logical);
    if (!existsSync(path)) return [];
    const stamp = lstatSync(path);
    if (!stamp.isFile() || stamp.isSymbolicLink()) throw Error('Linked or non-file preparation input: ' + path);
    const sha256=contentHash(readFileSync(path)),prior=sourceOwner?.files?.[logical];
    // A pin change refreshes proven, untouched archive inputs. Only actual
    // private work is carried into the new view; the previous view remains.
    if(priorPinnedView&&prior?.storage==='shared'&&prior.baseSha256===prior.sha256
      &&prior.sha256===sha256&&prior.bytes===stamp.size)return [];
    return [{ logical, path, bytes: stamp.size, sha256 }];
  });
  const overrides = sourceFiles.filter(file => file.sha256 !== index.files[file.logical]?.sha256
    || file.bytes !== index.files[file.logical]?.bytes).map(({ logical, sha256, bytes }) => [logical, sha256, bytes]);
  if (overrides.length) index.preparation = { ...index.preparation,
    archiveScopeId: index.preparation.scopeId,
    scopeId: contentHash(Buffer.from(JSON.stringify({ archiveScopeId: index.preparation.scopeId, overrides }))) };
  const sourceByPath = new Map(sourceFiles.map(file => [file.logical, file]));
  const expected = Object.fromEntries([...selectedPaths].sort().map(path => {
    const spec = sourceByPath.get(path) || index.files[path];
    return [path, [spec.sha256, spec.bytes]];
  }));
  const requestedScopeId = index.preparation.scopeId;
  let view=libraryMaterializedRoot(root,{scopeId:requestedScopeId});
  while (existsSync(resolve(view, '.complete'))) {
    const record = JSON.parse(readFileSync(resolve(view, '.cache-owner.json'), 'utf8'));
    if (record.schema !== 'pando-shared-runtime-v1' || record.owner !== owner || record.revision !== config.revision
      ||record.preparation?.scopeId!==index.preparation.scopeId) throw Error('Unexpected runtime view ownership');
    const observed = Object.fromEntries(contentFiles(view).filter(file => !['.complete','.cache-owner.json'].includes(file.logical))
      .sort((a,b)=>a.logical<b.logical?-1:a.logical>b.logical?1:0).map(file => {
        const prior=record.files[file.logical],stamp=lstatSync(file.path,{bigint:true});
        let sha256;
        if (prior?.storage==='shared') {
          const blob=lstatSync(contentPath(shared,prior.sha256),{bigint:true});
          if (stamp.ino!==blob.ino||stamp.dev!==blob.dev||Number(stamp.mode)&0o200||file.bytes!==prior.bytes)
            throw Error('Modified shared runtime must be repaired before preparation: '+file.path);
          sha256=prior.sha256;
        } else sha256=contentHash(readFileSync(file.path));
        return [file.logical,[sha256,file.bytes]];
      }));
    if (JSON.stringify(observed)===JSON.stringify(expected)) return view;
    // A completed view can subsequently become the owner's mutable working
    // edition. Preserve it and give the requested bytes their own scoped view.
    index.preparation={...index.preparation,archiveScopeId:index.preparation.archiveScopeId||requestedScopeId,
      scopeId:contentHash(Buffer.from(JSON.stringify({requestedScopeId,occupied:index.preparation.scopeId,observed})))};
    view=libraryMaterializedRoot(root,{scopeId:index.preparation.scopeId});
  }
  // Archive retention is not a runtime download requirement.
  if (existsSync(view)) throw Error(`Incomplete runtime view must be preserved: ${view}`);
  const pending = view + '.pending';
  if (existsSync(pending)) {
    // Preparation only copied bytes. Recover an interrupted view from its still
    // retained source or pinned objects; never remove an unknown pending file.
    const previous = contentFiles(pending);
    for (const file of previous) {
      if (['.complete', '.cache-owner.json'].includes(file.logical)) continue;
      const old = containedPath(source, file.logical), entry = index.files[file.logical];
      const original = existsSync(old) ? readFileSync(old) : entry ? decodeArchiveEntry(libraryCheckout(root), entry, config.revision,{fetch}) : null;
      if (!original || !original.equals(readFileSync(file.path))) throw Error(`Unknown pending runtime work must be preserved: ${file.path}`);
    }
    for (const file of previous) {
      if (['.complete', '.cache-owner.json'].includes(file.logical)) unlinkSync(file.path);
      else removeContentLink(shared, file.path);
    }
    removeEmptyDirectories(pending);
  }
  const files = {}, incoming = Object.entries(index.files).filter(([path]) => !path.startsWith('reports/'));
  const pool=resolve(shared,'.pando-store/blobs'),present=new Set(existsSync(pool)?readdirSync(pool):[]);
  const additional = runtimeMaterializationPeak(index,sourceFiles,present).totalBytes;
  if (additional >= 1024 ** 3) {
    const disk = statfsSync(shared); if (disk.bavail * disk.bsize < additional + 5 * 1024 ** 3) throw Error('Runtime sharing requires its peak additional bytes plus 5 GiB headroom');
  }
  if(fetch)prefetchArchiveEntries({checkout:libraryCheckout(root),revision:config.revision,entries:incoming.filter(([path,entry])=>!existsSync(containedPath(source,path))&&!present.has(entry.sha256)).map(([,entry])=>entry),additionalBytes:additional});
  mkdirSync(pending, { recursive: true });
  const write = (logical, bytes, expected = null) => {
    const output = safeChild(pending, logical), sha256 = contentHash(bytes);
    mkdirSync(dirname(output), { recursive: true });
    const sharedFile = expected?.sha256 === sha256 && expected.bytes === bytes.length;
    if (sharedFile) { publishContent(shared, bytes); linkContent(shared, sha256, output); }
    else { writeFileSync(output, bytes, { flag: 'wx' }); chmodSync(output, 0o600); }
    files[logical] = { sha256, bytes: bytes.length, storage: sharedFile ? 'shared' : 'private', ...(expected ? { baseSha256: expected.sha256 } : {}) };
  };
  // Deliberately use the former visible cache, including its unfinished work.
  // The pin selects the base revision; it never authorizes replacing dirty bytes.
  try {
  for (const [logical, entry] of incoming) {
    const previous = containedPath(source, logical);
    if (sourceByPath.has(logical)) {
      if (!lstatSync(previous).isFile() || lstatSync(previous).isSymbolicLink()) throw Error(`Unexpected old runtime source: ${previous}`);
      const bytes = readFileSync(previous);
      if (contentHash(bytes) !== sourceByPath.get(logical)?.sha256) throw Error('Preparation input changed: ' + logical);
      write(logical, bytes, entry);
    } else if(present.has(entry.sha256)) {
      const bytes=readFileSync(contentPath(shared,entry.sha256));
      if(bytes.length!==entry.bytes||contentHash(bytes)!==entry.sha256)throw Error('Existing immutable runtime blob changed: '+logical);
      write(logical,bytes,entry);
    } else write(logical, decodeArchiveEntry(libraryCheckout(root), entry, config.revision,{fetch}), entry);
  }
  for (const file of sourceFiles) if (!Object.hasOwn(index.files, file.logical)) {
    const bytes = readFileSync(file.path);
    if (contentHash(bytes) !== file.sha256) throw Error('Preparation input changed: ' + file.logical);
    write(file.logical, bytes);
  }
  atomicStorageJSON(resolve(pending, '.cache-owner.json'), { schema: 'pando-shared-runtime-v1', owner, revision: config.revision,preparation:index.preparation, files });
  writeFileSync(resolve(pending, '.complete'), config.revision + '\n');
  renameSync(pending, view); return view;
  } catch (error) {
    // Only remove outputs created and verified in this invocation. An unknown
    // file left by another writer remains visible for explicit recovery.
    for (const file of contentFiles(pending)) {
      const owned = files[file.logical];
      if (owned && owned.sha256 === contentHash(readFileSync(file.path))) removeContentLink(shared, file.path);
      else if (['.complete', '.cache-owner.json'].includes(file.logical)) unlinkSync(file.path);
      else throw new AggregateError([error], `Unexpected pending work preserved: ${file.path}`, { cause: error });
    }
    removeEmptyDirectories(pending); throw error;
  }
}

export function synchronizeRuntimeManifest(shared,view) {
  const manifest=containedPath(view,'.cache-owner.json'),record=JSON.parse(readFileSync(manifest,'utf8')),files={};
  for(const file of contentFiles(view)) {
    if(['.complete','.cache-owner.json'].includes(file.logical))continue;
    const prior=record.files[file.logical],sha256=contentHash(readFileSync(file.path)),s=lstatSync(file.path,{bigint:true});
    if(prior?.storage==='shared') {
      const blob=contentPath(shared,prior.sha256);
      if(sha256!==prior.sha256||file.bytes!==prior.bytes||s.ino!==lstatSync(blob,{bigint:true}).ino||Number(s.mode)&0o200)throw Error(`Modified shared runtime must be repaired before maintenance: ${file.path}`);
      files[file.logical]=prior;
    } else {
      if(s.nlink!==1n)throw Error(`Unowned mutable hardlink must be preserved: ${file.path}`);
      chmodSync(file.path,0o600);files[file.logical]={...(prior||{}),sha256,bytes:file.bytes,storage:'private'};
    }
  }
  for(const [logical,prior] of Object.entries(record.files))if(prior.storage==='shared'&&!files[logical])throw Error(`Shared runtime file is missing: ${logical}`);
  atomicStorageJSON(manifest,{...record,files});return files;
}

export function removeRuntimeView(shared, directory, record) {
  directory = containedPath(resolve(shared, '.pando-cache/materialized'), directory);
  if (record.schema !== 'pando-shared-runtime-v1' || Object.values(record.files).some(entry => entry.storage !== 'shared')) throw Error('Private runtime work must be preserved');
  const files = contentFiles(directory);
  for (const file of files) {
    if (['.complete', '.cache-owner.json'].includes(file.logical)) continue;
    const expected = record.files[file.logical];
    if (!expected || file.bytes !== expected.bytes || contentHash(readFileSync(file.path)) !== expected.sha256) throw Error('Runtime view changed before retirement');
  }
  for (const file of files) {
    if (['.complete', '.cache-owner.json'].includes(file.logical)) unlinkSync(file.path);
    else removeContentLink(shared, file.path);
  }
  removeEmptyDirectories(directory);
}

function removeEmptyDirectories(directory) {
  for (const name of readdirSync(directory)) { const child = resolve(directory, name); if (!lstatSync(child).isDirectory() || lstatSync(child).isSymbolicLink()) throw Error('Unexpected file in empty runtime directory'); removeEmptyDirectories(child); }
  rmdirSync(directory);
}

export function libraryWriteLeases(shared) {
  const base = resolve(shared, '.pando-store/leases'); if (!existsSync(base)) return [];
  return contentFiles(base).filter(file=>file.logical.endsWith('.json')).map(file => {
    const record = JSON.parse(readFileSync(file.path, 'utf8')); let alive = true;
    try { process.kill(record.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else if (error.code !== 'EPERM') throw error; }
    return { ...record, file: file.path, alive };
  });
}

export const scopesOverlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

export function beginLibraryWrite({ root = defaultRoot, prefixes, pid = process.pid } = {}) {
  return withLibraryLock(root, () => {
    const config = libraryConfig(root), shared = librarySharedCheckout(root), owner = libraryOwnerId(root);
    if (!Number.isInteger(pid) || pid <= 0 || !Array.isArray(prefixes) || !prefixes.length || prefixes.some(path => typeof path !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(p => p === '.' || p === '..' || p.startsWith('.')) || !config.mounts.some(mount => mount !== 'reports' && (path === mount || path.startsWith(mount + '/'))))) throw Error('Explicit valid runtime write prefixes are required');
    let view = libraryMaterializedRoot(root);
    if (!existsSync(resolve(view, '.complete'))) view = prepareOwnedLibraryData({ root, fetch: false, purpose: 'gis', prefixes }).materialized;
    if (libraryWriteLeases(shared).some(lease => lease.alive && lease.owner === owner && lease.prefixes.some(a => prefixes.some(b => scopesOverlap(a, b))))) throw Error('An overlapping library write lease is running');
    const manifest = resolve(view, '.cache-owner.json'), record = JSON.parse(readFileSync(manifest, 'utf8'));
    const selected = [...new Map(prefixes.flatMap(prefix => contentFiles(safeChild(view, prefix))).map(file => [file.path,file])).values()];
    const peak = selected.filter(file => !(lstatSync(file.path).mode & 0o200) || lstatSync(file.path).nlink > 1).reduce((sum,file)=>sum+file.bytes,0);
    if (peak >= 1024 ** 3) { const disk=statfsSync(shared); if(disk.bavail*disk.bsize<peak+5*1024**3)throw Error('Independent write scope needs its peak bytes plus 5 GiB headroom'); }
    for (const file of selected) {
      makePrivate(shared, file.path);
      const logical = relative(view, file.path).replaceAll('\\', '/');
      record.files[logical] = { ...(record.files[logical] || {}), sha256: contentHash(readFileSync(file.path)), bytes: file.bytes, storage: 'private' };
    }
    atomicStorageJSON(manifest, record);
    const id = `${owner}-${randomUUID()}`, file = resolve(shared, '.pando-store/leases', id + '.json');
    const lease = { schema: 'pando-library-write-v1', id, root: resolve(root), owner, revision: config.revision, view, pid, prefixes, startedAt: new Date().toISOString() };
    atomicStorageJSON(file, lease); return lease;
  });
}

export function endLibraryWrite({ root = defaultRoot, id } = {}) {
  if (!/^[\w-]+$/.test(id || '')) throw Error('Invalid write lease ID');
  const release = () => withLibraryLock(root, () => {
    const file = resolve(librarySharedCheckout(root), '.pando-store/leases', id + '.json');
    const lease = JSON.parse(readFileSync(file, 'utf8'));
    if (lease.root !== resolve(root) || lease.owner !== libraryOwnerId(root)) throw Error('Write lease belongs to another owner');
    const manifest=resolve(lease.view,'.cache-owner.json'), record=JSON.parse(readFileSync(manifest,'utf8')), seen=new Set();
    for(const prefix of lease.prefixes)for(const output of contentFiles(containedPath(lease.view,prefix))){
      if(lstatSync(output.path).nlink!==1)throw Error('Writer created a shared mutable file; lease retained for repair');
      chmodSync(output.path,0o600);
      const logical=relative(lease.view,output.path).replaceAll('\\','/');seen.add(logical);
      record.files[logical]={...(record.files[logical]||{}),sha256:contentHash(readFileSync(output.path)),bytes:output.bytes,storage:'private'};
    }
    for(const logical of Object.keys(record.files))if(lease.prefixes.some(scope=>logical===scope||logical.startsWith(scope+'/'))&&!seen.has(logical))delete record.files[logical];
    atomicStorageJSON(manifest,record);
    unlinkSync(file);
  });
  const until = Date.now() + 10000;
  for (;;) {
    try { return release(); } catch (error) {
      if (!/already running/.test(error.message) || Date.now() >= until) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export function withLibraryWrite(options, operation) {
  if (typeof operation !== 'function') throw Error('A library write operation is required');
  const lease = beginLibraryWrite(options), finish = () => endLibraryWrite({ root: options.root, id: lease.id });
  let result;
  try { result = operation(lease); } catch (error) { finish(); throw error; }
  if (result && typeof result.then === 'function') return Promise.resolve(result).finally(finish);
  finish(); return result;
}

export function withLibraryOutputs({ root = defaultRoot, paths }, operation) {
  if (!existsSync(resolve(root, 'config/library-data.json'))) return operation();
  const config = libraryConfig(root), prefixes = [...new Set(paths.map(path => relative(root, path instanceof URL ? fileURLToPath(path) : resolve(path)).replaceAll('\\', '/')).filter(path => config.mounts.some(mount => mount !== 'reports' && (path === mount || path.startsWith(mount + '/')))))];
  if (!prefixes.length) return operation();
  const inherited = process.env.PANDOLAB_LIBRARY_WRITE_LEASE;
  if (inherited) {
    const lease = libraryWriteLeases(librarySharedCheckout(root)).find(lease => lease.id === inherited && lease.alive && lease.root === resolve(root));
    if (!lease || prefixes.some(path => !lease.prefixes.some(scope => path === scope || path.startsWith(scope + '/')))) throw Error('Inherited library write lease does not cover these outputs');
    return operation(lease);
  }
  return withLibraryWrite({ root, prefixes }, operation);
}

export function writeLibraryOutput(path, bytes, options) {
  return withLibraryOutputs({ paths: [path] }, () => writeFileSync(path, bytes, options));
}

export function prepareOwnedLibraryData({ root, fetch, purpose = 'viewer', prefixes = [], source = null, projectId = null }) {
  root = resolve(root); const checkout = libraryCheckout(root);
  const config = libraryConfig(root);
  if (!existsSync(resolve(checkout, '.git'))) {
    if (!fetch) throw Error('Pinned library checkout is missing');
    mkdirSync(dirname(checkout), { recursive: true });
    execFileSync('git', [...gitOptions, '-c', 'core.autocrlf=false', 'clone', '--filter=blob:none', '--no-checkout', `https://github.com/${config.repository}.git`, checkout], { stdio: 'inherit' });
    git(checkout, ['config', 'core.autocrlf', 'false']);
    setMetadataCheckout(checkout,{fetch:true});
    // A no-checkout clone has no working snapshot yet, not user deletions.
    git(checkout, ['fetch', '--filter=blob:none', 'origin', config.revision]);
    git(checkout, ['checkout', '--detach', config.revision],{allowFetch:true});
  }
  let current;
  try { current = git(checkout, ['rev-parse', 'HEAD']); } catch { current = ''; }
  let index;
  try { index = JSON.parse(git(checkout, ['show', `${config.revision}:archive/index.json`],{allowFetch:fetch})); }
  catch (error) {
    if (!fetch) throw error;
    git(checkout, ['fetch', '--filter=blob:none', 'origin', config.revision]);
    index = JSON.parse(git(checkout, ['show', `${config.revision}:archive/index.json`],{allowFetch:fetch}));
  }
  // The archive checkout owns stored work. Runtime pairing is selected by the
  // pinned Git tree, not by moving that checkout back over later reports/WIP.
  if (!current || !existsSync(resolve(checkout, 'archive/index.json'))) throw Error('Library archive checkout is incomplete; preserve its work before repairing it.');
  excludeReportStorage(librarySharedCheckout(root));
  const reportRoot = libraryReportRoot(root);
  if (existsSync(resolve(checkout, '.working/report-owner.json'))) throw Error('Centralize existing report originals with --centralize-reports --apply before preparing data.');
  mkdirSync(reportRoot, { recursive: true });
  reportContext(root); // Metadata only; report editions stay independent of the runtime pin.
  if (purpose === 'reports') return { repository: config.repository, revision: config.revision,
    checkout, materialized: null, files: {}, archiveFiles: index.files };
  let projectManifest=null;
  if(purpose==='viewer'&&projectId!==null){
    const file=resolve(root,mapProjectManifestSourcePath(projectId));
    projectManifest=validateMapProjectManifest(JSON.parse(readFileSync(file,'utf8')));
    if(projectManifest.projectId!==projectId)throw new TypeError('Library project identity mismatch');
  }
  const materialized = materializeRuntimeView({ root, index, fetch, purpose, prefixes, source, projectManifest });
  const excludePath = resolve(checkout, git(checkout, ['rev-parse', '--git-path', 'info/exclude']));
  const exclude = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  if (!exclude.split(/\r?\n/).includes('/.working/')) { mkdirSync(dirname(excludePath), { recursive: true }); writeFileSync(excludePath, exclude + '\n/.working/\n'); }
  for (const path of config.mounts) {
    const output = safeChild(root, path);
    const target = path === 'reports' ? reportRoot : safeChild(materialized, path);
    mkdirSync(target, { recursive: true });
    mkdirSync(dirname(output), { recursive: true });
    if (existsSync(output)) {
      if (!lstatSync(output).isSymbolicLink()) throw Error(`Existing data directory must be preserved before mounting: ${output}`);
      if (realpathSync(output) === realpathSync(target)) continue;
      const previous = realpathSync(output);
      const cacheBase = resolve(librarySharedCheckout(root), '.pando-cache/materialized');
      const cacheRelative = relative(cacheBase, previous).split(sep);
      const owned = path === 'reports' ? previous === reportRoot || previous === resolve(checkout, 'reports') || previous.startsWith(resolve(checkout, '.working') + sep) : previous.startsWith(cacheBase + sep) && (/^[a-f0-9]{40}$/.test(cacheRelative[0]) || cacheRelative[0] === libraryOwnerId(root));
      if (!owned) throw Error(`Unknown data mount must be preserved: ${output}`);
      unlinkSync(output); // Remove this owned link only, preserving the previous cache.
    }
    symlinkSync(target, output, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const cacheRetirement = retireOwnedCaches(root, materialized);
  const compaction = compactOwnedCheckout(checkout, true);
  const prepared = JSON.parse(readFileSync(resolve(materialized, '.cache-owner.json'), 'utf8'));
  return { repository: config.repository, revision: config.revision, checkout, materialized,
    files: prepared.files, archiveFiles: index.files, preparation: prepared.preparation, compaction, cacheRetirement };
}
