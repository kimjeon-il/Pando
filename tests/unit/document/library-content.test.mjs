import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "node:fs";
import * as __dep3 from "node:os";
import * as __dep4 from "node:path";
import * as __dep5 from "../../../tools/data/library-content.mjs";
import * as __dep7 from "../../../tools/build/load-node-core.mjs";
import * as __dep8 from "../../../src/document/territorial-units.js";
import * as __dep9 from "../../helpers/core-startup.mjs";
import * as __dep10_context from "../../../tools/data/library-context.mjs";
import * as __dep10_reports from "../../../tools/data/library-reports.mjs";
import * as __dep10_runtime from "../../../tools/data/library-runtime.mjs";
import * as __dep10_publication from "../../../tools/data/library-report-publication.mjs";
import * as __dep10_store from "../../../tools/data/library-store.mjs";
const __dep10={...__dep10_context,...__dep10_reports,...__dep10_runtime,...__dep10_publication,...__dep10_store};

// Original feature contract: library-content.test.mjs
contractSuite("library-content", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync, existsSync, symlinkSync, unlinkSync }=__dep2;
const { tmpdir }=__dep3;
const { join }=__dep4;
const content=__dep5;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-content-'));
  t.after(() => { const walk = p => { if (!existsSync(p)) return; for (const e of content.contentFiles(p)) chmodSync(e.path, 0o600); }; walk(root); rmSync(root, { recursive: true }); });
  mkdirSync(join(root, '.pando-store/blobs'), { recursive: true });
  return root;
}

test('shared originals reject in-place writes and private copies isolate owner changes', t => {
  const root = fixture(t), first = join(root, 'main/data.bin'), second = join(root, 'ui/data.bin');
  const blob = content.publishContent(root, Buffer.from('original'));
  content.linkContent(root, blob.sha256, first); content.linkContent(root, blob.sha256, second);
  assert.equal(statSync(first, { bigint: true }).ino, statSync(second, { bigint: true }).ino);
  assert.throws(() => writeFileSync(first, 'unsafe'));
  content.makePrivate(root, first);
  writeFileSync(first, 'ui only');
  assert.equal(readFileSync(second, 'utf8'), 'original');
  assert.notEqual(statSync(first, { bigint: true }).ino, statSync(second, { bigint: true }).ino);
  assert.equal(statSync(second).mode & 0o200, 0);
});

test('removing one readonly view keeps the shared blob and other view immutable', t => {
  const root = fixture(t), a = join(root, 'a'), b = join(root, 'b');
  const blob = content.publishContent(root, Buffer.from('keep'));
  content.linkContent(root, blob.sha256, a); content.linkContent(root, blob.sha256, b);
  content.removeContentLink(root, a);
  assert.equal(existsSync(a), false); assert.equal(readFileSync(b, 'utf8'), 'keep');
  assert.equal(statSync(blob.path).mode & 0o200, 0);
  assert.throws(() => writeFileSync(b, 'changed'));
});

test('a changed or linked content-pool object is never overwritten', t => {
  const root = fixture(t), bytes = Buffer.from('evidence'), blob = content.publishContent(root, bytes);
  chmodSync(blob.path, 0o600); writeFileSync(blob.path, 'corrupt!');
  assert.throws(() => content.publishContent(root, bytes), /content|hash|modified/i);
  assert.equal(readFileSync(blob.path, 'utf8'), 'corrupt!');
});

test('exclusive temporary-file collisions preserve the earlier unfinished work', t => {
  const root = fixture(t), target = join(root, 'record.json');
  const temporary = `${target}.${process.pid}.pending`;
  writeFileSync(temporary, 'unfinished');
  assert.throws(() => content.atomicStorageJSON(target, {}), /EEXIST/);
  assert.equal(readFileSync(temporary, 'utf8'), 'unfinished');
  assert.throws(() => content.replaceLibraryFile(root, target, Buffer.from('new')), /EEXIST/);
  assert.equal(readFileSync(temporary, 'utf8'), 'unfinished');
});

test('an independent readonly edit becomes writable while the pool itself stays immutable',t=>{
  const root=fixture(t),edit=join(root,'edit.bin');writeFileSync(edit,'private edit');chmodSync(edit,0o400);
  content.makePrivate(root,edit);writeFileSync(edit,'updated');assert.equal(readFileSync(edit,'utf8'),'updated');
  const blob=content.publishContent(root,Buffer.from('immutable'));
  assert.throws(()=>content.makePrivate(root,blob.path));assert.equal(statSync(blob.path).mode&0o200,0);
});

test('explicit owned external views share immutable bytes and isolate edits',t=>{
  const root=fixture(t), store={root:join(root,'cache'),blobDirectory:'blobs'};
  const a=join(root,'app-a'),b=join(root,'app-b');
  for(const view of [a,b]){mkdirSync(view);writeFileSync(join(view,'.stage-owner'),'owned');}
  const blob=content.publishContent(store,Buffer.from('shared stage'));
  for(const view of [a,b])content.linkContentView(store,blob.sha256,join(view,'data.bin'),{viewRoot:view,marker:'.stage-owner'});
  assert.equal(statSync(join(a,'data.bin'),{bigint:true}).ino,statSync(join(b,'data.bin'),{bigint:true}).ino);
  assert.throws(()=>writeFileSync(join(a,'data.bin'),'unsafe'));
  content.makeContentViewPrivate(store,join(a,'data.bin'),{viewRoot:a,marker:'.stage-owner'});
  writeFileSync(join(a,'data.bin'),'private');
  assert.equal(readFileSync(join(b,'data.bin'),'utf8'),'shared stage');
  content.removeContentView(store,join(b,'data.bin'),{viewRoot:b,marker:'.stage-owner'});
  assert.equal(statSync(blob.path).mode&0o200,0);
  assert.throws(()=>content.linkContentView(store,blob.sha256,join(root,'escape.bin'),{viewRoot:a,marker:'.stage-owner'}),/scope|escape/i);
  assert.throws(()=>content.linkContentView(store,blob.sha256,join(root,'unowned/file'),{viewRoot:join(root,'unowned'),marker:'.stage-owner'}),/owner/i);
});

