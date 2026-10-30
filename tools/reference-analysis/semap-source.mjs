// Bounded access to immutable source archive byte ranges.
import {setTimeout as delay} from 'node:timers/promises';
import {crc32} from 'node:zlib';
import {readZipRangeMember,zipRangeMembers} from '../lib/geonames-zip.mjs';

const record='https://zenodo.org/api/records/19048095';
const archiveSizes=Object.freeze({'images.zip':2007189820,'labels.zip':258666716});
const institutions=new Set(['loc','bostonleventhal','nypl','erara','princeton','unileiden','wwu_munster','berkeleylib',
  'bordeaux_montaigne','emanuscripta','illinois','uva']);
export function semapMemberIdentity(name){
  if(typeof name!=='string')return null;
  const match=/^images\/real\/([a-z]+(?:_[a-z]+)*)_([0-9]+)-[0-9]+_[0-9]+_[0-9]+\.jpg$/.exec(name);
  return match?{institution:match[1],document:match[2]}:null;
}
export function selectRealTrainingMembers(names,training){
  if(!Array.isArray(names)||!(training instanceof Set))throw Error('Explicit source members and training partition required');
  return names.filter(name=>{const identity=semapMemberIdentity(name);return identity&&institutions.has(identity.institution)&&
    training.has(name.slice(name.lastIndexOf('/')+1,-4));}).sort();
}
export async function openSourceArchive({size,readRange,signal}){
  signal?.throwIfAborted();const members=await zipRangeMembers({size,readRange}),byName=new Map();
  for(const member of members){if(byName.has(member.name))throw Error('Duplicate ZIP member: '+member.name);byName.set(member.name,member);}
  return {members,async readMember(name,cached){
    signal?.throwIfAborted();const entry=byName.get(name);if(!entry||entry.name.endsWith('/'))throw Error('ZIP member not found: '+name);
    if(cached!==undefined){if(!(cached instanceof Uint8Array)||cached.length!==entry.uncompressed||(crc32(cached)>>>0)!==entry.crc32)
      throw Error('Cached original differs from publisher ZIP CRC');return Buffer.from(cached);}
    const value=await readZipRangeMember({entry,readRange});signal?.throwIfAborted();return value;
  }};
}
export async function openSemapArchive(name,{fetcher=fetch,signal}={}){
  if(!Object.hasOwn(archiveSizes,name))throw Error('Pinned Semap archive required');const size=archiveSizes[name];
  const readRange=(start,end)=>readPinnedHttpRange({url:`${record}/files/${name}/content`,total:size,start,end,fetcher,signal});
  return openSourceArchive({size,readRange,signal});
}

export async function readPinnedHttpRange({url,total,start,end,fetcher=fetch,signal}){
  signal?.throwIfAborted();
  if(typeof url!=='string'||!url.startsWith('https://')||typeof fetcher!=='function'||
    ![total,start,end].every(Number.isSafeInteger)||total<1||start<0||end<start||end>=total||end-start+1>8*1024*1024)
    throw Error('Invalid bounded source range');
  const parts=[];
  for(let first=start;first<=end;first+=128*1024){
    const last=Math.min(end,first+128*1024-1),expected=last-first+1;let value;
    for(let attempt=0;attempt<3;attempt++){
      signal?.throwIfAborted();const timeout=AbortSignal.timeout(45000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
      let response;
      try{response=await fetcher(url,{headers:{Range:`bytes=${first}-${last}`,'Accept-Encoding':'identity','User-Agent':'PandoLab-reference-import/1.0'},signal:requestSignal,redirect:'follow'});}
      catch(error){signal?.throwIfAborted();if(attempt===2)throw error;await delay(200*(attempt+1),undefined,{signal});continue;}
      if(response.status!==206||response.headers.get('content-range')!==`bytes ${first}-${last}/${total}`||
        (response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding').toLowerCase()))){
        await response.body?.cancel();throw Error('Server did not honor exact pinned source range');
      }
      if(!response.body)throw Error('Source range has no response body');
      const reader=response.body.getReader(),chunks=[];let size=0,readError;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
        if(size>expected){await reader.cancel();throw Error('Source range body exceeds requested bytes');}chunks.push(part.value);}}
      catch(error){readError=error;}
      finally{reader.releaseLock();}
      signal?.throwIfAborted();if(readError&&/exceeds requested/.test(readError.message))throw readError;
      if(!readError&&size===expected){value=Buffer.concat(chunks,size);break;}
      if(attempt===2)throw Error(`Source range body mismatch ${first}-${last}: received ${size}, expected ${expected}`,{cause:readError});
      await delay(200*(attempt+1),undefined,{signal});
    }
    parts.push(value);
  }
  return Buffer.concat(parts,end-start+1);
}
