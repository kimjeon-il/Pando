import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {compareCurrentWeb, parseGitTree} from './live-web-parity.mjs';

const blobSha=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const sample=()=>{
  const paths=[
    'reports/places/tier1-major-cities-batch01.json',
    'reports/places/historical-display-policy.json'
  ];
  const contents=new Map(paths.map((path,index)=>[path,Buffer.from('fixture-'+index)]));
  const manifest={files:paths.map(path=>({path,gitBlobSha:blobSha(contents.get(path))}))};
  const upstream=paths.map(path=>({type:'file',name:path.split('/').at(-1),sha:blobSha(contents.get(path))}));
  return {contents,manifest,upstream,read:path=>contents.get(path)};
};
test('matching same-commit Web blob identities pass without a fixed commit number',()=>{
  const {manifest,upstream,read}=sample();
  const result=compareCurrentWeb(manifest,upstream,read);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.batchCount,1);
});

test('same-commit Git tree keeps exact Web blob IDs and filenames',()=>{
  const {upstream}=sample();
  const tree=upstream.map(row=>`100644 blob ${row.sha}\treports/places/${row.name}`).join('\n')+'\n';
  assert.deepEqual(parseGitTree(tree),upstream);
});
test('changed upstream JSON and newly added batches are detected',()=>{
  const {manifest,upstream,read}=sample();
  upstream[0].sha=blobSha(Buffer.from('new upstream'));
  upstream.push({type:'file',name:'tier1-major-cities-batch02-test.json',
    sha:blobSha(Buffer.from('new batch'))});
  const result=compareCurrentWeb(manifest,upstream,read);
  assert.ok(result.errors.some(e=>e.includes('Stale Web source')));
  assert.ok(result.errors.some(e=>e.includes('New upstream review batch')));
});
test('local bytes inconsistent with the pinned source fail independently of upstream',()=>{
  const {manifest,upstream}=sample();
  const result=compareCurrentWeb(manifest,upstream,()=>Buffer.from('corrupted'));
  assert.ok(result.errors.some(e=>e.includes('Canonical report differs from pinned Git blob')));
});
