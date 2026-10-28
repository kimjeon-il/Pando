import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { organizedReportPath } from './library-report-layout.mjs';

export function canonicalResearchPath(path) {
  if (/^reports\/(?:geography|research)\//.test(path)) return organizedReportPath(path);
  return path;
}

export function buildResearchPurgeManifest({ retiredPaths, indexes, currentIndex }) {
  const retired = new Set(retiredPaths.map(canonicalResearchPath));
  for (const path of retired) {
    if (!/^(reports\/borders\/|tools\/historical-library\/)/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')) throw Error(`Outside research purge scope: ${path}`);
  }
  for (const path of Object.keys(currentIndex.files)) if (retired.has(canonicalResearchPath(path))) throw Error(`Currently retained research must not be purged: ${path}`);
  const logical = new Set(retired), candidates = new Set(), retainedStores = new Set();
  for (const index of indexes) for (const [path, entry] of Object.entries(index.files)) {
    if (retired.has(canonicalResearchPath(path))) { logical.add(path); candidates.add(entry.stored); }
    else retainedStores.add(entry.stored);
  }
  const stored = [...candidates].filter(path => !retainedStores.has(path));
  const paths = [...new Set([...logical, ...stored])].sort();
  if (paths.some(path => path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..'))) throw Error('Unsafe historical archive path');
  return { schema: 'pando-retired-research-history-v1', logicalPaths: [...logical].sort(), paths,
    sharedStoresPreserved: [...candidates].filter(path => retainedStores.has(path)).sort() };
}

export function filterResearchIndex(index, manifest) {
  const excluded = new Set(manifest.logicalPaths);
  return { ...index, files: Object.fromEntries(Object.entries(index.files).filter(([path]) => !excluded.has(path))) };
}

// Keep unpublished local originals without retaining retired blobs through
// an unreferenced tree left by an earlier storage operation.
export function preservePrivateHistoryObjects({ source, target, objects, manifest, excludedBlobIds, retiredContentHashes = [] }) {
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
  const git = (root, args, input) => execFileSync('git', ['-C', root, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
    env, input, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const kept = new Set(git(target, ['rev-list', '--objects', '--all']).split('\n').map(line => line.split(' ')[0]));
  const excluded = new Set(excludedBlobIds), hashes = new Set(retiredContentHashes), extra = new Set(), objectMap = {};
  const paths = new Set(manifest.paths), trees = new Map();
  if ([...excluded].some(oid => kept.has(oid))) throw Error('A proposed retired object is still used by retained history');
  const convert = (oid, type, prefix = '') => {
    const treeKey = `${oid}:${prefix}`;
    if (type === 'tree' && trees.has(treeKey)) return trees.get(treeKey);
    if (type !== 'tree' && Object.hasOwn(objectMap, oid)) return objectMap[oid];
    if (kept.has(oid) && (type !== 'tree' || !manifest.paths.some(path => path.startsWith(prefix ? prefix + '/' : '')))) return oid;
    let next;
    if (type === 'blob') {
      if (excluded.has(oid)) return objectMap[oid] = null;
      let bytes = execFileSync('git', ['-C', source, 'cat-file', 'blob', oid], { env, maxBuffer: 256 * 1024 ** 2, stdio: ['pipe', 'pipe', 'pipe'] });
      if (hashes.has(createHash('sha256').update(bytes).digest('hex'))) return objectMap[oid] = null;
      let parsed;
      try { parsed = JSON.parse(bytes.toString('utf8')); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (parsed?.files && !Array.isArray(parsed.files) && Object.values(parsed.files).every(entry => typeof entry?.stored === 'string')) {
        const filtered = filterResearchIndex(parsed, manifest);
        if (Object.keys(filtered.files).length !== Object.keys(parsed.files).length) bytes = Buffer.from(JSON.stringify(filtered) + '\n');
      }
      next = git(target, ['hash-object', '-w', '--stdin'], bytes);
    } else if (type === 'tree') {
      const rows = git(source, ['ls-tree', '-z', oid]).split('\0').filter(Boolean), entries = [];
      for (const row of rows) {
        const at = row.indexOf('\t'), [mode, kind, child] = row.slice(0, at).split(' '), name = row.slice(at + 1);
        const path = prefix ? prefix + '/' + name : name;
        if (paths.has(path)) continue;
        const mapped = kind === 'commit' ? child : convert(child, kind, path);
        if (mapped) entries.push(`${mode} ${kind} ${mapped}\t${name}\0`);
      }
      next = git(target, ['mktree', '-z'], entries.join(''));
    } else throw Error(`Unmapped private object type: ${type}`);
    if (type === 'tree') trees.set(treeKey, next);
    if (type !== 'tree' || !prefix) objectMap[oid] = next;
    if (!kept.has(next)) extra.add(next);
    return next;
  };
  for (const object of objects) convert(object.oid, object.type);
  let pack = null;
  if (extra.size) {
    pack = git(target, ['pack-objects', join(resolve(target), 'objects/pack/pack')], [...extra].join('\n') + '\n');
    writeFileSync(join(target, 'objects/pack', `pack-${pack}.keep`), 'Private non-retired originals preserved by the authorized history rewrite.\n');
  }
  return { objectMap, additionalObjects: extra.size, pack };
}

export async function rewriteResearchHistory({ source, target, manifest, filterRepoPath, pythonPath }) {
  source = resolve(source); target = resolve(target);
  if (existsSync(target)) throw Error('History output already exists; inspect it before resuming.');
  const environment = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  mkdirSync(dirname(target), { recursive: true });
  git('init', '--bare', '-q', target);
  const objects = resolve(source, git('-C', source, 'rev-parse', '--git-common-dir'), 'objects');
  mkdirSync(join(target, 'objects/info'), { recursive: true });
  writeFileSync(join(target, 'objects/info/alternates'), objects.replaceAll('\\', '/') + '\n');
  const manifestPath = target + '.manifest.json', callbackPath = target + '.callback.py';
  const indexOids = git('-C', source, 'rev-list', '--objects', '--all', '--reflog', '--', 'archive/index.json')
    .split('\n').filter(line => /^[a-f0-9]{40} archive\/index.json$/.test(line)).map(line => line.slice(0, 40));
  const indexBlobMap = {};
  for (const oid of new Set(indexOids)) {
    const original = JSON.parse(git('-C', source, 'cat-file', 'blob', oid));
    const filtered = filterResearchIndex(original, manifest);
    if (Object.keys(original.files).length === Object.keys(filtered.files).length) continue;
    indexBlobMap[oid] = execFileSync('git', ['--git-dir=' + target, 'hash-object', '-w', '--stdin'], {
      env: environment, input: JSON.stringify(filtered) + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, indexBlobMap }));
  writeFileSync(callbackPath, `import json\nif 'pando_history' not in globals():\n    with open(${JSON.stringify(manifestPath.replaceAll('\\', '/'))}, encoding='utf-8') as f:\n        globals()['pando_history'] = json.load(f)\n    pando_history['excluded'] = {p.encode('utf-8') for p in pando_history['paths']}\nkept = []\nfor change in commit.file_changes:\n    if change.filename in pando_history['excluded']:\n        continue\n    if change.type == b'M' and change.filename == b'archive/index.json':\n        old = change.blob_id.decode('ascii')\n        if old in pando_history['indexBlobMap']:\n            change.blob_id = pando_history['indexBlobMap'][old].encode('ascii')\n    kept.append(change)\ncommit.file_changes = kept\n`);
  const exporter = spawn('git', ['-C', source, 'fast-export', '--all', '--show-original-ids', '--no-data', '--signed-tags=strip', '--tag-of-filtered-object=rewrite', '--reference-excluded-parents', '--use-done-feature'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const filter = spawn(pythonPath, [filterRepoPath, '--source', source, '--target', target, '--stdin', '--force', '--prune-empty', 'never', '--prune-degenerate', 'never', '--preserve-commit-hashes', '--commit-callback', callbackPath], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  exporter.stderr.on('data', chunk => { errors += chunk; });
  filter.stdout.on('data', chunk => { output += chunk; });
  filter.stderr.on('data', chunk => { errors += chunk; });
  exporter.stdout.on('error', error => { errors += error.message; });
  filter.stdin.on('error', error => { errors += error.message; });
  exporter.stdout.pipe(filter.stdin);
  const completion = child => new Promise((resolveChild, reject) => {
    child.once('error', reject); child.once('close', code => resolveChild(code));
  });
  const [exportCode, filterCode] = await Promise.all([completion(exporter), completion(filter)]);
  if (exportCode || filterCode) throw Error(`History filtering failed (${exportCode}/${filterCode}): ${errors}\n${output}`);
  return { target, output, errors };
}
