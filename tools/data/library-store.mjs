import {planSourceGeometryArchive} from './library-archive.mjs';
import {assertVerifiedScopedWorldRetirement} from '../build/build-scoped-world-retirement.mjs';
import {assertTerritorialRetirement,assertBuiltinRetirement,retirementDisplayPath,retirementWorldPath,verifiedMixedCurrentWorld} from '../gis/territorial-retirement.mjs';
import {isDeepStrictEqual} from 'node:util';
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {gunzipSync,gzipSync} from "node:zlib";
import {contentFiles,contentHash,removeContentLink,replaceLibraryFile,shareContentFile} from "./library-content.mjs";
import {assertHistoricalStorageChanges} from "../gis/historical-display-storage.mjs";
import {assertHistoricalSourceStorageChanges} from "../gis/historical-display-review.mjs";
import {readBuiltinCountry,readBuiltinCountryStoredBytes} from "./builtin-country-bytes.mjs";
import {decodeTerritorialSource} from './territorial-source-codec.mjs';
import {assertOriginalAuthoringSourceStorageChanges,assertTerritorialSourceResourceBytes} from './territorial-original-authoring.mjs';
import {defaultRoot,gitOptions,git,libraryConfig,libraryCheckout,libraryMaterializedRoot,libraryReportRoot,librarySharedCheckout,libraryOwnerId,safeChild,decodeArchiveEntry,withLibraryLock,organizationTree} from "./library-context.mjs";
import {reportRegistry,writeReportRegistry,checkedReportPath,assertReportSubject} from "./library-reports.mjs";
import {compactOwnedCheckout,libraryWriteLeases,scopesOverlap,prepareOwnedLibraryData,ownedMaterializedView} from "./library-runtime.mjs";

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

