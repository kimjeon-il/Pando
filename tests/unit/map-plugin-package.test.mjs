import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as assets from '../../tools/reference-analysis/runtime-assets.mjs';

const exec=promisify(execFile);
test('artifact writer validates every destination before writing and preserves existing output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-plugin-output-'));
  try {
    const output=join(dir,'output');
    await assert.rejects(assets.writeArtifactFiles(output,[{path:'okay',data:Buffer.from('new')},{path:'../escape',data:Buffer.from('bad')}]),/path/i);
    await assert.rejects(readFile(join(output,'okay')),/ENOENT/);
    const rows=await assets.writeArtifactFiles(output,[{path:'nested/okay',data:Buffer.from('new')}]);
    assert.equal(rows[0].bytes,3);assert.equal((await readFile(join(output,'nested/okay'))).toString(),'new');
    await assert.rejects(assets.writeArtifactFiles(output,[{path:'nested/okay',data:Buffer.from('overwrite')}]),/exist/i);
    assert.equal((await readFile(join(output,'nested/okay'))).toString(),'new');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('distribution reads a committed snapshot instead of unfinished working bytes',async()=>{
  assert.equal(typeof assets.readPinnedSource,'function');
  const dir=await mkdtemp(join(tmpdir(),'map-plugin-pinned-'));
  try {
    const git=(...args)=>exec('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:dir});
    await git('init','-q');await writeFile(join(dir,'module.mjs'),'export const value=1;\n');
    await git('add','module.mjs');await git('commit','-qm','fixture');
    const revision=(await git('rev-parse','HEAD')).stdout.trim();
    await writeFile(join(dir,'module.mjs'),'unfinished working change');
    assert.equal((await assets.readPinnedSource(dir,revision,'module.mjs')).toString(),'export const value=1;\n');
    await assert.rejects(assets.readPinnedSource(dir,'work/ui','module.mjs'),/commit|revision/i);
    await assert.rejects(assets.readPinnedSource(dir,revision,'../private'),/path/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});
