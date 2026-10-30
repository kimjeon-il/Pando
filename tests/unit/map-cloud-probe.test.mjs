import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateEnvironment, verifyBundle, runProbe } from '../../tools/reference-analysis/cloud-probe.mjs';
import { nodeManifest, collectSourceFiles } from '../../tools/reference-analysis/runtime-assets.mjs';
import * as probe from '../../tools/reference-analysis/cloud-probe.mjs';
import {prepareRuntime} from '../../plugins/pando-map-tools/lib/runtime.mjs';

test('map runtime starts without a Python interpreter',async()=>{
  const previous=process.env.PANDO_MAP_PYTHON;process.env.PANDO_MAP_PYTHON=join(tmpdir(),'no-such-python');
  try{const result=await prepareRuntime({workspace:process.cwd()});assert.equal(result.workspace,process.cwd());assert.equal(Object.hasOwn(result,'python'),false);}
  finally{if(previous===undefined)delete process.env.PANDO_MAP_PYTHON;else process.env.PANDO_MAP_PYTHON=previous;}
});

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
  const files=await collectSourceFiles(undefined,{diagnostics:true});
  for(const name of ['plugins/pando-map-tools/lib/engine.mjs','shared/frontend/js/modules/temporal.js','scripts/lib/frontend-layout.mjs','tools/load-node-core.mjs','tools/reference-analysis/verify-trained-onnx.mjs'])assert(files.includes(name),name);
  for(const name of ['tools/map-image/native-resample.mjs','tools/native-tool.mjs','tools/cpp/CMakeLists.txt','tools/cpp/map-image/main.cpp','tools/cpp/map-image/resample.cpp','tools/cpp/map-image/resample.h','tools/cpp/map-image/png.cpp','tools/cpp/map-image/png.h','tools/cpp/map-image/zlib-LICENSE'])assert(files.includes(name),name);
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

test('product source closure excludes diagnostic runners, training and Python sources',async()=>{
  const files=await collectSourceFiles(undefined,{diagnostics:false});
  assert(!files.includes('tools/reference-analysis/cloud-probe.mjs'));
  assert(!files.includes('tools/reference-analysis/verify-trained-onnx.mjs'));
  assert(!files.some(path=>path.includes('__pycache__')||path.endsWith('.pyc')||path.endsWith('.py')||path.includes('skills/pando-map-training/')));
  assert(!files.some(path=>path.startsWith('assets/js/')||path.startsWith('assets/wasm/')));
});

test('committed runtime source closure includes the native owners and excludes the training-only raster module',async()=>{
  const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const files=await collectSourceFiles(undefined,{revision});
  for(const path of ['tools/map-image/native-pdf.mjs','tools/map-image/native-preview.mjs','tools/cpp/map-preview/aileron-subset.ttf'])assert(files.includes(path),path);
  assert(!files.includes('plugins/pando-map-tools/lib/raster.py'));
});

test('repeated export or resume is rejected before changing the job or a successful receipt',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-cloud-repeat-'));
  try {
    const bundle=join(dir,'bundle'),output=join(dir,'results');await mkdir(bundle);await mkdir(output);
    await writeFile(join(bundle,'probe.json'),JSON.stringify({schemaVersion:1,files:[]}));
    await writeFile(join(output,'map.job.json'),'unchanged job');
    for(const stage of ['export','resume']) {
      const receipt=join(output,stage+'.json');await writeFile(receipt,'previous successful receipt');
      await assert.rejects(runProbe({bundle,output,stage,selection:'unused'}),error=>error.code==='PL-MAP-PROBE-EXISTS');
      assert.equal(await readFile(receipt,'utf8'),'previous successful receipt');
      assert.equal(await readFile(join(output,'map.job.json'),'utf8'),'unchanged job');
    }
    await assert.rejects(runProbe({bundle,output:bundle,stage:'map'}),/outside.*bundle/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('analysis receives the packaged source evidence and keeps original-PDF and raster identities separate',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-cloud-evidence-'));
  try {
    await mkdir(join(dir,'inputs'));const evidence={id:'map',license:'source terms',sha256:'original-pdf-hash'};
    await writeFile(join(dir,'inputs/provenance.json'),JSON.stringify(evidence));
    assert.equal(typeof probe.probeAnalysisOptions,'function');
    const options=await probe.probeAnalysisOptions(dir,{options:{languages:['eng'],maxPixels:1000000}});
    assert.deepEqual(options.provenance,evidence);assert.deepEqual(options.languages,['eng']);
    assert.equal(options.input,join(dir,'inputs/map.jpg'));assert.equal(options.modelPath,join(dir,'model/boundary.manifest.json'));
    assert.equal(options.sha256,undefined);
  } finally {await rm(dir,{recursive:true,force:true});}
});
