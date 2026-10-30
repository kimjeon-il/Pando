import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {openSourceArchive,orderSemapTrainingMembers,readPinnedHttpRange,readPinnedSmallFile,readTrainingPartition,selectRealTrainingMembers} from '../../tools/reference-analysis/semap-source.mjs';
import {zipRangeMembers,readZipRangeMember} from '../../tools/lib/geonames-zip.mjs';

test('bounded source ranges retry short bodies and join partial stream chunks',async()=>{
  const requests=[];let attempts=0;
  const fetcher=async(_url,{headers})=>{
    requests.push(headers.Range);attempts++;
    const body=attempts===1?new Uint8Array([1,2,3]):new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.enqueue(new Uint8Array([4,5,6]));c.close();}});
    return new Response(body,{status:206,headers:{'Content-Range':'bytes 10-15/100'}});
  };
  assert.deepEqual(await readPinnedHttpRange({url:'https://example.test/source.zip',total:100,start:10,end:15,fetcher}),Buffer.from([1,2,3,4,5,6]));
  assert.deepEqual(requests,['bytes=10-15','bytes=10-15']);
});
test('large logical reads use individually bounded exact HTTP ranges',async()=>{
  const input=Buffer.alloc(128*1024+1,73),requests=[];
  const fetcher=async(_url,{headers})=>{const match=/^bytes=(\d+)-(\d+)$/.exec(headers.Range);assert(match);
    const first=Number(match[1]),last=Number(match[2]);requests.push([first,last]);
    return new Response(input.subarray(first,last+1),{status:206,headers:{'Content-Range':`bytes ${first}-${last}/${input.length}`}});};
  assert.deepEqual(await readPinnedHttpRange({url:'https://example.test/source.zip',total:input.length,start:0,end:input.length-1,fetcher}),input);
  assert.deepEqual(requests,[[0,131071],[131072,131072]]);
});
test('range ZIP reads only selected source members and validates CRC',async()=>{
  const bytes=await readFile('tests/fixtures/reference-semap/range.zip'),calls=[];
  const readRange=async(start,end)=>{calls.push([start,end]);return bytes.subarray(start,end+1);};
  const entries=await zipRangeMembers({size:bytes.length,readRange});
  const selected=entries.find(entry=>entry.name==='images/real/selected.jpg');assert(selected);
  assert.equal((await readZipRangeMember({entry:selected,readRange})).toString(),'original source');
  const source=await openSourceArchive({size:bytes.length,readRange});
  const before=calls.length;assert.equal((await source.readMember(selected.name,Buffer.from('original source'))).toString(),'original source');
  assert.equal(calls.length,before,'Verified cached originals do not require another member read');
  await assert.rejects(source.readMember(selected.name,Buffer.from('modified source')),/CRC/i);
  assert(calls.reduce((total,[a,b])=>total+b-a+1,0)<bytes.length,'ZIP data should not be downloaded in full');
  const broken={...selected,crc32:(selected.crc32^1)>>>0};
  await assert.rejects(readZipRangeMember({entry:broken,readRange}),/CRC/i);
  await assert.rejects(zipRangeMembers({size:bytes.length,readRange:async()=>Buffer.from([1])}),/truncated/i);
});
test('only licensed real training members are selected and alternate tiles remain',()=>{
  const names=['images/real/loc_000001-0_0_0.jpg','images/real/loc_000001-1_0_0.jpg',
    'images/real/wwu_munster_109980-1_1697_6386.jpg','images/real/davidrumsey_001234-0_0_0.jpg','images/synthetic/4_output_1.jpg'];
  const training=new Set(names.map(name=>name.split('/').at(-1).replace(/\.jpg$/,'')));
  assert.deepEqual(selectRealTrainingMembers(names,training),names.slice(0,3));
});
test('real source candidates interleave institutions using original deterministic diversity order',()=>{
  const names=['images/real/loc_000001-0_0_0.jpg','images/real/loc_000001-1_0_0.jpg','images/real/loc_000002-0_0_0.jpg',
    'images/real/wwu_munster_109980-1_1697_6386.jpg','images/real/wwu_munster_000002-0_0_0.jpg'];
  const training=new Set(names.map(name=>name.split('/').at(-1).replace(/\.jpg$/,'')));
  assert.deepEqual(orderSemapTrainingMembers(names,training),[names[2],names[3],names[1],names[4],names[0]]);
});
test('bounded source ranges reject incorrect range, oversized data and cancellation',async()=>{
  const options={url:'https://example.test/source.zip',total:100,start:10,end:15};
  await assert.rejects(readPinnedHttpRange({...options,fetcher:async()=>new Response('abcdef',{status:206,headers:{'Content-Range':'bytes 0-5/100'}})}),/exact pinned/i);
  await assert.rejects(readPinnedHttpRange({...options,fetcher:async()=>new Response('abcdefg',{status:206,headers:{'Content-Range':'bytes 10-15/100'}})}),/exceeds/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readPinnedHttpRange({...options,signal:controller.signal}));
  await assert.rejects(readPinnedHttpRange({...options,end:99,total:100,start:-1}),/range/i);
});
test('small partition and rights evidence must match its pinned length and digest',async()=>{
  const options={url:'https://example.test/license',size:6,md5:'e80b5017098950fc58aad83c8c14978e'};
  assert.equal((await readPinnedSmallFile({...options,fetcher:async()=>new Response('abcdef')})).toString(),'abcdef');
  await assert.rejects(readPinnedSmallFile({...options,fetcher:async()=>new Response('abc')}),/identity/i);
  await assert.rejects(readPinnedSmallFile({...options,fetcher:async()=>new Response('ABCDEF')}),/identity/i);
  await assert.rejects(readPinnedSmallFile({...options,fetcher:async()=>new Response('abcdefg')}),/exceeds/i);
});
test('author partition requires one CRC-verified training list',async()=>{
  assert.deepEqual([...await readTrainingPartition(await readFile('tests/fixtures/reference-semap/partition.zip'))],['loc_000001-1_0_0','loc_000001-0_0_0']);
  await assert.rejects(readTrainingPartition(await readFile('tests/fixtures/reference-semap/partition-duplicate.zip')),/unique/i);
});
