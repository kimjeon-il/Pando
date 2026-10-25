import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilerCacheEnvironment } from '../../tools/worktree-storage.mjs';
import { contentHash } from '../../tools/library-content.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-worktree-storage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('unconfigured hosts preserve current compiler and incremental environment',t=>{
  const root=fixture(t),env={PATH:'existing',CARGO_INCREMENTAL:'1',RUSTC_WRAPPER:'other-wrapper'};
  assert.deepEqual(compilerCacheEnvironment({root,env,settings:null}),env);
});
test('activated compiler cache verifies its tool and preserves branch target and incremental state',t=>{
  const root=fixture(t),tool=join(root,'sccache.exe');writeFileSync(tool,'verified fixture');
  const settings={schema:'pando-worktree-storage-v1',cacheRoot:join(root,'cache'),tool,toolSha256:contentHash(readFileSync(tool)),port:42427};
  const env=compilerCacheEnvironment({root,settings,env:{CARGO_INCREMENTAL:'1',CARGO_TARGET_DIR:'branch-target'}});
  assert.equal(env.RUSTC_WRAPPER,tool);assert.equal(env.EM_COMPILER_WRAPPER,tool);
  assert.equal(env.CARGO_INCREMENTAL,'1');assert.equal(env.CARGO_TARGET_DIR,'branch-target');
  assert.equal(env.SCCACHE_CACHE_SIZE,'2147483648');assert.equal(env.SCCACHE_SERVER_PORT,'42427');
  assert.throws(()=>compilerCacheEnvironment({root,settings,env:{RUSTC_WRAPPER:'another'}}),/conflict/i);
  assert.throws(()=>compilerCacheEnvironment({root,settings,env:{SCCACHE_DIR:'another'}}),/conflict/i);
  writeFileSync(tool,'corrupted');assert.throws(()=>compilerCacheEnvironment({root,settings,env:{}}),/integrity/i);
});
test('explicit compiler command forwards its exit status without shell interpolation',t=>{
  const root=fixture(t), script=fileURLToPath(new URL('../../tools/worktree-storage.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,`--root=${root}`,'--with-compiler-cache','--',process.execPath,'-e','process.exit(7)'],{encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);
});
