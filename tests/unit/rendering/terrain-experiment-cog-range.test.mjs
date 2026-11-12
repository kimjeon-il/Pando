import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createVerifiedRangeClient} from '../../../scripts/terrain-experiment/verified-cog-reader.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=Uint8Array.from({length:1000},(_,i)=>(i*31)%256),chunkBytes=128;
const manifest={bytes:bytes.length,chunkBytes,sha256:sha(bytes),chunks:Array.from({length:Math.ceil(bytes.length/chunkBytes)},
  (_,i)=>sha(bytes.subarray(i*chunkBytes,Math.min(bytes.length,(i+1)*chunkBytes))))};
const serve=({badStatus=false,badRange=false,corrupt=false}={})=>async(_url,{headers})=>{
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(headers.Range),start=Number(a),end=Number(b),body=bytes.slice(start,end+1);
  if(corrupt)body[0]^=1;
  return new Response(body,{status:badStatus?200:206,headers:{'Content-Range':badRange?'bytes 0-0/1':`bytes ${start}-${end}/${bytes.length}`}});
};

test('verified COG range assembles exact bytes and reuses authenticated chunks',async()=>{
  const client=createVerifiedRangeClient({url:'https://example.test/data.tif',manifest,fetchFn:serve()});
  const first=await client.request({headers:{Range:'bytes=120-260'}});
  assert.equal(first.getHeader('content-range'),'bytes 120-260/1000');
  assert.deepEqual(new Uint8Array(await first.getData()),bytes.slice(120,261));
  assert.equal(client.statistics.requests,3);assert.equal(client.statistics.cachedBytes,384);
  const second=await client.request({headers:{Range:'bytes=121-129'}});
  assert.deepEqual(new Uint8Array(await second.getData()),bytes.slice(121,130));
  assert.equal(client.statistics.requests,3);assert.equal(client.statistics.cacheHits,2);
  const last=await client.request({headers:{Range:'bytes=990-1100'}});
  assert.deepEqual(new Uint8Array(await last.getData()),bytes.slice(990));
});

test('verified COG rejects full, malformed or corrupted responses',async()=>{
  for(const options of [{badStatus:true},{badRange:true},{corrupt:true}]){
    const client=createVerifiedRangeClient({url:'https://example.test/data.tif',manifest,fetchFn:serve(options)});
    await assert.rejects(client.request({headers:{Range:'bytes=0-31'}}));
    assert.equal(client.statistics.cacheHits,0);
  }
});

test('concurrent COG reads share a request without coupling caller cancellation',async()=>{
  let calls=0;
  const delayed=async(url,options)=>{
    calls++;
    await new Promise((yes,no)=>{
      const timer=setTimeout(yes,25);
      options.signal.addEventListener('abort',()=>{clearTimeout(timer);no(options.signal.reason);},{once:true});
    });
    return serve()(url,options);
  };
  const client=createVerifiedRangeClient({url:'https://example.test/data.tif',manifest,fetchFn:delayed});
  const controller=new AbortController();
  const cancelled=client.request({headers:{Range:'bytes=0-31'},signal:controller.signal});
  const survivor=client.request({headers:{Range:'bytes=5-15'}});
  controller.abort(new Error('cancelled first consumer'));
  await assert.rejects(cancelled,/cancelled first consumer/);
  assert.deepEqual(new Uint8Array(await (await survivor).getData()),bytes.slice(5,16));
  assert.equal(calls,1);assert.equal(client.statistics.inflightHits,1);
});

test('a fully cancelled chunk can be requested again without a poisoned cache',async()=>{
  let calls=0;
  const delayed=async(url,options)=>{
    calls++;
    await new Promise((yes,no)=>{
      const timer=setTimeout(yes,25);
      options.signal.addEventListener('abort',()=>{clearTimeout(timer);no(options.signal.reason);},{once:true});
    });
    return serve()(url,options);
  };
  const client=createVerifiedRangeClient({url:'https://example.test/data.tif',manifest,fetchFn:delayed}),controller=new AbortController();
  const first=client.request({headers:{Range:'bytes=0-31'},signal:controller.signal});
  controller.abort(new Error('cancelled last consumer'));
  await assert.rejects(first,/cancelled last consumer/);
  const retry=await client.request({headers:{Range:'bytes=0-31'}});
  assert.deepEqual(new Uint8Array(await retry.getData()),bytes.slice(0,32));assert.equal(calls,2);
});

test('COG verified chunk cache obeys its byte budget and evicts least recently used data',async()=>{
  const client=createVerifiedRangeClient({url:'https://example.test/data.tif',manifest,fetchFn:serve(),maxCacheBytes:128});
  for(const range of ['bytes=0-15','bytes=128-143','bytes=0-15'])await client.request({headers:{Range:range}});
  assert.equal(client.statistics.requests,3);assert.equal(client.statistics.evictions,2);
  assert.equal(client.statistics.cachedBytes,128);assert.equal(client.statistics.maxCacheBytes,128);
});
