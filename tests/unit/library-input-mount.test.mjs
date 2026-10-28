import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('library input mounts refuse indirect source and destination parents',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-input-containment-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'source'),external=join(base,'external'),target=join(base,'target');
  for(const p of [source,external,target])mkdirSync(p);
  mkdirSync(join(external,'data'));
  symlinkSync(external,join(source,'assets'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>library.mountLibraryInputs({source,root:target}),/indirect|link/i);
});
