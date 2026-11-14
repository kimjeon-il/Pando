import {execFileSync} from "node:child_process";
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmdirSync,statfsSync,unlinkSync} from "node:fs";
import {dirname,relative,resolve,sep} from "node:path";
import {gunzipSync} from "node:zlib";
import {organizedReportPath,rewriteReportArtifact} from "./library-report-layout.mjs";
import {atomicStorageJSON,linkContent,makePrivate,removeContentLink,replaceLibraryFile,shareContentFile} from "./library-content.mjs";
import {defaultRoot,gitOptions,git,libraryCheckout,libraryReportEditRoot,librarySharedCheckout,reportDigest,libraryOwnerId,plainReportFiles,safeChild,withLibraryLock,organizationTree} from "./library-context.mjs";
import {reportRegistry,writeReportRegistry,checkedReportPath,assertReportProducersIdle,assertReportSubject} from "./library-reports.mjs";
import {libraryWriteLeases} from "./library-runtime.mjs";
import {storeOwnedLibraryData} from "./library-store.mjs";

const organizationTextFile = path => /\.md$/i.test(path) || /^reports\/reference-analysis\/(?:corpus|models)\/.*(?:manifest|catalog|config|registry|inventory|corpus[^/]*)\.json$/i.test(path);

function reportOrganizationInventory(root) {
  const shared = librarySharedCheckout(root), base = resolve(shared, 'reports'), registry = reportRegistry(root), head = git(shared, ['rev-parse', 'HEAD']);
  const owners = Object.entries(registry.owners).map(([id, record]) => ({ id, revision: record.revision }));
  if (!owners.some(owner => owner.id === libraryOwnerId(root))) owners.push({ id: libraryOwnerId(root), revision: head });
  const revisions = [...new Set([head, ...owners.map(owner => owner.revision)])], mapping = {}, trees = {};
  const destination = path => {
    // Replaced indexes remain available as historical originals, with stable bytes.
    if (/^reports\/(?:README\.md|(?:borders|hydro|places|terrain|map-analysis|development)\/README\.md)$/.test(path)) {
      return 'reports/development/storage/organization-original-indexes/' + path.slice(8).replaceAll('/', '-');
    }
    return organizedReportPath(path);
  };
  for (const revision of revisions) {
    trees[revision] = organizationTree(shared, revision);
    const index = JSON.parse(git(shared, ['show', `${revision}:archive/index.json`], { allowFetch: true }));
    for (const path of new Set([...trees[revision].map(x => x.path), ...Object.keys(index.files)])) if (path.startsWith('reports/')) mapping[path] = destination(path);
  }
  const files = [];
  const scan = (directory, owner = null) => {
    for (const file of plainReportFiles(directory)) {
      const from = 'reports/' + file.logical, to = destination(from);
      mapping[from] = to;
      const old = file.path, output = checkedReportPath(owner ? resolve(base, '.edits', owner) : base, to.slice(8));
      const bytes = readFileSync(old), sha256 = reportDigest(bytes);
      files.push({ from, to, old, output, owner, sha256, bytes: bytes.length });
    }
  };
  for (const name of existsSync(base) ? readdirSync(base) : []) {
    if (name.startsWith('.')) continue;
    const path = checkedReportPath(base, name), stamp = lstatSync(path);
    if (stamp.isDirectory()) {
      for (const file of plainReportFiles(path)) {
        const from = `reports/${name}/${file.logical}`, to = destination(from), bytes = readFileSync(file.path);
        mapping[from] = to; files.push({ from, to, old: file.path, output: checkedReportPath(base, to.slice(8)), owner: null, sha256: reportDigest(bytes), bytes: bytes.length });
      }
    } else if (stamp.isFile()) {
      const from = 'reports/' + name, to = destination(from), bytes = readFileSync(path);
      mapping[from] = to; files.push({ from, to, old: path, output: checkedReportPath(base, to.slice(8)), owner: null, sha256: reportDigest(bytes), bytes: bytes.length });
    } else throw Error(`Linked report source must be preserved: ${path}`);
  }
  const editBase = resolve(base, '.edits');
  if (existsSync(editBase)) for (const id of readdirSync(editBase)) {
    checkedReportPath(base, '.edits/' + id); scan(resolve(editBase, id), id);
  }
  const targets = new Map();
  for (const [from, to] of Object.entries(mapping)) {
    const key = to.toLowerCase(), previous = targets.get(key);
    if (previous && previous !== from) throw Error(`Report destination collision: ${previous}, ${from} -> ${to}`);
    targets.set(key, from);
  }
  for (const file of files) {
    if (file.old !== file.output && existsSync(file.output)) throw Error(`Report destination conflict: ${file.output}`);
    const text = organizationTextFile(file.from);
    if (text) {
      const original = readFileSync(file.old, 'utf8'), updated = rewriteReportArtifact(original, file.from, file.to, mapping);
      if (updated !== original) { file.text = updated; file.updatedSha256 = reportDigest(Buffer.from(updated)); }
    }
  }
  const apps = git(root, ['worktree', 'list', '--porcelain']).split('\n').filter(x => x.startsWith('worktree ')).map(x => x.slice(9)).filter(app => existsSync(resolve(app, 'config/library-data.json')));
  const pins = apps.map(app => ({ app, sha256: reportDigest(readFileSync(resolve(app, 'config/library-data.json'))), checkout: libraryCheckout(app), head: git(libraryCheckout(app), ['rev-parse', 'HEAD']) }));
  const skipWorktree = git(shared, ['ls-files', '-t', '-z']).split('\0').filter(row => row.startsWith('S ')).map(row => row.slice(2));
  return { schemaVersion: 1, layout: 'subjects-v1', phase: 'inventoried', head, owners, mapping, files, pins, skipWorktree, freeBytesBefore: statfsSync(shared).bavail * statfsSync(shared).bsize };
}

