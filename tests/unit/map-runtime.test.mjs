import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import * as runtime from '../../plugins/pando-map-tools/lib/runtime.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function file(root,path,bytes) {
  bytes=Buffer.from(bytes);await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);
  return {path,bytes:bytes.length,sha256:sha(bytes)};
}
async function fixture(root,ocrResources={}) {
  const plugin=join(root,'plugin'),seed=join(plugin,'runtime/workspace');
  const files=[await file(seed,'package.json','{"private":true,"type":"module"}'),await file(seed,'tools/load-node-core.mjs','export const core=true;'),
    await file(seed,'tools/library-archive.mjs',await readFile(new URL('../../tools/library-archive.mjs',import.meta.url)))];
  const model=await file(plugin,'model/boundary.onnx','test-model');
  const spec={trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,model:{url:'boundary.onnx',bytes:model.bytes,sha256:model.sha256}};
  const modelManifest=await file(plugin,'model/boundary.manifest.json',JSON.stringify(spec));
  const ocr=await file(seed,'assets/data/reference-analysis/v1/ocr/manifest.json',JSON.stringify({languages:Object.fromEntries(Object.entries(ocrResources).map(([lang,row])=>[lang,{url:lang+'.traineddata.gz',sha256:row.sha256,bytes:row.bytes}]))}));
  const gazetteer=await file(seed,'assets/data/reference-analysis/v1/gazetteer/manifest.json',JSON.stringify({revision:'c'.repeat(64),files:{}}));
  files.push(ocr,gazetteer);
  const analysisData=await file(plugin,'analysis-data.json',JSON.stringify({schemaVersion:1,repository:'owner/data',revision:'b'.repeat(40),ocr:{root:'assets/ocr',manifestSha256:ocr.sha256},gazetteer:{root:'reports/gazetteer',manifestSha256:gazetteer.sha256,revision:'c'.repeat(64)},defaultModel:{name:'fixture',root:'reports/map-analysis/models/fixture',manifestSha256:modelManifest.sha256,sha256:model.sha256}}));
  const catalog={schemaVersion:2,codeRevision:'a'.repeat(40),dataRevision:'b'.repeat(40),files,model:modelManifest,analysisData,ocrResources,gazetteerResources:{},gazetteer:{revision:'c'.repeat(64),manifestSha256:gazetteer.sha256}};
  await file(plugin,'runtime.json',JSON.stringify(catalog));return {plugin,seed,catalog};
}

