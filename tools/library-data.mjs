import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statfsSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { REPORT_SUBJECTS, organizedReportPath, reportDocumentDetails, reportSubjectReadmes, rewriteReportArtifact } from './library-report-layout.mjs';
import { atomicStorageJSON, containedPath, contentFiles, contentHash, contentPath, linkContent, makePrivate, publishContent, recoverContentPermissions, removeContentLink, replaceLibraryFile, shareContentFile } from './library-content.mjs';

export const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const gitOptions = ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', '-c', 'core.autocrlf=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
const git = (root, args, { allowFetch = false } = {}) => {
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
export function libraryMaterializedRoot(root = defaultRoot) {
  return resolve(librarySharedCheckout(root), '.pando-cache/materialized', libraryOwnerId(root), libraryConfig(root).revision);
}
export function libraryReportRoot(root = defaultRoot) {
  return resolve(librarySharedCheckout(root), 'reports');
}
export function libraryReportEditRoot(root = defaultRoot) {
  return resolve(libraryReportRoot(root), '.edits', libraryOwnerId(root));
}
export function librarySharedCheckout(root = defaultRoot) {
  const checkout = libraryCheckout(root);
  if (!existsSync(resolve(checkout, '.git'))) return checkout;
  return dirname(resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir'])));
}
const reportDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export function libraryOwnerId(root) {
  if (!existsSync(resolve(root, '.git'))) return 'main';
  const branch = git(root, ['branch', '--show-current']);
  return branch.startsWith('work/') ? branch.slice(5).replaceAll('/', '-') : 'main';
}
function reportRegistry(root) {
  const path = resolve(libraryReportRoot(root), '.owners.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, owners: {} };
}
function writeReportRegistry(root, registry) {
  const path = resolve(libraryReportRoot(root), '.owners.json');
  mkdirSync(dirname(path), { recursive: true });
  excludeReportStorage(librarySharedCheckout(root));
  atomicReportJSON(path, registry);
}
function atomicReportJSON(path, value) {
  const temporary = `${path}.${process.pid}.pending`;
  const handle = openSync(temporary, 'wx');
  let closed = false;
  try {
    writeFileSync(handle, JSON.stringify(value) + '\n'); closeSync(handle); closed = true;
    renameSync(temporary, path);
  } finally {
    if (!closed) closeSync(handle);
    if (existsSync(temporary) && !lstatSync(temporary).isSymbolicLink()) unlinkSync(temporary);
  }
}
function excludeReportStorage(shared) {
  const common = resolve(shared, git(shared, ['rev-parse', '--git-common-dir']));
  const path = resolve(common, 'info/exclude'), text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const patterns = ['/.working/', '/.pando-store/', '/.pando-cache/', '/.pando-worktrees/', '/private-evidence/', '/reports/.owners.json', '/reports/.provenance.json', '/reports/.centralization.pending.json', '/reports/.edits/', '/reports/.variants/', '/reports/.views/'];
  const missing = patterns.filter(line => !text.split(/\r?\n/).includes(line));
  if (missing.length) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text + '\n' + missing.join('\n') + '\n'); }
}
function reportMainRevision(root, allowFetch = true) {
  const shared = librarySharedCheckout(root);
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    let revision;
    try { revision = git(shared, ['rev-parse', '--verify', ref]); } catch { continue; }
    const index = JSON.parse(git(shared, ['show', `${revision}:archive/index.json`], { allowFetch }));
    if (index.reportLayout === 'subjects-v1') return revision;
  }
  return git(shared, ['rev-parse', 'HEAD']);
}
export function reportContext(root, { allowFetch = true } = {}) {
  const checkout = libraryCheckout(root), owner = libraryOwnerId(root), registry = reportRegistry(root);
  if (!registry.owners[owner]) {
    const revision = reportMainRevision(root, allowFetch);
    const index = JSON.parse(git(checkout, ['show', `${revision}:archive/index.json`]));
    git(librarySharedCheckout(root), ['update-ref', `refs/pando/reports/${owner}`, revision]);
    if (index.reportLayout) registry.reportLayout = index.reportLayout;
    registry.owners[owner] = { revision }; writeReportRegistry(root, registry);
  }
  const revision = registry.owners[owner].revision;
  return { checkout, owner, revision, base:libraryReportRoot(root), files: JSON.parse(git(checkout, ['show', `${revision}:archive/index.json`])).files };
}
function checkedReportPath(base, path) {
  const output = safeChild(base, path);
  for (let current = output; current !== base; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error(`Linked report path must be preserved: ${current}`);
  }
  return output;
}
function plainReportFiles(base) {
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
function matchingReport(path, entry) {
  return existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()
    && lstatSync(path).size === entry.bytes && reportDigest(readFileSync(path)) === entry.sha256;
}
function originalReport(context, logical, entry) {
  const base = context.base, canonical = checkedReportPath(base, logical.slice(8));
  if (matchingReport(canonical, entry)) return canonical;
  const variant = checkedReportPath(base, `.variants/${entry.sha256}`);
  if (!existsSync(variant)) {
    const bytes = decodeArchiveEntry(context.checkout, entry, context.revision,{fetch:true});
    mkdirSync(dirname(variant), { recursive: true }); writeFileSync(variant, bytes, { flag: 'wx' });
    shareContentFile(dirname(base), variant, entry);
  }
  if (!matchingReport(variant, entry)) throw Error(`Modified report variant: ${variant}`);
  return variant;
}
// Access is explicit: readers share originals; writers receive independent,
// scoped copies. Neither access overwrites another branch's unfinished work.
export function hydrateReports({ root = defaultRoot, path, access } = {}) {
  assertReportSubject(root, 'reports/' + path);
  if (!['read', 'write'].includes(access)) throw Error('Report access must be read or write');
  checkedReportPath(libraryReportRoot(root), path);
  if (path.split(/[\\/]/).some(part => part.startsWith('.'))) throw Error('Unsafe reserved report path');
  return withLibraryLock(root, () => hydrateOwnedReports({ root, path, access }));
}
function hydrateOwnedReports({ root, path, access }) {
  excludeReportStorage(librarySharedCheckout(root));
  const context = reportContext(root), base=context.base, shared=dirname(base);
  const editRoot = resolve(base, '.edits', context.owner), edit = checkedReportPath(editRoot, path);
  const logical = 'reports/' + path.replaceAll('\\', '/');
  const entries = Object.entries(context.files).filter(([key]) => key === logical || key.startsWith(logical + '/'));
  if (access === 'write') {
    for (const [key, entry] of entries) {
      const output = checkedReportPath(editRoot, key.slice(8));
      if (!existsSync(output)) { mkdirSync(dirname(output), { recursive: true }); copyFileSync(originalReport(context, key, entry), output); chmodSync(output, 0o600); }
    }
    for(const file of plainReportFiles(edit))makePrivate(shared,file.path);
    mkdirSync(dirname(edit), { recursive: true }); return edit;
  }
  if (entries.length === 1 && entries[0][0] === logical) return existsSync(edit) ? edit : originalReport(context, logical, entries[0][1]);
  if (!entries.length) {
    if (existsSync(edit)) return edit;
    throw Error(`Report is not archived or edited: ${logical}`);
  }
  const central = checkedReportPath(base, path), edited = plainReportFiles(edit);
  const centralFiles = plainReportFiles(central);
  if (!edited.length && centralFiles.length === entries.length && entries.every(([key, entry]) => matchingReport(checkedReportPath(base, key.slice(8)), entry))) return central;
  const view = checkedReportPath(base, `.views/${context.owner}/${reportDigest(Buffer.from(path))}/${path}`);
  const manifest = checkedReportPath(base, `.views/.manifests/${context.owner}-${reportDigest(Buffer.from(path))}.json`);
  const previous = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
  for (const existing of plainReportFiles(view)) {
    if (previous[existing.logical] !== reportDigest(readFileSync(existing.path))) throw Error(`Modified report view must be preserved: ${existing.path}`);
  }
  const expected = new Map(entries.map(([key, entry]) => [key.slice(logical.length + 1), originalReport(context, key, entry)]));
  for (const file of edited) expected.set(file.logical, file.path);
  for (const existing of plainReportFiles(view)) if (!expected.has(existing.logical)) removeContentLink(shared,existing.path);
  for (const [name, input] of expected) {
    const output = checkedReportPath(view, name), bytes = readFileSync(input);
    mkdirSync(dirname(output), { recursive: true });
    if (!existsSync(output) || !readFileSync(output).equals(bytes)) replaceLibraryFile(shared,output,bytes);
    shareContentFile(shared,output);
  }
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify(Object.fromEntries([...expected].map(([name, input]) => [name, reportDigest(readFileSync(input))]))) + '\n');
  return view;
}

