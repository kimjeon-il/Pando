import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as library from '../../tools/library-data.mjs';
import { contentFiles } from '../../tools/library-content.mjs';
import {createP3PreviewServer} from '../../scripts/p3-preview-server.mjs';

const put = (p, bytes) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'pando-runtime-share-')), app = join(parent, 'app'), ui = join(parent, 'ui'), data = join(parent, 'data');
  t.after(() => { for (const f of contentFiles(data)) chmodSync(f.path, 0o600); rmSync(parent, { recursive: true, force: true }); });
  for (const root of [app, data]) { mkdirSync(root); git(root,'init','-q'); git(root,'config','user.name','Fixture'); git(root,'config','user.email','fixture@example.invalid'); }
  const bytes = Buffer.from('runtime original'), logical = 'assets/data/current.bin';
  put(join(data, logical), bytes); put(join(data,'library.json'),'{}');
  put(join(data,'archive/index.json'),JSON.stringify({branch:'main',files:{[logical]:{stored:logical,encoding:'identity',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}}}));
  git(data,'add','.');git(data,'commit','-qm','data');const revision=git(data,'rev-parse','HEAD');
  put(join(app,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision,mounts:['assets/data','reports']}));
  put(join(app,'.gitignore'),'.library-data/\nassets/data/\nreports/\n');git(app,'add','.');git(app,'commit','-qm','app');git(app,'worktree','add','-qb','work/ui',ui);
  for(const root of [app,ui]){mkdirSync(join(root,'.library-data'),{recursive:true});symlinkSync(data,join(root,'.library-data/repository'),process.platform==='win32'?'junction':'dir');}
  return {parent,app,ui,data,revision,logical};
}

test('same-pin runtime views share readonly bytes but scoped writes stay branch-private', t => {
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});library.prepareLibraryData({root:f.ui,fetch:false});
  const a=join(f.app,f.logical),b=join(f.ui,f.logical);
  assert.notEqual(library.libraryMaterializedRoot(f.app),library.libraryMaterializedRoot(f.ui));
  assert.equal(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);
  assert.throws(()=>writeFileSync(b,'unsafe'));
  library.withLibraryWrite({root:f.ui,prefixes:['assets/data/current.bin']},()=>writeFileSync(b,'ui edit'));
  assert.equal(readFileSync(a,'utf8'),'runtime original');assert.equal(readFileSync(b,'utf8'),'ui edit');
  assert.notEqual(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);
  library.prepareLibraryData({root:f.ui,fetch:false});assert.equal(readFileSync(b,'utf8'),'ui edit');
});

test('dirty legacy cache bytes and extra files are independently retained for every old consumer', t => {
  const f=fixture(t),legacy=join(f.data,'.pando-cache/materialized',f.revision);
  put(join(legacy,f.logical),'unfinished');put(join(legacy,'assets/data/local.json'),'unarchived');
  for(const root of [f.app,f.ui])library.prepareLibraryData({root,fetch:false});
  const a=join(f.app,f.logical),b=join(f.ui,f.logical);assert.equal(readFileSync(a,'utf8'),'unfinished');assert.equal(readFileSync(b,'utf8'),'unfinished');
  assert.notEqual(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);
  writeFileSync(b,'ui edit');assert.equal(readFileSync(a,'utf8'),'unfinished');
  assert.equal(readFileSync(join(f.app,'assets/data/local.json'),'utf8'),'unarchived');assert.ok(existsSync(join(legacy,'assets/data/local.json')));
});

test('async write leases persist until completion and reject overlapping writes', async t => {
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const operation=library.withLibraryWrite({root:f.app,prefixes:['assets/data']},async()=>{await waiting;writeFileSync(join(f.app,f.logical),'finished');});
  assert.throws(()=>library.withLibraryWrite({root:f.app,prefixes:['assets/data/current.bin']},()=>{}),/write|lease|running/i);
  release();await operation;assert.equal(readFileSync(join(f.app,f.logical),'utf8'),'finished');
  library.withLibraryWrite({root:f.app,prefixes:['assets/data/current.bin']},()=>{});
});

