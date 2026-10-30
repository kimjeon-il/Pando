import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
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
  assert.equal(await validateReviewedCorpus(input,root),input);
  assert.deepEqual(evaluationGroups([sheet,{...sheet,id:'other',language:'urd'}]),{'monochrome/Arabic/fas':['map'],'monochrome/Arabic/urd':['other']});
  const manifest=join(root,'review.json');await writeFile(manifest,JSON.stringify(input));
  const result=JSON.parse(execFileSync(process.execPath,['tools/reference-analysis/reviewed-corpus.mjs','--corpus',manifest],{encoding:'utf8'}));
  assert.deepEqual(result,{valid:true,groups:{'monochrome/Arabic/fas':['map']}});
});
test('reviewed corpus rejects split leakage, paths, source and unreviewed labels',async t=>{
  const {root,sheet,annotation}=await fixture(t);const check=rows=>validateReviewedCorpus({schemaVersion:1,sheets:rows},root);
  await assert.rejects(check([sheet,{...sheet,id:'other',split:'test'}]),/familyId.*split/i);
  await assert.rejects(check([{...sheet,image:'../outside'}]),/path|inside|escape/i);
  await assert.rejects(check([{...sheet,sha256:'0'.repeat(64)}]),/hash/i);
  await writeFile(join(root,'labels/map.json'),JSON.stringify({...annotation,reviewed:false}));await assert.rejects(check([sheet]),/source.reviewed/i);
});
test('reviewed corpus rejects training-only and unavailable OCR packs',async t=>{
  const {root,sheet}=await fixture(t);
  await assert.rejects(validateReviewedCorpus({schemaVersion:1,trainingOnly:true,sheets:[sheet]},root),/training.only/i);
  await assert.rejects(validateReviewedCorpus({schemaVersion:1,sheets:[{...sheet,ocrLanguages:['missing']}]},root),/OCR/i);
});