// This is the one-off, resumable relocation used by the scoped cleanup command.
// It inventories all sources before writing, and deletes a copy only after a
// second byte/hash check of its retained destination. Git history is untouched.
export function centralizeLibraryReports({ root = defaultRoot, apply = false } = {}) {
  const operation = () => centralizeOwnedReports(root, apply);
  return apply ? withLibraryLock(root, operation) : operation();
}
function assertReportProducersIdle(shared = null) {
  if (process.platform !== 'win32') return;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(python|node|pandolab).*\\.exe$' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const parsed = output.trim() ? JSON.parse(output) : [], processes = Array.isArray(parsed) ? parsed : [parsed];
  const writers = processes.filter(item => {
    if (item.ProcessId === process.pid) return false;
    const command = item.CommandLine || '';
    if (/\.working[\\/]|reference-analysis[\\/](?:train|macro|inspect-checkpoint|acquire-sources|publisher|prepare-analysis-images)\.py/i.test(command)) return true;
    // An input report path does not make a read-only verifier a producer.
    return /--report-directory(?:[=\s])/.test(command) && (!shared || command.replaceAll('\\', '/').toLowerCase().includes(shared.replaceAll('\\', '/').toLowerCase()));
  });
  if (writers.length) throw Error(`Report producers are running; retry after completion: ${writers.map(item => `${item.ProcessId}: ${item.CommandLine}`).join('; ')}`);
}
function centralizeOwnedReports(root, apply) {
  const shared = librarySharedCheckout(root), base = resolve(shared, 'reports');
  const common = resolve(shared, git(shared, ['rev-parse', '--git-common-dir']));
  if (!apply && existsSync(resolve(common, 'pando-library.lock'))) throw Error('Library storage is already running.');
  const roots = git(root, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
  const owners = [];
  for (const app of roots) {
    if (!existsSync(resolve(app, '.library-data/repository'))) continue;
    if (resolve(app) !== resolve(root) && existsSync(resolve(app, '.library-data/prepare.lock'))) throw Error(`Library operation is running: ${app}`);
    const checkout = libraryCheckout(app), id = libraryOwnerId(app);
    const legacy = resolve(checkout, '.working/report-owner.json');
    const registration = existsSync(legacy) ? JSON.parse(readFileSync(legacy, 'utf8')) : null;
    const revision = registration?.revision || reportRegistry(app).owners[id]?.revision || git(checkout, ['rev-parse', 'HEAD']);
    owners.push({ id, app, checkout, revision, activePath: registration ? resolve(checkout, '.working', registration.path) : null, files: JSON.parse(git(checkout, ['show', `${revision}:archive/index.json`])).files });
  }
  const main = owners.find(owner => owner.checkout === shared) || { id: 'main', checkout: shared, revision: git(shared, ['rev-parse', 'HEAD']) };
  main.files ||= JSON.parse(git(shared, ['show', `${main.revision}:archive/index.json`])).files;
  const baseline = Object.fromEntries(Object.entries(main.files).filter(([key]) => key.startsWith('reports/')));
  const baselineOwners = new Map(Object.keys(baseline).map(key => [key, main]));
  for (const owner of owners) for (const [key, entry] of Object.entries(owner.files)) {
    if (key.startsWith('reports/') && !baseline[key]) { baseline[key] = entry; baselineOwners.set(key, owner); }
  }
  const sources = [], markers = [], directories = [], oldIndexes = new Map();
  for (const owner of owners) {
    const working = resolve(owner.checkout, '.working');
    if (!existsSync(working)) continue;
    for (const file of plainReportFiles(working)) {
      if (file.logical === 'report-owner.json' || file.logical.endsWith('/.reports-complete')) { markers.push(file); continue; }
      const slash = file.logical.indexOf('/'), revision = file.logical.slice(0, slash), rel = file.logical.slice(slash + 1);
      const bytes = readFileSync(file.path), sha256 = reportDigest(bytes);
      const record = { ...file, owner: owner.id, sourceRevision: revision, sha256, active: Boolean(owner.activePath && file.path.startsWith(owner.activePath + sep)) };
      if (rel.startsWith('private-evidence/')) record.destination = resolve(shared, 'private-evidence', owner.id, revision, rel.slice(17));
      else if (rel.startsWith('reports/')) {
        const logical = rel, canonical = baseline[logical];
        if (canonical?.sha256 === sha256) record.destination = checkedReportPath(base, logical.slice(8));
        else {
          if (!oldIndexes.has(revision)) {
            try { oldIndexes.set(revision, JSON.parse(git(owner.checkout, ['show', `${revision}:archive/index.json`])).files); }
            catch { oldIndexes.set(revision, {}); }
          }
          const archived = owner.files[logical]?.sha256 === sha256 || oldIndexes.get(revision)[logical]?.sha256 === sha256;
          record.destination = checkedReportPath(base, archived || !record.active ? `.variants/${sha256}` : `.edits/${owner.id}/${logical.slice(8)}`);
          record.classification = archived ? 'archived-variant' : record.active ? 'unfinished-original' : 'inactive-unfinished-original';
        }
      } else throw Error(`Unrecognized working original must be reviewed: ${file.path}`);
      record.classification ||= rel.startsWith('private-evidence/') ? 'private-original' : 'shared-original';
      sources.push(record);
    }
    directories.push(working);
  }
  sources.sort((a, b) => Number(b.active) - Number(a.active) || a.path.localeCompare(b.path));
  const destinationHashes = new Map();
  for (const record of sources) {
    const previous = destinationHashes.get(record.destination);
    if ((previous && previous !== record.sha256) || (existsSync(record.destination) && !matchingReport(record.destination, record) && record.destination.includes(`${sep}.edits${sep}`))) {
      record.destination = checkedReportPath(base, `.variants/${record.sha256}`);
      record.classification = 'conflicting-original';
    }
    destinationHashes.set(record.destination, record.sha256);
  }
  const duplicates = new Set(), result = { schemaVersion: 1, apply, shared, sourceFiles: sources.length, sourceBytes: 0, duplicateBytes: 0, deletedBytes: 0, movedBytes: 0, preservedFiles: 0, owners: owners.map(({ id, revision }) => ({ id, revision })) };
  for (const record of sources) {
    result.sourceBytes += record.bytes;
    if (duplicates.has(record.sha256)) result.duplicateBytes += record.bytes;
    duplicates.add(record.sha256);
  }
  if (!apply) return result;
  if (!sources.length && !markers.length && existsSync(resolve(base, '.owners.json')) && !existsSync(resolve(base, '.centralization.pending.json'))) return result;
  assertReportProducersIdle(shared);
  const disk = statfsSync(shared); result.freeBytesBefore = disk.bavail * disk.bsize;
  if (result.freeBytesBefore < 7 * 1024 ** 3) throw Error('Report migration requires 2 GiB peak space plus 5 GiB headroom.');
  const dirty = git(shared, ['status', '--porcelain', '-z']).split('\0').filter(Boolean)
    .filter(row => !/^\?\? reports\/\.(?:edits|variants|views)(?:\/|$)/.test(row)).join('\0');
  const pending = resolve(base, '.centralization.pending.json');
  if (dirty && !existsSync(pending)) throw Error('Preserve existing library checkout changes before centralization.');
  if (dirty) {
    const allowed = new Set(['archive/index.json', 'reports/.centralization.pending.json', ...Object.keys(baseline), ...Object.values(baseline).map(entry => entry.stored)]);
    for (const row of dirty.split('\0').filter(Boolean)) {
      if (/^[RC]|^.[RC]/.test(row) || !allowed.has(row.slice(3))) throw Error(`Unrelated checkout changes must be preserved before resuming: ${row}`);
    }
  }
  // No nested links may enter any destination, including private evidence.
  for (const record of sources) checkedReportPath(shared, relative(shared, record.destination));
  const unchanged = file => {
    checkedReportPath(shared, relative(shared, file.path));
    const now = lstatSync(file.path);
    if (!now.isFile() || now.isSymbolicLink() || now.size !== file.bytes || now.mtimeMs !== file.mtime || now.ctimeMs !== file.ctime) throw Error(`Source changed during review: ${file.path}`);
  };
  sources.forEach(unchanged); markers.forEach(unchanged);
  mkdirSync(base, { recursive: true });
  const provenancePath = resolve(base, '.provenance.json');
  const previous = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : { schemaVersion: 1, sources: [] };
  const journal = existsSync(pending) ? JSON.parse(readFileSync(pending, 'utf8')) : { sources: [] };
  const provenance = new Map([...previous.sources, ...journal.sources, ...sources].map(item => [item.path, item]));
  atomicReportJSON(pending, { sources: [...provenance.values()] });
  excludeReportStorage(shared);
  const byDestination = new Map(); for (const record of sources) if (!byDestination.has(record.destination)) byDestination.set(record.destination, record);
  const retained = new Set();
  const moveOrVerify = record => {
    unchanged(record);
    if (reportDigest(readFileSync(record.path)) !== record.sha256) throw Error(`Source bytes changed: ${record.path}`);
    mkdirSync(dirname(record.destination), { recursive: true });
    if (!existsSync(record.destination)) { renameSync(record.path, record.destination); result.movedBytes += record.bytes; }
    else {
      if (!matchingReport(record.destination, record)) throw Error(`Destination contains different work: ${record.destination}`);
      if (!readFileSync(record.destination).equals(readFileSync(record.path))) throw Error('Retained original byte comparison failed');
      unlinkSync(record.path); result.deletedBytes += record.bytes;
    }
    if (!matchingReport(record.destination, record)) throw Error(`Relocated original verification failed: ${record.destination}`);
    retained.add(record.path);
  };
  // Replace tracked archive excerpts with full originals. Preserve any raw
  // baseline already installed by an interrupted migration.
  for (const [logical, entry] of Object.entries(baseline)) {
    const destination = checkedReportPath(base, logical.slice(8));
    if (matchingReport(destination, entry)) continue;
    if (existsSync(destination)) {
      const raw = readFileSync(destination), hash = reportDigest(raw);
      const baselineOwner = baselineOwners.get(logical);
      let historical;
      try { historical = execFileSync('git', [...gitOptions, 'show', `${baselineOwner.revision}:${logical}`], { cwd: shared, maxBuffer: Math.max(raw.length * 2, 16 * 1024 * 1024), stdio: ['pipe', 'pipe', 'pipe'] }); } catch { historical = null; }
      if (!historical?.equals(raw)) {
        const keep = checkedReportPath(base, `.variants/${hash}`); mkdirSync(dirname(keep), { recursive: true });
        if (!existsSync(keep)) renameSync(destination, keep); else if (readFileSync(keep).equals(raw)) unlinkSync(destination); else throw Error('Existing variant differs');
      } else unlinkSync(destination);
    }
    const candidate = byDestination.get(destination);
    if (candidate && !retained.has(candidate.path)) moveOrVerify(candidate);
    else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, decodeArchiveEntry(shared, entry, baselineOwners.get(logical).revision), { flag: 'wx' }); }
  }
  for (const record of sources) if (!retained.has(record.path)) moveOrVerify(record);
  assertReportProducersIdle(shared);
  // Store raw originals directly; keep compressed originals in historical Git
  // commits, and remove only formerly report-owned, now-unreferenced tree blobs.
  const indexPath = resolve(shared, 'archive/index.json'), index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const oldStored = new Set();
  for (const [logical, entry] of Object.entries(baseline)) {
    if (!matchingReport(checkedReportPath(base, logical.slice(8)), entry)) throw Error(`Missing canonical original: ${logical}`);
    oldStored.add(entry.stored); index.files[logical] = { ...entry, stored: logical, encoding: 'identity' };
  }
  const referenced = new Set(Object.values(index.files).map(entry => entry.stored));
  const retired = [...oldStored].filter(path => path.startsWith('archive/blobs/') && !referenced.has(path));
  const tracked = new Set(git(shared, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean));
  if (retired.length) {
    execFileSync('git', [...gitOptions, 'update-index', '--force-remove', '-z', '--stdin'], { cwd: shared, input: retired.join('\0') + '\0' });
    for (const path of retired) if (existsSync(safeChild(shared, path))) unlinkSync(safeChild(shared, path));
  }
  writeFileSync(indexPath, JSON.stringify(index) + '\n');
  execFileSync('git', [...gitOptions, 'add', '--sparse', '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: shared, input: ['archive/index.json', ...Object.keys(baseline)].join('\0') + '\0' });
  if (git(shared, ['diff', '--cached', '--name-only'])) execFileSync('git', [...gitOptions, '-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com', 'commit', '--only', '--pathspec-from-file=-', '--pathspec-file-nul', '-m', 'Centralize full report originals and preserve branch evidence'], {
    cwd: shared, input: ['archive/index.json', ...Object.keys(baseline), ...retired.filter(path => tracked.has(path))].join('\0') + '\0', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  const registry = { schemaVersion: 1, owners: Object.fromEntries(owners.map(owner => [owner.id, { revision: owner.checkout === shared ? git(shared, ['rev-parse', 'HEAD']) : owner.revision }])) };
  writeReportRegistry(root, registry);
  atomicReportJSON(provenancePath, { schemaVersion: 1, sources: [...provenance.values()] });
  setMetadataCheckout(shared);
  const remaining = git(shared, ['status', '--porcelain', '-z']).split('\0').filter(Boolean);
  if (remaining.some(row => row.slice(3) === 'archive/index.json' || row.slice(3).startsWith('reports/') || retired.includes(row.slice(3)))) throw Error('Task-owned data changes remain after report publication; preserve the recovery journal.');
  for (const owner of owners) {
    const mount = resolve(owner.app, 'reports');
    if (existsSync(mount)) {
      if (!lstatSync(mount).isSymbolicLink()) throw Error(`Existing report directory must be preserved: ${mount}`);
      const target = realpathSync(mount);
      if (target !== realpathSync(base)) {
        if (!target.startsWith(resolve(owner.checkout, '.working') + sep)) throw Error(`Unknown report mount must be preserved: ${mount}`);
        unlinkSync(mount);
      }
    }
    if (!existsSync(mount)) symlinkSync(base, mount, process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const file of markers) { unchanged(file); unlinkSync(file.path); }
  const removeEmpty = directory => {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory)) {
      const child = resolve(directory, name), stamp = lstatSync(child);
      if (stamp.isSymbolicLink()) throw Error(`Linked directory appeared during cleanup: ${child}`);
      if (stamp.isDirectory()) removeEmpty(child);
    }
    if (!readdirSync(directory).length) rmdirSync(directory);
  };
  for (const directory of directories) removeEmpty(directory);
  // All historical sources, including already moved journal entries, must still
  // have an exact retained copy before removing the recovery journal.
  for (const record of provenance.values()) if (!matchingReport(record.destination, record)) throw Error(`Provenance original missing: ${record.destination}`);
  unlinkSync(pending);
  result.preservedFiles = provenance.size;
  const after = statfsSync(shared); result.freeBytesAfter = after.bavail * after.bsize; result.freeBytesDelta = result.freeBytesAfter - result.freeBytesBefore;
  return result;
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
    if (record.revision !== item.name || record.schema !== 'pando-shared-runtime-v1') continue;
    // Private WIP is never eligible for retirement. Do not hash its entire
    // runtime dataset merely to reach that already-known preservation result.
    if (Object.values(record.files).some(entry => entry.storage !== 'shared')) continue;
    if (libraryWriteLeases(librarySharedCheckout(root)).some(lease => lease.alive && lease.view === directory)) continue;
    if (pristineCache(directory, record.files)) removeRuntimeView(librarySharedCheckout(root), directory, record);
  }
  lastRetirementSignature = signature;
}
export function safeChild(root, path) {
  const target = resolve(root, path), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error(`Unsafe library path: ${path}`);
  return target;
}
export function decodeArchiveEntry(checkout, entry, revision = null, {fetch=false}={}) {
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
    stored = execFileSync('git', [...gitOptions, 'show', revision + ':' + entry.stored], { cwd: checkout, env: { ...process.env, GIT_NO_LAZY_FETCH: fetch?'0':'1' }, maxBuffer: Math.max(entry.bytes * 2, 16 * 1024 * 1024), stdio:['pipe','pipe','pipe'] });
  }
  return decode(stored);
}
export function prepareLibraryData({ root = defaultRoot, fetch = true } = {}) {
  return withLibraryLock(root, () => prepareOwnedLibraryData({ root, fetch }));
}
export function withLibraryLock(root, operation, { maintenance = false, organizing = false } = {}) {
  const lockPath = resolve(root, '.library-data/prepare.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  let lock;
  try { discardDeadLibraryLock(lockPath); lock = openSync(lockPath, 'wx'); }
  catch (error) { throw Error('Library preparation is already running; preserve its outputs and retry after it finishes.', { cause: error }); }
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, root })); return withCheckoutLock(libraryCheckout(root), operation, maintenance, organizing); }
  finally { closeSync(lock); unlinkSync(lockPath); }
}
function withCheckoutLock(checkout, operation, maintenance = false, organizing = false) {
  if (!existsSync(resolve(checkout, '.git'))) return operation();
  const common = resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir']));
  const path = resolve(common, 'pando-library.lock');
  let handle;
  try { discardDeadLibraryLock(path); handle = openSync(path, 'wx'); }
  catch (error) { throw Error('Library storage is already running in another worktree; retry after it finishes.', { cause: error }); }
  try {
    writeFileSync(handle, JSON.stringify({ pid: process.pid, checkout })); recoverContentPermissions(dirname(common));
    if (!maintenance && existsSync(resolve(dirname(common), '.pando-store/storage-migration.pending.json'))) throw Error('Library storage migration must resume before preparing or editing data.');
    if (!organizing && existsSync(resolve(dirname(common), '.pando-store/report-organization.pending.json'))) throw Error('Report organization must resume before preparing or editing data.');
    return operation();
  }
  finally { closeSync(handle); unlinkSync(path); }
}
export function discardDeadLibraryLock(path) {
  if(!existsSync(path))return false;
  const before=lstatSync(path,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink())return false;
  let owner;
  try{owner=JSON.parse(readFileSync(path,'utf8'));}catch{return false;}
  if(!Number.isInteger(owner.pid)||owner.pid<=0||!(typeof owner.root==='string'||typeof owner.checkout==='string'))return false;
  try{process.kill(owner.pid,0);return false;}catch(error){if(error.code!=='ESRCH')return false;}
  const after=lstatSync(path,{bigint:true});
  if(before.ino!==after.ino||before.mtimeNs!==after.mtimeNs||before.size!==after.size)return false;
  unlinkSync(path);return true;
}

