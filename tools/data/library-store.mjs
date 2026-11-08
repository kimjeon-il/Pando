import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {gunzipSync,gzipSync} from "node:zlib";
import {contentHash,removeContentLink,replaceLibraryFile,shareContentFile} from "./library-content.mjs";
import {assertHistoricalStorageChanges} from "../gis/historical-display-storage.mjs";
import {readBuiltinCountryStoredBytes} from "./builtin-country-bytes.mjs";
import {runtimeArchiveIndex} from "./library-runtime-index.mjs";
import {defaultRoot,gitOptions,git,libraryConfig,libraryReportRoot,librarySharedCheckout,libraryOwnerId,safeChild,decodeArchiveEntry,withLibraryLock,organizationTree} from "./library-context.mjs";
import {reportRegistry,writeReportRegistry,checkedReportPath,assertReportSubject} from "./library-reports.mjs";
import {compactOwnedCheckout,libraryWriteLeases,scopesOverlap,prepareOwnedLibraryData} from "./library-runtime.mjs";

function validateExpectedLibraryRevision(expectedRevision) {
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{40}$/.test(expectedRevision))) {
    throw Error('Expected library revision must be a 40-character lowercase hexadecimal SHA.');
  }
}

function validateExpectedBranch(expectedBranch) {
  if (expectedBranch !== undefined && !['main', 'work/gis'].includes(expectedBranch)) throw Error('Expected library branch must be main or work/gis.');
}

export function libraryPublicationRef(branch) {
  // A new work branch must use a fully qualified refs/heads destination.
  // Refuse unexpected names rather than relying on Git's destination guessing.
  if (typeof branch !== 'string' || !/^(?:main|work\/[a-z0-9][a-z0-9-]{0,63})$/.test(branch))
    throw Error('P2_LIBRARY_PUBLISH_BRANCH_INVALID: '+String(branch));
  return 'refs/heads/'+branch;
}

export function assertExpectedLibraryRevision({ expectedRevision, expectedBranch, branch, head, remote }) {
  validateExpectedBranch(expectedBranch);
  if (expectedBranch !== undefined && branch !== expectedBranch) throw Error('Library checkout branch differs from expected branch.');
  validateExpectedLibraryRevision(expectedRevision);
  if (expectedRevision === undefined) return;
  if (head !== expectedRevision) throw Error('Library checkout HEAD differs from the expected revision; regenerate against the latest data before storing.');
  if (remote !== expectedRevision) throw Error(`Library remote ${expectedBranch || 'work/gis'} differs from the expected revision; regenerate against the latest data before storing.`);
}

export function storeLibraryData({ root = defaultRoot, push = false, prefixes = null, removePaths = [], expectedRevision, expectedBranch } = {}) {
  validateExpectedLibraryRevision(expectedRevision);
  validateExpectedBranch(expectedBranch);
  if (!prefixes?.length) throw Error("Storage requires explicit library prefixes.");
  for (const path of prefixes) if (path === 'reports' || path.startsWith('reports/')) assertReportSubject(root, path);
  return withLibraryLock(root, () => storeOwnedLibraryData({ root, push, prefixes, removePaths, expectedRevision, expectedBranch }));
}

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

