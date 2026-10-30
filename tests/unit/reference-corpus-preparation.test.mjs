import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {prepareReviewCorpus} from '../../tools/reference-analysis/prepare-review.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'pando-review-')),sources=join(root,'sources');await mkdir(sources);
  t.after(()=>rm(root,{recursive:true}));
  const image=await readFile('tests/fixtures/map-image/jpeg-read/orientation-6.jpg');
  const source={id:'sheet',familyId:'atlas',language:'fas',script:'Arabic',rightsReviewed:true,
    sha256:sha(image),url:'https://example.org/map.jpg',license:'CC0',uncertainty:'Unknown date'};
  await writeFile(join(sources,'sheet.jpg'),image);await writeFile(join(sources,'sheet.source.json'),JSON.stringify(source));
  return {root,sources,image,source};
}
test('preparation preserves originals and independent edits and requires review',async t=>{
  const {root,sources,image}=await fixture(t),manifest=await prepareReviewCorpus(sources);
  const first=JSON.parse(await readFile(manifest,'utf8')),labels=join(root,'labels/sheet.json');
  assert.equal(first.trainingReady,false);assert.equal(first.sheets[0].image,'sources/sheet.jpg');assert.equal(first.sheets[0].split,null);
  assert.deepEqual(JSON.parse(await readFile(labels,'utf8')),{schemaVersion:1,reviewed:false,width:9,height:12,lines:[],ignore:[]});
  const changed=JSON.parse(await readFile(labels,'utf8'));changed.lines=[{kind:'frame',points:[[1,1],[2,1]],width:1}];await writeFile(labels,JSON.stringify(changed));
  first.sheets[0].split='test';await writeFile(manifest,JSON.stringify(first));const saved=await readFile(manifest);
  assert.equal(await prepareReviewCorpus(sources),manifest);assert.deepEqual(await readFile(manifest),saved);
  assert.deepEqual(JSON.parse(await readFile(labels,'utf8')),changed);assert.deepEqual(await readFile(join(sources,'sheet.jpg')),image);
});
test('invalid source identities and later failures create no draft output',async t=>{
  const {root,sources,source,image}=await fixture(t);
  for(const delta of [{id:'../outside'},{rightsReviewed:false},{sha256:'0'.repeat(64)},{ocrLanguages:['unknown']}]){
    await writeFile(join(sources,'sheet.source.json'),JSON.stringify({...source,...delta}));
    await assert.rejects(prepareReviewCorpus(sources));await assert.rejects(readFile(join(root,'corpus.draft.json')),{code:'ENOENT'});
  }
  await writeFile(join(sources,'sheet.source.json'),JSON.stringify(source));await writeFile(join(sources,'z.jpg'),image);
  await writeFile(join(sources,'z.source.json'),JSON.stringify({...source,id:'z',sha256:'0'.repeat(64)}));
  await assert.rejects(prepareReviewCorpus(sources),/hash/i);await assert.rejects(readFile(join(root,'labels/sheet.json')),{code:'ENOENT'});
});
test('PNG and WebP originals remain their source formats with oriented dimensions',async t=>{
  for(const format of ['png','webp']){
    const {root,sources,source}=await fixture(t),image=await readFile(`tests/fixtures/map-image/${format}-read/orientation-6.${format}`);
    await writeFile(join(sources,'sheet.'+format),image);await writeFile(join(sources,'sheet.source.json'),JSON.stringify({...source,format,sha256:sha(image)}));
    const manifest=JSON.parse(await readFile(await prepareReviewCorpus(sources),'utf8'));
    assert.equal(manifest.sheets[0].image,'sources/sheet.'+format);
    const labels=JSON.parse(await readFile(join(root,'labels/sheet.json'),'utf8'));
    assert.deepEqual([labels.width,labels.height],format==='png'?[9,12]:[17,23]);
    assert.deepEqual(await readFile(join(sources,'sheet.'+format)),image);
  }
});
test('mismatched existing labels and out-of-root symlinks are preserved and rejected',async t=>{
  const {root,sources}=await fixture(t);const manifest=await prepareReviewCorpus(sources),labels=join(root,'labels/sheet.json');
  const value=JSON.parse(await readFile(labels,'utf8'));value.width++;await writeFile(labels,JSON.stringify(value));
  const before=await readFile(labels),original=await readFile(manifest);
  await assert.rejects(prepareReviewCorpus(sources),/dimensions/i);assert.deepEqual(await readFile(labels),before);assert.deepEqual(await readFile(manifest),original);
  const other=await mkdtemp(join(tmpdir(),'pando-outside-'));t.after(()=>rm(other,{recursive:true}));
  const second=await fixture(t);await symlink(other,join(second.root,'labels'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(prepareReviewCorpus(second.sources),/escape/i);
});
