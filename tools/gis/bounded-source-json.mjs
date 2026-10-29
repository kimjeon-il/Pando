/** Bounded HTTPS-only source requests for read-only GIS evidence. */
export async function fetchBoundedBytes(url,{fetcher=fetch,signal,timeoutMs,limit,headers}){
  const active=signal ? AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let current=new URL(url),response;
  if(current.protocol!=='https:')throw Error('HTTPS is required for source requests');
  for(let redirects=0;redirects<=10;redirects++){
    response=await fetcher(current,{headers,signal:active,redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');if(!location)throw Error('Missing redirect location');
    current=new URL(location,current);if(current.protocol!=='https:')throw Error('HTTPS is required for source redirects');
    await response.body?.cancel();response=null;
  }
  if(!response)throw Error('Too many source redirects');
  if(!response.ok||!response.body)throw Error('Service response unavailable: '+response.status);
  if(Number(response.headers.get('content-length'))>limit){await response.body.cancel();throw Error('Oversized source response');}
  const chunks=[];let total=0;
  for await(const part of response.body){
    active.throwIfAborted();total+=part.length;if(total>limit)throw Error('Truncated or oversized sample');chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks);
}
export async function fetchBoundedJson(url,options){return JSON.parse((await fetchBoundedBytes(url,options)).toString('utf8'));}
