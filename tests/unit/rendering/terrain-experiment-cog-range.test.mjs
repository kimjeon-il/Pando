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
  assert.equal(client.statistics.requests,3);
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
