// Temporary, reviewed delivery tool; removed after remote read-back.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {inflateSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const raw=inflateSync(Buffer.from(readFileSync('.github/test-scope-patch-v2.b64','utf8').trim(),'base64'),{maxOutputLength:4*1024*1024});
if(hash(raw)!=='f7f61f7d5ce1b578104cd8f01a6cf1f39627a0e54b407dcb2e4e1585f2dac3a1')throw Error('Review payload checksum mismatch');
const plan=JSON.parse(raw),sources=plan.blobs.map(sha=>{
  if(!/^[0-9a-f]{40}$/.test(sha))throw Error('Invalid source blob');
  const bytes=execFileSync('git',['cat-file','blob',sha],{maxBuffer:4*1024*1024});
  if(blob(bytes)!==sha)throw Error('Source blob mismatch');return bytes;
});
const outputs=[],seen=new Set();
for(const row of plan.files){
  const path=row.p;
  if(seen.has(path)||! /^(?:tests\/unit\/|scripts\/contracts\/|\.github\/workflows\/|package\.json$|scripts\/check-ussr-partition-native\.mjs$)/.test(path)||relative(process.cwd(),resolve(path)).startsWith('..'))throw Error('Unsafe or duplicate path: '+path);
  seen.add(path);
  const before=existsSync(path)?blob(readFileSync(path)):null;
  if(before!==row.b)throw Error('Concurrent change requires review: '+path+' expected '+row.b+' actual '+before);
  let bytes=null;
  if(row.a!==null){
    bytes=Buffer.concat(row.s.map(part=>{
      if(typeof part==='string')return Buffer.from(part);
      const [index,start,size]=part,source=sources[index];
      if(!source||!Number.isInteger(start)||!Number.isInteger(size)||start<0||size<0||start+size>source.length)throw Error('Invalid copy range');
      return source.subarray(start,start+size);
    }));
    if(blob(bytes)!==row.a)throw Error('Reviewed output mismatch: '+path);
  }
  outputs.push({path,bytes});
}
// No file is changed until all source, destination and output identities match.
for(const {path,bytes} of outputs){if(bytes===null)unlinkSync(path);else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}}
const result=outputs.map(({path,bytes})=>({path,sha256:bytes===null?null:hash(bytes),blob:bytes===null?null:blob(bytes)}));
writeFileSync('/tmp/pando-test-scope-output.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({files:result.length,removed:result.filter(x=>x.blob===null).length,outputs:result},null,2));