export function assertTerritorialStorageScope(prefixes,libraryIndex,previousIndex,{readLineage}={}) {
  const base='assets/data/territorial-entities',included=path=>prefixes.some(prefix=>path===prefix||path.startsWith(prefix+'/'));
  if(included(base))return;
  if(!included(base+'/generated/v2/index.json'))throw Error('Scoped territorial storage requires the paired index');
  const previous=new Map(previousIndex.entities.map(row=>[row.entityId,row])),next=new Map(libraryIndex.entities.map(row=>[row.entityId,row]));
  if(next.size!==libraryIndex.entities.length||[...previous.keys()].some(id=>!next.has(id)))throw Error('Scoped territorial storage cannot remove or duplicate catalog membership');
  const additions=libraryIndex.entities.filter(row=>!previous.has(row.entityId));
  for(const entry of libraryIndex.entities)if(previous.get(entry.entityId)?.sha256!==entry.sha256) {
    if(!included(base+'/generated/v2/'+entry.file)||!included(base+'/source/countries/'+entry.entityId.replace(':','-')+'.json'))
      throw Error('Scoped territorial storage requires source, chunk and index together: '+entry.entityId);
  }
  const oldLineages=new Map((previousIndex.lineages||[]).map(row=>[row.lineageId,row])),lineages=new Map((libraryIndex.lineages||[]).map(row=>[row.lineageId,row]));
  const lineageChanged=JSON.stringify(libraryIndex.lineages||[])!==JSON.stringify(previousIndex.lineages||[]);
  if(additions.length||lineageChanged){
    if(lineages.size!==(libraryIndex.lineages||[]).length||[...oldLineages.keys()].some(id=>!lineages.has(id)))throw Error('Scoped registration cannot remove or duplicate a lineage');
    const members=new Set();
    for(const lineage of lineages.values()){
      if(!Array.isArray(lineage.entityRefs)||!lineage.entityRefs.length)throw Error('Scoped registration requires lineage membership');
      for(const id of lineage.entityRefs){if(members.has(id)||next.get(id)?.lineageId!==lineage.lineageId)throw Error('Invalid scoped lineage membership: '+id);members.add(id);}
      const old=oldLineages.get(lineage.lineageId);
      if(old&&(old.entityRefs.some(id=>!lineage.entityRefs.includes(id))||JSON.stringify({...old,entityRefs:[]})!==JSON.stringify({...lineage,entityRefs:[]})))throw Error('Scoped registration must preserve existing lineage metadata and members');
      if(JSON.stringify(old)!==JSON.stringify(lineage)){
        if(!included(base+'/source/lineages/'+lineage.lineageId+'.json')||typeof readLineage!=='function'||JSON.stringify(readLineage(lineage.lineageId))!==JSON.stringify(lineage))throw Error('Scoped registration requires the exact paired lineage source: '+lineage.lineageId);
      }
    }
    if(members.size!==next.size)throw Error('Scoped registration has orphan lineage members');
  }
  if(JSON.stringify(libraryIndex.snapshots||[])!==JSON.stringify(previousIndex.snapshots||[]))throw Error('Scoped registration cannot change reference snapshots');
  if(JSON.stringify(libraryIndex.views||[])!==JSON.stringify(previousIndex.views||[])&&!included(base+'/source/views/world.json'))throw Error('Scoped territorial storage requires paired world view source');
  for(const prefix of prefixes.filter(path=>path.startsWith(base+'/source/'))) {
    if(prefix===base+'/source/views/world.json'){
      if(!Array.isArray(libraryIndex.views)||libraryIndex.views.length!==1||libraryIndex.views[0].id!=='world:catalog')throw Error('Scoped territorial storage requires a supported world view');
      continue;
    }
    if(prefix.startsWith(base+'/source/lineages/')){
      const lineage=[...lineages.values()].find(row=>prefix===base+'/source/lineages/'+row.lineageId+'.json');
      if(!lineage||typeof readLineage!=='function'||JSON.stringify(readLineage(lineage.lineageId))!==JSON.stringify(lineage))throw Error('Scoped registration requires an exact lineage source');
      continue;
    }
    const entry=libraryIndex.entities.find(row=>prefix===base+'/source/countries/'+row.entityId.replace(':','-')+'.json');
    if(!entry||!included(base+'/generated/v2/'+entry.file))throw Error('Scoped territorial storage requires explicit paired source files');
  }
}

export function libraryWriteGitEnvironment(token, base = process.env) {
  if (!token) return base;
  const raw = base.GIT_CONFIG_COUNT ?? '0';
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || Number(raw) > 1024) throw Error('Invalid inherited Git configuration count');
  const count = Number(raw);
  return { ...base, GIT_CONFIG_COUNT: String(count + 2),
    [`GIT_CONFIG_KEY_${count}`]: 'http.https://github.com/.extraheader', [`GIT_CONFIG_VALUE_${count}`]: '',
    [`GIT_CONFIG_KEY_${count + 1}`]: 'http.https://github.com/.extraheader',
    [`GIT_CONFIG_VALUE_${count + 1}`]: `AUTHORIZATION: basic ${Buffer.from('x-access-token:' + token).toString('base64')}` };
}

export function runtimeStoreIndex(pinned, current) {
  return { ...pinned, files: {
    ...Object.fromEntries(Object.entries(pinned.files).filter(([path]) => !path.startsWith('reports/'))),
    ...Object.fromEntries(Object.entries(current.files).filter(([path]) => path.startsWith('reports/'))),
  } };
}

