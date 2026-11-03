import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {libraryOwnerId} from '../../tools/library-data.mjs';

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
