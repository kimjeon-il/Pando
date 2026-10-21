import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const git = (root, args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
export function libraryConfig(root = defaultRoot) {
  const config = JSON.parse(readFileSync(resolve(root, 'config/library-data.json'), 'utf8'));
  if (!/^[\w-]+\/[\w.-]+$/.test(config.repository) || !/^[a-f0-9]{40}$/.test(config.revision)) throw Error('Invalid pinned library configuration');
  return config;
}
export function libraryCheckout(root = defaultRoot) {
  return resolve(process.env.PANDOLAB_LIBRARY_DATA_ROOT || resolve(root, '.library-data/repository'));
}
export function libraryMaterializedRoot(root = defaultRoot) {
  return resolve(root, '.library-data/materialized', libraryConfig(root).revision);
}
export function libraryReportRoot(root = defaultRoot) {
  return resolve(libraryCheckout(root), 'reports');
}
export function safeChild(root, path) {
  const target = resolve(root, path), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Unsafe library path: ${path}`);
  return target;
}
export function decodeArchiveEntry(checkout, entry) {
  const stored = readFileSync(safeChild(checkout, entry.stored));
  if (!['gzip', 'identity'].includes(entry.encoding)) throw Error('Unknown library archive encoding');
  const bytes = entry.encoding === 'gzip' ? gunzipSync(stored) : stored;
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Library transfer is corrupt: ${entry.stored}`);
  return bytes;
}
export function prepareLibraryData({ root = defaultRoot, checkout = libraryCheckout(root), fetch = true } = {}) {
  root = resolve(root); checkout = resolve(checkout);
  const config = libraryConfig(root);
  if (!existsSync(resolve(checkout, '.git'))) {
    if (!fetch) throw Error('Pinned library checkout is missing');
    mkdirSync(dirname(checkout), { recursive: true });
    execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', '-c', 'core.autocrlf=false', 'clone', '--filter=blob:none', '--no-checkout', `https://github.com/${config.repository}.git`, checkout], { stdio: 'inherit' });
    git(checkout, ['config', 'core.autocrlf', 'false']);
    git(checkout, ['sparse-checkout', 'init', '--cone']);
    git(checkout, ['sparse-checkout', 'set', 'assets/data', 'archive', 'objects', 'reports']);
  }
  let current;
  try { current = git(checkout, ['rev-parse', 'HEAD']); } catch { current = ''; }
  if (current !== config.revision || !existsSync(resolve(checkout, 'archive/index.json'))) {
    if (git(checkout, ['status', '--porcelain'])) throw Error('Library checkout has local edits; preserve or publish them before changing its pin');
    if (fetch) git(checkout, ['fetch', '--filter=blob:none', 'origin', config.revision]);
    git(checkout, ['checkout', '--detach', config.revision]);
  }
  const index = JSON.parse(readFileSync(resolve(checkout, 'archive/index.json'), 'utf8'));
  const materialized = libraryMaterializedRoot(root), marker = resolve(materialized, '.complete');
  if (!existsSync(marker)) {
    for (const [path, entry] of Object.entries(index.files)) {
      if (path.startsWith('reports/')) continue;
      const output = safeChild(materialized, path);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, decodeArchiveEntry(checkout, entry));
    }
    writeFileSync(marker, config.revision + '\n');
  }
  for (const path of config.mounts) {
    const output = safeChild(root, path);
    const target = path === 'reports' ? resolve(checkout, 'reports') : safeChild(materialized, path);
    mkdirSync(target, { recursive: true });
    mkdirSync(dirname(output), { recursive: true });
    if (existsSync(output)) {
      if (!lstatSync(output).isSymbolicLink()) throw Error(`Existing data directory must be preserved before mounting: ${output}`);
      if (realpathSync(output) === realpathSync(target)) continue;
      const previous = realpathSync(output);
      if (path === 'reports' || !previous.startsWith(resolve(root, '.library-data/materialized') + sep)) throw Error(`Unknown data mount must be preserved: ${output}`);
      unlinkSync(output); // Remove this owned link only, preserving the previous cache.
    }
    symlinkSync(target, output, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return { repository: config.repository, revision: config.revision, checkout, materialized, files: index.files };
}

// App-owned writers store their output here; the data repository runs no tools.
export function storeLibraryData({ root = defaultRoot, push = false } = {}) {
  const data = prepareLibraryData({ root });
  const indexPath = resolve(data.checkout, 'archive/index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const runtimeDirectories = new Set(Object.entries(index.files).filter(([path, entry]) => path === entry.stored).map(([path]) => dirname(path)));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const put = (path, bytes) => { const output = safeChild(data.checkout, path); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, bytes); };
  const store = (path, bytes) => {
    const sha256 = digest(bytes);
    if (index.files[path]?.sha256 === sha256) return;
    const packed = gzipSync(bytes, { level: 9 });
    const identity = runtimeDirectories.has(dirname(path)) || packed.length >= bytes.length;
    const stored = runtimeDirectories.has(dirname(path)) ? path : `archive/blobs/${sha256}.${identity ? 'bin' : 'gz'}`;
    put(stored, identity ? bytes : packed);
    index.files[path] = { stored, encoding: identity ? 'identity' : 'gzip', sha256, bytes: bytes.length };
  };
  const seen = new Set();
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error(`Unexpected nested library link: ${path}`);
      if (entry.isDirectory()) visit(resolve(directory, entry.name), path);
      else if (entry.isFile()) { seen.add(path); store(path, readFileSync(resolve(directory, entry.name))); }
    }
  };
  const managedMounts = libraryConfig(root).mounts.filter(path => path !== 'reports');
  for (const path of managedMounts) visit(safeChild(data.materialized, path), path);
  for (const [path, entry] of Object.entries(index.files)) {
    if (!managedMounts.some(mount => path.startsWith(mount + '/')) || seen.has(path)) continue;
    delete index.files[path];
    if (entry.stored === path && existsSync(safeChild(data.checkout, path))) unlinkSync(safeChild(data.checkout, path));
  }
  const changedReports = git(data.checkout, ['ls-files', '--modified', '--others', '--exclude-standard', '--', 'reports']).split('\n').filter(Boolean);
  for (const path of changedReports) {
    if (existsSync(safeChild(data.checkout, path))) store(path, readFileSync(safeChild(data.checkout, path)));
    else delete index.files[path];
  }
  // The existing native source schema remains the only editable library format.
  const indexBytes = readFileSync(resolve(data.materialized, 'assets/data/territorial-entities/generated/v2/index.json'));
  const libraryIndex = JSON.parse(indexBytes), source = { schemaVersion: 1, indexHash: digest(indexBytes), entities: {} };
  put(`objects/${source.indexHash}.json`, indexBytes);
  for (const entry of libraryIndex.entities) {
    const bytes = Buffer.from(JSON.stringify(JSON.parse(gunzipSync(readFileSync(resolve(data.materialized, 'assets/data/territorial-entities/generated/v2', entry.file))))) + '\n');
    const hash = digest(bytes); put(`objects/${hash}.json`, bytes); source.entities[entry.entityId] = hash;
  }
  put('library.json', Buffer.from(JSON.stringify(source) + '\n'));
  index.sourceRevision = git(root, ['rev-parse', 'HEAD']);
  put('archive/index.json', Buffer.from(JSON.stringify(index) + '\n'));
  git(data.checkout, ['add', '--sparse', '--', 'archive', 'assets/data', 'objects', 'library.json', 'reports']);
  if (git(data.checkout, ['diff', '--cached', '--name-only'])) git(data.checkout, ['-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com', 'commit', '-m', `Store app-produced library material from ${index.sourceRevision}`]);
  const revision = git(data.checkout, ['rev-parse', 'HEAD']);
  if (push) {
    const token = process.env.PANDOLAB_LIBRARY_WRITE_TOKEN;
    const env = token ? { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:' + token).toString('base64')}` } : process.env;
    execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', 'push', 'origin', `HEAD:${index.branch}`], { cwd: data.checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const config = libraryConfig(root); config.revision = revision;
  writeFileSync(resolve(root, 'config/library-data.json'), JSON.stringify(config, null, 2) + '\n');
  return revision;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--store-and-stage')) {
    storeLibraryData({ push: process.argv.includes('--push') });
    const root = defaultRoot, mounts = libraryConfig(root).mounts;
    const paths = process.argv.slice(process.argv.indexOf('--') + 1).filter(path => !path.startsWith('-')).filter(path => {
      const logical = relative(root, resolve(root, path)).replaceAll('\\', '/');
      return !isAbsolute(path) && !logical.startsWith('../') && !mounts.some(mount => logical === mount || logical.startsWith(mount + '/'));
    });
    git(root, ['add', '--', 'config/library-data.json', ...paths]);
  } else if (process.argv.includes('--store')) console.log(`Library stored: ${storeLibraryData({ push: process.argv.includes('--push') })}`);
  else { const result = prepareLibraryData(); console.log(`Library mounted: ${result.repository}@${result.revision}`); }
}