export function storeLibraryData({ root = defaultRoot, push = false, prefixes = null, removePaths = [], expectedRevision, expectedBranch, readPreviousCountry,readPreviousSource,retirement=null,worldRetirementFiles=null,materialized } = {}) {
  validateExpectedLibraryRevision(expectedRevision);
  if(retirement?.kind==='mixed-current-identity-retirement'){assertVerifiedScopedWorldRetirement(worldRetirementFiles);}else if(worldRetirementFiles)throw Error('Scoped world retirement token requires mixed retirement');
  validateExpectedBranch(expectedBranch);
  if (!prefixes?.length) throw Error("Storage requires explicit library prefixes.");
  for (const path of prefixes) if (path === 'reports' || path.startsWith('reports/')) assertReportSubject(root, path);
  return withLibraryLock(root, () => storeOwnedLibraryData({ root, push, prefixes, removePaths, expectedRevision, expectedBranch, readPreviousCountry,readPreviousSource,retirement,worldRetirementFiles,materialized }));
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

export function assertMixedRetirementWorldPairing({plan,files,prefixes,removePaths,archived,readNew}){
 if(!plan?.mixed||!plan.verifiedRuntimeCountries||!plan.verifiedRuntimeFiles)throw Error('Territorial retirement: verified mixed runtime plan required');const proof=assertVerifiedScopedWorldRetirement(files),hash=b=>createHash('sha256').update(b).digest('hex');
 if(archived.files['assets/data/world/current.json']?.sha256!==proof.baselineWorldSha256||archived.files[retirementWorldPath]?.sha256!==proof.baselineCurrentWorldSha256)throw Error('Territorial retirement: world baseline differs from pinned archive');for(const r of proof.baselineAssets)if(archived.files[r.path]?.sha256!==r.sha256||archived.files[r.path]?.bytes!==r.bytes)throw Error('Territorial retirement: world asset baseline differs from pinned archive');
 const additions={};for(const [id,n]of Object.entries({VNM:4,PHL:4,CHN:1,TWN:1})){const c=plan.verifiedRuntimeCountries.get(id),b=c.sourceBindings.find(b=>b.validTo===null),g=c.geometries.find(g=>g.id===b.geometryRef.id&&g.version===b.geometryRef.version).geojson;additions[id]=g.coordinates.slice(-n);}if(hash(JSON.stringify(Object.fromEntries(Object.entries(additions).sort(([a],[b])=>a.localeCompare(b)))))!==proof.canonicalAdditionsSha256)throw Error('Territorial retirement: world additions differ from verified source-exact components');
 const expected=new Set([...plan.removePaths,'assets/data/territorial-entities/generated/v2/index.json','assets/data/territorial-entities/source/views/world.json',retirementDisplayPath,retirementWorldPath,'assets/data/builtin-world/generated/v1/index.json','assets/data/builtin-world/generated/v1/coverage-report.json',...proof.files.map(r=>r.path),...[...plan.verifiedRuntimeFiles.keys()].map(p=>'assets/data/builtin-world/generated/v1/'+p),...[...plan.metadataUpdates.values()].flatMap(r=>['assets/data/territorial-entities/source/countries/'+r.entityId.replace(':','-')+'.json','assets/data/territorial-entities/generated/v2/'+r.nextEntry.file])]);
 if(!isDeepStrictEqual([...expected].sort(),[...prefixes].sort())||!isDeepStrictEqual([...plan.removePaths].sort(),[...removePaths].sort()))throw Error('Territorial retirement: exact paired source/runtime/world scopes required');
 for(const r of proof.files){const bytes=readNew(r.path);if(!Buffer.isBuffer(bytes)||bytes.length!==r.bytes||hash(bytes)!==r.sha256)throw Error('Territorial retirement: world output differs from verified producer');}for(const [p,b]of plan.verifiedRuntimeFiles)if(!readNew('assets/data/builtin-world/generated/v1/'+p).equals(b))throw Error('Territorial retirement: runtime output bytes differ from verified producer');return proof;
}

export function assertTerritorialStorageScope(prefixes,libraryIndex,previousIndex,{readLineage,readSourceDescriptor,retirement=null,displayPolicy,worldView,readRecovery,removePaths=[],pathExists}={}) {
  let retirementPlan=null;
  if(retirement){
    const plan=assertTerritorialRetirement({manifest:retirement,previousIndex,index:libraryIndex,displayPolicy,readRecovery});
    if(JSON.stringify(worldView)!==JSON.stringify(plan.index.views[0]))throw Error('Territorial retirement requires the exact paired world view source');
    const paired=[...plan.removePaths,'assets/data/territorial-entities/generated/v2/index.json','assets/data/territorial-entities/source/views/world.json',retirementDisplayPath,retirementWorldPath,
      'assets/data/builtin-world/generated/v1/index.json','assets/data/builtin-world/generated/v1/coverage-report.json',...[...plan.metadataUpdates.values()].flatMap(row=>['assets/data/territorial-entities/source/countries/'+row.entityId.replace(':','-')+'.json','assets/data/territorial-entities/generated/v2/'+row.nextEntry.file])];
    if(paired.some(path=>!prefixes.includes(path))||plan.removePaths.some(path=>!removePaths.includes(path))
      ||removePaths.some(path=>path.startsWith('assets/data/territorial-entities/')&&!plan.removePaths.includes(path)))
      throw Error('Territorial retirement requires exact paired paths and explicit removals');
    if(typeof pathExists!=='function'||plan.removePaths.some(path=>pathExists(path)))throw Error('Territorial retirement requires removed active source, lineage and chunk files');
    prefixes=prefixes.filter(path=>!plan.removePaths.includes(path));
    // Authored-but-unpublished source changes are still changes against storage's
    // pin, even though the retirement producer preserves their staged hashes.
    previousIndex={...plan.index,entities:previousIndex.entities.filter(row=>!plan.sourceIds.has(row.entityId))};retirementPlan=plan;
  }
  const base='assets/data/territorial-entities',included=path=>prefixes.some(prefix=>path===prefix||path.startsWith(prefix+'/'));
  if(included(base)){if(retirement)throw Error("Territorial retirement requires bounded file scopes");return;}
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
    if(prefix.startsWith(base+'/source/geometries/')){
      const referenced=typeof readSourceDescriptor==='function'&&libraryIndex.entities.some(row=>{
        const p=base+'/source/countries/'+row.entityId.replace(':','-')+'.json';
        return included(p)&&readSourceDescriptor(p).geometryVersions.some(v=>base+'/source/'+v.geometryResource.file===prefix);
      });
      if(!referenced)throw Error('Scoped territorial storage requires a referenced source geometry');
      continue;
    }
    const entry=libraryIndex.entities.find(row=>prefix===base+'/source/countries/'+row.entityId.replace(':','-')+'.json');
    if(!entry||!included(base+'/generated/v2/'+entry.file))throw Error('Scoped territorial storage requires explicit paired source files');
  }
  return retirementPlan;
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

export function storeOwnedLibraryData({ root, push, prefixes, removePaths, reportData, expectedRevision, expectedBranch, readPreviousCountry,readPreviousSource,retirement,worldRetirementFiles,materialized: explicitView }) {
  // Store the owner's current write view. Preparing a different view here can
  // hide unpublished outputs, and absence from a view never means deletion.
  if (reportData && explicitView !== undefined) throw Error('Report storage cannot select a runtime view');
  const materialized = explicitView === undefined ? libraryMaterializedRoot(root) : ownedMaterializedView(root, explicitView);
  let data = reportData;
  if (!data && existsSync(resolve(materialized, '.complete'))) {
    const record = JSON.parse(readFileSync(resolve(materialized, '.cache-owner.json'), 'utf8'));
    if (record.schema !== 'pando-shared-runtime-v1' || record.owner !== libraryOwnerId(root)) throw Error('Unexpected library storage view ownership');
    data = { checkout: libraryCheckout(root), materialized };
  }
  data ||= prepareOwnedLibraryData({ root, fetch: true,
    purpose: prefixes.every(path => path.startsWith('reports/')) ? 'reports' : 'gis', prefixes });
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
  const pinnedRevision=libraryConfig(root).revision;
  const archived=JSON.parse(git(data.checkout,['show',pinnedRevision+':archive/index.json'],{allowFetch:true}));
  const oldBytes=p=>{const entry=archived.files[p];if(!entry)throw Error('Missing pinned source: '+p);return decodeArchiveEntry(data.checkout,entry,pinnedRevision,{fetch:true});};
  const newBytes=p=>included(p)&&data.materialized&&existsSync(resolve(data.materialized,p))?readFileSync(resolve(data.materialized,p)):oldBytes(p);
  let retirementEvidenceRevision,retirementEvidenceIndex;let retirementReadRecovery;
  if(retirement?.kind==='mixed-current-identity-retirement'){
    retirementEvidenceRevision=git(data.checkout,['rev-parse','HEAD']);retirementEvidenceIndex=JSON.parse(git(data.checkout,['show',retirementEvidenceRevision+':archive/index.json']));git(data.checkout,['merge-base','--is-ancestor',pinnedRevision,retirementEvidenceRevision]);
    const table=index=>Object.entries(index.files).filter(([p])=>p.startsWith('assets/data/')).map(([p,e])=>[p,e.sha256,e.bytes]).sort(([a],[b])=>a.localeCompare(b));if(!isDeepStrictEqual(table(archived),table(retirementEvidenceIndex)))throw Error('Territorial retirement: reviewed runtime pin/HEAD asset tables differ');
    retirementReadRecovery=p=>{if(typeof p!=='string'||!p.startsWith('reports/')||p.split('/').some(x=>!x||x==='.'||x==='..')||!retirementEvidenceIndex.files[p])throw Error('Territorial retirement: archived report recovery required');return decodeArchiveEntry(data.checkout,retirementEvidenceIndex.files[p],retirementEvidenceRevision,{fetch:false});};
  }

  const territorial='assets/data/territorial-entities',generated=territorial+'/generated/v2/';
  const sourceEntity=(p,read)=>decodeTerritorialSource(JSON.parse(read(p)),file=>read(territorial+'/source/'+file));
  const previousSource=p=>readPreviousSource?readPreviousSource(p,oldBytes):sourceEntity(p,oldBytes);
  const generatedSelected=prefixes.some(p=>p===territorial||p.startsWith(generated)||generated.startsWith(p+'/'));
  let retirementPlan=null;
  if(generatedSelected){
    const libraryIndex=JSON.parse(newBytes(generated+'index.json')),previousIndex=JSON.parse(oldBytes(generated+'index.json'));
    retirementPlan=assertTerritorialStorageScope(prefixes,libraryIndex,previousIndex,{readLineage:id=>JSON.parse(newBytes(territorial+'/source/lineages/'+id+'.json')),readSourceDescriptor:p=>JSON.parse(newBytes(p)),retirement,removePaths,readRecovery:retirementReadRecovery,pathExists:p=>existsSync(resolve(data.materialized,p)),
      ...(retirement?{displayPolicy:JSON.parse(newBytes(retirementDisplayPath)),worldView:JSON.parse(newBytes(territorial+"/source/views/world.json"))}:{})});
  }
  // Source coordinate resources are immutable CAS bytes, not domain admission.
  // Even a resource-only scope must not replace bytes an unchanged descriptor uses.
  if(data.materialized&&traversable(territorial+'/source/geometries'))for(const file of contentFiles(resolve(data.materialized,territorial+'/source/geometries'))){
    const p=territorial+'/source/geometries/'+file.logical;
    if(included(p))assertTerritorialSourceResourceBytes(p,newBytes(p));
  }
  let evidenceRevision=retirementEvidenceRevision,evidenceIndex=retirementEvidenceIndex,sourceSnapshot;
  const ensureEvidenceSnapshot=()=>{
    // Non-source stores and old admission methods never request a source census.
    if(!evidenceIndex){
      evidenceRevision=git(data.checkout,['rev-parse','HEAD']);
      evidenceIndex=JSON.parse(git(data.checkout,['show',evidenceRevision+':archive/index.json']));
    }
  };
  const readSourceEvidence=reference=>{
    ensureEvidenceSnapshot();
    if(!evidenceIndex.files[reference])throw Error('Missing archived source adoption evidence: '+reference);
    return decodeArchiveEntry(data.checkout,evidenceIndex.files[reference],evidenceRevision,{fetch:false});
  };
  const getSourceSnapshot=()=>{
    if(sourceSnapshot)return sourceSnapshot;
    ensureEvidenceSnapshot();
    git(data.checkout,['merge-base','--is-ancestor',pinnedRevision,evidenceRevision]);
    const prefix=territorial+'/source/countries/',paths=index=>Object.keys(index.files).filter(p=>p.startsWith(prefix)).sort(),countryDescriptorPaths=paths(evidenceIndex),pinnedPaths=paths(archived);
    if(JSON.stringify(countryDescriptorPaths)!==JSON.stringify(pinnedPaths))throw Error('Restoration snapshot: source pin/HEAD country sets differ; rebase census');
    for(const p of countryDescriptorPaths){
      if(evidenceIndex.files[p].sha256!==archived.files[p].sha256||evidenceIndex.files[p].bytes!==archived.files[p].bytes)throw Error('Restoration snapshot: source pin/HEAD descriptor differs; rebase census');
      const descriptor=JSON.parse(readSourceEvidence(p));
      for(const v of descriptor.geometryVersions||[]){const resource=territorial+'/source/'+v.geometryResource?.file,a=archived.files[resource],b=evidenceIndex.files[resource];if(!a||!b||a.sha256!==b.sha256||a.bytes!==b.bytes)throw Error('Restoration snapshot: source pin/HEAD referenced resource differs; rebase census');}
    }
    // Initial raw adoption must authenticate its old scope anchor at the source
    // pin, not at a report-only descendant or in mutable local report files.
    const readPinnedEvidence=reference=>{
      if(typeof reference!=='string'||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(reference)||reference.split('/').some(p=>p==='.'||p==='..'))throw Error('Restoration snapshot: exact pinned report JSON path required');
      const entry=archived.files[reference];
      if(!entry)throw Error('Restoration snapshot: missing pinned report evidence: '+reference);
      return decodeArchiveEntry(data.checkout,entry,pinnedRevision,{fetch:false});
    };
    sourceSnapshot=Object.freeze({archiveRevision:evidenceRevision,sourcePin:pinnedRevision,countryDescriptorPaths:Object.freeze(countryDescriptorPaths),readPinnedEvidence});
    return sourceSnapshot;
  };
  // Editable source may be stored before its derived chunks are regenerated.
  // Validate the selected source itself, without recreating a second authority.
  if(data.materialized&&traversable(territorial+'/source/countries'))for(const file of contentFiles(resolve(data.materialized,territorial+'/source/countries'))){
    const p=territorial+'/source/countries/'+file.logical;
    if(!included(p)||!p.startsWith(territorial+'/source/countries/')||!p.endsWith('.json')||!existsSync(resolve(data.materialized,p)))continue;
    const bytes=newBytes(p);if(contentHash(bytes)===archived.files[p]?.sha256)continue;
    const raw=sourceEntity(p,newBytes);
    if(raw.schemaVersion!==2||typeof raw.entityId!=='string'||!Array.isArray(raw.geometryVersions)
      ||p!==territorial+'/source/countries/'+raw.entityId.replace(':','-')+'.json')throw Error('Source filename identity/schema mismatch');
    const previous=archived.files[p]?previousSource(p):null;
    // Both gates use one fixed archived revision, never mutable report files.
    assertOriginalAuthoringSourceStorageChanges(raw,previous,{prefixes,readEvidence:readSourceEvidence});
    const metadataCorrection=retirementPlan?.mixed&&retirementPlan.metadataUpdates.get(raw.entityId);
    if(metadataCorrection){if(!isDeepStrictEqual(JSON.parse(newBytes(p)),metadataCorrection.afterDescriptor))throw Error('Territorial retirement: source differs from verified metadata-only correction');}
    else assertHistoricalSourceStorageChanges(raw,previous,{prefixes,readEvidence:readSourceEvidence,getSourceSnapshot});
  }
  const reviewScopes=['assets/data/territorial-entities','assets/data/builtin-world'];
  if(prefixes.some(p=>reviewScopes.some(s=>p===s||p.startsWith(s+'/')||s.startsWith(p+'/')))){
    const sourceBase='assets/data/territorial-entities/generated/v2/',countryBase='assets/data/builtin-world/generated/v1/';
    const sourceIndex=JSON.parse(newBytes(sourceBase+'index.json')),previousSourceIndex=JSON.parse(oldBytes(sourceBase+'index.json'));
    const builtinSelected=prefixes.some(p=>p==='assets/data/builtin-world'||p.startsWith('assets/data/builtin-world/')||'assets/data/builtin-world'.startsWith(p+'/'));
    const builtinIndex=builtinSelected?JSON.parse(newBytes(countryBase+'index.json')):{entities:[]},previousBuiltinIndex=builtinSelected?JSON.parse(oldBytes(countryBase+'index.json')):{entities:[]};
    if(retirement){
     if(retirementPlan.mixed){const paths=Object.keys(archived.files).filter(p=>p.startsWith(territorial+'/source/countries/')).sort();if(!isDeepStrictEqual(paths,[...retirementPlan.sourceCensusPaths].sort()))throw Error('Territorial retirement: authoritative source census incomplete');for(const row of retirementPlan.metadataUpdates.values()){const raw=territorial+'/source/countries/'+row.entityId.replace(':','-')+'.json',chunk=sourceBase+row.nextEntry.file;if(!isDeepStrictEqual(JSON.parse(newBytes(raw)),row.afterDescriptor)||contentHash(newBytes(chunk))!==row.afterChunkReceipt.sha256)throw Error('Territorial retirement: actual survivor metadata output differs');}}

     assertBuiltinRetirement({plan:retirementPlan,readRecovery:retirementReadRecovery,previousSourceIndex,sourceIndex,previousIndex:previousBuiltinIndex,index:builtinIndex,
      previousCoverage:JSON.parse(oldBytes(countryBase+'coverage-report.json')),coverage:JSON.parse(newBytes(countryBase+'coverage-report.json')),
      policy:JSON.parse(newBytes('assets/data/historical-world/policy.json')),
      readDescriptor:entry=>JSON.parse(gunzipSync(readBuiltinCountryStoredBytes(entry,file=>newBytes(countryBase+file))))});
     for(const [p,receipt] of retirementPlan.recoveryReceipts)if(archived.files[p]?.sha256!==receipt.sha256)throw Error('Territorial retirement: recovery differs from pinned archive: '+p);
     if(retirementPlan.mixed)assertMixedRetirementWorldPairing({plan:retirementPlan,files:worldRetirementFiles,prefixes,removePaths,archived,readNew:newBytes});
     const world=JSON.parse(newBytes(retirementWorldPath));if(retirementPlan.mixed&&!isDeepStrictEqual(world,verifiedMixedCurrentWorld(retirementPlan,{readRecovery:retirementReadRecovery})))throw Error('Territorial retirement: current-world output differs');const expected=builtinIndex.sourceIdentities.flatMap(row=>row.sourceFeatureIds),actual=world.features?.map(row=>row.id);
     if(world.type!=='FeatureCollection'||!actual||new Set(actual).size!==actual.length||actual.length!==expected.length||expected.some(id=>!actual.includes(id)))throw Error('Territorial retirement: unpaired current-world identities');
    }
    const source=(entry,read)=>{const bytes=read(sourceBase+entry.file);if(contentHash(bytes)!==entry.sha256)throw Error('Historical source chunk hash mismatch: '+entry.entityId);const entity=JSON.parse(gunzipSync(bytes));if(entity.entityId!==entry.entityId)throw Error('Historical source identity mismatch');return entity;};
    const country=(entry,index,read)=>readBuiltinCountry(entry,index,file=>read(countryBase+file));
    const previousCountry=readPreviousCountry?entry=>readPreviousCountry(entry,previousBuiltinIndex,file=>oldBytes(countryBase+file))
      :entry=>country(entry,previousBuiltinIndex,oldBytes);
    const verifiedMetadata=retirementPlan?.mixed?retirementPlan.metadataUpdates:new Map(),verifiedRuntime=retirementPlan?.mixed?retirementPlan.verifiedRuntimeCountries:new Map();
    assertHistoricalStorageChanges({prefixes,sourceIndex:{...sourceIndex,entities:sourceIndex.entities.filter(e=>!verifiedMetadata.has(e.entityId))},previousSourceIndex,builtinIndex:{...builtinIndex,entities:builtinIndex.entities.filter(e=>!verifiedRuntime.has(e.entityId))},previousBuiltinIndex,readSource:e=>source(e,newBytes),readPreviousSource:e=>source(e,oldBytes),readCountry:e=>country(e,builtinIndex,newBytes),readPreviousCountry:previousCountry,sourceFileChanged:e=>{if(!generatedSelected)return false;const p='assets/data/territorial-entities/source/countries/'+e.entityId.replace(':','-')+'.json';return prefixes.some(prefix=>p===prefix||p.startsWith(prefix+'/'))&&contentHash(newBytes(p))!==archived.files[p]?.sha256;},readRawSource:e=>sourceEntity('assets/data/territorial-entities/source/countries/'+e.entityId.replace(':','-')+'.json',newBytes),countryFileChanged:e=>[...(e.parts||[e]),...(builtinIndex.geometryAssets||[]).filter(asset=>(e.geometryRefs||[]).some(ref=>ref.id===asset.id&&ref.version===asset.version))].some(spec=>{const p=countryBase+spec.file;return prefixes.some(prefix=>p===prefix||p.startsWith(prefix+'/'))&&contentHash(newBytes(p))!==archived.files[p]?.sha256;})});
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
    // Chunk only immutable editable source geometry archives, never public
    // runtime URLs or directly published reports. Logical file/hash are unchanged.
    const chunked=!direct&&planSourceGeometryArchive(path,packed,{sha256,bytes:bytes.length});
    if(chunked){
      for(const [stored,part]of chunked.outputs)put(stored,part);
      index.files[path]=chunked.entry;return;
    }
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
  if (!reportData && data.materialized) for (const path of managedMounts) visit(safeChild(data.materialized, path), path);
  // Store only this branch's mutable scope. Shared originals from another
  // branch must never be implicitly imported into a branch publication.
  visit(editRoot, 'reports');
  for (const [path, entry] of Object.entries(index.files)) {
    if (path.startsWith('reports/')) continue;
    // Both unprepared paths and absent generated files stay in the archive
    // until a caller explicitly requests a scoped removal.
    if (!removed.has(path)) continue;
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
