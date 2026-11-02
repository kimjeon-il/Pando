import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { organizedReportPath } from './library-report-layout.mjs';
import { HistoryStreamFilter } from './library-history-stream.mjs';

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

export function buildHistoryRetentionManifest({ keepPaths, indexes, aliases = {}, currentOnly = {}, allowedBlobIds = {} }) {
  const safe = path => {
    if (!path || /^[A-Za-z]:/.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw Error(`Unsafe retention path: ${path}`);
    return path;
  };
  const retained = new Set(keepPaths.map(safe));
  for (const [old, current] of Object.entries(aliases)) { safe(old); safe(current); if (retained.has(current)) retained.add(old); }
  for (const [path, hashes] of Object.entries(currentOnly)) {
    if (!retained.has(safe(path)) || !Array.isArray(hashes) || !hashes.length) throw Error(`Current-only editions require a retained path: ${path}`);
  }
  const blobSelections = { ...allowedBlobIds };
  for (const [old, current] of Object.entries(aliases)) if (retained.has(old) && blobSelections[current]) blobSelections[old] = [...blobSelections[current]];
  const manifest = { schema: 'pando-history-retention-v1', keepPaths: [...retained].sort(), aliases, currentOnly, allowedBlobIds: blobSelections };
  for (const index of indexes) for (const entry of Object.values(filterHistoryIndex(index, manifest).files)) retained.add(safe(entry.stored));
  manifest.keepPaths = [...retained].sort();
  return manifest;
}

export function filterHistoryIndex(index, manifest) {
  if (manifest.keepPaths) {
    const retained = new Set(manifest.keepPaths);
    return { ...index, files: Object.fromEntries(Object.entries(index.files).filter(([path, entry]) => {
      const canonical = manifest.aliases[path] || path;
      return retained.has(path) && (!manifest.currentOnly[canonical] || manifest.currentOnly[canonical].includes(entry.sha256));
    })) };
  }
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
        const filtered = filterHistoryIndex(parsed, manifest);
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

export async function rewriteHistory({ source, target, manifest, refs = ['--all'], renamePaths = {} }) {
  source = resolve(source); target = resolve(target);
  if (!manifest || !Array.isArray(refs) || !refs.length || !Array.isArray(manifest.excludedPrefixes || []) ||
    (manifest.excludedPrefixes || []).some(path => typeof path !== 'string' || !path.endsWith('/') || path.startsWith('/') || path.includes('\\') || path.split('/').slice(0, -1).some(part => !part || part === '.' || part === '..')))
    throw Error('Invalid history filter or excluded prefix');
  if (existsSync(target)) throw Error('History output already exists; inspect it before resuming.');
  const environment = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  mkdirSync(dirname(target), { recursive: true });
  git('init', '--bare', '-q', target);
  const objects = resolve(source, git('-C', source, 'rev-parse', '--git-common-dir'), 'objects');
  mkdirSync(join(target, 'objects/info'), { recursive: true });
  writeFileSync(join(target, 'objects/info/alternates'), objects.replaceAll('\\', '/') + '\n');
  const indexOids = git('-C', source, 'rev-list', '--objects', ...refs, '--', 'archive/index.json')
    .split('\n').filter(line => /^[a-f0-9]{40} archive\/index.json$/.test(line)).map(line => line.slice(0, 40));
  const indexBlobMap = {};
  for (const oid of new Set(indexOids)) {
    const original = JSON.parse(git('-C', source, 'cat-file', 'blob', oid));
    const filtered = filterHistoryIndex(original, manifest);
    if (Object.keys(original.files).length === Object.keys(filtered.files).length) continue;
    indexBlobMap[oid] = execFileSync('git', ['--git-dir=' + target, 'hash-object', '-w', '--stdin'], {
      env: environment, input: JSON.stringify(filtered) + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }
  const marksPath = join(target, 'pando-import-marks');
  const exporter = spawn('git', ['-C', source, 'fast-export', ...refs, '--show-original-ids', '--no-data', '--no-renames', '--signed-tags=strip', '--tag-of-filtered-object=rewrite', '--reference-excluded-parents', '--use-done-feature'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const importer = spawn('git', ['--git-dir=' + target, 'fast-import', '--quiet', '--export-marks=' + marksPath], { env: environment, stdio: ['pipe', 'ignore', 'pipe'] });
  const filter = new HistoryStreamFilter(manifest, indexBlobMap, renamePaths);
  let errors = '';
  for (const child of [exporter, importer]) child.stderr.on('data', chunk => { errors += chunk; });
  const completion = child => new Promise((accept, reject) => {
    child.once('error', reject); child.once('close', code => accept(code));
  });
  const finished = Promise.all([completion(exporter), completion(importer)]);
  try {
    await pipeline(exporter.stdout, filter, importer.stdin);
    const [exportCode, importCode] = await finished;
    if (exportCode || importCode) throw Error(`History filtering failed (${exportCode}/${importCode}): ${errors}`);
    const marks = new Map(readFileSync(marksPath, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(' ')));
    mkdirSync(join(target, 'filter-repo'), { recursive: true });
    const rows = filter.commits.map(({ mark, oid }) => {
      const mapped = marks.get(':' + mark);
      if (!mapped) throw Error('Missing imported commit mark: ' + mark);
      return oid + ' ' + mapped;
    });
    writeFileSync(join(target, 'filter-repo/commit-map'), 'old                                      new\n' + rows.join('\n') + '\n');
    unlinkSync(marksPath);
    return { target, output: '', errors };
  } catch (error) {
    exporter.kill(); importer.kill();
    await finished.catch(() => {});
    throw new Error(`History filtering failed: ${errors}${error.message}`, { cause: error });
  }
}
