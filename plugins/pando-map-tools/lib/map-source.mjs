import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, statfs, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const formats = { jpeg:'.jpg', pdf:'.pdf', png:'.png', webp:'.webp' };
const digest = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function httpsUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('Map source download requires HTTPS'); }
  if (parsed.protocol !== 'https:') throw Error('Map source download and redirects require HTTPS');
  return parsed;
}
async function download(url, fetcher, signal) {
  for (let redirects = 0; redirects <= 10; redirects++) {
    signal.throwIfAborted();
    const response = await fetcher(httpsUrl(url), {redirect:'manual', signal, headers:{'User-Agent':'Map-Toolkit/0.4'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw Error('Map source redirect has no location');
      url = httpsUrl(new URL(location, url)).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok || !response.body) throw Error(`Map source download failed: HTTP ${response.status}`);
    return response;
  }
  throw Error('Too many map source redirects');
}
function signature(format, header) {
  if (format === 'pdf') return header.subarray(0,5).equals(Buffer.from('%PDF-'));
  if (format === 'jpeg') return header.subarray(0,2).equals(Buffer.from([0xff,0xd8]));
  if (format === 'png') return header.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  return header.subarray(0,4).toString() === 'RIFF' && header.subarray(8,12).toString() === 'WEBP';
}
export async function acquire(source, root, {fetcher=fetch, signal}={}) {
  if (source.rightsReviewed !== true || !source.license) return {id:source.id,status:'rights-unverified'};
  httpsUrl(source.url);
  if (typeof source.id !== 'string' || !/^[a-z0-9-]+$/.test(source.id)) throw Error('Unsafe source id');
  const format = source.format ?? 'jpeg', suffix = formats[format];
  if (!suffix) throw Error('Unsupported source format');
  root = resolve(root); await mkdir(root,{recursive:true}); root = await realpath(root);
  const target=join(root,source.id+suffix), evidence=join(root,source.id+'.source.json'), temporary=target+'.part';
  const targetStat=await exists(target), evidenceStat=await exists(evidence);
  if (targetStat?.isSymbolicLink() || evidenceStat?.isSymbolicLink()) throw Error('Source target escapes storage root');
  if (targetStat || evidenceStat) {
    if (!targetStat?.isFile() || !evidenceStat?.isFile()) throw Error('Incomplete existing source; preserve it for inspection');
    const stored=JSON.parse(await readFile(evidence,'utf8')), bytes=await readFile(target);
    if (stored.url!==source.url || stored.sha256!==digest('sha256',bytes)) throw Error('Existing source differs; never overwrite original evidence');
    if (source.sha256 != null && source.sha256!==stored.sha256) throw Error('Existing source differs from pinned original hash');
    return {id:source.id,status:'verified-existing',bytes:bytes.length,path:target,provenancePath:evidence};
  }
  const maximum=source.maximumBytes ?? 64*1024*1024;
  if (!Number.isSafeInteger(maximum) || maximum<=0) throw Error('A positive bounded source download budget is required');
  const disk=await statfs(root);
  const headroom=maximum>=1024**3 ? 5*1024**3 : 128*1024*1024;
  if (disk.bavail*disk.bsize < maximum+headroom) throw Error('Insufficient storage for bounded source acquisition');
  const activeSignal = signal ? AbortSignal.any([signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  let file, created=false, metadataCreated=false, published=false;
  try {
    activeSignal.throwIfAborted(); file=await open(temporary,'wx'); created=true;
    const response=await download(source.url,fetcher,activeSignal);
    const sha=createHash('sha256'),md5=createHash('md5'); let count=0, header=Buffer.alloc(0);
    for await (const chunk of response.body) {
      activeSignal.throwIfAborted(); const bytes=Buffer.from(chunk); count+=bytes.length;
      if (count>maximum) throw Error('Source exceeds declared download budget');
      if (header.length<16) header=Buffer.concat([header,bytes.subarray(0,16-header.length)]);
      sha.update(bytes);md5.update(bytes); await file.writeFile(bytes);
    }
    await file.close(); file=null;
    const sha256=sha.digest('hex'), md5sum=md5.digest('hex');
    if ((source.expectedBytes != null && source.expectedBytes!==count) || (source.md5 != null && source.md5!==md5sum) || (source.sha256 != null && source.sha256!==sha256)) throw Error('Source does not match depositor size/checksum');
    if (!count || !signature(format,header)) throw Error('Source is not a '+format.toUpperCase());
    activeSignal.throwIfAborted();
    const metadata=await open(evidence,'wx'); metadataCreated=true;
    try { await metadata.writeFile(JSON.stringify({...source,sha256,bytes:count,acquiredAt:new Date().toISOString(),annotations:null,reviewedLabels:false,trainingReady:false},null,2)+'\n'); } finally { await metadata.close(); }
    activeSignal.throwIfAborted();
    // link is an exclusive publication: an original created concurrently is never replaced.
    await link(temporary,target); published=true;
    return {id:source.id,status:'acquired-unlabelled',bytes:count,sha256,path:target,provenancePath:evidence};
  } finally {
    if (file) await file.close();
    if (created) await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if (metadataCreated && !published) await unlink(evidence).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
