import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prefetchFixtureTiles} from '../../../scripts/terrain-experiment/fixture-transfer.mjs';

test('equal-network fixture prefetch checks bytes and hashes and restricts the region',async()=>{
  const a=Buffer.from('first'),b=Buffer.from('second'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const records=[{region:'r',file:'a.webp',webpBytes:a.length,webpSha256:hash(a)},
    {region:'r',file:'b.webp',webpBytes:b.length,webpSha256:hash(b)},
    {region:'other',file:'c.webp',webpBytes:1,webpSha256:hash(Buffer.from('c'))}];
  const calls=[],fetchFn=async url=>{calls.push(url);return new Response(String(url).endsWith('a.webp')?a:b);};
  const result=await prefetchFixtureTiles({records,region:'r',base:'https://example.test/',fetchFn});
  assert.equal(result.tiles.size,2);assert.equal(result.bytes,a.length+b.length);assert.equal(calls.length,2);
  assert.deepEqual(result.tiles.get('a.webp'),a);
  await assert.rejects(()=>prefetchFixtureTiles({records,region:'r',base:'https://example.test/',fetchFn:async()=>new Response('bad')}),/identity mismatch/);
  await assert.rejects(()=>prefetchFixtureTiles({records,region:'missing',base:'https://example.test/',fetchFn}),/empty/);
});
