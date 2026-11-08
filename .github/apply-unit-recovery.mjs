// Temporary reviewed source recovery; the complete patch has an immutable SHA-256.
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const bytes=readFileSync('.github/test-scope-recovery.patch');
const identity=createHash('sha256').update(bytes).digest('hex');
if(identity!=='213071ff7295caa2045dbde43ca928414835c565348d681d9844a223a2858ffd')throw Error('Recovery patch checksum mismatch');
const patch=bytes.toString('utf8');
const parts=patch.split(/(?=^diff --git a\/)/m).filter(Boolean);
if(parts.length!==115)throw Error('Recovery patch file count mismatch: '+parts.length);
const applied=[],already=[],retired=[];
const permitted=p=>/^(?:tests\/unit\/|\.github\/workflows\/|scripts\/contracts\/)/.test(p)||p==='package.json'||p==='scripts/lib/check-changes.mjs';
for(const part of parts){
  const match=/^diff --git a\/([^\n]+) b\/([^\n]+)\n/.exec(part);
  if(!match||match[1]!==match[2])throw Error('Noncanonical diff header');
  const path=match[1];
  if(!permitted(path)||relative(process.cwd(),resolve(path)).startsWith('..'))throw Error('Unsafe patch path: '+path);
  const hashes=/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m.exec(part);
  if(!hashes)throw Error('Missing source identity: '+path);
  const current=existsSync(path)?execFileSync('git',['hash-object','--',path],{encoding:'utf8'}).trim():null;
  const after=hashes[2],isDelete=part.includes('deleted file mode ');
  if((current&&current.startsWith(after))||(!current&&(after.startsWith('000000')||isDelete))){
    already.push(path);continue;
  }
  if(!current&&!part.includes('new file mode ')){
    // A later commit retired this test completely. Never resurrect obsolete tests.
    if(!path.startsWith('tests/unit/'))throw Error('Missing currently required source: '+path);
    retired.push(path);continue;
  }
  const result=spawnSync('git',['apply','--3way','--index','-'],{input:part,encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.status!==0)throw Error('Cannot apply reviewed edit without overriding newer changes: '+path+'\n'+(result.stderr||result.stdout));
  applied.push(path);
}
const names=execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!names.length)throw Error('No newly applied changes; do not issue an empty commit');
if(names.some(x=>!permitted(x)))throw Error('Unreviewed staged path');
execFileSync('git',['diff','--cached','--check'],{stdio:'inherit'});
writeFileSync('/tmp/pando-test-scope-output.json',JSON.stringify(names.map(path=>({path})),null,2)+'\n');
console.log(JSON.stringify({reviewed:parts.length,applied:applied.length,already:already.length,retired:retired.length,retiredPaths:retired,staged:names.length},null,2));
