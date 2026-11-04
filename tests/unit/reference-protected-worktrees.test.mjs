import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {protectedWorktreeRoots, withinWorktree} from '../../tools/reference-analysis/protected-worktrees.mjs';

test('missing prunable worktree records remain protected without preventing active worktrees', t => {
  const base=mkdtempSync(join(tmpdir(),'pando-worktree-roots-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const active=join(base,'active'), missing=join(base,'missing'), external=join(base,'external');
  mkdirSync(active);mkdirSync(external);
  const list=`worktree ${active}\0HEAD a\0\0worktree ${missing}\0HEAD b\0prunable missing gitdir\0\0`;
  const roots=protectedWorktreeRoots(list);
  assert.ok(roots.includes(realpathSync.native(active)));
  assert.ok(roots.includes(resolve(missing)));
  assert.equal(withinWorktree(join(active,'nested'),roots),true);
  assert.equal(withinWorktree(join(missing,'nested'),roots),true);
  assert.equal(withinWorktree(external,roots),false);
  assert.equal(withinWorktree(active+'-other',roots),false);
  assert.throws(()=>protectedWorktreeRoots(`worktree ${missing}\0HEAD b\0\0`),{code:'ENOENT'});
  assert.throws(()=>protectedWorktreeRoots('HEAD a\0\0'),/Invalid Git worktree record/);
  assert.throws(()=>protectedWorktreeRoots(''),/Empty Git worktree inventory/);
  const alias=join(base,'alias');symlinkSync(active,alias,process.platform==='win32'?'junction':'dir');
  const aliasRoots=protectedWorktreeRoots(`worktree ${alias}\0HEAD a\0\0`);
  assert.ok(aliasRoots.includes(realpathSync.native(active)));
});
