import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// Storage format owner shared by local archive restoration and scoped Work fetches.
export function decodeLibraryArchiveBytes(stored,entry) {
  if(!['gzip','identity'].includes(entry.encoding)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Unknown library archive encoding or size');
  const bytes=entry.encoding==='gzip'?gunzipSync(stored,{maxOutputLength:entry.bytes+1}):stored;
  if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Library transfer is corrupt (size/hash mismatch): '+(entry.stored||'resource'));
  return bytes;
}
