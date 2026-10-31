// Candidate-only correction; never called by the production build.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const path='shared/frontend/js/modules/rendering-domain.js';
const test='tests/helpers/gpu-recovery-viewer-admission.test.mjs';
const evidence=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence');mkdirSync(evidence,{recursive:true});
const before=readFileSync(path,'utf8');
const blob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
assert.equal(blob(before),'087442eae29112c61287c67a8d39fd9de3469666','Rendering domain changed; review before applying the admission correction');
function run(name){
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap',test],{encoding:'utf8'});
 const output=result.stdout+result.stderr;writeFileSync(resolve(evidence,name+'.tap'),output);console.log(output);
 return{...result,output};
}
const red=run('admission-before');assert.equal(red.status,1);assert.match(red.output,/ERR_ASSERTION/);
assert.doesNotMatch(red.output,/ReferenceError|SyntaxError|TypeError|ERR_MODULE_NOT_FOUND/);
const old='  const invalidateGpuFrame = reason => invalidate(\n    MAP_RENDER_DIRTY.GPU_FRAME,';
assert.equal(before.split(old).length,2);
const after=before.replace(old,'  const invalidateGpuFrame = reason => invalidate(\n    // Upload completion draws a new frame and must enter the same approval\n    // path as view changes. The coordinator still rejects unready/stale draws.\n    MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.VIEW_PRESENTATION,');
writeFileSync(path,after);
assert.equal(spawnSync(process.execPath,['--check',path],{encoding:'utf8'}).status,0);
const green=run('admission-after');assert.equal(green.status,0);
writeFileSync(resolve(evidence,'admission-rendering-domain.js'),after);
writeFileSync(resolve(evidence,'admission-identity.json'),JSON.stringify({input:blob(before),output:blob(after),redExit:red.status,greenExit:green.status},null,2));
const diff=spawnSync('git',['diff','--',path],{encoding:'utf8'});assert.equal(diff.status,0);writeFileSync(resolve(evidence,'admission.patch'),diff.stdout);
