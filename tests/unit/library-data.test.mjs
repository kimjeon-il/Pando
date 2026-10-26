import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { compactLibraryCheckout, decodeArchiveEntry, prepareLibraryData, libraryReportRoot, libraryReportEditRoot, libraryMaterializedRoot, withLibraryWrite, hydrateReports, safeChild, storeLibraryData } from '../../tools/library-data.mjs';
import { reportPath } from '../../tools/report-paths.mjs';

test('native library storage reuses unedited object references without reading their chunks',async()=>{
  const {storeNativeLibraryObjects}=await import('../../tools/library-data.mjs');
  assert.equal(typeof storeNativeLibraryObjects,'function');
  const old='a'.repeat(64),reads=[],writes=[];
  const entities=storeNativeLibraryObjects({libraryIndex:{entities:[{entityId:'state:edited',sha256:'new'},{entityId:'state:untouched',sha256:'same'}]},
    previousLibrary:{entities:{'state:edited':'b'.repeat(64),'state:untouched':old}},
    previousIndex:{entities:[{entityId:'state:edited',sha256:'old'},{entityId:'state:untouched',sha256:'same'}]},
    readChunk:entry=>{reads.push(entry.entityId);if(entry.entityId==='state:untouched')throw new Error('unrelated source read');return gzipSync(Buffer.from('{"entityId":"state:edited","lifetime":{"validFrom":"1841","validTo":null}}'));},
    put:(path,bytes)=>writes.push({path,text:bytes.toString()})});
  assert.deepEqual(reads,['state:edited']);
  assert.equal(entities['state:untouched'],old);
  assert.equal(writes.length,1);
  assert.equal(writes[0].text,'{"entityId":"state:edited","lifetime":{"validFrom":"1841","validTo":null}}\n');
  assert.equal(writes[0].path,`objects/${entities['state:edited']}.json`);
});

test('public release paths remain directly archivable from the storage Git tree', t => {
  const parent=mkdtempSync(join(tmpdir(),'pando-public-release-store-')),root=join(parent,'app'),checkout=join(root,'.library-data/repository');
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const put=(base,path,bytes)=>{mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes);};
  const git=(base,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:base,encoding:'utf8',stdio:'pipe'}).trim();
  for(const base of [root,checkout]){mkdirSync(base,{recursive:true});git(base,'init','-q');git(base,'config','user.name','Fixture');git(base,'config','user.email','fixture@example.invalid');}
  put(checkout,'archive/index.json',JSON.stringify({branch:'main',files:{}}));put(checkout,'library.json','{}');
  git(checkout,'add','.');git(checkout,'commit','-qm','source');
  put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:git(checkout,'rev-parse','HEAD'),mounts:['assets/data','reports']}));
  put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');
  prepareLibraryData({root,fetch:false});
  const paths=['assets/data/library-channel/current.json',`assets/data/library-releases/${'a'.repeat(64)}/manifest.json`];
  withLibraryWrite({root,prefixes:paths},()=>{for(const path of paths)put(root,path,'{"release":"'+'x'.repeat(200)+'"}');});
  storeLibraryData({root,prefixes:paths});
  for(const path of paths){const entry=JSON.parse(git(checkout,'show','HEAD:archive/index.json')).files[path];assert.equal(entry.stored,path);assert.equal(entry.encoding,'identity');assert.equal(git(checkout,'show',`HEAD:${path}`),readFileSync(join(root,path),'utf8'));}
});

test('external materialization restores exact gzip bytes and rejects corrupt transfers', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-transfer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('{"coordinate":0.12345678901234567,"evidence":"원문"}\n');
  writeFileSync(join(root, 'source.gz'), gzipSync(bytes));
  const entry = { stored: 'source.gz', encoding: 'gzip', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(decodeArchiveEntry(root, entry), bytes);
  assert.throws(() => decodeArchiveEntry(root, { ...entry, sha256: '0'.repeat(64) }), /corrupt/);
});
test('archive paths cannot escape their explicit storage root', () => {
  const root = join(tmpdir(), 'pando-library');
  assert.throws(() => safeChild(root, '../other'), /Unsafe/);
  assert.throws(() => safeChild(root, '.'), /Unsafe/);
  assert.equal(safeChild(root, 'archive/file.gz'), join(root, 'archive/file.gz'));
});

