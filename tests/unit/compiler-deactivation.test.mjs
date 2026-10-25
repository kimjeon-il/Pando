import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {deactivateCompilerCache,compilerCacheEnvironment} from '../../tools/worktree-storage.mjs';
test('compiler deactivation keeps the shared application store usable without the old SDK or wrapper',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-compiler-off-'));t.after(()=>rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-q',root]);const cacheRoot=join(root,'cache');mkdirSync(cacheRoot);const settings={schema:'pando-worktree-storage-v1',cacheRoot,version:'0.19.0',port:42427,tool:join(root,'missing-sccache.exe'),toolSha256:'a'.repeat(64)};writeFileSync(join(root,'.git/pando-storage.json'),JSON.stringify(settings));let stopped=0;deactivateCompilerCache({root,settings,processes:[],stopServer:()=>{stopped++;}});assert.equal(stopped,1);const next=JSON.parse(readFileSync(join(root,'.git/pando-storage.json')));assert.equal(next.compilerEnabled,false);assert.equal(next.cacheRoot,cacheRoot);const env=compilerCacheEnvironment({root,env:{Path:'runtime',RUSTC_WRAPPER:settings.tool},settings:next});assert.equal(env.Path,'runtime');assert.equal(env.RUSTC_WRAPPER,undefined);
 assert.throws(()=>deactivateCompilerCache({root,settings,processes:[{Name:'cargo.exe'}],stopServer:()=>{throw Error('must not stop');}}),/active|build/i);
});
