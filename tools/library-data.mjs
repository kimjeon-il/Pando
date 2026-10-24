import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const gitOptions = ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
const git = (root, args) => execFileSync('git', [...gitOptions, ...args], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
export function libraryConfig(root = defaultRoot) {
  const config = JSON.parse(readFileSync(resolve(root, 'config/library-data.json'), 'utf8'));
  if (!/^[\w-]+\/[\w.-]+$/.test(config.repository) || !/^[a-f0-9]{40}$/.test(config.revision)) throw Error('Invalid pinned library configuration');
  return config;
}
export function libraryCheckout(root = defaultRoot) {
  const checkout = resolve(process.env.PANDOLAB_LIBRARY_DATA_ROOT || resolve(root, '.library-data/repository'));
  return existsSync(checkout) ? realpathSync(checkout) : checkout;
}
export function libraryMaterializedRoot(root = defaultRoot) {
  const base = resolve(root, '.library-data/materialized');
  return resolve(existsSync(base) ? realpathSync(base) : base, libraryConfig(root).revision);
}
export function libraryReportRoot(root = defaultRoot) {
  const checkout = libraryCheckout(root), registry = resolve(checkout, '.working/report-owner.json');
  if (existsSync(registry)) return safeChild(resolve(checkout, '.working'), JSON.parse(readFileSync(registry, 'utf8')).path);
  const mounted = resolve(root, 'reports');
  if (existsSync(mounted) && lstatSync(mounted).isSymbolicLink()) {
    const previous = realpathSync(mounted);
    if (previous.startsWith(resolve(checkout, '.working') + sep)) return previous;
  }
  return resolve(checkout, '.working/current/reports');
}
// Restore only the requested original. Existing files, including unfinished
// evidence, belong to the caller and are never overwritten by hydration.
export function hydrateReports({ root = defaultRoot, path } = {}) {
  return withLibraryLock(root, () => hydrateOwnedReports({ root, path }));
}
function hydrateOwnedReports({ root, path }) {
  const reportRoot = libraryReportRoot(root);
  safeChild(reportRoot, path);
  const checkout = libraryCheckout(root), registry = resolve(checkout, '.working/report-owner.json');
  const revision = (existsSync(registry) && JSON.parse(readFileSync(registry, 'utf8')).revision) || libraryConfig(root).revision;
  const index = JSON.parse(git(checkout, ['show', `${revision}:archive/index.json`]));
  for (const [logical, entry] of Object.entries(index.files)) {
    if (logical !== `reports/${path}` && !logical.startsWith(`reports/${path}/`)) continue;
    const output = safeChild(reportRoot, logical.slice(8));
    if (existsSync(output)) continue;
    const stored = execFileSync('git', [...gitOptions, 'show', `${revision}:${entry.stored}`], { cwd: checkout, maxBuffer: Math.max(entry.bytes * 2, 16 * 1024 * 1024) });
    const bytes = entry.encoding === 'gzip' ? gunzipSync(stored) : stored;
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Corrupt report: ${logical}`);
    mkdirSync(dirname(output), { recursive: true });
    try { writeFileSync(output, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return safeChild(reportRoot, path);
}

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
        if (files[logical] !== createHash('sha256').update(readFileSync(file)).digest('hex')) pristine = false;
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
  try { roots = git(root, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9)); }
  catch { return; }
  for (const worktree of roots) {
    if (!existsSync(resolve(worktree, 'config/library-data.json'))) continue;
    active.add(libraryMaterializedRoot(worktree));
    const lease = resolve(worktree, '.library-data/dev-server.json');
    if (existsSync(lease)) {
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
    if (!item.isDirectory() || !/^[a-f0-9]{40}$/.test(item.name)) continue;
    const directory = safeChild(base, item.name), owner = resolve(directory, '.cache-owner.json');
    if (active.has(directory) || !existsSync(owner)) continue;
    const record = JSON.parse(readFileSync(owner, 'utf8'));
    if (record.revision !== item.name || record.schema !== 'pando-materialized-cache-v1') continue;
    if (pristineCache(directory, record.files)) rmSync(directory, { recursive: true });
  }
  lastRetirementSignature = signature;
}
export function safeChild(root, path) {
  const target = resolve(root, path), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Unsafe library path: ${path}`);
  return target;
}
export function decodeArchiveEntry(checkout, entry, revision = null) {
  let stored;
  try { stored = readFileSync(safeChild(checkout, entry.stored)); }
  catch (error) { if (!revision) throw error; }
  const decode = stored => {
    if (!['gzip', 'identity'].includes(entry.encoding)) throw Error('Unknown library archive encoding');
    const bytes = entry.encoding === 'gzip' ? gunzipSync(stored) : stored;
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Library transfer is corrupt: ${entry.stored}`);
    return bytes;
  };
  if (revision) {
    try { return decode(stored); } catch { /* The storage HEAD may contain a newer runtime resource. */ }
    stored = execFileSync('git', [...gitOptions, 'show', revision + ':' + entry.stored], { cwd: checkout, maxBuffer: Math.max(entry.bytes * 2, 16 * 1024 * 1024) });
  }
  return decode(stored);
}
export function prepareLibraryData({ root = defaultRoot, fetch = true } = {}) {
  return withLibraryLock(root, () => prepareOwnedLibraryData({ root, fetch }));
}
function withLibraryLock(root, operation) {
  const lockPath = resolve(root, '.library-data/prepare.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  let lock;
  try { lock = openSync(lockPath, 'wx'); }
  catch (error) { throw Error('Library preparation is already running; preserve its outputs and retry after it finishes.', { cause: error }); }
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, root })); return withCheckoutLock(libraryCheckout(root), operation); }
  finally { closeSync(lock); unlinkSync(lockPath); }
}
function withCheckoutLock(checkout, operation) {
  if (!existsSync(resolve(checkout, '.git'))) return operation();
  const common = resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir']));
  const path = resolve(common, 'pando-library.lock');
  let handle;
  try { handle = openSync(path, 'wx'); }
  catch (error) { throw Error('Library storage is already running in another worktree; retry after it finishes.', { cause: error }); }
  try { writeFileSync(handle, JSON.stringify({ pid: process.pid, checkout })); return operation(); }
  finally { closeSync(handle); unlinkSync(path); }
}

const sparseMetadata = ['/*', '!/*/', '/archive/', '!/archive/*', '/archive/index.json'];
function setMetadataCheckout(checkout) {
  execFileSync('git', [...gitOptions, 'sparse-checkout', 'set', '--no-cone', '--stdin'], {
    cwd: checkout, input: sparseMetadata.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'],
  });
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
// Evict working copies only: shared Git objects, refs, and report originals stay.
// Read every candidate object offline and compare raw bytes, bounded per batch.
export function compactLibraryCheckout({ checkout, apply = false } = {}) {
  checkout = realpathSync(checkout);
  if (!apply) {
    const common = resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir']));
    if (existsSync(resolve(common, 'pando-library.lock'))) throw Error('Library storage is already running.');
    return compactOwnedCheckout(checkout, false);
  }
  return withCheckoutLock(checkout, () => compactOwnedCheckout(checkout, apply));
}
function compactOwnedCheckout(checkout, apply) {
  const result = { checkout, status: 'protected', eligibleBytes: 0, deletedBytes: 0, files: 0 };
  if (git(checkout, ['status', '--porcelain'])) return { ...result, reason: 'Checkout has local edits or untracked work.' };
  const head = git(checkout, ['rev-parse', 'HEAD']);
  const tree = git(checkout, ['ls-tree', '-rz', 'HEAD']).split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw Error('Unsupported or unavailable archive tree entry; preserve checkout.');
    return { mode: match[1], oid: match[2], path: match[3] };
  });
  const excluded = tree.filter(item => item.path.includes('/') && item.path !== 'archive/index.json');
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
function prepareOwnedLibraryData({ root, fetch }) {
  root = resolve(root); const checkout = libraryCheckout(root);
  const config = libraryConfig(root);
  if (!existsSync(resolve(checkout, '.git'))) {
    if (!fetch) throw Error('Pinned library checkout is missing');
    mkdirSync(dirname(checkout), { recursive: true });
    execFileSync('git', [...gitOptions, '-c', 'core.autocrlf=false', 'clone', '--filter=blob:none', '--no-checkout', `https://github.com/${config.repository}.git`, checkout], { stdio: 'inherit' });
    git(checkout, ['config', 'core.autocrlf', 'false']);
    setMetadataCheckout(checkout);
    // A no-checkout clone has no working snapshot yet, not user deletions.
    git(checkout, ['fetch', '--filter=blob:none', 'origin', config.revision]);
    git(checkout, ['checkout', '--detach', config.revision]);
  }
  let current;
  try { current = git(checkout, ['rev-parse', 'HEAD']); } catch { current = ''; }
  let index;
  try { index = JSON.parse(git(checkout, ['show', `${config.revision}:archive/index.json`])); }
  catch (error) {
    if (!fetch) throw error;
    git(checkout, ['fetch', '--filter=blob:none', 'origin', config.revision]);
    index = JSON.parse(git(checkout, ['show', `${config.revision}:archive/index.json`]));
  }
  // The archive checkout owns stored work. Runtime pairing is selected by the
  // pinned Git tree, not by moving that checkout back over later reports/WIP.
  if (!current || !existsSync(resolve(checkout, 'archive/index.json'))) throw Error('Library archive checkout is incomplete; preserve its work before repairing it.');
  const materialized = libraryMaterializedRoot(root), marker = resolve(materialized, '.complete');
  if (!existsSync(marker)) {
    if (existsSync(materialized)) throw Error('Incomplete library cache must be reviewed before replacement.');
    const materializeLock = resolve(dirname(materialized), `.${config.revision}.lock`);
    mkdirSync(dirname(materialized), { recursive: true });
    const handle = openSync(materializeLock, 'wx');
    if (existsSync(marker)) { closeSync(handle); unlinkSync(materializeLock); return prepareOwnedLibraryData({ root, fetch }); }
    const pending = materialized + '.pending';
    let ownedPending = false;
    try {
    if (existsSync(pending)) throw Error('An incomplete materialization is preserved; review it before retrying.');
    mkdirSync(pending); ownedPending = true;
    for (const [path, entry] of Object.entries(index.files)) {
      if (path.startsWith('reports/')) continue;
      const output = safeChild(pending, path);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, decodeArchiveEntry(checkout, entry, config.revision));
    }
    writeFileSync(resolve(pending, '.complete'), config.revision + '\n');
    writeFileSync(resolve(pending, '.cache-owner.json'), JSON.stringify({ schema: 'pando-materialized-cache-v1', revision: config.revision,
      files: Object.fromEntries(Object.entries(index.files).filter(([path]) => !path.startsWith('reports/')).map(([path, entry]) => [path, entry.sha256])) }));
    renameSync(pending, materialized);
    } catch (error) {
      // Only the fresh output created under our held revision lock is disposable.
      if (ownedPending && existsSync(pending) && !existsSync(materialized)) {
        // Do not traverse links introduced by another writer.
        const noLinks = path => readdirSync(path, { withFileTypes: true }).every(entry => !entry.isSymbolicLink() && (!entry.isDirectory() || noLinks(resolve(path, entry.name))));
        if (noLinks(pending)) rmSync(pending, { recursive: true });
      }
      throw error;
    } finally { closeSync(handle); unlinkSync(materializeLock); }
  }
  const cacheOwner = resolve(materialized, '.cache-owner.json');
  if (!existsSync(cacheOwner)) {
    const files = Object.fromEntries(Object.entries(index.files).filter(([path]) => !path.startsWith('reports/')).map(([path, entry]) => [path, entry.sha256]));
    if (pristineCache(materialized, files)) writeFileSync(cacheOwner, JSON.stringify({ schema: 'pando-materialized-cache-v1', revision: config.revision, files }));
  }
  const reportRoot = libraryReportRoot(root);
  mkdirSync(reportRoot, { recursive: true });
  const registry = resolve(checkout, '.working/report-owner.json');
  const registration = existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8')) : { path: relative(resolve(checkout, '.working'), reportRoot) };
  registration.revision = current;
  writeFileSync(registry, JSON.stringify(registration));
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
      const owned = path === 'reports' ? previous === resolve(checkout, 'reports') || previous.startsWith(resolve(checkout, '.working') + sep) : previous.startsWith(dirname(materialized) + sep);
      if (!owned) throw Error(`Unknown data mount must be preserved: ${output}`);
      unlinkSync(output); // Remove this owned link only, preserving the previous cache.
    }
    symlinkSync(target, output, process.platform === 'win32' ? 'junction' : 'dir');
  }
  retireOwnedCaches(root, materialized);
  const compaction = compactOwnedCheckout(checkout, true);
  return { repository: config.repository, revision: config.revision, checkout, materialized, files: index.files, compaction };
}