export function storeOwnedLibraryData({ root, push, prefixes, removePaths, reportData, expectedRevision, expectedBranch }) {
  const data = reportData || prepareOwnedLibraryData({ root, fetch: true });
  if (expectedRevision !== undefined) {
    // Check after preparation/fetch and before mutating archived data. A later
    // concurrent publication is still rejected by the normal non-force push.
    const token = process.env.PANDOLAB_LIBRARY_WRITE_TOKEN;
    const env = libraryWriteGitEnvironment(token);
    const remote = execFileSync('git', [...gitOptions, 'ls-remote', '--exit-code', 'origin', `refs/heads/${expectedBranch || 'work/gis'}`], { cwd: data.checkout, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\s+/)[0];
    assertExpectedLibraryRevision({ expectedRevision, expectedBranch, branch: git(data.checkout, ['branch', '--show-current']), head: git(data.checkout, ['rev-parse', 'HEAD']), remote });
  }
  if (libraryWriteLeases(librarySharedCheckout(root)).some(lease => lease.alive && lease.owner === libraryOwnerId(root) && lease.prefixes.some(a => prefixes.some(b => scopesOverlap(a, b))))) throw Error('Finish the active library write lease before storing this scope');
  if (git(data.checkout, ['status', '--porcelain'])) throw Error('Preserve existing data checkout edits before storing library material.');
  if (prefixes && (!Array.isArray(prefixes) || !prefixes.length || prefixes.some(path =>
    typeof path !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part === '..' || part === '.')
      || !libraryConfig(root).mounts.some(mount => path === mount || path.startsWith(mount + '/'))))) throw Error('Invalid library storage prefixes.');
  const included = path => !prefixes || prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'));
  const traversable = path => included(path) || prefixes.some(prefix => prefix.startsWith(path + '/'));
  const storeNativeObjects = !prefixes || prefixes.some(path=>path==='assets/data/territorial-entities'||path.startsWith('assets/data/territorial-entities/'));
  let nativeStore;
  if(storeNativeObjects) {
    const indexBytes=readFileSync(resolve(data.materialized,'assets/data/territorial-entities/generated/v2/index.json'));
    const runtimeRevision=libraryConfig(root).revision;
    const libraryIndex=JSON.parse(indexBytes),previousLibrary=JSON.parse(git(data.checkout,['show',`${runtimeRevision}:library.json`],{allowFetch:true}));
    const previousIndex=previousLibrary.indexHash?JSON.parse(git(data.checkout,['show',`${runtimeRevision}:objects/${previousLibrary.indexHash}.json`],{allowFetch:true})):{entities:[]};
    if(prefixes)assertTerritorialStorageScope(prefixes,libraryIndex,previousIndex,{readLineage:id=>JSON.parse(readFileSync(resolve(data.materialized,'assets/data/territorial-entities/source/lineages',id+'.json'),'utf8'))});
    nativeStore={indexBytes,libraryIndex,previousLibrary,previousIndex};
  }
  const reviewScopes=['assets/data/territorial-entities','assets/data/builtin-world'];
  if(prefixes.some(p=>reviewScopes.some(s=>p===s||p.startsWith(s+'/')||s.startsWith(p+'/')))){
    const revision=libraryConfig(root).revision,archived=JSON.parse(git(data.checkout,['show',revision+':archive/index.json'],{allowFetch:true})),oldBytes=p=>decodeArchiveEntry(data.checkout,archived.files[p],revision,{fetch:true}),newBytes=p=>readFileSync(resolve(data.materialized,p));
    const sourceBase='assets/data/territorial-entities/generated/v2/',countryBase='assets/data/builtin-world/generated/v1/';
    const sourceIndex=JSON.parse(newBytes(sourceBase+'index.json')),previousSourceIndex=JSON.parse(oldBytes(sourceBase+'index.json'));
    const builtinSelected=prefixes.some(p=>p==='assets/data/builtin-world'||p.startsWith('assets/data/builtin-world/')||'assets/data/builtin-world'.startsWith(p+'/'));
    const builtinIndex=builtinSelected?JSON.parse(newBytes(countryBase+'index.json')):{entities:[]},previousBuiltinIndex=builtinSelected?JSON.parse(oldBytes(countryBase+'index.json')):{entities:[]};
    const source=(entry,read)=>{const bytes=read(sourceBase+entry.file);if(contentHash(bytes)!==entry.sha256)throw Error('Historical source chunk hash mismatch: '+entry.entityId);const entity=JSON.parse(gunzipSync(bytes));if(entity.entityId!==entry.entityId)throw Error('Historical source identity mismatch');return entity;};
    const country=(entry,read)=>{const value=JSON.parse(gunzipSync(readBuiltinCountryStoredBytes(entry,file=>read(countryBase+file))));if(value.entityId!==entry.entityId)throw Error('Historical country identity mismatch');return value;};
    assertHistoricalStorageChanges({prefixes,sourceIndex,previousSourceIndex,builtinIndex,previousBuiltinIndex,readSource:e=>source(e,newBytes),readPreviousSource:e=>source(e,oldBytes),readCountry:e=>country(e,newBytes),readPreviousCountry:e=>country(e,oldBytes),sourceFileChanged:e=>{const p='assets/data/territorial-entities/source/countries/'+e.entityId.replace(':','-')+'.json';return prefixes.some(prefix=>p===prefix||p.startsWith(prefix+'/'))&&contentHash(newBytes(p))!==archived.files[p]?.sha256;},readRawSource:e=>JSON.parse(newBytes('assets/data/territorial-entities/source/countries/'+e.entityId.replace(':','-')+'.json')),countryFileChanged:e=>(e.parts||[e]).some(spec=>{const p=countryBase+spec.file;return prefixes.some(prefix=>p===prefix||p.startsWith(prefix+'/'))&&contentHash(newBytes(p))!==archived.files[p]?.sha256;})});
  }
  const indexPath = resolve(data.checkout, 'archive/index.json');
  // A runtime pin owns all unselected data inputs, independently of the
  // archive checkout's later report or other stored work.
  if(!reportData)try { git(data.checkout,['merge-base','--is-ancestor',libraryConfig(root).revision,'HEAD']); }
  catch(error){if(error.status!==1)throw error;throw Error('Integrate the pinned runtime data revision into this archive history before storing; preserve both histories.',{cause:error});}
  // Report-only storage extends the current archive, independently of the
  // runtime pin. Starting from that older pin would orphan earlier reports.
  const reportOnly = prefixes.every(path => path === 'reports' || path.startsWith('reports/'));
  const currentIndex = JSON.parse(readFileSync(indexPath,'utf8'));
  const index = reportData || reportOnly ? currentIndex : runtimeStoreIndex(JSON.parse(git(data.checkout,['show',`${libraryConfig(root).revision}:archive/index.json`],{allowFetch:true})), currentIndex);
  const runtimeFiles = reportData || reportOnly ? index.files : runtimeArchiveIndex(index, entry => decodeArchiveEntry(data.checkout, entry, libraryConfig(root).revision, {fetch:true})).files;
  const publicationBranch=reportData?'main':git(root,['symbolic-ref','--short','HEAD']);
  if(!publicationBranch)throw Error('Runtime publication requires an explicit application branch.');
  if (expectedBranch !== undefined && publicationBranch !== expectedBranch) throw Error('Application publication branch differs from expected branch.');
  index.branch=publicationBranch;
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
  const retiredReports = [...removed].filter(path => path.startsWith('reports/'));
  const trackedReports = retiredReports.length ? new Set(git(data.checkout, ['ls-files', '-z', '--', 'reports']).split('\0').filter(Boolean)) : new Set();
  for (const path of retiredReports) {
    const output = checkedReportPath(data.checkout, path);
    if ((existsSync(output) && (!lstatSync(output).isFile() || lstatSync(output).isSymbolicLink()))
      || [...trackedReports].some(file => file.startsWith(path + '/'))) throw Error(`Explicit report deletion must name a plain file: ${path}`);
  }
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
    if (path.startsWith('reports/')) continue;
    // A filtered archived asset is not a user deletion.
    if (!Object.hasOwn(runtimeFiles, path) && !removed.has(path)) continue;
    if (!included(path) || !(path.startsWith('reports/') || managedMounts.some(mount => path.startsWith(mount + '/'))) || seen.has(path)) continue;
    delete index.files[path];
    if (entry.stored === path || path.startsWith('reports/')) {
      if (existsSync(safeChild(data.checkout, path))) removeContentLink(librarySharedCheckout(root),safeChild(data.checkout, path));
      // A sparse path may have no physical copy but still needs index removal.
      if (git(data.checkout, ['ls-files', '--', path])) git(data.checkout, ['update-index', '--force-remove', '--', path]);
    }
  }
  for (const path of retiredReports) {
    delete index.files[path];
    const output = checkedReportPath(data.checkout, path);
    if (existsSync(output)) removeContentLink(librarySharedCheckout(root), output);
  }
  const trackedRetirements = retiredReports.filter(path => trackedReports.has(path));
  if (trackedRetirements.length) execFileSync('git', [...gitOptions, 'update-index', '-z', '--index-info'], {
    cwd: data.checkout, input: trackedRetirements.map(path => `0 ${'0'.repeat(40)}\t${path}\0`).join(''), stdio: ['pipe', 'pipe', 'pipe'],
  });
  // The existing native source schema remains the only editable library format.
  if (storeNativeObjects) {
  const {indexBytes,libraryIndex,previousLibrary,previousIndex}=nativeStore;
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
    const env = libraryWriteGitEnvironment(token);
    execFileSync('git', [...gitOptions, 'push', 'origin', `HEAD:${libraryPublicationRef(publicationBranch)}`], { cwd: data.checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const branch = publicationBranch;
    const remote = execFileSync('git', [...gitOptions, 'ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`], { cwd: data.checkout, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\s+/)[0];
    if (remote !== revision) throw Error('Library remote revision changed after push; preserve the stored commit and retry before advancing the pin.');
  }
  if (!prefixes.every(path => path === 'reports' || path.startsWith('reports/'))) {
    const config = libraryConfig(root); config.revision = revision;
    writeFileSync(resolve(root, 'config/library-data.json'), JSON.stringify(config, null, 2) + '\n');
  }
  return revision;
}
