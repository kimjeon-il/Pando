import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import * as library from '../../tools/library-data.mjs';

test('explicit library input checkout mounts bytes without overwriting a target or modifying inputs',t=>{
  assert.equal(typeof library.mountLibraryInputs,'function');
  const base=mkdtempSync(join(tmpdir(),'pando-input-mount-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'input'),target=join(base,'application');
  mkdirSync(join(source,'assets/data'),{recursive:true});mkdirSync(target);
  writeFileSync(join(source,'assets/data/source.json'),'original bytes');
  library.mountLibraryInputs({source,root:target});
  assert.equal(readFileSync(join(target,'assets/data/source.json'),'utf8'),'original bytes');
  assert.throws(()=>library.mountLibraryInputs({source,root:target}),/exists|existing/i);
  assert.equal(readFileSync(join(source,'assets/data/source.json'),'utf8'),'original bytes');
});

test('isolated Git baseline stays clean and input edits remain independently visible',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-input-git-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'input'),target=join(base,'baseline');
  for(const root of [source,target])mkdirSync(join(root,'assets'),{recursive:true});
  mkdirSync(join(source,'assets/data'));writeFileSync(join(source,'assets/data/source.json'),'pinned input');
  writeFileSync(join(target,'index.html'),'pinned source');
  const git=(root,args)=>execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  for(const root of [source,target]){git(root,['init','-q']);git(root,['add','.']);git(root,['commit','-qm','fixture']);}
  library.mountLibraryInputs({source,root:target});
  assert.equal(git(target,['status','--porcelain','--untracked-files=all','--','index.html','assets']), '');
  assert.equal(git(source,['status','--porcelain','--untracked-files=all','--','assets/data']), '');
  assert.equal(readFileSync(join(target,'index.html'),'utf8'),'pinned source');
  writeFileSync(join(source,'assets/data/source.json'),'changed input');
  assert.match(git(source,['status','--porcelain','--untracked-files=all','--','assets/data']),/M assets\/data\/source.json/);
});

test('library input mounts refuse indirect source and destination parents',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-input-containment-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'source'),external=join(base,'external'),target=join(base,'target');
  for(const p of [source,external,target])mkdirSync(p);
  mkdirSync(join(external,'data'));
  symlinkSync(external,join(source,'assets'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>library.mountLibraryInputs({source,root:target}),/indirect|link/i);
});
