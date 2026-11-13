import {createHash} from 'node:crypto';

// Prepare verified in-memory proxy responses before any candidate starts.
export async function prefetchFixtureTiles({records,region,base,fetchFn=globalThis.fetch,concurrency=6}){
  if(!Array.isArray(records)||typeof region!=='string'||!region||typeof base!=='string'||typeof fetchFn!=='function'||
    !Number.isSafeInteger(concurrency)||concurrency<1)throw new TypeError('Invalid fixture prefetch configuration');
  const selected=records.filter(record=>record.region===region),tiles=new Map();
  if(!selected.length)throw Error('Fixture region is empty');
  let next=0,bytes=0;
  const started=performance.now();
  await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},async()=>{
    while(next<selected.length){
      const record=selected[next++];
      if(typeof record.file!=='string'||!/^[a-z0-9-]+\.webp$/.test(record.file)||
        !Number.isSafeInteger(record.webpBytes)||record.webpBytes<1||!/^[a-f0-9]{64}$/.test(record.webpSha256)||tiles.has(record.file))
        throw Error('Invalid or duplicate fixture identity');
      const response=await fetchFn(new URL(record.file,base));
      if(!response.ok)throw Error(`Fixture tile HTTP ${response.status}`);
      const value=Buffer.from(await response.arrayBuffer());
      if(value.length!==record.webpBytes||createHash('sha256').update(value).digest('hex')!==record.webpSha256)
        throw Error('Fixture tile identity mismatch');
      tiles.set(record.file,value);bytes+=value.length;
    }
  }));
  if(tiles.size!==selected.length)throw Error('Duplicate fixture identities');
  return {tiles,bytes,files:tiles.size,durationMs:performance.now()-started};
}