test('runtime storage advances the pin only after a remotely confirmed push and preserves rejected work', t => {
  const parent=mkdtempSync(join(tmpdir(),'pando-runtime-push-')), root=join(parent,'app'), data=join(root,'.library-data/repository'), remote=join(parent,'remote');
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const put=(base,path,bytes)=>{mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes);};
  const git=(base,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:base,encoding:'utf8',stdio:'pipe'}).trim();
  for(const base of [root,data]){mkdirSync(base,{recursive:true});git(base,'init','-q');git(base,'config','user.name','Fixture');git(base,'config','user.email','fixture@example.invalid');}
  git(root,'branch','-m','main');
  mkdirSync(remote);git(remote,'init','--bare','-q');
  const path='assets/data/value.bin', bytes=Buffer.from('first');
  put(data,path,bytes);put(data,'library.json','{}');
  put(data,'archive/index.json',JSON.stringify({branch:'main',files:{[path]:{stored:path,encoding:'identity',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}}));
  git(data,'add','.');git(data,'commit','-qm','initial');git(data,'remote','add','origin',remote);git(data,'push','origin','HEAD:main');
  put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:git(data,'rev-parse','HEAD'),mounts:['assets/data','reports']}));
  put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');
  prepareLibraryData({root,fetch:false});
  withLibraryWrite({root,prefixes:[path]},()=>put(root,path,'second'));
  const revision=storeLibraryData({root,prefixes:[path],push:true});
  assert.equal(JSON.parse(readFileSync(join(root,'config/library-data.json'))).revision,revision);
  assert.equal(git(data,'ls-remote','origin','refs/heads/main').split(/\s+/)[0],revision);
  put(remote,'hooks/pre-receive','#!/bin/sh\nexit 1\n');
  chmodSync(join(remote,'hooks/pre-receive'),0o755);
  withLibraryWrite({root,prefixes:[path]},()=>put(root,path,'preserved rejected update'));
  assert.throws(()=>storeLibraryData({root,prefixes:[path],push:true}),/push|rejected/);
  assert.equal(JSON.parse(readFileSync(join(root,'config/library-data.json'))).revision,revision);
  assert.notEqual(git(data,'rev-parse','HEAD'),revision);
});

test('checkout compaction preserves dirty, ignored and linked work and is offline and idempotent', t => {
  const checkout = mkdtempSync(join(tmpdir(), 'pando-compact-'));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(checkout, 'archive/blobs'), { recursive: true });
  writeFileSync(join(checkout, '.gitignore'), '*.notes\n');
  writeFileSync(join(checkout, 'archive/index.json'), '{}');
  const blob = join(checkout, 'archive/blobs/original.bin');
  writeFileSync(blob, 'original');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const before = git('rev-parse', 'HEAD');
  assert.equal(compactLibraryCheckout({ checkout }).eligibleBytes, 8);
  assert.ok(existsSync(blob));
  assert.equal(existsSync(join(checkout, '.git/info/sparse-checkout')), false);
  writeFileSync(blob, 'modified');
  assert.equal(compactLibraryCheckout({ checkout, apply: true }).status, 'protected');
  assert.equal(readFileSync(blob, 'utf8'), 'modified');
  writeFileSync(blob, 'original');
  const notes = join(checkout, 'archive/blobs/local.notes'); writeFileSync(notes, 'unfinished');
  assert.equal(compactLibraryCheckout({ checkout, apply: true }).status, 'protected');
  assert.equal(readFileSync(notes, 'utf8'), 'unfinished'); unlinkSync(notes);
  const linked = join(checkout, 'archive/blobs/external'); symlinkSync(join(checkout, '.git'), linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(compactLibraryCheckout({ checkout, apply: true }).status, 'protected'); unlinkSync(linked);
  const oid = git('rev-parse', 'HEAD:archive/blobs/original.bin');
  const object = join(checkout, '.git/objects', oid.slice(0, 2), oid.slice(2));
  const stored = readFileSync(object); unlinkSync(object);
  assert.throws(() => compactLibraryCheckout({ checkout, apply: true }), /unavailable|failed/i);
  assert.ok(existsSync(blob)); writeFileSync(object, stored);
  assert.equal(compactLibraryCheckout({ checkout, apply: true }).deletedBytes, 8);
  assert.equal(existsSync(blob), false);
  assert.equal(git('show', 'HEAD:archive/blobs/original.bin'), 'original');
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(compactLibraryCheckout({ checkout, apply: true }).deletedBytes, 0);
  unlinkSync(object);
  assert.equal(compactLibraryCheckout({ checkout }).eligibleBytes, 0, 'unhydrated blobs need not be fetched or read by preview');
  assert.equal(compactLibraryCheckout({ checkout, apply: true }).deletedBytes, 0, 'metadata-only checkout stays usable with unhydrated blobs');
});