function organizationTextBlobs(shared, oids, cache) {
  const missing = [...new Set(oids)].filter(oid => !cache.has(oid));
  if (!missing.length) return;
  const output = execFileSync('git', [...gitOptions, 'cat-file', '--batch'], { cwd: shared, input: missing.join('\n') + '\n', env: { ...process.env, GIT_NO_LAZY_FETCH: '0' }, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  let offset = 0;
  for (const oid of missing) {
    const end = output.indexOf(10, offset), header = output.subarray(offset, end).toString('ascii').split(' '), size = Number(header[2]);
    if (end < 0 || header[0] !== oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0 || end + size + 1 >= output.length || output[end + size + 1] !== 10) throw Error(`Invalid report blob response: ${oid}`);
    cache.set(oid, output.subarray(end + 1, end + 1 + size)); offset = end + size + 2;
  }
  if (offset !== output.length) throw Error('Unexpected report blob batch content');
}

function organizedReportCommit(shared, revision, mapping, cache, resources) {
  if (cache.has(revision)) return cache.get(revision);
  const tree = organizationTree(shared, revision), index = JSON.parse(git(shared, ['show', `${revision}:archive/index.json`], { allowFetch: true }));
  const reportFiles = tree.filter(x => x.path.startsWith('reports/')), entries = {}, updated = new Map();
  const byPath = new Map(tree.map(item => [item.path, item]));
  const originals = Object.entries(index.files).filter(([path]) => path.startsWith('reports/') && organizationTextFile(path)).map(([, entry]) => {
    const item = byPath.get(entry.stored); if (!item) throw Error(`Missing stored report: ${entry.stored}`); return item.oid;
  });
  organizationTextBlobs(shared, [...reportFiles.filter(item => organizationTextFile(item.path)).map(item => item.oid), ...originals], resources.originals);
  const blob = bytes => {
    const key = reportDigest(bytes);
    if (!resources.written.has(key)) resources.written.set(key, execFileSync('git', [...gitOptions, 'hash-object', '-w', '--stdin'], { cwd: shared, input: bytes, encoding: 'utf8' }).trim());
    return resources.written.get(key);
  };
  for (const item of reportFiles) {
    const target = mapping[item.path]; if (!target) throw Error(`Unmapped report: ${item.path}`);
    let oid = item.oid, bytes = null;
    if (organizationTextFile(item.path)) {
      const original = resources.originals.get(item.oid);
      const text = rewriteReportArtifact(original.toString('utf8'), item.path, target, mapping);
      if (text !== original.toString('utf8')) { bytes = Buffer.from(text); oid = blob(bytes); }
    }
    updated.set(target, { ...item, path: target, oid, bytes });
  }
  for (const [path, entry] of Object.entries(index.files)) {
    if (!path.startsWith('reports/')) { entries[path] = entry; continue; }
    const target = mapping[path]; if (!target) throw Error(`Unmapped report index entry: ${path}`);
    if ((!updated.has(target) || entry.stored !== path || entry.encoding !== 'identity') && organizationTextFile(path)) {
      const stored = resources.originals.get(byPath.get(entry.stored).oid);
      if (!['identity', 'gzip'].includes(entry.encoding)) throw Error(`Unknown report encoding: ${path}`);
      const original = entry.encoding === 'gzip' ? gunzipSync(stored) : stored;
      if (original.length !== entry.bytes || reportDigest(original) !== entry.sha256) throw Error(`Corrupt report original: ${path}`);
      const text = rewriteReportArtifact(original.toString('utf8'), path, target, mapping);
      if (text !== original.toString('utf8')) {
        const bytes = Buffer.from(text); updated.set(target, { path: target, mode: '100644', oid: blob(bytes), bytes });
        entries[target] = { stored: target, encoding: 'identity', bytes: bytes.length, sha256: reportDigest(bytes) }; continue;
      }
      // A raw excerpt may have changed independently of its archived original.
      // Its hash must never replace the metadata for an unchanged full edition.
      entries[target] = { ...entry, stored: mapping[entry.stored] || entry.stored }; continue;
    }
    const changed = updated.get(target)?.bytes;
    entries[target] = { ...entry, stored: mapping[entry.stored] || entry.stored, ...(changed ? { bytes: changed.length, sha256: reportDigest(changed) } : {}) };
  }
  const indexBytes = Buffer.from(JSON.stringify({ ...index, reportLayout: 'subjects-v1', files: entries }) + '\n');
  updated.set('archive/index.json', { path: 'archive/index.json', mode: '100644', oid: blob(indexBytes) });
  const scratch = resolve(shared, '.pando-store/report-organization.index');
  const env = { ...process.env, GIT_INDEX_FILE: scratch, GIT_NO_LAZY_FETCH: '1' };
  mkdirSync(dirname(scratch), { recursive: true });
  const indexGit = args => execFileSync('git', [...gitOptions, ...args], { cwd: shared, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  try {
    indexGit(['read-tree', revision]);
    const removals = reportFiles.map(item => `0 ${'0'.repeat(40)}\t${item.path}\0`).join('');
    const additions = [...updated.values()].map(item => `${item.mode} ${item.oid}\t${item.path}\0`).join('');
    execFileSync('git', [...gitOptions, 'update-index', '-z', '--index-info'], { cwd: shared, env, input: removals + additions, stdio: ['pipe', 'pipe', 'pipe'] });
    const result = indexGit(['write-tree']);
    const commit = git(shared, ['-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com', 'commit-tree', result, '-p', revision, '-m', 'Organize research and reports by subject']);
    cache.set(revision, commit); return commit;
  } finally { if (existsSync(scratch)) unlinkSync(scratch); }
}

export function organizeLibraryReports({ root = defaultRoot, apply = false, stopAfter = null } = {}) {
  const shared = librarySharedCheckout(root), base = resolve(shared, 'reports'), pending = resolve(shared, '.pando-store/report-organization.pending.json');
  const operation = () => {
    const current = git(shared, ['rev-parse', 'HEAD']);
    const currentIndex = JSON.parse(git(shared, ['show', 'HEAD:archive/index.json'], { allowFetch: true }));
    if (!existsSync(pending) && currentIndex.reportLayout === 'subjects-v1') return { layout: 'subjects-v1', revision: current, moves: [], files: 0, unchanged: true };
    if (!apply && existsSync(resolve(shared, '.git/pando-library.lock'))) throw Error('Library storage is already running.');
    const journal = existsSync(pending) ? JSON.parse(readFileSync(pending, 'utf8')) : reportOrganizationInventory(root);
    const moves = Object.entries(journal.mapping).filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to }));
    if (!apply) return { layout: journal.layout, moves, files: journal.files.length, privateFiles: journal.files.filter(x => x.owner).length, estimatedAdditionalBytes: 64 * 1024 * 1024 };
    assertReportProducersIdle(shared);
    if (libraryWriteLeases(shared).some(lease => lease.alive && lease.prefixes.some(path => path === 'reports' || path.startsWith('reports/')))) throw Error('Report writers hold active leases; retry after completion.');
    if (git(shared, ['branch', '--show-current']) !== 'main') throw Error('Preserve the library branch; organization requires main.');
    if (!existsSync(pending)) {
      if (git(shared, ['status', '--porcelain'])) throw Error('Preserve dirty library work before organization.');
      if (fetchReportMain(shared) !== current) throw Error('Library main must match remote main before organization; preserve both histories.');
      atomicStorageJSON(pending, journal);
    }
    const save = () => atomicStorageJSON(pending, journal);
    // Only recorded transaction PIDs and exact hashes authorize stale temporary
    // cleanup after a process was killed between replacement unlink and rename.
    journal.workerPids ||= [];
    const clearReplacementTemps = (output, sha256) => {
      for (const pid of journal.workerPids) {
        const path = checkedReportPath(shared, relative(shared, `${output}.${pid}.pending`));
        if (!existsSync(path)) continue;
        if (reportDigest(readFileSync(path)) !== sha256) throw Error(`Modified organization temporary must be preserved: ${path}`);
        removeContentLink(shared, path);
      }
    };
    if (!journal.workerPids.includes(process.pid)) { journal.workerPids.push(process.pid); save(); }
    for (const pin of journal.pins) {
      if (reportDigest(readFileSync(resolve(pin.app, 'config/library-data.json'))) !== pin.sha256 || git(pin.checkout, ['rev-parse', 'HEAD']) !== pin.head) {
        // Shared main is deliberately advanced by this transaction only.
        if (pin.checkout !== shared || reportDigest(readFileSync(resolve(pin.app, 'config/library-data.json'))) !== pin.sha256) throw Error('Runtime pin or private checkout changed during organization; preserve it.');
      }
    }
    if (journal.phase === 'inventoried') {
      for (const file of journal.files) {
        const source = checkedReportPath(shared, relative(shared, file.old)), output = checkedReportPath(shared, relative(shared, file.output));
        if (file.updatedSha256) clearReplacementTemps(output, file.updatedSha256);
        if (!existsSync(source) && !existsSync(output)) {
          if (file.text !== undefined) replaceLibraryFile(shared, output, Buffer.from(file.text));
          else {
            linkContent(shared, file.updatedSha256 || file.sha256, output);
            if (file.owner) makePrivate(shared, output);
          }
        }
        const input = existsSync(source) ? source : output;
        const digest = existsSync(input) ? reportDigest(readFileSync(input)) : null;
        if (![file.sha256, file.updatedSha256].includes(digest)) throw Error(`Report changed during organization: ${input}`);
        if (source !== output && existsSync(source)) {
          if (existsSync(output)) throw Error(`Report destination collision during resume: ${output}`);
          mkdirSync(dirname(output), { recursive: true }); renameSync(source, output);
        }
        if (file.text !== undefined && digest !== file.updatedSha256) {
          replaceLibraryFile(shared, output, Buffer.from(file.text));
          if (!file.owner) shareContentFile(shared, output);
        }
      }
      // Empty retired directories only; never recurse into a populated or linked path.
      for (const file of journal.files) for (let dir = dirname(file.old); dir !== base && dir.startsWith(base + sep); dir = dirname(dir)) {
        if (!existsSync(dir) || lstatSync(dir).isSymbolicLink() || readdirSync(dir).length) break;
        rmdirSync(dir);
      }
      journal.phase = 'moved'; save();
    }
    if (stopAfter === journal.phase) return { interruptedAt: journal.phase };
    if (journal.phase === 'moved') {
      const cache = new Map(), resources = { originals: new Map(), written: new Map() };
      if (!journal.revision) { journal.revision = organizedReportCommit(shared, journal.head, journal.mapping, cache, resources); save(); }
      cache.set(journal.head, journal.revision); journal.ownerRevisions ||= {};
      for (const owner of journal.owners) if (!journal.ownerRevisions[owner.id]) {
        journal.ownerRevisions[owner.id] = organizedReportCommit(shared, owner.revision, journal.mapping, cache, resources); save();
      }
      journal.phase = 'commits'; save();
    }
    if (journal.phase === 'commits') {
      if (git(shared, ['rev-parse', 'HEAD']) !== journal.head && git(shared, ['rev-parse', 'HEAD']) !== journal.revision) throw Error('Library main changed; preserve the pending organization.');
      for (const file of journal.files) if (reportDigest(readFileSync(file.output)) !== (file.updatedSha256 || file.sha256)) throw Error(`Post-move verification failed: ${file.output}`);
      const finalIndex = git(shared, ['show', `${journal.revision}:archive/index.json`]);
      clearReplacementTemps(resolve(shared, 'archive/index.json'), reportDigest(Buffer.from(finalIndex + '\n')));
      replaceLibraryFile(shared, resolve(shared, 'archive/index.json'), Buffer.from(finalIndex + '\n'));
      if (git(shared, ['rev-parse', 'HEAD']) === journal.head) git(shared, ['update-ref', 'refs/heads/main', journal.revision, journal.head]);
      git(shared, ['read-tree', journal.revision]);
      if (journal.skipWorktree.length) execFileSync('git', [...gitOptions, 'update-index', '--skip-worktree', '-z', '--stdin'], {
        cwd: shared, input: journal.skipWorktree.map(path => journal.mapping[path] || path).join('\0') + '\0', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const registry = reportRegistry(root); registry.reportLayout = 'subjects-v1';
      for (const [owner, revision] of Object.entries(journal.ownerRevisions)) {
        git(shared, ['update-ref', `refs/pando/reports/${owner}`, revision]); registry.owners[owner] = { revision };
      }
      writeReportRegistry(root, registry); journal.phase = 'committed'; save();
    }
    if (git(shared, ['rev-parse', 'HEAD']) !== journal.revision) throw Error('Library main changed from the recorded revision; preserve the pending organization.');
    if (git(shared, ['status', '--porcelain'])) throw Error('Unexpected library work remains after organization; preserve the journal.');
    execFileSync('git', [...gitOptions, 'push', 'origin', `${journal.revision}:main`], { cwd: shared, stdio: ['ignore', 'pipe', 'pipe'] });
    if (fetchReportMain(shared) !== journal.revision) throw Error('Remote organization revision differs; preserve the journal.');
    const disk = statfsSync(shared), result = { layout: journal.layout, revision: journal.revision, files: journal.files.length, moved: moves.length, privateFiles: journal.files.filter(x => x.owner).length, freeBytesBefore: journal.freeBytesBefore, freeBytesAfter: disk.bavail * disk.bsize };
    const evidence = resolve(libraryReportEditRoot(root), 'development/storage/library-organization-2026-10-25');
    mkdirSync(evidence, { recursive: true });
    const published = new Set(organizationTree(shared, journal.head).map(x => x.path));
    for (const path of Object.keys(JSON.parse(git(shared, ['show', `${journal.head}:archive/index.json`])).files)) published.add(path);
    const paths = Object.fromEntries(Object.entries(journal.mapping).filter(([path]) => published.has(path)));
    atomicStorageJSON(resolve(evidence, 'mapping.json'), { paths, moves: moves.filter(x => published.has(x.from)), publishedBaseline: journal.head });
    atomicStorageJSON(resolve(evidence, 'result.json'), result);
    atomicStorageJSON(resolve(shared, 'private-evidence/report-organization/2026-10-25.json'), journal);
    unlinkSync(pending); return result;
  };
  return apply ? withLibraryLock(root, operation, { organizing: true }) : operation();
}

function reportWorkingFiles(root, prefixes, removePaths = []) {
  if (!Array.isArray(prefixes) || !prefixes.length || prefixes.some(path => typeof path !== 'string'
    || !/^reports\/[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part.startsWith('.')))) {
    throw Error('Report completion requires explicit reports/<scope> prefixes.');
  }
  if (!Array.isArray(removePaths) || removePaths.some(path => typeof path !== 'string'
    || !/^reports\/[\w.-]+(?:\/[\w.-]+)+$/.test(path) || path.split('/').some(part => part.startsWith('.'))
    || !prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/')))) {
    throw Error('Report deletion requires explicit paths inside the selected report scopes.');
  }
  for (const path of removePaths) {
    assertReportSubject(root, path);
    if (existsSync(checkedReportPath(libraryReportEditRoot(root), path.slice(8)))) {
      throw Error(`Remove the working original before publishing its deletion: ${path}`);
    }
  }
  const files = new Map();
  for (const prefix of prefixes) {
    assertReportSubject(root, prefix);
    const scope = checkedReportPath(libraryReportEditRoot(root), prefix.slice(8));
    const scoped = plainReportFiles(scope);
    if (!scoped.length && !removePaths.some(path => path === prefix || path.startsWith(prefix + '/'))) throw Error(`Empty or missing report scope: ${prefix}`);
    for (const file of scoped) {
      const before = lstatSync(file.path), bytes = readFileSync(file.path), after = lstatSync(file.path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error(`Report writer is still changing ${file.path}`);
      const logical = prefix + (file.logical ? '/' + file.logical : '');
      files.set(logical, { logical, bytes: bytes.length, sha256: reportDigest(bytes) });
    }
  }
  return [...files.values()];
}

function fetchReportMain(shared) {
  git(shared, ['fetch', '--filter=blob:none', 'origin', 'main']);
  return git(shared, ['rev-parse', 'FETCH_HEAD']);
}

function prepareReportPublication(root, prefixes) {
  const shared = librarySharedCheckout(root);
  if (git(shared, ['branch', '--show-current']) !== 'main' || git(shared, ['status', '--porcelain'])) {
    throw Error('Preserve existing library main work before publishing reports.');
  }
  const remote = fetchReportMain(shared), current = git(shared, ['rev-parse', 'HEAD']);
  if (current !== remote) {
    const base = git(shared, ['merge-base', current, remote]);
    if (base === current) git(shared, ['merge', '--ff-only', remote], { allowFetch: true });
    else if (base === remote) {
      // A rejected report push is retryable; unpublished runtime/history is not.
      const included = path => prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'));
      for (const revision of git(shared, ['rev-list', `${remote}..HEAD`]).split('\n')) {
        const paths = git(shared, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-z', '-r', revision]).split('\0').filter(Boolean);
        if (paths.some(path => path !== 'archive/index.json' && !path.startsWith('reports/'))) {
          throw Error('Preserve unpublished non-report commits on library main before report publication.');
        }
        if (paths.some(path => path.startsWith('reports/') && !included(path))) throw Error('Unpublished report commits exist outside the selected scope; preserve them before publishing this scope.');
      }
      const previous = JSON.parse(git(shared, ['show', `${remote}:archive/index.json`], { allowFetch: true })).files;
      const pending = JSON.parse(git(shared, ['show', 'HEAD:archive/index.json'])).files;
      if ([...new Set([...Object.keys(previous), ...Object.keys(pending)])].some(path => !path.startsWith('reports/')
        && JSON.stringify(previous[path]) !== JSON.stringify(pending[path]))) throw Error('Preserve unpublished non-report archive entries before report publication.');
      if ([...new Set([...Object.keys(previous), ...Object.keys(pending)])].some(path => path.startsWith('reports/') && !included(path)
        && JSON.stringify(previous[path]) !== JSON.stringify(pending[path]))) throw Error('Unpublished report archive entries exist outside the selected scope.');
    } else throw Error('Library main has diverged; preserve both histories and resolve the merge before publishing reports.');
  }
  return { checkout: shared };
}

function checkOwnedReports(root, prefixes, removePaths = []) {
  const files = reportWorkingFiles(root, prefixes, removePaths), shared = librarySharedCheckout(root), revision = fetchReportMain(shared);
  const index = JSON.parse(git(shared, ['show', `${revision}:archive/index.json`], { allowFetch: true }));
  for (const path of removePaths) {
    if (index.files[path]) {
      throw Error(`Retired report is still present remotely: ${path}`);
    }
  }
  if (removePaths.length) {
    const subjects = [...new Set(removePaths.map(path => path.split('/').slice(0, 2).join('/')))];
    const present = git(shared, ['ls-tree', '-r', '--name-only', revision, '--', ...subjects]).split('\n')
      .filter(file => removePaths.some(path => file === path || file.startsWith(path + '/')));
    if (present.length) throw Error(`Retired report is still present remotely: ${present.join(', ')}`);
  }
  for (const file of files) {
    const entry = index.files[file.logical];
    if (!entry || entry.sha256 !== file.sha256 || entry.bytes !== file.bytes) throw Error(`Report is not published with its current original: ${file.logical}`);
    safeChild(shared, entry.stored);
    const stored = execFileSync('git', [...gitOptions, 'show', `${revision}:${entry.stored}`], { cwd: shared, env: { ...process.env, GIT_NO_LAZY_FETCH: '0' }, maxBuffer: Math.max(entry.bytes * 2, 16 * 1024 * 1024), stdio: ['pipe', 'pipe', 'pipe'] });
    if (!['identity', 'gzip'].includes(entry.encoding)) throw Error(`Unknown report archive encoding: ${file.logical}`);
    const bytes = entry.encoding === 'gzip' ? gunzipSync(stored) : stored;
    if (bytes.length !== file.bytes || reportDigest(bytes) !== file.sha256) throw Error(`Remote report content is corrupt or mismatched: ${file.logical}`);
  }
  return { revision, files: files.length, removed: new Set(removePaths).size, prefixes };
}

export function publishLibraryReports({ root = defaultRoot, prefixes, removePaths = [] } = {}) {
  return withLibraryLock(root, () => {
    reportWorkingFiles(root, prefixes, removePaths);
    const data = prepareReportPublication(root, prefixes);
    storeOwnedLibraryData({ root, prefixes, removePaths, push: true, reportData: data });
    return checkOwnedReports(root, prefixes, removePaths);
  },{compact:false});
}

export function checkLibraryReports({ root = defaultRoot, prefixes, removePaths = [] } = {}) {
  return withLibraryLock(root, () => checkOwnedReports(root, prefixes, removePaths),{compact:false});
}

// Create a descendant archive edition without checking out data or touching any
// caller index, working bytes, branch, owner ref or remote. Publication is separate.
export function createReportRetirementCommit({ root = defaultRoot, revision, removePaths, documentationPaths = [] } = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('Report retirement requires an explicit commit revision');
  const plainPath = path => typeof path === 'string' && /^[\w.-]+(?:\/[\w.-]+)+$/.test(path)
    && !path.split('/').some(part => part.startsWith('.'));
  const storagePath = path => typeof path === 'string' && /^[\w.-]+(?:\/[\w.-]+)+$/.test(path)
    && !path.split('/').some(part => part.startsWith('.') && part !== '.originals');
  const protectedPath = path => /(?:^|\/)AGENTS(?:\.override)?\.md$/i.test(path)
    || /(?:^|\/)docs\/policies(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:vendor|third[-_]party|third[-_]party[-_]notices)(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:license|licence|copying|copyright|notice|notices|third[-_]?party[-_]?(?:notices|licenses))(?:[._-]|$)/i.test(path);
  if (!Array.isArray(removePaths) || !removePaths.length || removePaths.some(path => !plainPath(path)
    || !/\.(?:md|markdown|mdx)$/i.test(path) || protectedPath(path))) throw Error('Unsafe or protected Markdown retirement path');
  if (!Array.isArray(documentationPaths) || documentationPaths.some(path => !removePaths.includes(path)
    || !/^(?:archive|docs|tools)\//.test(path))) throw Error('Documentation retirement paths must be explicit selected archive/docs/tools Markdown');
  const documentation = new Set(documentationPaths);
  const paths = [...new Set(removePaths)], shared = librarySharedCheckout(root);
  if (git(shared, ['cat-file', '-t', revision]) !== 'commit') throw Error('Report retirement revision must name a commit');
  const index = JSON.parse(git(shared, ['show', `${revision}:archive/index.json`]));
  if (!index.files || Array.isArray(index.files) || typeof index.files !== 'object') throw Error('Invalid archive index');
  const tracked = new Map(git(shared, ['ls-tree', '-rz', '--full-tree', revision]).split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'); return [row.slice(tab + 1), row.slice(0, tab).split(' ')];
  }));
  const entries = paths.map(path => {
    if (!path.startsWith('reports/') && !Object.hasOwn(index.files, path) && !documentation.has(path)) throw Error(`Not an archived source Markdown path: ${path}`);
    if (!Object.hasOwn(index.files, path) && !tracked.has(path)) throw Error(`Markdown retirement path is absent: ${path}`);
    const metadata = tracked.get(path);
    if (documentation.has(path) && !metadata) throw Error(`Documentation retirement requires a tracked plain file: ${path}`);
    if (metadata && (metadata[1] !== 'blob' || !['100644', '100755'].includes(metadata[0]))) throw Error(`Retirement requires a plain file: ${path}`);
    const entry = index.files[path];
    if (entry && (!storagePath(entry.stored) || protectedPath(entry.stored)
      || entry.stored !== path && !/\.(?:gz|bin)$/i.test(entry.stored))) throw Error(`Unsafe archived Markdown storage path: ${path}`);
    delete index.files[path]; return { path, entry };
  });
  const retainedStorage = new Set(Object.values(index.files).map(entry => entry.stored)), removed = new Set();
  for (const { path, entry } of entries) {
    if (tracked.has(path)) {
      if (retainedStorage.has(path)) throw Error(`Retained archive entry still references retired Markdown: ${path}`);
      removed.add(path);
    }
    if (entry && !retainedStorage.has(entry.stored) && tracked.has(entry.stored)) removed.add(entry.stored);
  }
  const bytes = Buffer.from(JSON.stringify(index) + '\n');
  mkdirSync(resolve(shared, '.pando-store'), { recursive: true });
  const directory = mkdtempSync(resolve(shared, '.pando-store/report-retirement-')), scratch = resolve(directory, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: scratch, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
  const run = (args, input) => execFileSync('git', [...gitOptions, ...args], { cwd: shared, env, input, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }).trim();
  try {
    run(['read-tree', revision]);
    if (removed.size) run(['update-index', '--force-remove', '-z', '--stdin'], [...removed].join('\0') + '\0');
    const blob = run(['hash-object', '-w', '--stdin'], bytes);
    run(['update-index', '-z', '--index-info'], `100644 ${blob}\tarchive/index.json\0`);
    // Unchanged promisor objects remain lazy; retirement only removes selected entries.
    const tree = run(['write-tree', '--missing-ok']);
    const next = run(['-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com',
      'commit-tree', tree, '-p', revision, '-m', 'Retire explicitly selected Markdown [skip ci]']);
    return { revision: next, parent: revision, removed: paths.length };
  } finally {
    for (const path of [scratch + '.lock', scratch]) if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  }
}
