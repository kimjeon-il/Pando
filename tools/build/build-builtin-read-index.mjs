import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readLibraryDataFile} from '../data/library-context.mjs';
import {writeLibraryOutput} from '../data/library-runtime.mjs';
import {readBuiltinCountryStoredBytes} from '../data/builtin-country-bytes.mjs';
import {compileBuiltinReadIndex} from '../../src/data/builtin-country-files.js';

/** Upgrade only small metadata, never geometry, meshes or source GIS. */
export function buildBuiltinReadIndex({root=process.cwd()}={}){
 const base='assets/data/builtin-world/generated/v1/';
 const read=file=>readLibraryDataFile(base+file,{root,fetch:true});
 const before=read('index.json'),index=JSON.parse(before);
 const descriptors=index.entities.map(entry=>{
  const bytes=gunzipSync(readBuiltinCountryStoredBytes(entry,read),{maxOutputLength:entry.decodedBytes+1});
  if(bytes.length!==entry.decodedBytes)throw Error('Country descriptor decoded length mismatch');
  return JSON.parse(bytes);
 });
 const {readIndex:old,...unchanged}=index;
 index.readIndex=compileBuiltinReadIndex(index,descriptors);
 const {readIndex,...retained}=index;
 if(JSON.stringify(unchanged)!==JSON.stringify(retained))throw Error('Unrelated catalog metadata changed');
 const after=Buffer.from(JSON.stringify(index)+'\n');
 if(!before.equals(after))writeLibraryOutput(resolve(root,base+'index.json'),after);
 return {identities:readIndex.identities.length,records:Object.fromEntries(Object.entries(readIndex.records).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),
  bytes:after.length,readIndexBytes:Buffer.byteLength(JSON.stringify(readIndex)),changed:!before.equals(after),sha256:createHash('sha256').update(after).digest('hex')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildBuiltinReadIndex()));
