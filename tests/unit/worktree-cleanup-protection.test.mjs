import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {protectedWorktreeFiles} from '../../tools/worktree-storage.mjs';
import {previewGeneratedCleanup} from '../../tools/worktree-generated.mjs';
test('cleanup protects every tracked and untracked source on a not-yet-migrated branch',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-source-protection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(p,text='protected')=>{mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),text);};
 execFileSync('git',['init',root],{stdio:'pipe'});put('index.html');put('apps/web-shell/src-tauri/src/lib.rs');put('.gitignore','node_modules/\n');
 execFileSync('git',['-C',root,'add','.'],{stdio:'pipe'});put('assets/worker-runtime/new-worker/source.js');put('node_modules/.pnpm/cache','reproducible');
 const protectedPaths=protectedWorktreeFiles([root]);
 for(const path of ['index.html','apps/web-shell/src-tauri/src/lib.rs','assets/worker-runtime/new-worker/source.js']){
  assert.throws(()=>previewGeneratedCleanup({roots:[root],protectedPaths,requests:[{root,path,action:'delete',reason:'obsolete output'}]}),/Protected source or WIP/);
 }
 assert.equal(previewGeneratedCleanup({roots:[root],protectedPaths,requests:[{root,path:'node_modules/.pnpm',action:'delete',reason:'replaced dependency store'}]}).entries.length,1);
});
