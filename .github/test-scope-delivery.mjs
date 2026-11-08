// Temporary, reviewed delivery tool; removed after remote read-back.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {dirname,resolve,relative,join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';
const hash=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
let encoded=readFileSync('.github/test-scope-patch-v2.b64','utf8');
// Exact corrections against the archived transport, not edits to application source.
if(blob(Buffer.from(encoded))==='6ec91d00a408e9c2f689db56bccc1f5f5a1c5aa6'){
  for(const [start,end,text] of [[4809,4810,''],[3053,3054,''],[2999,2999,'q1Xiw83'],[2951,2952,'5'],[2944,2945,''],[2746,2747,'']])encoded=encoded.slice(0,start)+text+encoded.slice(end);
}
if(blob(Buffer.from(encoded))!=='da20814a8aa89ed3e9beb9b88caa9c328c388c6b')throw Error('Encoded review checksum mismatch');
const raw=inflateSync(Buffer.from(encoded.trim(),'base64'),{maxOutputLength:4*1024*1024});
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

  // Preserve already-applied outputs and merge independently changed current files.
  // No repository file is written until every reviewed path has passed this preflight.
  if(before===row.a) {
    bytes=before===null?null:readFileSync(path);
  } else if(before!==row.b) {
    if(before===null||row.b===null||row.a===null) {
      throw Error('Concurrent add/remove requires manual review: '+path+' expected '+row.b+' actual '+before);
    }
    const base=execFileSync('git',['cat-file','blob',row.b],{maxBuffer:8*1024*1024});
    const current=readFileSync(path);
    if(blob(base)!==row.b||blob(current)!==before)throw Error('Inconsistent merge sources: '+path);
    for(const item of [base,current,bytes]){
      if(item.includes(0)||!Buffer.from(item.toString('utf8')).equals(item)) {
        throw Error('Non-UTF8 or binary overlap requires manual review: '+path);
      }
    }
    const temp=mkdtempSync(join(tmpdir(),'pando-scope-merge-'));
    try {
      const ours=join(temp,'current'),ancestor=join(temp,'ancestor'),theirs=join(temp,'reviewed');
      writeFileSync(ours,current);writeFileSync(ancestor,base);writeFileSync(theirs,bytes);
      try {
        bytes=execFileSync('git',['merge-file','-p',ours,ancestor,theirs],{maxBuffer:8*1024*1024});
      } catch(error) {
        // A whole-file merge can report a conflict when an unrelated adjacent
        // section changed. Apply only the exact reviewed diff with normal
        // context; git apply rejects any nonmatching hunk.
        let delta;
        try {
          delta=execFileSync('git',['diff','--no-index','--unified=3','--','ancestor','reviewed'],{cwd:temp,maxBuffer:8*1024*1024});
        } catch(diffError) {
          if(diffError.status!==1)throw diffError;
          delta=diffError.stdout;
        }
        const patch=delta.toString('utf8')
          .replace(/^diff --git a\\/ancestor b\\/reviewed/m,'diff --git a/current b/current')
          .replace(/^--- a\\/ancestor/m,'--- a/current')
          .replace(/^\\+\\+\\+ b\\/reviewed/m,'+++ b/current');
        try {
          execFileSync('git',['apply','--check','-'],{cwd:temp,input:patch,maxBuffer:8*1024*1024});
          execFileSync('git',['apply','-'],{cwd:temp,input:patch,maxBuffer:8*1024*1024});
          bytes=readFileSync(ours);
          console.log('Merged using context-checked independent hunks: '+path);
        } catch(applyError) {
          throw Error('Merge conflict requires manual review: '+path+' (merge '+error.status+', hunk '+applyError.status+')');
        }
      }
    } finally {
      rmSync(temp,{recursive:true,force:true});
    }
    console.log('Merged reviewed changes with concurrent edits: '+path);
  }
  outputs.push({path,bytes});
}
// No file is changed until all source, destination and output identities match.
for(const {path,bytes} of outputs){if(bytes===null)unlinkSync(path);else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}}
const result=outputs.map(({path,bytes})=>({path,sha256:bytes===null?null:hash(bytes),blob:bytes===null?null:blob(bytes)}));
writeFileSync('/tmp/pando-test-scope-output.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({files:result.length,removed:result.filter(x=>x.blob===null).length,outputs:result},null,2));
