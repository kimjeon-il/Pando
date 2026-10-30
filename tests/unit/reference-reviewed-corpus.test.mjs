import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validateReviewedCorpus,evaluationGroups} from '../../tools/reference-analysis/reviewed-corpus.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'pando-validated-'));t.after(()=>rm(root,{recursive:true}));
  await mkdir(join(root,'sources'));await mkdir(join(root,'labels'));
  const data=await readFile('tests/fixtures/map-image/png-read/orientation-6.png'),sha256=createHash('sha256').update(data).digest('hex');
  await writeFile(join(root,'sources/map.png'),data);
  const annotation={schemaVersion:1,reviewed:true,width:9,height:12,known:{international:[[[0,0],[8,0],[8,11],[0,11]]]},
    lines:[{kind:'international',width:1,points:[[1,4],[6,4]]}],ignore:[],review:{kind:'human',reviewer:'reviewer',reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:sha256,predictionBlind:true}};
  await writeFile(join(root,'labels/map.json'),JSON.stringify(annotation));
  const sheet={id:'map',familyId:'atlas',editionId:'one',duplicateGroup:'map',split:'train',image:'sources/map.png',annotations:'labels/map.json',
    sha256,language:'fas',script:'Arabic',mapKind:'monochrome',source:{url:'https://example.org',license:'CC0'}};
  return {root,sheet,annotation};
}
test('reviewed corpus validates materialized source and keeps language groups distinct',async t=>{
  const {root,sheet}=await fixture(t);const input={schemaVersion:1,sheets:[sheet]};
  const verified=[];assert.equal(await validateReviewedCorpus(input,root,{onVerified:entry=>verified.push(entry)}),input);
  assert.equal(verified.length,1);assert.equal(verified[0].annotation.review.sourceSha256,sheet.sha256);
  assert.equal(verified[0].annotationSha256,createHash('sha256').update(await readFile(join(root,'labels/map.json'))).digest('hex'));
  assert.deepEqual(evaluationGroups([sheet,{...sheet,id:'other',language:'urd'}]),{'monochrome/Arabic/fas':['map'],'monochrome/Arabic/urd':['other']});
  assert.deepEqual(Object.keys(evaluationGroups(['ara','fas','urd'].map((language,index)=>({...sheet,id:String(index),language})))).sort(),
    ['monochrome/Arabic/ara','monochrome/Arabic/fas','monochrome/Arabic/urd']);
  const manifest=join(root,'review.json');await writeFile(manifest,JSON.stringify(input));
  const result=JSON.parse(execFileSync(process.execPath,['tools/reference-analysis/reviewed-corpus.mjs','--corpus',manifest],{encoding:'utf8'}));
  assert.deepEqual(result,{valid:true,groups:{'monochrome/Arabic/fas':['map']}});
});
test('reviewed corpus rejects split leakage, paths, source and unreviewed labels',async t=>{
  const {root,sheet,annotation}=await fixture(t);const check=rows=>validateReviewedCorpus({schemaVersion:1,sheets:rows},root);
  await assert.rejects(check([sheet,{...sheet,id:'other',split:'test'}]),/familyId.*split/i);
  await assert.rejects(check([{...sheet,annotations:null}]),/annotations/i);
  await assert.rejects(check([{...sheet,image:'../outside'}]),/path|inside|escape/i);
  await assert.rejects(check([{...sheet,sha256:'0'.repeat(64)}]),/hash/i);
  await writeFile(join(root,'labels/map.json'),JSON.stringify({...annotation,reviewed:false}));await assert.rejects(check([sheet]),/source.reviewed/i);
});
test('reviewed corpus rejects training-only and unavailable OCR packs',async t=>{
  const {root,sheet}=await fixture(t);
  await assert.rejects(validateReviewedCorpus({schemaVersion:1,trainingOnly:true,sheets:[sheet]},root),/training.only/i);
  await assert.rejects(validateReviewedCorpus({schemaVersion:1,sheets:[{...sheet,ocrLanguages:['missing']}]},root),/OCR/i);
});
test('reviewed corpus refuses a path through a directory link outside its root',async t=>{
  const {root,sheet}=await fixture(t),outside=await mkdtemp(join(tmpdir(),'pando-corpus-outside-'));t.after(()=>rm(outside,{recursive:true}));
  await writeFile(join(outside,'map.png'),await readFile(join(root,'sources/map.png')));
  await symlink(outside,join(root,'escape'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(validateReviewedCorpus({schemaVersion:1,sheets:[{...sheet,image:'escape/map.png'}]},root),/escape/i);
});
test('source language remains distinct from the installed OCR pack catalog',async t=>{
  const {root,sheet}=await fixture(t);
  for(const [language,script] of [['afr','Latin'],['und','Zyyy']]){
    const row={...sheet,language,script,ocrLanguages:['eng']};const validated=await validateReviewedCorpus({schemaVersion:1,sheets:[row]},root);
    assert.equal(validated.sheets[0].language,language);
  }
  for(const language of ['lat','deu_latf','rus','ukr','heb','hye','kat','hin','ben','jpn_vert','chi_tra_vert'])
    await validateReviewedCorpus({schemaVersion:1,sheets:[{...sheet,language}]},root);
});