// App-owned writers store their output here; the data repository runs no tools.
export function storeLibraryData({ root = defaultRoot, push = false, prefixes = null, removePaths = [] } = {}) {
  if (!prefixes?.length) throw Error("Storage requires explicit library prefixes.");
  return withLibraryLock(root, () => storeOwnedLibraryData({ root, push, prefixes, removePaths }));
}
function storeOwnedLibraryData({ root, push, prefixes, removePaths }) {
  const data = prepareOwnedLibraryData({ root, fetch: true });
  if (git(data.checkout, ['status', '--porcelain'])) throw Error('Preserve existing data checkout edits before storing library material.');
  if (prefixes && (!Array.isArray(prefixes) || !prefixes.length || prefixes.some(path =>
    typeof path !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part === '..' || part === '.')
      || !libraryConfig(root).mounts.some(mount => path === mount || path.startsWith(mount + '/'))))) throw Error('Invalid library storage prefixes.');
  const included = path => !prefixes || prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'));
  const traversable = path => included(path) || prefixes.some(prefix => prefix.startsWith(path + '/'));
  const storeNativeObjects = !prefixes || included('assets/data/territorial-entities');
  if (!storeNativeObjects && prefixes.some(path => path.startsWith('assets/data/territorial-entities/'))) throw Error('Store territorial entities as a whole so native objects and runtime data stay paired.');
  const indexPath = resolve(data.checkout, 'archive/index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const runtimeDirectories = new Set(Object.entries(index.files).filter(([path, entry]) => path.startsWith('assets/data/') && path === entry.stored).map(([path]) => dirname(path)));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const changed = new Set();
  const put = (path, bytes) => {
    const output = safeChild(data.checkout, path);
    mkdirSync(dirname(output), { recursive: true });
    if (existsSync(output) && readFileSync(output).equals(bytes)) return;
    const temporary = output + `.${process.pid}.pending`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, output);
    changed.add(path);
  };
  const store = (path, bytes) => {
    const sha256 = digest(bytes);
    if (index.files[path]?.sha256 === sha256) return;
    const packed = gzipSync(bytes, { level: 9 });
    const identity = runtimeDirectories.has(dirname(path)) || packed.length >= bytes.length;
    const stored = runtimeDirectories.has(dirname(path)) ? path : `archive/blobs/${sha256}.${identity ? 'bin' : 'gz'}`;
    put(stored, identity ? bytes : packed);
    index.files[path] = { stored, encoding: identity ? 'identity' : 'gzip', sha256, bytes: bytes.length };
    if (path.startsWith('reports/') && /\.(?:md|png|jpe?g|webp|gif|svg)$/i.test(path)) {
      let readable = bytes;
      if (path.endsWith('.md') && bytes.length > 5000 && !/\/(?:README|TEMPLATE)\.md$/.test(path)) {
        const text = bytes.toString('utf8'), title = text.split('\n').find(line => line.startsWith('# ')) || '# Report';
        readable = Buffer.from(title + '\n\n> 압축 열람본: 도입부 발췌. 전체 출처·결론·미확인 내용은 연결한 원문을 따른다.\n\n' + text.slice(title.length).slice(0, 1600) + '\n\n[무손실 압축 원문](' + relative(dirname(path), stored).replaceAll('\\', '/') + ')\n');
      }
      put(path, readable);
    }
  };
  if (removePaths.some(path => !included(path) || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part === '..' || part === '.'))) throw Error('Invalid explicit library deletion.');
  for (const path of removePaths) if (path.startsWith('reports/') && existsSync(safeChild(libraryReportRoot(root), path.slice(8)))) {
    throw Error(`Preserve or remove the working original before archiving its deletion: ${path}`);
  }
  const removed = new Set(removePaths);
  const seen = new Set();
  const visit = (directory, prefix) => {
    if (!traversable(prefix) || !existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error(`Unexpected nested library link: ${path}`);
      if (entry.isDirectory()) visit(resolve(directory, entry.name), path);
      else if (entry.isFile() && included(path) && !removed.has(path)) { seen.add(path); store(path, readFileSync(resolve(directory, entry.name))); }
    }
  };
  const managedMounts = libraryConfig(root).mounts.filter(path => path !== 'reports');
  for (const path of managedMounts) visit(safeChild(data.materialized, path), path);
  visit(libraryReportRoot(root), 'reports');
  for (const [path, entry] of Object.entries(index.files)) {
    if (path.startsWith('reports/') && !removed.has(path)) continue;
    if (!included(path) || !(path.startsWith('reports/') || managedMounts.some(mount => path.startsWith(mount + '/'))) || seen.has(path)) continue;
    delete index.files[path];
    if (entry.stored === path || path.startsWith('reports/')) {
      if (existsSync(safeChild(data.checkout, path))) unlinkSync(safeChild(data.checkout, path));
      // A sparse path may have no physical copy but still needs index removal.
      if (git(data.checkout, ['ls-files', '--', path])) git(data.checkout, ['update-index', '--force-remove', '--', path]);
    }
  }
  // The existing native source schema remains the only editable library format.
  if (storeNativeObjects) {
  const indexBytes = readFileSync(resolve(data.materialized, 'assets/data/territorial-entities/generated/v2/index.json'));
  const libraryIndex = JSON.parse(indexBytes), source = { schemaVersion: 1, indexHash: digest(indexBytes), entities: {} };
  put(`objects/${source.indexHash}.json`, indexBytes);
  for (const entry of libraryIndex.entities) {
    const bytes = Buffer.from(JSON.stringify(JSON.parse(gunzipSync(readFileSync(resolve(data.materialized, 'assets/data/territorial-entities/generated/v2', entry.file))))) + '\n');
    const hash = digest(bytes); put(`objects/${hash}.json`, bytes); source.entities[entry.entityId] = hash;
  }
  put('library.json', Buffer.from(JSON.stringify(source) + '\n'));
  }
  index.sourceRevision = git(root, ['rev-parse', 'HEAD']);
  put('archive/index.json', Buffer.from(JSON.stringify(index) + '\n'));
  if (changed.size) execFileSync('git', [...gitOptions, '--literal-pathspecs', 'add', '--sparse', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    cwd: data.checkout, input: [...changed].join('\0') + '\0', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (git(data.checkout, ['diff', '--cached', '--name-only'])) git(data.checkout, ['-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com', 'commit', '-m', `Store app-produced library material from ${index.sourceRevision}`]);
  const revision = git(data.checkout, ['rev-parse', 'HEAD']);
  const registry = resolve(data.checkout, '.working/report-owner.json');
  const owner = JSON.parse(readFileSync(registry, 'utf8')); owner.revision = revision;
  writeFileSync(registry, JSON.stringify(owner));
  const compaction = compactOwnedCheckout(data.checkout, true);
  if (compaction.status !== 'compacted') throw Error(`Stored library checkout could not be compacted: ${compaction.reason}`);
  if (push) {
    const token = process.env.PANDOLAB_LIBRARY_WRITE_TOKEN;
    const env = token ? { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:' + token).toString('base64')}` } : process.env;
    execFileSync('git', [...gitOptions, 'push', 'origin', `HEAD:${index.branch}`], { cwd: data.checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  if (!prefixes.every(path => path === 'reports' || path.startsWith('reports/'))) {
    const config = libraryConfig(root); config.revision = revision;
    writeFileSync(resolve(root, 'config/library-data.json'), JSON.stringify(config, null, 2) + '\n');
  }
  return revision;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--report-root') {
    console.log(libraryReportRoot(process.argv[3] || defaultRoot));
  } else {
  const prefixes = process.argv.filter(arg => arg.startsWith('--include-prefix=')).map(arg => arg.slice('--include-prefix='.length));
  const separator = process.argv.indexOf('--');
  const selected = separator < 0 ? [] : process.argv.slice(separator + 1).filter(path => !path.startsWith('-'));
  if (!prefixes.length && process.argv.includes('--store-and-stage')) for (const path of selected) {
    let logical = relative(defaultRoot, resolve(defaultRoot, path)).replaceAll('\\', '/');
    const original = relative(libraryReportRoot(defaultRoot), resolve(defaultRoot, path)).replaceAll('\\', '/');
    if (!original.startsWith('../') && !isAbsolute(original)) logical = 'reports/' + original;
    logical = logical.split(/[*?[]/)[0].replace(/\/$/, '');
    if (libraryConfig().mounts.some(mount => logical === mount || logical.startsWith(mount + '/'))) prefixes.push(logical);
  }
  const storeOptions = { push: process.argv.includes('--push'), prefixes: prefixes.length ? prefixes : null,
    removePaths: process.argv.filter(arg => arg.startsWith('--remove-path=')).map(arg => arg.slice(14)) };
  if (process.argv.includes('--store-and-stage')) {
    if (prefixes.length) storeLibraryData(storeOptions);
    const root = defaultRoot, mounts = libraryConfig(root).mounts;
    const paths = process.argv.slice(process.argv.indexOf('--') + 1).filter(path => !path.startsWith('-')).filter(path => {
      const logical = relative(root, resolve(root, path)).replaceAll('\\', '/');
      return !isAbsolute(path) && !logical.startsWith('../') && !mounts.some(mount => logical === mount || logical.startsWith(mount + '/'));
    });
    git(root, ['add', '--', 'config/library-data.json', ...paths]);
  } else if (process.argv.includes('--store')) console.log(`Library stored: ${storeLibraryData(storeOptions)}`);
  else { const result = prepareLibraryData(); console.log(`Library mounted: ${result.repository}@${result.revision}`); }
  }
}