test('runtime preparation is report-lazy and scoped report stores preserve pins, originals and local edits', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-delete-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, '.library-data/repository');
  const put = (base, path, bytes) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), bytes); };
  const git = (base, ...args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.autocrlf=false', ...args], { cwd: base, encoding: 'utf8' }).trim();
  for (const directory of [root, checkout]) {
    mkdirSync(directory, { recursive: true }); git(directory, 'init', '-q');
    git(directory, 'config', 'user.name', 'Test'); git(directory, 'config', 'user.email', 'test@example.invalid');
  }
  const files = {};
  for (const [path, text] of [['assets/data/territorial-entities/generated/v2/index.json', '{"entities":[]}'], ['assets/data/obsolete.json', '{}'], ['reports/obsolete.md', '# original'], ['reports/development/partial/old.md', '# sibling original']]) {
    const bytes = Buffer.from(text); put(checkout, path, bytes);
    files[path] = { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  put(checkout, 'archive/index.json', JSON.stringify({ branch: 'main', files }));
  put(checkout, 'objects/.gitkeep', ''); put(checkout, 'library.json', '{}');
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'source');
  put(root, '.gitignore', '.library-data/\nassets/data/\nreports/\n');
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/data', revision: git(checkout, 'rev-parse', 'HEAD'), mounts: ['assets/data', 'reports'] }));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'code');
  const legacy = join(checkout, 'reports/.edits/main');
  put(legacy, 'unsaved.md', '# local original');
  symlinkSync(join(checkout, 'reports'), join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  prepareLibraryData({ root, fetch: false });
  assert.equal(existsSync(join(checkout, 'assets/data/obsolete.json')), false, 'runtime checkout copies are evicted after offline verification');
  assert.equal(readFileSync(join(checkout, 'reports/obsolete.md'), 'utf8'), '# original', 'central originals remain visible');
  for (const directory of ['assets/data', 'objects']) assert.deepEqual(readdirSync(join(checkout, directory)), [], 'canonical storage directories remain available without payload copies');
  git(checkout, 'add', '--sparse', '--', 'archive', 'assets/data', 'objects', 'library.json', 'reports');
  assert.equal(git(checkout, 'diff', '--cached', '--name-only'), '', 'current worktrees can stage canonical directories without deleting unhydrated entries');
  assert.equal(git(checkout, 'status', '--porcelain'), '');
  const pin = readFileSync(join(root, 'config/library-data.json'), 'utf8');
  const reportRoot = libraryReportRoot(root);
  assert.equal(reportRoot, join(checkout, 'reports'));
  const edits = libraryReportEditRoot(root);
  assert.equal(readFileSync(join(edits, 'unsaved.md'), 'utf8'), '# local original');
  const lockPath = join(root, '.library-data/prepare.lock');
  writeFileSync(lockPath, 'another preparation');
  assert.throws(() => prepareLibraryData({ root, fetch: false }), /already running/);
  assert.equal(readFileSync(lockPath, 'utf8'), 'another preparation');
  unlinkSync(lockPath);
  const sharedLock = join(checkout, '.git/pando-library.lock');
  writeFileSync(sharedLock, 'another worktree is storing');
  assert.throws(() => hydrateReports({ root, path: 'obsolete.md', access: 'read' }), /already running/);
  assert.throws(() => prepareLibraryData({ root, fetch: false }), /already running/);
  unlinkSync(sharedLock);
  assert.equal(existsSync(join(root, 'reports/obsolete.md')), true);
  hydrateReports({ root, path: 'obsolete.md', access: 'read' });
  assert.equal(readFileSync(join(root, 'reports/obsolete.md'), 'utf8'), '# original');
  writeFileSync(hydrateReports({ root, path: 'obsolete.md', access: 'write' }), '# unfinished');
  hydrateReports({ root, path: 'obsolete.md', access: 'read' });
  assert.equal(readFileSync(hydrateReports({ root, path: 'obsolete.md', access: 'read' }), 'utf8'), '# unfinished');
  put(edits, 'development/partial/new.md', '# unfinished sibling');
  const partial = reportPath('reports/development/partial', { root, access: 'read' });
  assert.equal(readFileSync(join(partial, 'old.md'), 'utf8'), '# sibling original');
  assert.equal(readFileSync(join(partial, 'new.md'), 'utf8'), '# unfinished sibling');
  const unrelated = join(root, 'assets/data/territorial-entities/generated/v2/index.json');
  withLibraryWrite({ root, prefixes: ['assets/data/territorial-entities'] }, () => writeFileSync(unrelated, '{"entities":[],"unfinished":true}'));
  writeFileSync(hydrateReports({ root, path: 'new.md', access: 'write' }), '# new evidence');
  storeLibraryData({ root, prefixes: ['reports/new.md'] });
  const stored = JSON.parse(readFileSync(join(checkout, 'archive/index.json'), 'utf8'));
  assert.deepEqual(stored.files['reports/obsolete.md'], files['reports/obsolete.md']);
  assert.equal(readFileSync(join(root, 'config/library-data.json'), 'utf8'), pin);
  assert.deepEqual(stored.files['assets/data/territorial-entities/generated/v2/index.json'], files['assets/data/territorial-entities/generated/v2/index.json']);
  assert.match(readFileSync(unrelated, 'utf8'), /unfinished/);
  assert.equal(readFileSync(join(checkout, 'library.json'), 'utf8'), '{}');
  writeFileSync(hydrateReports({ root, path: 'second.md', access: 'write' }), '# second evidence');
  storeLibraryData({ root, prefixes: ['reports/second.md'] });
  assert.equal(readFileSync(join(checkout, 'reports/second.md'), 'utf8'), '# second evidence', 'store retains central raw originals');
  const secondEntry = JSON.parse(readFileSync(join(checkout, 'archive/index.json'))).files['reports/second.md'];
  assert.equal(secondEntry.stored, 'reports/second.md');
  assert.equal(secondEntry.encoding, 'identity');
  assert.equal(git(checkout, 'status', '--porcelain'), '');
  assert.equal(git(checkout, 'show', 'HEAD:reports/obsolete.md'), '# original', 'unhydrated tracked originals survive narrow staging');
  assert.ok(JSON.parse(readFileSync(join(checkout, 'archive/index.json'))).files['reports/new.md'], 'successive report-only stores retain earlier archived additions');
  // A new runtime pin reuses this worktree's original report owner.
  const config = JSON.parse(pin); config.revision = git(checkout, 'rev-parse', 'HEAD');
  put(root, 'config/library-data.json', JSON.stringify(config));
  prepareLibraryData({ root, fetch: false });
  assert.equal(libraryReportRoot(root), reportRoot);
  assert.equal(readFileSync(hydrateReports({ root, path: 'obsolete.md', access: 'read' }), 'utf8'), '# unfinished');
  assert.throws(() => storeLibraryData({ root, prefixes: ['reports/new.md'], removePaths: ['reports/new.md'] }), /working original/i);
  unlinkSync(join(edits, 'new.md'));
  storeLibraryData({ root, prefixes: ['reports/new.md'], removePaths: ['reports/new.md'] });
  storeLibraryData({ root, prefixes: ['reports'] });
  assert.equal(JSON.parse(readFileSync(join(checkout, 'archive/index.json'))).files['reports/new.md'], undefined);
  assert.throws(() => storeLibraryData({ root }), /explicit.*prefix/i);
  const mountedBeforeFailure = readFileSync(unrelated);
  const archive = JSON.parse(readFileSync(join(checkout, 'archive/index.json')));
  archive.files['assets/data/bad.bin'] = { stored: 'assets/data/bad.bin', encoding: 'identity', bytes: 3, sha256: '0'.repeat(64) };
  put(checkout, 'assets/data/bad.bin', 'bad'); put(checkout, 'archive/index.json', JSON.stringify(archive));
  git(checkout, 'add', '--sparse', '.'); git(checkout, 'commit', '-qm', 'corrupt transfer fixture');
  config.revision = git(checkout, 'rev-parse', 'HEAD'); put(root, 'config/library-data.json', JSON.stringify(config));
  assert.throws(() => prepareLibraryData({ root, fetch: false }), /corrupt/);
  assert.deepEqual(readFileSync(unrelated), mountedBeforeFailure);
  assert.equal(existsSync(libraryMaterializedRoot(root) + '.pending'), false);
});


test('a fresh no-checkout clone is populated before the local edit guard', t => {
  const parent = mkdtempSync(join(tmpdir(), 'pando-fresh-clone-')), remote = join(parent, 'remote'), root = join(parent, 'code');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  for (const directory of [remote, root]) mkdirSync(directory, { recursive: true });
  const put = (base, path, bytes) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), bytes); };
  const git = (...args) => execFileSync('git', ['-c', 'core.fsync=none', '-c', 'core.fsyncObjectFiles=false', '-c', 'core.autocrlf=false', ...args], { cwd: remote, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'test@example.invalid');
  const bytes = Buffer.from('exact runtime bytes'), path = 'assets/data/current.bin'; put(remote, path, bytes); put(remote, '.gitattributes', '* -text\n');
  const report=Buffer.from('unrequested report original');put(remote,'reports/unrequested.md',report);
  put(remote, 'archive/index.json', JSON.stringify({ files: { [path]: { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },'reports/unrequested.md':{stored:'reports/unrequested.md',encoding:'identity',bytes:report.length,sha256:createHash('sha256').update(report).digest('hex')} } }));
  git('add', '.'); git('commit', '-qm', 'source');
  git('config','uploadpack.allowFilter','true');git('config','uploadpack.allowAnySHA1InWant','true');
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/data', revision: git('rev-parse', 'HEAD'), mounts: ['assets/data', 'reports'] }));
  const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'], previous = keys.map(key => process.env[key]);
  try {
    process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(remote).href}.insteadOf`; process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/example/data.git';
    prepareLibraryData({ root });
    assert.deepEqual(readFileSync(join(root, path)), bytes);
    assert.equal(existsSync(join(root, '.library-data/repository', path)), false);
    assert.equal(existsSync(join(root,'.library-data/repository/reports/unrequested.md')),false);
    const available=execFileSync('git',['cat-file','--batch-all-objects','--batch-check=%(objectname)'],{cwd:join(root,'.library-data/repository'),encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1'}}).trim().split('\n');
    assert.equal(available.includes(git('rev-parse','HEAD:reports/unrequested.md')),false,'runtime prepare never downloads unrequested report blobs');
  } finally { keys.forEach((key, at) => previous[at] === undefined ? delete process.env[key] : process.env[key] = previous[at]); }
});

test('runtime storage targets the app branch and keeps the pinned unselected inputs', t => {
 const parent=mkdtempSync(join(tmpdir(),'pando-runtime-branch-')),root=join(parent,'app'),data=join(root,'.library-data/repository'),remote=join(parent,'remote');
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const put=(base,path,bytes)=>{mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes);};
 const git=(base,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:base,encoding:'utf8',stdio:'pipe'}).trim();
 for(const base of [root,data]){mkdirSync(base,{recursive:true});git(base,'init','-q');git(base,'config','user.name','Fixture');git(base,'config','user.email','fixture@example.invalid');}
 git(root,'branch','-m','work/objects');mkdirSync(remote);git(remote,'init','--bare','-q');
 const spec=(path,bytes)=>({stored:path,encoding:'identity',bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')});
 const path='assets/data/value.bin',other='assets/data/unselected.bin',index={branch:'main',files:{[path]:spec(path,'first'),[other]:spec(other,'pinned')}};
 put(data,path,'first');put(data,other,'pinned');put(data,'library.json','{}');put(data,'archive/index.json',JSON.stringify(index));
 git(data,'add','.');git(data,'commit','-qm','initial');git(data,'remote','add','origin',remote);git(data,'push','origin','HEAD:main');const baseline=git(data,'rev-parse','HEAD');
 put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:baseline,mounts:['assets/data','reports']}));put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');
 prepareLibraryData({root,fetch:false});
 // An archive checkout can own later work independently of its selected runtime pin.
 index.files[other]={...spec(other,'archive-head'),stored:'archive/blobs/unselected-head.bin'};put(data,'archive/blobs/unselected-head.bin','archive-head');put(data,'archive/index.json',JSON.stringify(index));git(data,'add','--sparse','archive/index.json','archive/blobs/unselected-head.bin');git(data,'commit','-qm','separate stored work');
 withLibraryWrite({root,prefixes:[path]},()=>put(root,path,'second'));
 const revision=storeLibraryData({root,prefixes:[path],push:true});
 assert.equal(git(data,'ls-remote','origin','refs/heads/main').split(/\s+/)[0],baseline,'private runtime storage must not publish main');
 assert.equal(git(data,'ls-remote','origin','refs/heads/work/objects').split(/\s+/)[0],revision);
 const stored=JSON.parse(git(data,'show',revision+':archive/index.json'));
 assert.equal(stored.branch,'work/objects');assert.deepEqual(stored.files[other],spec(other,'pinned'));
});
