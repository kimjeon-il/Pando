import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual as equal} from 'node:util';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const archiveChunkBytes=32*1024*1024;
export const archiveChunkThreshold=90*1024*1024;
const schema='pando-library-gzip-chunks-v1';
const fail=message=>{throw Error('Library chunk archive: '+message);};
function manifestFor(entry){return {schema,sha256:entry.sha256,bytes:entry.bytes,packedSha256:entry.packedSha256,packedBytes:entry.packedBytes,chunks:entry.chunks};}
export function assertChunkEntry(entry){
 if(entry?.encoding!=='gzip-chunks'||!sha(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>2*1024**3||!sha(entry.packedSha256)||!Number.isSafeInteger(entry.packedBytes)||entry.packedBytes<1||entry.packedBytes>512*1024**2||!sha(entry.manifestSha256)||!Number.isSafeInteger(entry.manifestBytes)||entry.manifestBytes<1||entry.manifestBytes>1024*1024||entry.stored!=='archive/blobs/'+entry.sha256+'.gzip-chunks.json'||!Array.isArray(entry.chunks)||entry.chunks.length<1||entry.chunks.length>1024)fail('invalid manifest identity or bounds');
 let offset=0;for(const part of entry.chunks){if(!sha(part?.sha256)||part.stored!=='archive/chunks/'+part.sha256+'.bin'||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>archiveChunkBytes||part.offset!==offset)fail('invalid part path, size or offset');offset+=part.bytes;if(!Number.isSafeInteger(offset))fail('packed size overflow');}if(offset!==entry.packedBytes)fail('packed size mismatch');return entry;
}
/** Only the already-compressed bytes are split. Canonical JSON and its hash stay unchanged. */
export function encodeChunkedArchive(packed,{sha256,bytes},{chunkBytes=archiveChunkBytes}={}){
 if(!Buffer.isBuffer(packed)||!packed.length||packed.length>512*1024**2||!sha(sha256)||!Number.isSafeInteger(bytes)||bytes<0||bytes>2*1024**3||!Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>archiveChunkBytes)fail('invalid input');
 if(Math.ceil(packed.length/chunkBytes)>1024)fail('part count exceeds bound');
 const outputs=new Map(),chunks=[];for(let at=0;at<packed.length;at+=chunkBytes){const part=packed.subarray(at,at+chunkBytes),digest=hash(part),stored='archive/chunks/'+digest+'.bin';outputs.set(stored,part);chunks.push({stored,sha256:digest,bytes:part.length,offset:at});}
 const entry={stored:'archive/blobs/'+sha256+'.gzip-chunks.json',encoding:'gzip-chunks',sha256,bytes,packedSha256:hash(packed),packedBytes:packed.length,chunks};const manifest=Buffer.from(JSON.stringify(manifestFor(entry))+'\n');entry.manifestBytes=manifest.length;entry.manifestSha256=hash(manifest);assertChunkEntry(entry);outputs.set(entry.stored,manifest);return {entry,outputs};
}
/** Full stored-object inventory is in the pinned index, so partial clones can prefetch once. */
export function archiveStoredResources(entry){
 if(entry?.encoding==='gzip-chunks'){assertChunkEntry(entry);return [{stored:entry.stored,bytes:entry.manifestBytes},...entry.chunks.map(p=>({stored:p.stored,bytes:p.bytes}))];}
 if(!entry||typeof entry.stored!=='string'||!['identity','gzip'].includes(entry.encoding)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Unknown library archive encoding or size');return [{stored:entry.stored,bytes:entry.bytes}];
}
export function decodeLibraryArchiveBytes(stored,entry,{readStored}={}){
 if(entry?.encoding==='gzip-chunks'){
  assertChunkEntry(entry);if(!Buffer.isBuffer(stored)||stored.length!==entry.manifestBytes||hash(stored)!==entry.manifestSha256)fail('manifest hash/size mismatch');let manifest;try{manifest=JSON.parse(stored);}catch{fail('invalid manifest JSON');}if(!equal(manifest,manifestFor(entry)))fail('manifest/index mismatch');if(typeof readStored!=='function')fail('part reader required');
  const parts=entry.chunks.map(p=>{const bytes=readStored(p.stored,p);if(!Buffer.isBuffer(bytes)||bytes.length!==p.bytes||hash(bytes)!==p.sha256)fail('part hash/size mismatch');return bytes;});stored=Buffer.concat(parts,entry.packedBytes);if(hash(stored)!==entry.packedSha256)fail('packed hash mismatch');
 }else if(!['gzip','identity'].includes(entry?.encoding)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Unknown library archive encoding or size');
 const bytes=entry.encoding==='identity'?stored:gunzipSync(stored,{maxOutputLength:entry.bytes+1});if(!Buffer.isBuffer(bytes)||bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)throw Error('Library transfer is corrupt (size/hash mismatch): '+(entry.stored||'resource'));return bytes;
}

export function archiveStoredPaths(entry){return entry?.encoding==='gzip-chunks'?archiveStoredResources(entry).map(item=>item.stored):[entry.stored];}

export function planSourceGeometryArchive(logicalPath,packed,{sha256,bytes},{threshold=archiveChunkThreshold,chunkBytes=archiveChunkBytes}={}){
 const match=/^assets\/data\/territorial-entities\/source\/geometries\/sha256-([a-f0-9]{64})\.json$/.exec(logicalPath);
 if(!match)return null;
 if(!Buffer.isBuffer(packed)||!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(threshold)||threshold<1||threshold>archiveChunkThreshold||match[1]!==sha256)fail('source archive scope/hash mismatch');
 if(packed.length<=threshold||packed.length>=bytes)return null;
 return encodeChunkedArchive(packed,{sha256,bytes},{chunkBytes});
}
