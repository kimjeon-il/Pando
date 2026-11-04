// Immutable distribution boundary for shared Pando computation and storage tools.
// No model, plugin source, dependency environment or application checkout is included.
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,mkdir,writeFile,lstat,open,unlink} from 'node:fs/promises';
import {join,dirname,resolve,isAbsolute} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
function checkedPath(root,path){
  if(typeof path!=='string'||isAbsolute(path)||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..')||
    !/^(tools|scripts|shared|docs|build-native)\//.test(path))throw Error('Shared toolkit path ownership violation: '+path);
  return resolve(root,path);
}
function contract(pin){
  if(pin?.schema!=='pando-shared-toolkit'||pin.interfaceVersion!==1)throw Error('Unsupported shared toolkit interface');
  if(!/^[a-f0-9]{64}$/.test(pin.sha256)||!Number.isSafeInteger(pin.bytes)||pin.bytes<1||
    pin.source?.repository!=='kimjeon-il/Pando'||!/^[a-f0-9]{40}$/.test(pin.source.revision))throw Error('Invalid shared toolkit identity');
}
async function noLinks(root,path=''){
  let cursor=resolve(root);
  // Include ancestors: never install through an aliased/junction workspace.
  for(let parent=cursor;;parent=dirname(parent)){
    try{if((await lstat(parent)).isSymbolicLink())throw Error('Shared toolkit path traverses a link');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(dirname(parent)===parent)break;
  }
  for(const part of path.split('/').filter(Boolean)){
    cursor=join(cursor,part);
    try{if((await lstat(cursor)).isSymbolicLink())throw Error('Shared toolkit path traverses a link');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
export function encodeSharedToolkit({source,entries}){
  const seen=new Set(),files=entries.map(({path,data})=>{
    checkedPath('.',path);if(seen.has(path))throw Error('Duplicate shared toolkit path');seen.add(path);
    const bytes=Buffer.from(data);return {path,bytes:bytes.length,sha256:hash(bytes),data:bytes.toString('base64')};
  }).sort((a,b)=>a.path.localeCompare(b.path));
  const bytes=gzipSync(json({schema:'pando-shared-toolkit',interfaceVersion:1,source,files}),{level:9});
  const pin={schema:'pando-shared-toolkit',interfaceVersion:1,source,bytes:bytes.length,sha256:hash(bytes),
    inventorySha256:hash(JSON.stringify(files.map(({data,...row})=>row)))};contract(pin);
  return {bytes,pin};
}
function decode(bytes,pin){
  contract(pin);if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('Shared toolkit archive hash/identity mismatch');
  const artifact=JSON.parse(gunzipSync(bytes,{maxOutputLength:256*1024**2}));
  if(artifact.schema!==pin.schema||artifact.interfaceVersion!==pin.interfaceVersion||JSON.stringify(artifact.source)!==JSON.stringify(pin.source)||!Array.isArray(artifact.files)||!artifact.files.length)throw Error('Shared toolkit identity mismatch');
  if(hash(JSON.stringify(artifact.files.map(({data,...row})=>row)))!==pin.inventorySha256)throw Error('Shared toolkit inventory identity mismatch');
  const seen=new Set();
  for(const row of artifact.files){
    checkedPath('.',row.path);if(seen.has(row.path))throw Error('Duplicate shared toolkit path');seen.add(row.path);
    const data=Buffer.from(row.data,'base64');
    if(data.length!==row.bytes||hash(data)!==row.sha256)throw Error('Shared toolkit file hash mismatch: '+row.path);
  }
  return artifact;
}
export async function verifySharedToolkit(root,pin){
  contract(pin);await noLinks(root);
  const marker=JSON.parse(await readFile(join(root,'.shared-toolkit.json'),'utf8'));
  if(JSON.stringify(marker.pin)!==JSON.stringify(pin)||!Array.isArray(marker.files)||!marker.files.length||hash(JSON.stringify(marker.files))!==pin.inventorySha256)throw Error('Shared toolkit identity mismatch');
  const seen=new Set();
  for(const row of marker.files){
    const path=checkedPath(root,row.path);if(seen.has(row.path))throw Error('Duplicate shared toolkit path');seen.add(row.path);
    await noLinks(root,row.path);const bytes=await readFile(path);
    if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('Shared toolkit file hash mismatch: '+row.path);
  }
  return marker;
}
export async function installSharedToolkit({root,bytes,pin}){
  root=resolve(root);const artifact=decode(bytes,pin);await noLinks(root);await mkdir(root,{recursive:true});
  const lockPath=join(root,'.shared-toolkit.lock'),lock=await open(lockPath,'wx');
  try{
    try{await readFile(join(root,'.shared-toolkit.json'));await verifySharedToolkit(root,pin);return {cacheHit:true,pin};}
    catch(error){if(error.code!=='ENOENT')throw error;}
    // Validate the complete input and all pre-existing paths before writing.
    for(const row of artifact.files){
      const path=checkedPath(root,row.path);await noLinks(root,row.path);
      try{const data=await readFile(path);if(data.length!==row.bytes||hash(data)!==row.sha256)throw Error('Existing file conflicts with shared toolkit: '+row.path);}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    for(const row of artifact.files){
      const path=checkedPath(root,row.path);await mkdir(dirname(path),{recursive:true});
      try{await writeFile(path,Buffer.from(row.data,'base64'),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    await writeFile(join(root,'.shared-toolkit.json'),json({pin,files:artifact.files.map(({data,...row})=>row)}),{flag:'wx'});
    await verifySharedToolkit(root,pin);return {cacheHit:false,pin};
  }finally{await lock.close();await unlink(lockPath);}
}
