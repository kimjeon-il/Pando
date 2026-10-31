// Verification-only: materialize the reviewed candidate in a clean CI checkout.
// No commit, push, pin update, generated data rebuild or deployment is performed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=resolve(process.env.G4_EVIDENCE||'test-results/gpu-g4');
const hash=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const fixture=join(root,'tests/fixtures/gpu-recovery');
const compressed=Buffer.concat([1,2,3].map(n=>readFileSync(join(fixture,`candidate-source.gz.part${n}`))));
assert.equal(hash(compressed),'943b887fb3395b38803e7035d5e38111cb07ad95768bf99cf479614d57a21b2c');
const archive=JSON.parse(gunzipSync(compressed)),config=JSON.parse(archive['renderer-edits.json']);
const added='shared/frontend/js/modules/gpu-context-recovery.js';
const modified='tests/unit/gpu-shared-pass-initialization.test.mjs';
const paths=[config.path,added,modified];
const dirty=execFileSync('git',['status','--porcelain','--',...paths],{encoding:'utf8'}).trim();
assert.equal(dirty,'','Preserve uncommitted candidate files; refuse replacement');
const inputFiles={};
for(const [path,expected]of Object.entries({[config.path]:config.baseBlob,...config.pairedBlobs,[modified]:config.modifiedFiles[modified].baseBlob})){
 const bytes=readFileSync(join(root,path));assert.equal(blob(bytes),expected,`Reviewed input changed: ${path}`);inputFiles[path]=hash(bytes);
}
assert.equal(existsSync(join(root,added)),false,'Do not overwrite an existing recovery owner');
let source=readFileSync(join(root,config.path),'utf8');
for(const {before,after}of config.operations){assert.ok(before&&typeof after==='string');assert.equal(source.split(before).length,2,'Missing/nonunique candidate anchor: '+before.slice(0,100));source=source.replace(before,()=>after);}
const changes=new Map([[config.path,source],[added,archive['payload/'+added]],[modified,archive['payload/'+modified]]]);
assert.equal(hash(changes.get(added)),config.newFiles[added]);
assert.equal(hash(changes.get(modified)),config.modifiedFiles[modified].sha256);
const pin=readFileSync('config/library-data.json');
for(const [path,text]of changes){assert.equal(typeof text,'string');mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);execFileSync(process.execPath,['--check',path]);}
assert.deepEqual(readFileSync('config/library-data.json'),pin,'Data pin must not change');
mkdirSync(out,{recursive:true});
const evidence={schema:'pando-gpu-g4-candidate-v1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fixtureSha256:hash(compressed),candidateApplied:true,operationCount:config.operations.length,dataPin:JSON.parse(pin),inputFiles,outputFiles:Object.fromEntries([...changes].map(([p,t])=>[p,hash(t)]))};
writeFileSync(join(out,'candidate-identity.json'),JSON.stringify(evidence,null,2)+'\n');
writeFileSync(join(out,'candidate.patch'),execFileSync('git',['diff','--no-ext-diff','--',config.path,modified],{maxBuffer:4*1024*1024}));
writeFileSync(join(out,'gpu-context-recovery.js'),changes.get(added));
console.log(JSON.stringify(evidence));
