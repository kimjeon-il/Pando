import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {stageRawBranchCommit,readRawGitBlob,assertRawBranchTarget} from '../../../tools/data/library-raw-branch-git.mjs';

const raw='refs/heads/work/gis-raw-modern';
const main='refs/heads/main';
const git=(cwd, args, input)=>execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args], {cwd,input,stdio:['pipe','pipe','pipe']});
const oid=(cwd,args,input)=>git(cwd,args,input).toString().trim();

function fixture(t) {
  const parent=mkdtempSync(join(tmpdir(),'pando-raw-git-test-'));
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const repository=join(parent,'library.git');
  mkdirSync(repository);
  git(repository,['init','--bare','--initial-branch=main']);
  const blob=oid(repository,['hash-object','-w','--stdin'],Buffer.from('original\n'));
  const tree=oid(repository,['mktree'],Buffer.from('100644 blob '+blob+'\tkeep\n'));
  const baseline=oid(repository,['commit-tree',tree,'-m','Baseline']);
  git(repository,['update-ref',main,baseline]);
  git(repository,['update-ref',raw,baseline]);
  return {repository,baseline};
}

const stage=({repository,baseline},paths)=>stageRawBranchCommit({repository,expectedRevision:baseline,paths,message:'Scoped fixture'});
const rawTip=f=>oid(f.repository,['rev-parse',raw]);
const archivePath='archive/index.json';
const classified='assets/data/territorial-entities/.originals/'+'a'.repeat(64)+'.gz';

test('stages exact bytes without publication, then advances only raw',t=>{
  const f=fixture(t), bytes=Buffer.from([0,200,255,13,10,0,4]);
  const c=stage(f,new Map([[archivePath,bytes],[classified,bytes]]));
  assert.equal(rawTip(f),f.baseline);
  assert.equal(assertRawBranchTarget(f.repository,f.baseline).headRef,main);
  assert.equal(readRawGitBlob(f.repository,f.baseline,archivePath),null);
  assert.deepEqual(readRawGitBlob(f.repository,c.revision,archivePath),bytes);
  assert.deepEqual(readRawGitBlob(f.repository,c.revision,classified),bytes);
  assert.equal(oid(f.repository,['rev-parse','HEAD']),f.baseline);
  assert.deepEqual(git(f.repository,['show',c.revision+':'+archivePath]),bytes);
  assert.deepEqual(oid(f.repository,['diff-tree','-r','--no-commit-id','--name-only',f.baseline,c.revision]).split('\n').sort(),[archivePath,classified].sort());
  assert.equal(c.publish(),c.revision);
  assert.equal(rawTip(f),c.revision);
  assert.equal(oid(f.repository,['rev-parse',main]),f.baseline);
  assert.equal(oid(f.repository,['rev-parse','HEAD']),f.baseline);
  assert.deepEqual(git(f.repository,['show',raw+':'+archivePath]),bytes);
});

test('refuses a stale writer without undoing winner',t=>{
  const f=fixture(t);
  const a=stage(f,new Map([[archivePath,Buffer.from('first')]]));
  const b=stage(f,new Map([[archivePath,Buffer.from('second')]]));
  b.publish();
  assert.throws(()=>a.publish(),{code:'PANDO_RAW_BRANCH_STALE'});
  assert.throws(()=>stage(f,new Map([[archivePath,Buffer.from('again')]])),{code:'PANDO_RAW_BRANCH_STALE'});
  assert.equal(rawTip(f),b.revision);
  assert.equal(oid(f.repository,['rev-parse',main]),f.baseline);
});

test('refuses checked-out raw at staging time and again before publication',t=>{
  const f=fixture(t);
  const c=stage(f,new Map([[archivePath,Buffer.from('new')]]));
  git(f.repository,['symbolic-ref','HEAD',raw]);
  assert.throws(()=>c.publish(),{code:'PANDO_RAW_BRANCH_CHECKED_OUT'});
  assert.throws(()=>stage(f,new Map([[archivePath,Buffer.from('new')]])),{code:'PANDO_RAW_BRANCH_CHECKED_OUT'});
  assert.equal(rawTip(f),f.baseline);
});

test('refuses path traversal, ambiguous path types and true no-op',t=>{
  const f=fixture(t);
  for(const path of ['../outside','archive/.git/config','/archive/x','archive/NUL','archive/case.','keep/child','keep\\child'])
    assert.throws(()=>stage(f,new Map([[path,Buffer.from('bad')]])),{code:'PANDO_RAW_BRANCH_SCOPE'});
  assert.throws(()=>stage(f,new Map([['Archive/a',Buffer.from('one')],['archive/b',Buffer.from('two')]])),{code:'PANDO_RAW_BRANCH_SCOPE'});
  assert.throws(()=>stage(f,new Map([['keep',Buffer.from('original\n')]])),{code:'PANDO_RAW_BRANCH_NO_CHANGE'});
  assert.equal(rawTip(f),f.baseline);
});

test('refuses missing raw and a symbolic raw ref, and leaves main intact',t=>{
  const f=fixture(t);
  git(f.repository,['update-ref','-d',raw]);
  assert.throws(()=>stage(f,new Map([[archivePath,Buffer.from('new')]])),{code:'PANDO_RAW_BRANCH_STALE'});
  git(f.repository,['symbolic-ref',raw,main]);
  assert.throws(()=>stage(f,new Map([[archivePath,Buffer.from('new')]])),{code:'PANDO_RAW_BRANCH_SYMBOLIC'});
  assert.equal(oid(f.repository,['rev-parse',main]),f.baseline);
});