const sparseMetadata = ['/*', '!/*/', '/archive/', '!/archive/*', '/archive/index.json'];
function setMetadataCheckout(checkout,{fetch=false}={}) {
  const shared = dirname(resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir'])));
  const keepReports = checkout === shared && existsSync(resolve(shared, 'reports/.owners.json'));
  const patterns=[...sparseMetadata],directories=new Set();
  const literal=path=>path.replace(/[\\*?[\]]/g,'\\$&');
  const includeDirectory=path=>{if(directories.has(path))return;const parent=path.slice(0,path.lastIndexOf('/'));if(parent)includeDirectory(parent);directories.add(path);patterns.push('/'+literal(path)+'/','!/'+literal(path)+'/*');};
  if(keepReports)for(const file of plainReportFiles(resolve(shared,'reports'))){
    if(file.logical.startsWith('.'))continue;
    const path='reports/'+file.logical;includeDirectory(path.slice(0,path.lastIndexOf('/')));patterns.push('/'+literal(path));
  }
  execFileSync('git', [...gitOptions, 'sparse-checkout', 'set', '--no-cone', '--stdin'], {
    cwd: checkout, env:{...process.env,GIT_NO_LAZY_FETCH:fetch?'0':'1'}, input: patterns.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'],
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
export function materializeRuntimeView({ root, index, source = null, fetch=false }) {
  const shared = librarySharedCheckout(root), config = libraryConfig(root), owner = libraryOwnerId(root), view = libraryMaterializedRoot(root);
  const marker = resolve(view, '.complete'), manifest = resolve(view, '.cache-owner.json');
  if (existsSync(marker)) {
    const record = JSON.parse(readFileSync(manifest, 'utf8'));
    if (record.schema !== 'pando-shared-runtime-v1' || record.owner !== owner || record.revision !== config.revision) throw Error('Unexpected runtime view ownership');
    return view;
  }
  if (existsSync(view)) throw Error(`Incomplete runtime view must be preserved: ${view}`);
  source ||= resolve(shared, '.pando-cache/materialized', config.revision);
  const sourceFiles=contentFiles(source).map(file=>({...file,sha256:contentHash(readFileSync(file.path))}));
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
    if (existsSync(previous)) {
      if (!lstatSync(previous).isFile() || lstatSync(previous).isSymbolicLink()) throw Error(`Unexpected old runtime source: ${previous}`);
      write(logical, readFileSync(previous), entry);
    } else write(logical, decodeArchiveEntry(libraryCheckout(root), entry, config.revision,{fetch}), entry);
  }
  if (existsSync(source)) for (const file of sourceFiles) {
    if (['.complete', '.cache-owner.json'].includes(file.logical) || files[file.logical]) continue;
    write(file.logical, readFileSync(file.path));
  }
  atomicStorageJSON(resolve(pending, '.cache-owner.json'), { schema: 'pando-shared-runtime-v1', owner, revision: config.revision, files });
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
// Maintenance reconciliation only; ordinary preparation does not rehash the
// entire runtime. Raw edits to an already private file remain protected WIP.
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
const scopesOverlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
export function beginLibraryWrite({ root = defaultRoot, prefixes, pid = process.pid } = {}) {
  return withLibraryLock(root, () => {
    const config = libraryConfig(root), shared = librarySharedCheckout(root), owner = libraryOwnerId(root);
    if (!Number.isInteger(pid) || pid <= 0 || !Array.isArray(prefixes) || !prefixes.length || prefixes.some(path => typeof path !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(p => p === '.' || p === '..' || p.startsWith('.')) || !config.mounts.some(mount => mount !== 'reports' && (path === mount || path.startsWith(mount + '/'))))) throw Error('Explicit valid runtime write prefixes are required');
    const view = libraryMaterializedRoot(root);
    if (!existsSync(resolve(view, '.complete'))) prepareOwnedLibraryData({ root, fetch: false });
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
// Output paths outside a configured mount (unit fixtures or staging folders)
// are ordinary private files. Mounted outputs require the canonical lease.
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
// The cleanup orchestrator invokes this only while holding withLibraryLock.
export function prepareOwnedLibraryData({ root, fetch }) {
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
  const materialized = materializeRuntimeView({ root, index, fetch });
  const reportRoot = libraryReportRoot(root);
  if (existsSync(resolve(checkout, '.working/report-owner.json'))) throw Error('Centralize existing report originals with --centralize-reports --apply before preparing data.');
  mkdirSync(reportRoot, { recursive: true });
  reportContext(root); // Metadata only; report editions stay independent of the runtime pin.
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
  retireOwnedCaches(root, materialized);
  const compaction = compactOwnedCheckout(checkout, true);
  return { repository: config.repository, revision: config.revision, checkout, materialized, files: index.files, compaction };
}

function organizationTree(shared, revision) {
  return git(shared, ['ls-tree', '-rz', revision]).split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'), [mode, type, oid] = row.slice(0, tab).split(' ');
    if (type !== 'blob') throw Error('Unexpected report tree entry');
    return { mode, oid, path: row.slice(tab + 1) };
  });
}
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
  const reportFiles = tree.filter(x => x.path.startsWith('reports/')), entries = {}, updated = new Map(), documents = {};
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
      if (item.path.endsWith('.md')) documents[item.path] = original.toString('utf8');
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
      if (path.endsWith('.md')) documents[path] = original.toString('utf8');
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
  for (const [path, text] of Object.entries(reportSubjectReadmes([...updated.keys()], reportDocumentDetails(documents, mapping)))) {
    const bytes = Buffer.from(text); updated.set(path, { path, mode: '100644', oid: blob(bytes) });
    entries[path] = { stored: path, encoding: 'identity', sha256: reportDigest(bytes), bytes: bytes.length };
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
      for (const path of Object.keys(reportSubjectReadmes([]))) {
        const bytes = execFileSync('git', [...gitOptions, 'show', `${journal.revision}:${path}`], { cwd: shared, maxBuffer: 4 * 1024 * 1024 });
        const output = checkedReportPath(shared, path); clearReplacementTemps(output, reportDigest(bytes)); mkdirSync(dirname(output), { recursive: true }); replaceLibraryFile(shared, output, bytes); shareContentFile(shared, output);
      }
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

function assertReportSubject(root, path) {
  const layout = reportRegistry(root).reportLayout || JSON.parse(git(librarySharedCheckout(root), ['show', `${reportMainRevision(root)}:archive/index.json`])).reportLayout;
  if (layout !== 'subjects-v1') return;
  const subject = path.slice(8).split('/')[0];
  if (!Object.hasOwn(REPORT_SUBJECTS, subject) && !['README.md', 'TEMPLATE.md'].includes(subject)) throw Error(`Use a canonical report subject; obsolete path: ${path}`);
}
function reportWorkingFiles(root, prefixes) {
  if (!Array.isArray(prefixes) || !prefixes.length || prefixes.some(path => typeof path !== 'string'
    || !/^reports\/[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part.startsWith('.')))) {
    throw Error('Report completion requires explicit reports/<scope> prefixes.');
  }
  const files = new Map();
  for (const prefix of prefixes) {
    assertReportSubject(root, prefix);
    const scope = checkedReportPath(libraryReportEditRoot(root), prefix.slice(8));
    const scoped = plainReportFiles(scope);
    if (!scoped.length) throw Error(`Empty or missing report scope: ${prefix}`);
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
function checkOwnedReports(root, prefixes) {
  const files = reportWorkingFiles(root, prefixes), shared = librarySharedCheckout(root), revision = fetchReportMain(shared);
  const index = JSON.parse(git(shared, ['show', `${revision}:archive/index.json`], { allowFetch: true }));
  for (const file of files) {
    const entry = index.files[file.logical];
    if (!entry || entry.sha256 !== file.sha256 || entry.bytes !== file.bytes) throw Error(`Report is not published with its current original: ${file.logical}`);
    safeChild(shared, entry.stored);
    const stored = execFileSync('git', [...gitOptions, 'show', `${revision}:${entry.stored}`], { cwd: shared, env: { ...process.env, GIT_NO_LAZY_FETCH: '0' }, maxBuffer: Math.max(entry.bytes * 2, 16 * 1024 * 1024), stdio: ['pipe', 'pipe', 'pipe'] });
    if (!['identity', 'gzip'].includes(entry.encoding)) throw Error(`Unknown report archive encoding: ${file.logical}`);
    const bytes = entry.encoding === 'gzip' ? gunzipSync(stored) : stored;
    if (bytes.length !== file.bytes || reportDigest(bytes) !== file.sha256) throw Error(`Remote report content is corrupt or mismatched: ${file.logical}`);
  }
  return { revision, files: files.length, prefixes };
}
// Task completion is scoped and explicit. Merely requesting a writable path
// must never publish a partially written report or unrelated runtime work.
export function publishLibraryReports({ root = defaultRoot, prefixes } = {}) {
  return withLibraryLock(root, () => {
    reportWorkingFiles(root, prefixes);
    const data = prepareReportPublication(root, prefixes);
    storeOwnedLibraryData({ root, prefixes, removePaths: [], push: true, reportData: data });
    return checkOwnedReports(root, prefixes);
  });
}
export function checkLibraryReports({ root = defaultRoot, prefixes } = {}) {
  return withLibraryLock(root, () => checkOwnedReports(root, prefixes));
}

// App-owned writers store their output here; the data repository runs no tools.
export function storeLibraryData({ root = defaultRoot, push = false, prefixes = null, removePaths = [] } = {}) {
  if (!prefixes?.length) throw Error("Storage requires explicit library prefixes.");
  for (const path of prefixes) if (path === 'reports' || path.startsWith('reports/')) assertReportSubject(root, path);
  return withLibraryLock(root, () => storeOwnedLibraryData({ root, push, prefixes, removePaths }));
}
// Advance selected report scopes only. Runtime stores and another report's
// publication must not replace this branch's independent archived editions.
function recordReportOwner(root, source, paths) {
  const shared = librarySharedCheckout(root), registry = reportRegistry(root), owner = libraryOwnerId(root);
  const previous = registry.owners[owner]?.revision || source;
  let revision = source;
  if (previous !== source) {
    const selected = new Set(paths), included = path => selected.has(path);
    const before = JSON.parse(git(shared, ['show', `${previous}:archive/index.json`]));
    const after = JSON.parse(git(shared, ['show', `${source}:archive/index.json`]));
    const files = Object.fromEntries(Object.entries(before.files).filter(([path]) => !included(path)));
    for (const [path, entry] of Object.entries(after.files)) if (included(path)) files[path] = entry;
    const bytes = Buffer.from(JSON.stringify({ ...before, reportLayout: after.reportLayout || before.reportLayout, files }) + '\n');
    const oid = execFileSync('git', [...gitOptions, 'hash-object', '-w', '--stdin'], { cwd: shared, input: bytes, encoding: 'utf8' }).trim();
    const scratch = resolve(shared, '.pando-store/report-owner.index'), env = { ...process.env, GIT_INDEX_FILE: scratch, GIT_NO_LAZY_FETCH: '1' };
    mkdirSync(dirname(scratch), { recursive: true });
    const indexGit = args => execFileSync('git', [...gitOptions, ...args], { cwd: shared, env, encoding: 'utf8', stdio: 'pipe' }).trim();
    try {
      indexGit(['read-tree', previous]);
      const removed = organizationTree(shared, previous).filter(item => included(item.path)).map(item => `0 ${'0'.repeat(40)}\t${item.path}\0`);
      const added = organizationTree(shared, source).filter(item => included(item.path)).map(item => `${item.mode} ${item.oid}\t${item.path}\0`);
      execFileSync('git', [...gitOptions, 'update-index', '-z', '--index-info'], { cwd: shared, env, input: [...removed, ...added, `100644 ${oid}\tarchive/index.json\0`].join(''), stdio: 'pipe' });
      const tree = indexGit(['write-tree']);
      revision = tree === git(shared, ['rev-parse', `${previous}^{tree}`]) ? previous : git(shared, ['-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com', 'commit-tree', tree, '-p', previous, '-m', 'Record selected report editions']);
    } finally { if (existsSync(scratch)) unlinkSync(scratch); }
  }
  git(shared, ['update-ref', `refs/pando/reports/${owner}`, revision]);
  registry.owners[owner] = { revision }; writeReportRegistry(root, registry);
}
export function storeNativeLibraryObjects({libraryIndex,previousLibrary,previousIndex,readChunk,put}) {
  const previous=new Map(previousIndex.entities.map(entry=>[entry.entityId,entry.sha256])),entities={};
  for(const entry of libraryIndex.entities){
    const old=previousLibrary.entities?.[entry.entityId];
    if(old&&previous.get(entry.entityId)===entry.sha256){entities[entry.entityId]=old;continue;}
    const bytes=Buffer.from(JSON.stringify(JSON.parse(gunzipSync(readChunk(entry))))+'\n');
    const hash=contentHash(bytes);put(`objects/${hash}.json`,bytes);entities[entry.entityId]=hash;
  }
  return entities;
}
function storeOwnedLibraryData({ root, push, prefixes, removePaths, reportData }) {
  const data = reportData || prepareOwnedLibraryData({ root, fetch: true });
  if (libraryWriteLeases(librarySharedCheckout(root)).some(lease => lease.alive && lease.owner === libraryOwnerId(root) && lease.prefixes.some(a => prefixes.some(b => scopesOverlap(a, b))))) throw Error('Finish the active library write lease before storing this scope');
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
    replaceLibraryFile(librarySharedCheckout(root), output, bytes);
    if (path.startsWith('reports/') && data.checkout === librarySharedCheckout(root)) shareContentFile(librarySharedCheckout(root), output);
    changed.add(path);
  };
  const store = (path, bytes) => {
    const sha256 = digest(bytes);
    const isReport = path.startsWith('reports/');
    if (index.files[path]?.sha256 === sha256 && (!isReport || index.files[path].stored === path)) return;
    const packed = isReport ? bytes : gzipSync(bytes, { level: 9 });
    // Pages overlays these public paths with git archive, independently of a
    // branch's runtime pin. They must remain present in the Git tree.
    const direct = isReport || path.startsWith('assets/data/library-channel/')
      || path.startsWith('assets/data/library-releases/') || runtimeDirectories.has(dirname(path));
    const identity = direct || packed.length >= bytes.length;
    const stored = direct ? path : `archive/blobs/${sha256}.${identity ? 'bin' : 'gz'}`;
    put(stored, identity ? bytes : packed);
    index.files[path] = { stored, encoding: identity ? 'identity' : 'gzip', sha256, bytes: bytes.length };
  };
  if (removePaths.some(path => !included(path) || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part === '..' || part === '.'))) throw Error('Invalid explicit library deletion.');
  const editRoot = resolve(libraryReportRoot(root), '.edits', libraryOwnerId(root));
  for (const path of removePaths) if (path.startsWith('reports/') && existsSync(safeChild(editRoot, path.slice(8)))) {
    throw Error(`Preserve or remove the working original before archiving its deletion: ${path}`);
  }
  const removed = new Set(removePaths);
  const seen = new Set();
  const visit = (directory, prefix) => {
    if (!traversable(prefix) || !existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (prefix === 'reports' && entry.name.startsWith('.')) continue;
      const path = prefix + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error(`Unexpected nested library link: ${path}`);
      if (entry.isDirectory()) visit(resolve(directory, entry.name), path);
      else if (entry.isFile() && included(path) && !removed.has(path)) { seen.add(path); store(path, readFileSync(resolve(directory, entry.name))); }
    }
  };
  const managedMounts = libraryConfig(root).mounts.filter(path => path !== 'reports');
  if (!reportData) for (const path of managedMounts) visit(safeChild(data.materialized, path), path);
  // Store only this branch's mutable scope. Shared originals from another
  // branch must never be implicitly imported into a branch publication.
  visit(editRoot, 'reports');
  for (const [path, entry] of Object.entries(index.files)) {
    if (path.startsWith('reports/') && !removed.has(path)) continue;
    if (!included(path) || !(path.startsWith('reports/') || managedMounts.some(mount => path.startsWith(mount + '/'))) || seen.has(path)) continue;
    delete index.files[path];
    if (entry.stored === path || path.startsWith('reports/')) {
      if (existsSync(safeChild(data.checkout, path))) removeContentLink(librarySharedCheckout(root),safeChild(data.checkout, path));
      // A sparse path may have no physical copy but still needs index removal.
      if (git(data.checkout, ['ls-files', '--', path])) git(data.checkout, ['update-index', '--force-remove', '--', path]);
    }
  }
  // The existing native source schema remains the only editable library format.
  if (storeNativeObjects) {
  const indexBytes = readFileSync(resolve(data.materialized, 'assets/data/territorial-entities/generated/v2/index.json'));
  const libraryIndex = JSON.parse(indexBytes), previousLibrary=JSON.parse(readFileSync(resolve(data.checkout,'library.json')));
  const previousIndex=previousLibrary.indexHash?JSON.parse(git(data.checkout,['show',`HEAD:objects/${previousLibrary.indexHash}.json`],{allowFetch:true})):{entities:[]};
  const source = { schemaVersion: 1, indexHash: digest(indexBytes), entities: storeNativeLibraryObjects({libraryIndex,previousLibrary,previousIndex,
    readChunk:entry=>readFileSync(resolve(data.materialized,'assets/data/territorial-entities/generated/v2',entry.file)),put}) };
  put(`objects/${source.indexHash}.json`, indexBytes);
  put('library.json', Buffer.from(JSON.stringify(source) + '\n'));
  }
  index.sourceRevision = git(root, ['rev-parse', 'HEAD']);
  put('archive/index.json', Buffer.from(JSON.stringify(index) + '\n'));
  if (changed.size) execFileSync('git', [...gitOptions, '--literal-pathspecs', 'add', '--sparse', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    cwd: data.checkout, input: [...changed].join('\0') + '\0', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (git(data.checkout, ['diff', '--cached', '--name-only'])) git(data.checkout, ['-c', 'user.name=Pando library publisher', '-c', 'user.email=library-publisher@users.noreply.github.com', 'commit', '-m', `Store app-produced library material from ${index.sourceRevision}`]);
  const revision = git(data.checkout, ['rev-parse', 'HEAD']);
  const reportPaths = [...seen, ...removed].filter(path => path.startsWith('reports/'));
  if (reportPaths.length) recordReportOwner(root, revision, reportPaths);
  const compaction = compactOwnedCheckout(data.checkout, true);
  if (compaction.status !== 'compacted') throw Error(`Stored library checkout could not be compacted: ${compaction.reason}`);
  if (push) {
    const token = process.env.PANDOLAB_LIBRARY_WRITE_TOKEN;
    const env = token ? { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:' + token).toString('base64')}` } : process.env;
    execFileSync('git', [...gitOptions, 'push', 'origin', `HEAD:${reportData ? 'main' : index.branch}`], { cwd: data.checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  if (!prefixes.every(path => path === 'reports' || path.startsWith('reports/'))) {
    const config = libraryConfig(root); config.revision = revision;
    writeFileSync(resolve(root, 'config/library-data.json'), JSON.stringify(config, null, 2) + '\n');
  }
  return revision;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--begin-write' || process.argv[2] === '--end-write' || process.argv[2] === '--with-write') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    if (process.argv[2] === '--end-write') endLibraryWrite({ root, id: process.argv.find(arg => arg.startsWith('--lease-id='))?.slice(11) });
    else {
      const prefixes = process.argv.filter(arg => arg.startsWith('--include-prefix=')).map(arg => arg.slice(17));
      if (process.argv[2] === '--begin-write') console.log(JSON.stringify(beginLibraryWrite({ root, prefixes, pid: Number(process.argv.find(arg => arg.startsWith('--writer-pid='))?.slice(13) || process.pid) })));
      else {
        const at = process.argv.indexOf('--'); if (at < 0 || at === process.argv.length - 1) throw Error('A scoped writer command is required');
        let status = 0;
        withLibraryWrite({ root, prefixes }, lease => { try { execFileSync(process.argv[at + 1], process.argv.slice(at + 2), { cwd: root, stdio: 'inherit', env: { ...process.env, PANDOLAB_LIBRARY_WRITE_LEASE: lease.id } }); } catch (error) { status = error.status || 1; } });
        process.exitCode = status;
      }
    }
  } else if (process.argv[2] === '--organize-reports') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    console.log(JSON.stringify(organizeLibraryReports({ root, apply: process.argv.includes('--apply') })));
  } else if (process.argv[2] === '--centralize-reports') {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    console.log(JSON.stringify(centralizeLibraryReports({ root, apply: process.argv.includes('--apply') })));
  } else if (process.argv[2] === '--report-edit-root') {
    console.log(libraryReportEditRoot(process.argv[3] || defaultRoot));
  } else if (process.argv[2] === '--report-root') {
    console.log(libraryReportRoot(process.argv[3] || defaultRoot));
  } else {
  const prefixes = process.argv.filter(arg => arg.startsWith('--include-prefix=')).map(arg => arg.slice('--include-prefix='.length));
  if (process.argv.includes('--publish-reports') || process.argv.includes('--check-reports')) {
    const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || defaultRoot;
    const operation = process.argv.includes('--publish-reports') ? publishLibraryReports : checkLibraryReports;
    console.log(JSON.stringify(operation({ root, prefixes })));
  } else {
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
}
