import {execFileSync} from "node:child_process";
import {chmodSync,closeSync,copyFileSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmdirSync,statfsSync,symlinkSync,unlinkSync,writeFileSync} from "node:fs";
import {dirname,relative,resolve,sep} from "node:path";
import {REPORT_SUBJECTS} from "./library-report-layout.mjs";
import {makePrivate,removeContentLink,replaceLibraryFile,shareContentFile} from "./library-content.mjs";
import {defaultRoot,gitOptions,git,libraryCheckout,libraryReportRoot,librarySharedCheckout,reportDigest,libraryOwnerId,plainReportFiles,safeChild,decodeArchiveEntry,withLibraryLock,setMetadataCheckout} from "./library-context.mjs";

export function reportRegistry(root) {
  const path = resolve(libraryReportRoot(root), '.owners.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, owners: {} };
}

export function writeReportRegistry(root, registry) {
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

export function excludeReportStorage(shared) {
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

export function checkedReportPath(base, path) {
  const output = safeChild(base, path);
  for (let current = output; current !== base; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error(`Linked report path must be preserved: ${current}`);
  }
  return output;
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

export function hydrateReports({ root = defaultRoot, path, access } = {}) {
  assertReportSubject(root, 'reports/' + path);
  if (!['read', 'write'].includes(access)) throw Error('Report access must be read or write');
  checkedReportPath(libraryReportRoot(root), path);
  if (path.split(/[\\/]/).some(part => part.startsWith('.'))) throw Error('Unsafe reserved report path');
  return withLibraryLock(root, () => hydrateOwnedReports({ root, path, access }),{compact:false});
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

export function centralizeLibraryReports({ root = defaultRoot, apply = false } = {}) {
  const operation = () => centralizeOwnedReports(root, apply);
  return apply ? withLibraryLock(root, operation) : operation();
}

export function assertReportProducersIdle(shared = null) {
  if (process.platform !== 'win32') return;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(python|node|pandolab).*\\.exe$' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const parsed = output.trim() ? JSON.parse(output) : [], processes = Array.isArray(parsed) ? parsed : [parsed];
  const writers = processes.filter(item => {
    if (item.ProcessId === process.pid) return false;
    const command = item.CommandLine || '';
    if (/\.working[\\/]|reference-analysis[\\/](?:(?:train|macro|inspect-checkpoint|publisher|prepare-analysis-images)\.py|acquire-sources\.mjs)/i.test(command)) return true;
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

export function assertReportSubject(root, path) {
  const layout = reportRegistry(root).reportLayout || JSON.parse(git(librarySharedCheckout(root), ['show', `${reportMainRevision(root)}:archive/index.json`])).reportLayout;
  if (layout !== 'subjects-v1') return;
  const subject = path.slice(8).split('/')[0];
  if (!Object.hasOwn(REPORT_SUBJECTS, subject) && !['README.md', 'TEMPLATE.md'].includes(subject)) throw Error(`Use a canonical report subject; obsolete path: ${path}`);
}
