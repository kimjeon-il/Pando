import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const owner=new URL('../../scripts/lib/prepared-input-verification.mjs',import.meta.url);
const base='assets/data/builtin-world/generated/v1/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const bytes=gzipSync('{"entityId":"state:test","schemaVersion":2}');
 const row={entityId:'state:test',file:`countries/state-test-sha256-${sha(bytes)}.json.gz`,sha256:sha(bytes),encoding:'gzip',compressedBytes:bytes.length,decodedBytes:42};
 const chunks=[bytes.subarray(0,20),bytes.subarray(20)],files=new Map();
 row.parts=chunks.map(bytes=>{const file=`country-parts/sha256-${sha(bytes)}.bin`;files.set(base+file,bytes);return {file,sha256:sha(bytes),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length};});
 files.set(base+'index.json',Buffer.from(JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',entities:[row]})));
 files.set('assets/data/other.bin',Buffer.from('other'));
 const calls=[],read=path=>{calls.push(path);assert.ok(files.has(path),'Unexpected or retired physical read: '+path);return files.get(path);};
 return {bytes,row,files,calls,read,hashes:{[base+row.file]:sha(bytes)}};
}
async function verifier(){
 assert.ok(existsSync(owner),'A country-aware prepared input verifier is required');
 return (await import(owner.href)).verifyPreparedInputHashes;
}
test('prepared input hashes resolve split countries without reading their retired originals',async()=>{
 const verify=await verifier(),f=fixture();verify(f.hashes,f.read);
 assert.deepEqual(f.calls,[base+'index.json',...f.row.parts.map(part=>base+part.file)]);
});
test('prepared input verification still rejects corrupt physical country parts',async()=>{
 const verify=await verifier(),f=fixture();f.files.set(base+f.row.parts[0].file,Buffer.from('broken'));
 assert.throws(()=>verify(f.hashes,f.read),/Invalid country bytes/);
});
test('a correct reconstructed country cannot excuse a stale prepared input hash',async()=>{
 const verify=await verifier(),f=fixture();f.hashes[base+f.row.file]='0'.repeat(64);
 assert.throws(()=>verify(f.hashes,f.read),/prepared input/);
});
test('retired aggregate and unreferenced country inputs fail instead of restoring archive payloads',async()=>{
 const verify=await verifier(),f=fixture();
 assert.throws(()=>verify({[base+'transport/old.bin']:'old'},f.read),/Retired builtin/);assert.deepEqual(f.calls,[]);
 assert.throws(()=>verify({[base+'countries/old.json.gz']:'old'},f.read),/Unreferenced builtin/);
 assert.deepEqual(f.calls,[base+'index.json']);
});
test('ordinary prepared input hash validation remains exact',async()=>{
 const verify=await verifier(),f=fixture(),path='assets/data/other.bin';
 verify({[path]:sha(f.files.get(path))},f.read);
 assert.throws(()=>verify({[path]:'0'.repeat(64)},f.read),/prepared input/);
});
