import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateEnvironment, verifyBundle, nodeManifest, collectSourceFiles } from '../../tools/reference-analysis/cloud-probe.mjs';

test('environment gate requires observed Work cloud execution rather than a local smoke test',()=>{
  const receipt={surface:'chatgpt-work-cloud',verdict:'passed',checks:{platform:{os:'Linux'},node:{status:'passed'},file_read_write:{status:'passed'}}};
  assert.equal(validateEnvironment(receipt),receipt);
  for(const patch of [{surface:'codex-cloud'},{verdict:'unavailable'},{checks:{...receipt.checks,platform:{os:'Windows'}}}])
    assert.throws(()=>validateEnvironment({...receipt,...patch}),/Work cloud|environment/i);
});

test('bundle verification rejects changed bytes, traversal, and missing files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-cloud-integrity-'));
  try {
    const bytes=Buffer.from('original');await writeFile(join(dir,'source.txt'),bytes);
    const row={path:'source.txt',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    await writeFile(join(dir,'probe.json'),JSON.stringify({schemaVersion:1,files:[row]}));
    assert.equal((await verifyBundle(dir)).files.length,1);
    await writeFile(join(dir,'source.txt'),'modified');await assert.rejects(verifyBundle(dir),/hash|size/i);
    await writeFile(join(dir,'probe.json'),JSON.stringify({schemaVersion:1,files:[{...row,path:'../source.txt'}]}));
    await assert.rejects(verifyBundle(dir),/path/i);
    await writeFile(join(dir,'probe.json'),JSON.stringify({schemaVersion:1,files:[{...row,path:'missing'}]}));
    await assert.rejects(verifyBundle(dir),/ENOENT/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('diagnostic source closure includes dynamic numerical owners but excludes product build outputs',async()=>{
  const files=await collectSourceFiles();
  for(const name of ['plugins/pando-map-tools/lib/engine.mjs','assets/js/modules/temporal.js','tools/load-node-core.mjs','tools/reference-analysis/verify-trained-onnx.mjs'])assert(files.includes(name),name);
  assert(files.some(name=>name.startsWith('shared/core/src/')));
  assert(!files.some(name=>name.startsWith('build-native/')||name.startsWith('.git/')||name.startsWith('node_modules/')));
  assert.equal(files.length,new Set(files).size);
});

test('generated runtime dependencies are exact versions from the installed production closure',()=>{
  const manifest=nodeManifest();
  assert.deepEqual(manifest.dependencies,{'onnxruntime-web':'1.30.0','tesseract.js':'7.0.0'});
  assert(Object.keys(manifest.overrides).length>5);
  assert(Object.values(manifest.overrides).every(version=>/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)));
  assert(!manifest.scripts);assert(!manifest.devDependencies);
});
