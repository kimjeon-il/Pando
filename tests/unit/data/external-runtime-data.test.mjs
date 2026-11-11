import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createExternalRuntimeDataFetch, validateExternalRuntimeData } from '../../../src/data/external-runtime-data.js';

const revision='3f63c1c3e36cef5249e806a0f76615362e79204c';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=Buffer.from('verified external content'),segment=bytes.subarray(9,17);
const logical='assets/data/test/content.bin',base='https://viewer.test/app/';
const entry={stored:'archive/blobs/content.bin',encoding:'identity',bytes:bytes.length,sha256:sha(bytes),
  segments:[{offset:9,bytes:segment.length,sha256:sha(segment)}]};
const meta={externalRuntimeData:{revision,files:{[logical]:entry}}};

test('external data resolves fixed archive bytes, verifies them, and preserves local bootstrap',async()=>{
  const calls=[];
  const runtimeFetch=createExternalRuntimeDataFetch({meta,fetchFn:async(url,init)=>{
    calls.push({url:String(url),init});return new Response(bytes);
  }});
  const response=await runtimeFetch(new URL(logical,base));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal(calls[0].url,`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/${entry.stored}`);
  await runtimeFetch(new URL('assets/data/projects/world/manifest.json',base));
  assert.equal(calls[1].url,new URL('assets/data/projects/world/manifest.json',base).href);
  await assert.rejects(runtimeFetch(new URL('assets/data/test/missing.bin',base)),/Missing pinned/);
});

test('outer archive gzip is decoded before logical length and hash verification',async()=>{
  const gzip={...entry,encoding:'gzip',stored:'archive/blobs/content.gz'};delete gzip.segments;
  const runtimeFetch=createExternalRuntimeDataFetch({meta:{externalRuntimeData:{revision,files:{[logical]:gzip}}},
    fetchFn:async()=>new Response(gzipSync(bytes))});
  assert.deepEqual(Buffer.from(await (await runtimeFetch(new URL(logical,base))).arrayBuffer()),bytes);
});

test('range responses verify complete segments without trusting inaccessible Content-Range',async()=>{
  let requested;
  const runtimeFetch=createExternalRuntimeDataFetch({meta,fetchFn:async(url,init)=>{
    requested=init.headers.Range;return new Response(segment,{status:206});
  }});
  const response=await runtimeFetch(new URL(logical,base),{headers:{Range:'bytes=11-13'}});
  assert.equal(requested,'bytes=9-16');
  assert.equal(response.headers.get('Content-Range'),`bytes 11-13/${bytes.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(11,14));
  const corrupted=createExternalRuntimeDataFetch({meta,fetchFn:async()=>new Response(Buffer.alloc(segment.length),{status:206})});
  await assert.rejects(corrupted(new URL(logical,base),{headers:{Range:'bytes=11-13'}}),/hash mismatch/);
});

test('mismatched bytes and unsafe archive paths fail closed',async()=>{
  assert.throws(()=>validateExternalRuntimeData({revision,files:{[logical]:{...entry,stored:'archive/blobs/../bad'}}}));
  const bad=createExternalRuntimeDataFetch({meta,fetchFn:async()=>new Response(Buffer.alloc(bytes.length))});
  await assert.rejects(bad(new URL(logical,base)),/hash mismatch/);
  const missing=createExternalRuntimeDataFetch({meta,fetchFn:async()=>new Response('',{status:404})});
  await assert.rejects(missing(new URL(logical,base)),error=>error.httpStatus===404);
});

test('external project origins are not rewritten as pinned viewer resources',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'location'),calls=[];
  Object.defineProperty(globalThis,'location',{configurable:true,value:{href:base,origin:'https://viewer.test'}});
  try {
    const runtimeFetch=createExternalRuntimeDataFetch({meta,fetchFn:async url=>{calls.push(String(url));return new Response(bytes);}});
    await runtimeFetch('https://other.test/assets/data/test/content.bin');
    await runtimeFetch(new URL(logical,base));
    assert.equal(calls[0],'https://other.test/assets/data/test/content.bin');
    assert.equal(calls[1],`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/${entry.stored}`);
  } finally {
    if(original)Object.defineProperty(globalThis,'location',original);else delete globalThis.location;
  }
});

test('external hydro reads and caches a whole verified shard before selecting packs',async()=>{
  const packed=gzipSync(Buffer.from('water')), container=Buffer.concat([Buffer.from('prefix'),packed,Buffer.from('tail')]);
  const shard={id:1,url:'hydro.bin',offset:6,bytes:packed.length,fileBytes:container.length,sha256:sha(packed)};
  const path='assets/data/hydro/hydro.bin';
  const externalRuntimeData={revision,files:{[path]:{stored:path,encoding:'identity',bytes:container.length,
    sha256:sha(container),segments:[{offset:shard.offset,bytes:shard.bytes,sha256:shard.sha256}]}}};
  const calls=[];
  const runtimeFetch=createExternalRuntimeDataFetch({meta:{externalRuntimeData},fetchFn:async(_url,init)=>{
    calls.push(init.headers.Range);return new Response(packed,{status:206});
  }});
  const scope={self:{},Response,Uint8Array,Map};
  vm.runInNewContext(readFileSync(new URL('../../../src/rendering/workers/hydro-shard-store.js',import.meta.url),'utf8'),scope);
  const store=scope.self.createHydroShardStore({verifiedExternal:true,fetchResponse:runtimeFetch,openCache:async()=>null,
    resolveUrl:()=>new URL(path,base).href,gunzip:value=>new Uint8Array(gunzipSync(value)),digest:async value=>sha(value)});
  for(let i=0;i<2;i++){
    const rows=await store.read(shard,[{id:7,offset:0,length:packed.length}],0,packed.length);
    assert.equal(Buffer.from(rows[0][1]).toString(),'water');
  }
  assert.deepEqual(calls,[`bytes=${shard.offset}-${shard.offset+shard.bytes-1}`]);
});
