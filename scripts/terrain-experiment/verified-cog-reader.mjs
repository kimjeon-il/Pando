// Experimental COG reader: verify each fixed-size chunk before decoding.
import {fromCustomClient} from 'geotiff';

const hex=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function createVerifiedRangeClient({url,manifest,fetchFn=globalThis.fetch}={}){
  if(typeof url!=='string'||!url||typeof fetchFn!=='function'||!manifest||
    !Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||!Number.isSafeInteger(manifest.chunkBytes)||manifest.chunkBytes<1||
    !Array.isArray(manifest.chunks)||manifest.chunks.length!==Math.ceil(manifest.bytes/manifest.chunkBytes)||
    manifest.chunks.some(value=>!validHash(value))||!validHash(manifest.sha256))throw new TypeError('Invalid COG chunk manifest');
  const cache=new Map(),statistics={requests:0,networkBytes:0,cacheHits:0};
  async function chunk(index,signal){
    signal?.throwIfAborted();
    if(cache.has(index)){statistics.cacheHits++;return cache.get(index);}
    const start=index*manifest.chunkBytes,end=Math.min(manifest.bytes,start+manifest.chunkBytes)-1;
    const response=await fetchFn(url,{headers:{Range:`bytes=${start}-${end}`},signal});statistics.requests++;
    if(response.status!==206)throw Error(`COG range HTTP ${response.status}; full-file responses are forbidden`);
    const range=response.headers.get('Content-Range');
    if(range!==`bytes ${start}-${end}/${manifest.bytes}`)throw Error('COG Content-Range is missing or mismatched');
    const bytes=new Uint8Array(await response.arrayBuffer());statistics.networkBytes+=bytes.length;
    if(bytes.length!==end-start+1)throw Error('COG range length mismatch');
    if(await digest(bytes)!==manifest.chunks[index])throw Error('COG range SHA-256 mismatch');
    signal?.throwIfAborted();cache.set(index,bytes);return bytes;
  }
  return {url,statistics,async request({headers,signal}={}){
    const match=/^bytes=(\d+)-(\d+)$/.exec(headers?.Range||headers?.range||'');
    if(!match)throw Error('One explicit COG byte range is required');
    const start=Number(match[1]),requestedEnd=Number(match[2]);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start<0||start>=manifest.bytes||requestedEnd<start)
      throw Error('COG byte range is invalid');
    const end=Math.min(requestedEnd,manifest.bytes-1),first=Math.floor(start/manifest.chunkBytes),last=Math.floor(end/manifest.chunkBytes);
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