test('Python context manager detaches only its scope and releases its live lease', {skip:!process.env.PANDOLAB_TEST_PYTHON}, t => {
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});library.prepareLibraryData({root:f.ui,fetch:false});
  const tools=fileURLToPath(new URL('../../tools',import.meta.url));
  const program='import sys,pathlib; sys.path.insert(0,sys.argv[1]); from library_data import library_write; root=pathlib.Path(sys.argv[2]);\nwith library_write(["assets/data/current.bin"],root=root):\n (root/"assets/data/current.bin").write_bytes(b"python edit")\n';
  execFileSync(process.env.PANDOLAB_TEST_PYTHON,['-B','-c',program,tools,f.ui],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
  assert.equal(readFileSync(join(f.app,f.logical),'utf8'),'runtime original');assert.equal(readFileSync(join(f.ui,f.logical),'utf8'),'python edit');
  assert.equal(library.libraryWriteLeases(f.data).filter(lease=>lease.alive).length,0);
});

test('materialization peak includes private edits and unarchived files even with a populated pool',()=>{
  const sha='a'.repeat(64),index={files:{'assets/data/current.bin':{sha256:sha,bytes:10}}};
  const peak=library.runtimeMaterializationPeak(index,[{logical:'assets/data/current.bin',sha256:'b'.repeat(64),bytes:2*1024**3},{logical:'assets/data/local.bin',sha256:'c'.repeat(64),bytes:1024**3}],new Set([sha]));
  assert.equal(peak.privateBytes,3*1024**3);assert.equal(peak.totalBytes,3*1024**3);
});

test('offline archive restoration never starts a promisor lazy-fetch child',t=>{
  const f=fixture(t),entry=JSON.parse(git(f.data,'show',`${f.revision}:archive/index.json`)).files[f.logical];
  const oid=git(f.data,'rev-parse',`${f.revision}:${f.logical}`);
  unlinkSync(join(f.data,f.logical));unlinkSync(join(f.data,'.git/objects',oid.slice(0,2),oid.slice(2)));
  git(f.data,'config','remote.origin.promisor','true');git(f.data,'config','remote.origin.url',join(f.parent,'unavailable-local-promisor'));
  const trace=join(f.parent,'git-trace.json'),oldTrace=process.env.GIT_TRACE2_EVENT,oldLazy=process.env.GIT_NO_LAZY_FETCH;
  try{
    process.env.GIT_TRACE2_EVENT=trace;delete process.env.GIT_NO_LAZY_FETCH;
    assert.throws(()=>library.decodeArchiveEntry(f.data,entry,f.revision));
    const events=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.some(event=>event.event==='child_start'&&event.argv?.includes('fetch')),false);
  }finally{oldTrace===undefined?delete process.env.GIT_TRACE2_EVENT:process.env.GIT_TRACE2_EVENT=oldTrace;oldLazy===undefined?delete process.env.GIT_NO_LAZY_FETCH:process.env.GIT_NO_LAZY_FETCH=oldLazy;}
});

test('scoped producer output stores and rehydrates without changing a peer pin or bytes',t=>{
  const f=fixture(t);for(const root of [f.app,f.ui])library.prepareLibraryData({root,fetch:false});
  const peerPin=readFileSync(join(f.app,'config/library-data.json'));
  library.withLibraryOutputs({root:f.ui,paths:[join(f.ui,f.logical)]},()=>writeFileSync(join(f.ui,f.logical),'published ui bytes'));
  library.storeLibraryData({root:f.ui,prefixes:[f.logical]});
  for(const root of [f.app,f.ui])library.prepareLibraryData({root,fetch:false});
  assert.equal(readFileSync(join(f.ui,f.logical),'utf8'),'published ui bytes');
  assert.equal(readFileSync(join(f.app,f.logical),'utf8'),'runtime original');
  assert.deepEqual(readFileSync(join(f.app,'config/library-data.json')),peerPin);
});

test('Web preview serves only the configured owner runtime mount outside its code root',async t=>{
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});
  const secret=join(f.parent,'unrelated');put(join(secret,'secret.txt'),'private');
  symlinkSync(secret,join(f.app,'assets/unrelated'),process.platform==='win32'?'junction':'dir');
  const server=createP3PreviewServer(f.app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(origin+'/'+f.logical);assert.equal(response.status,200);assert.equal(await response.text(),'runtime original');
    assert.equal((await fetch(origin+'/assets/unrelated/secret.txt')).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