test('external views reject junctions and permission recovery preserves immutable peers',t=>{
  const root=fixture(t),store={root:join(root,'cache'),blobDirectory:'blobs'},view=join(root,'view');
  mkdirSync(view);writeFileSync(join(view,'.stage-owner'),'owned');
  const blob=content.publishContent(store,Buffer.from('original'));
  const link=join(root,'junction');symlinkSync(view,link,'junction');
  try{assert.throws(()=>content.linkContentView(store,blob.sha256,join(link,'file'),{viewRoot:link,marker:'.stage-owner'}),/Linked/);}
  finally{unlinkSync(link);}
  const nested=join(view,'nested');symlinkSync(root,nested,'junction');
  try{assert.throws(()=>content.linkContentView(store,blob.sha256,join(nested,'outside'),{viewRoot:view,marker:'.stage-owner'}),/Linked/);}
  finally{unlinkSync(nested);}
  chmodSync(blob.path,0o600);content.atomicStorageJSON(join(store.root,'.permission-restore.json'),{sha256:blob.sha256});
  content.recoverContentPermissions(store);
  assert.equal(statSync(blob.path).mode&0o200,0);assert.equal(existsSync(join(store.root,'.permission-restore.json')),false);
});
});

// Original feature contract: library-retention.test.mjs


// Original feature contract: library-history.test.mjs


// Original feature contract: library-origin-period.test.mjs
contractSuite("library-origin-period", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { loadNodeCore }=__dep7;
const { createTerritorialFeature }=__dep8;
const { startupDocument }=__dep9;

test('typed library provenance round-trips dates and source identity without a precision flag',async()=>{
 const core=await loadNodeCore();
 const origin={libraryId:'state:soviet-union-russian-sfsr',geometryVersionId:'1991-r1',referenceDate:'1991-12-24',
  sourceId:'existing-shape',sourceVersion:'2',certainty:'medium',partial:false,missingLibraryRefs:[]};
 const feature=createTerritorialFeature({id:'phase',entityKind:'general',name:'Phase',
  geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]},metadata:{libraryOrigin:origin}});
 const session=new core.DocumentSession({validateFlagDataUrl(){}});
 try{
  session.documentLoad(JSON.stringify(startupDocument([feature])),'1991-12');
  const saved=JSON.parse(session.storageSnapshot());
  assert.deepEqual(saved.territorialEntities[0].properties.metadata.libraryOrigin,origin);
 }finally{session.delete();}
});
});

// Original feature contract: library-owner-id.test.mjs
contractSuite("library-owner-id", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { mkdtempSync, mkdirSync, rmSync, writeFileSync }=__dep2;
const { join }=__dep4;
const { tmpdir }=__dep3;
const { libraryOwnerId }=__dep10;

test('library owner follows the permanent worktree across integration branches',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-owner-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const gitdir=join(base,'repository','.git','worktrees','ui');
  const root=join(base,'ui');
  mkdirSync(gitdir,{recursive:true});mkdirSync(root);
  writeFileSync(join(root,'.git'),`gitdir: ${gitdir}\n`);
  writeFileSync(join(gitdir,'HEAD'),'ref: refs/heads/integration/r4-gis-w2-20261103\n');
  assert.equal(libraryOwnerId(root),'ui');
  writeFileSync(join(gitdir,'HEAD'),'ref: refs/heads/work/ui\n');
  assert.equal(libraryOwnerId(root),'ui');
});

test('unknown worktree identities cannot take main library ownership',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-owner-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const gitdir=join(base,'repository','.git','worktrees','unregistered');
  const root=join(base,'unregistered');
  mkdirSync(gitdir,{recursive:true});mkdirSync(root);
  writeFileSync(join(root,'.git'),`gitdir: ${gitdir}\n`);
  writeFileSync(join(gitdir,'HEAD'),'ref: refs/heads/integration/r4-gis-w2-20261103\n');
  assert.throws(()=>libraryOwnerId(root),/worktree owner/i);
});

test('optimization permanent worktrees keep separate library ownership across branch changes',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-optimization-owner-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  for(const owner of ['optimization','pando-work-optimization']){
    const gitdir=join(base,'repository','.git','worktrees',owner),root=join(base,owner);
    mkdirSync(gitdir,{recursive:true});mkdirSync(root);
    writeFileSync(join(root,'.git'),`gitdir: ${gitdir}\n`);
    writeFileSync(join(gitdir,'HEAD'),'ref: refs/heads/work/optimization\n');
    assert.equal(libraryOwnerId(root),owner);
    writeFileSync(join(gitdir,'HEAD'),'ref: refs/heads/integration/optimization\n');
    assert.equal(libraryOwnerId(root),owner);
    assert.notEqual(libraryOwnerId(root),'main');
    assert.notEqual(libraryOwnerId(root),'gis');
  }
});
});
