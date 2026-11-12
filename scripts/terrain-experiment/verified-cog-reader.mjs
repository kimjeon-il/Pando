// Experimental COG reader: verify each fixed-size chunk before decoding.
import {fromCustomClient} from 'geotiff';

const hex=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function createVerifiedRangeClient({url,manifest,fetchFn=globalThis.fetch,maxCacheBytes=32*1024*1024,maxCoalescedChunks=1}={}){
  if(typeof url!=='string'||!url||typeof fetchFn!=='function'||!manifest||
    !Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||!Number.isSafeInteger(manifest.chunkBytes)||manifest.chunkBytes<1||
    !Array.isArray(manifest.chunks)||manifest.chunks.length!==Math.ceil(manifest.bytes/manifest.chunkBytes)||
    manifest.chunks.some(value=>!validHash(value))||!validHash(manifest.sha256)||
    !Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<0||!Number.isSafeInteger(maxCoalescedChunks)||maxCoalescedChunks<1||maxCoalescedChunks>16)
    throw new TypeError('Invalid COG chunk manifest or cache budget');
  const cache=new Map(),pending=new Map(),statistics={requests:0,networkBytes:0,cacheHits:0,inflightHits:0,cachedBytes:0,evictions:0,maxCacheBytes};
  function cacheChunk(index,bytes){
    if(bytes.length>maxCacheBytes)return;
    if(cache.has(index)){statistics.cachedBytes-=cache.get(index).length;cache.delete(index);}
    while(statistics.cachedBytes+bytes.length>maxCacheBytes&&cache.size){
      const oldest=cache.keys().next().value;statistics.cachedBytes-=cache.get(oldest).length;cache.delete(oldest);statistics.evictions++;
    }
    statistics.cachedBytes+=bytes.length;cache.set(index,bytes);
  }
  function createBatch(first,last){
    const batch={controller:new AbortController(),waiters:0,settled:false};
    const start=first*manifest.chunkBytes,end=Math.min(manifest.bytes,(last+1)*manifest.chunkBytes)-1;
    batch.promise=(async()=>{
    statistics.requests++;
    const response=await fetchFn(url,{headers:{Range:`bytes=${start}-${end}`},signal:batch.controller.signal});
    if(response.status!==206)throw Error(`COG range HTTP ${response.status}; full-file responses are forbidden`);
    const range=response.headers.get('Content-Range');
    if(range!==`bytes ${start}-${end}/${manifest.bytes}`)throw Error('COG Content-Range is missing or mismatched');
    const bytes=new Uint8Array(await response.arrayBuffer());statistics.networkBytes+=bytes.length;
    if(bytes.length!==end-start+1)throw Error('COG range length mismatch');
    const blocks=[];
    for(let index=first;index<=last;index++){
      const from=(index-first)*manifest.chunkBytes,block=bytes.slice(from,Math.min(bytes.length,from+manifest.chunkBytes));
      if(await digest(block)!==manifest.chunks[index])throw Error('COG range SHA-256 mismatch');
      blocks.push(block);
    }
    batch.controller.signal.throwIfAborted();
    blocks.forEach((block,index)=>cacheChunk(first+index,block));
    return blocks;
    })().finally(()=>{
      batch.settled=true;
      for(let index=first;index<=last;index++)if(pending.get(index)?.batch===batch)pending.delete(index);
    });
    for(let index=first;index<=last;index++)pending.set(index,{batch,offset:index-first,consumers:0});
  }
  function prime(first,last){
    for(let index=first;index<=last;){
      if(cache.has(index)||pending.has(index)){index++;continue;}
      let end=index;
      while(end<last&&end-index+1<maxCoalescedChunks&&!cache.has(end+1)&&!pending.has(end+1))end++;
      createBatch(index,end);index=end+1;
    }
  }
  function chunk(index,signal){
    signal?.throwIfAborted();
    if(cache.has(index)){statistics.cacheHits++;const value=cache.get(index);cache.delete(index);cache.set(index,value);return Promise.resolve(value);}
    const entry=pending.get(index),batch=entry.batch;
    if(entry.consumers)statistics.inflightHits++;
    entry.consumers++;batch.waiters++;
    return new Promise((yes,no)=>{
      let done=false;
      const finish=callback=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.consumers--;batch.waiters--;
        if(!batch.settled&&batch.waiters===0){
          for(const [key,value] of pending)if(value.batch===batch)pending.delete(key);
          batch.controller.abort();
        }callback();};
      const abort=()=>finish(()=>no(signal.reason));
      signal?.addEventListener('abort',abort,{once:true});
      batch.promise.then(blocks=>finish(()=>yes(blocks[entry.offset])),error=>finish(()=>no(error)));
      if(signal?.aborted)abort();
    });
  }
  return {url,statistics,async request({headers,signal}={}){
    const match=/^bytes=(\d+)-(\d+)$/.exec(headers?.Range||headers?.range||'');
    if(!match)throw Error('One explicit COG byte range is required');
    const start=Number(match[1]),requestedEnd=Number(match[2]);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start<0||start>=manifest.bytes||requestedEnd<start)
      throw Error('COG byte range is invalid');
    const end=Math.min(requestedEnd,manifest.bytes-1),first=Math.floor(start/manifest.chunkBytes),last=Math.floor(end/manifest.chunkBytes);
    signal?.throwIfAborted();
    prime(first,last);
    const chunks=await Promise.all(Array.from({length:last-first+1},(_,i)=>chunk(first+i,signal)));
    const result=new Uint8Array(end-start+1);let written=0;
    for(let i=0;i<chunks.length;i++){
      const blockStart=(first+i)*manifest.chunkBytes,from=Math.max(start,blockStart)-blockStart,to=Math.min(end+1,blockStart+chunks[i].length)-blockStart;
      result.set(chunks[i].subarray(from,to),written);written+=to-from;
    }
    if(written!==result.length)throw Error('Incomplete verified COG range');
    return {ok:true,status:206,getHeader(name){const key=name.toLowerCase();
      if(key==='content-range')return `bytes ${start}-${end}/${manifest.bytes}`;
      if(key==='content-type')return 'image/tiff';return undefined;},async getData(){return result.buffer;}};
  }};
}

export async function openVerifiedCog(options){
  const client=createVerifiedRangeClient(options);
  const tiff=await fromCustomClient(client,{allowFullFile:false});
  return {tiff,statistics:client.statistics};
}
