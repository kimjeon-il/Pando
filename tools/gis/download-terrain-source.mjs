/** Download large pinned sources with validated HTTP byte ranges.
 * A failed transfer never turns a partly preallocated file into a complete source.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync,
  renameSync, rmSync, statSync, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function natural(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw Error('Invalid '+label);
  return value;
}
async function checkedFetch(fetcher, url, init, ms) {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(ms), redirect:'follow' });
  return res;
}
export async function downloadVerifiedRanges({ url, output, workers = 6, chunkMiB = 64, fetcher = fetch,
  quiet = false }) {
  if (!/^https?:\/\//u.test(url) || !output) throw Error('HTTP(S) URL and --output required');
  natural(workers, 'worker count', 32);
  natural(chunkMiB, 'chunk MiB', 128);
  const headers={ 'Accept-Encoding':'identity' };
  const head=await checkedFetch(fetcher,url,{method:'HEAD',headers},30000);
  if (!head.ok || head.headers.get('accept-ranges')?.toLowerCase()!=='bytes')
    throw Error('Server does not advertise byte ranges');
  const contentLength=head.headers.get('content-length');
  const size=Number(contentLength);
  if (!contentLength || !Number.isSafeInteger(size) || size<=0) throw Error('Invalid Content-Length');
  const etag=head.headers.get('etag'), modified=head.headers.get('last-modified');
  const destination=resolve(output);
  mkdirSync(dirname(destination),{recursive:true});
  const prefix=existsSync(destination)?statSync(destination).size:0;
  if (prefix>size)throw Error('Existing file is larger than source');
  if (!quiet)console.log('source='+size+' prefix='+prefix+' remaining='+(size-prefix));
  if (prefix===size) return {status:'already-complete',size,prefix,downloaded:0};
  const stage=destination+'.download-'+randomUUID()+'.tmp';
  if(prefix)copyFileSync(destination,stage);
  else {const fd=openSync(stage,'wx');closeSync(fd);}
  const chunkSize=chunkMiB*1024*1024, ranges=[];
  for(let start=prefix;start<size;start+=chunkSize)
    ranges.push([start,Math.min(size-1,start+chunkSize-1)]);
  let transferred=0,index=0,failed=null;
  let handle;
  try {
    handle=await fs.open(stage,'r+');
    await handle.truncate(size);
    async function worker() {
      while(index<ranges.length && !failed) {
        const [start,end]=ranges[index++];
        try {
          let lastError;
          for(let attempt=0;attempt<4;attempt++){
            try {
              const partHeaders={...headers,Range:'bytes='+start+'-'+end};
              if(etag||modified)partHeaders['If-Range']=etag||modified;
              const res=await checkedFetch(fetcher,url,{method:'GET',headers:partHeaders},90000);
              const expected='bytes '+start+'-'+end+'/'+size;
              if(res.status!==206 || res.headers.get('content-range')!==expected)
                throw Error('Bad range response: '+res.status+' '+res.headers.get('content-range'));
              if(res.headers.get('content-encoding') && res.headers.get('content-encoding')!=='identity')
                throw Error('Unexpected content-encoding in range response');
              const bytes=Buffer.from(await res.arrayBuffer());
              if(bytes.length!==end-start+1)throw Error('Short range '+start+'-'+end+': '+bytes.length);
              let written=0;
              while(written<bytes.length){
                const part=await handle.write(bytes,written,bytes.length-written,start+written);
                if(!part.bytesWritten)throw Error('Empty file write');
                written+=part.bytesWritten;
              }
              transferred+=bytes.length;
              if(!quiet)console.log('received='+transferred+' of '+(size-prefix));
              lastError=null;break;
            } catch(error) {
              lastError=error;
              if(attempt===3)throw error;
            }
          }
          if(lastError)throw lastError;
        }catch(error){failed=error;return;}
      }
    }
    await Promise.all(Array.from({length:Math.min(workers,ranges.length)},()=>worker()));
    if(failed)throw failed;
    if(transferred!==size-prefix)throw Error('Downloaded byte count mismatch');
    await handle.sync();
    await handle.close();handle=null;
    const tail=await checkedFetch(fetcher,url,{method:'HEAD',headers},30000);
    if(!tail.ok||tail.headers.get('content-length')!==String(size)||
       tail.headers.get('etag')!==etag||tail.headers.get('last-modified')!==modified)
      throw Error('Source changed during ranged download');
    renameSync(stage,destination);
    if(!quiet)console.log('completed='+statSync(destination).size);
    return {status:'completed',size,prefix,downloaded:transferred};
  } finally {
    if(handle)await handle.close();
    rmSync(stage,{force:true});
  }
}
function parseArgs(args) {
  const out={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(!['--url','--output','--workers','--chunk-mib'].includes(key))throw Error('Unknown argument: '+key);
    if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+key);
    out[key==='--chunk-mib'?'chunkMiB':key.slice(2)]=['--workers','--chunk-mib'].includes(key)?Number(args[++i]):args[++i];
  }
  return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  downloadVerifiedRanges(parseArgs(process.argv.slice(2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