test('runtime seed validation refuses corrupt, missing, duplicate and escaping resources',async()=>{
  assert.equal(typeof runtime.verifyRuntimeFiles,'function');
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-integrity-'));
  try {
    const row=await file(dir,'data/item','original');await runtime.verifyRuntimeFiles(dir,[row]);
    await assert.rejects(runtime.verifyRuntimeFiles(dir,[row,row]),/duplicate/i);
    await assert.rejects(runtime.verifyRuntimeFiles(dir,[{...row,path:'../item'}]),/path/i);
    await writeFile(join(dir,row.path),'changed!');await assert.rejects(runtime.verifyRuntimeFiles(dir,[row]),/hash|size/i);
    await assert.rejects(runtime.verifyRuntimeFiles(dir,[{...row,path:'missing'}]),/ENOENT|missing/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('installed catalog refuses a mixed data revision, gazetteer or unpinned lazy shard before creating a cache',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-pairing-'));
  try {
    const {plugin,catalog}=await fixture(dir),cacheRoot=join(dir,'cache');
    for(const patch of [{dataRevision:'d'.repeat(40)},{gazetteer:{...catalog.gazetteer,revision:'e'.repeat(64)}},
      {gazetteerResources:{'assets/data/reference-analysis/v1/gazetteer/names/x.json':{url:'https://example.org/unpinned',bytes:2,sha256:'f'.repeat(64)}}}]) {
      await writeFile(join(plugin,'runtime.json'),JSON.stringify({...catalog,...patch}));
      await assert.rejects(runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot}),/pair|gazetteer|resource/i);
      await assert.rejects(readdir(cacheRoot),/ENOENT/);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('another valid pending model cannot silently replace the immutable private default',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-default-model-'));
  try {
    const {plugin,catalog}=await fixture(dir),model=await file(plugin,'model/candidate.onnx','different-candidate');
    const manifest=await file(plugin,'model/candidate.manifest.json',JSON.stringify({trainingOnly:true,releaseApproved:false,evaluationStatus:'pending',model:{url:'candidate.onnx',sha256:model.sha256,bytes:model.bytes}}));
    await writeFile(join(plugin,'runtime.json'),JSON.stringify({...catalog,model:manifest}));
    await assert.rejects(runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot:join(dir,'cache')}),/default model|model.*pair/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('private installed resources create one reusable workspace without copying model weights',async()=>{
  assert.equal(typeof runtime.materializeWorkspace,'function');
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-cache-'));
  try {
    const {plugin,seed,catalog}=await fixture(dir),cacheRoot=join(dir,'cache');
    const first=await runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot});
    assert.equal(first.cacheHit,false);assert.equal(first.modelPath,join(plugin,catalog.model.path));
    assert.equal(await readFile(join(first.workspace,'tools/load-node-core.mjs'),'utf8'),'export const core=true;');
    assert.equal((await readdir(first.workspace)).includes('model'),false);
    const second=await runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot});
    assert.equal(second.cacheHit,true);assert.equal(second.workspace,first.workspace);
    assert.equal((await readdir(cacheRoot)).length,1);
    await writeFile(join(first.workspace,'tools/load-node-core.mjs'),'tampered');
    await assert.rejects(runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot}),/hash|size/i);
    assert.equal(await readFile(join(seed,'tools/load-node-core.mjs'),'utf8'),'export const core=true;');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('OCR prepares only a requested language, verifies decoded archive bytes and reuses them',async()=>{
  assert.equal(typeof runtime.ensureOcrLanguage,'function');
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-language-'));
  try {
    const bytes=Buffer.from('language-pack'),spec={url:'https://example.invalid/ell.gz',encoding:'gzip',bytes:bytes.length,sha256:sha(bytes)};
    const {plugin}=await fixture(dir,{ell:spec,ara:{...spec,url:'https://example.invalid/ara.gz'}});
    const prepared=await runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot:join(dir,'cache')});let requests=0;
    const fetchAsset=async()=>{requests++;return new Response(gzipSync(bytes));};
    await runtime.ensureOcrLanguage(prepared.workspace,'ell',{fetchAsset});
    await runtime.ensureOcrLanguage(prepared.workspace,'ell',{fetchAsset});assert.equal(requests,1);
    const ocr=join(prepared.workspace,'assets/data/reference-analysis/v1/ocr');
    assert.deepEqual(await readFile(join(ocr,'ell.traineddata.gz')),bytes);
    await assert.rejects(runtime.ensureOcrLanguage(prepared.workspace,'ara',{fetchAsset:async()=>new Response(gzipSync(Buffer.from('wrong')))}),/hash|size/i);
    assert.deepEqual(await readdir(ocr),['ell.traineddata.gz','manifest.json']);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a pre-existing preparation temporary file is never removed or overwritten',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-owned-temp-'));
  try {
    const {plugin,catalog}=await fixture(dir),cacheRoot=join(dir,'cache');
    const workspace=join(cacheRoot,sha(JSON.stringify(catalog)));
    const temporary=join(workspace,'package.json.part-'+process.pid);
    await mkdir(workspace,{recursive:true});await writeFile(temporary,'another active writer');
    await assert.rejects(runtime.materializeWorkspace({pluginRoot:plugin,cacheRoot}),/EEXIST/);
    assert.equal(await readFile(temporary,'utf8'),'another active writer');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('gazetteer resources use the same bounded hash-verified lazy asset loader',async()=>{
  assert.equal(typeof runtime.ensureRuntimeAsset,'function');
  const dir=await mkdtemp(join(tmpdir(),'map-runtime-gazetteer-'));
  try {
    await file(dir,'tools/library-archive.mjs',await readFile(new URL('../../tools/library-archive.mjs',import.meta.url)));
    const bytes=Buffer.from('{"aliases":[]}'),path='assets/data/reference-analysis/v1/gazetteer/names/abc.json';
    const spec={url:'https://example.org/pinned/shard',encoding:'identity',bytes:bytes.length,sha256:sha(bytes)};
    let calls=0;const fetchAsset=async()=>{calls++;return new Response(bytes);};
    await runtime.ensureRuntimeAsset(dir,path,spec,{fetchAsset});
    await runtime.ensureRuntimeAsset(dir,path,spec,{fetchAsset});assert.equal(calls,1);
    assert.deepEqual(await readFile(join(dir,path)),bytes);
    await assert.rejects(runtime.ensureRuntimeAsset(dir,path,{...spec,sha256:'a'.repeat(64)},{fetchAsset}),/hash|size/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});
