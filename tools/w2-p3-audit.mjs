import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Specify evidence directory');
const read=n=>{const file=base+'/'+n+(existsSync(base+'/'+n)?'':'.gz');const b=readFileSync(file);return JSON.parse(file.endsWith('.gz')?gunzipSync(b):b);};
const a=read('analysis.json');assert.equal(a.consistent,true);assert.equal(a.complete,true);
assert.equal(a.runs.flatMap(r=>r.samples).length,600);
for(const k of ['A','B','A2']){assert.equal(a.conditions[k].coldRuns,10);assert.equal(a.conditions[k].warmDisplay.n,20);assert.equal(a.conditions[k].memorySamples,160);}
const extra=['A-untraced-memory','B-untraced-memory','B-forced-memory','latest-regression'];
for(const name of extra){const r=read(name+'.json');assert.equal(r.status,'passed',name);assert.deepEqual(r.processesAfterClose,[],name);for(const s of r.samples)assert.equal(s.semantic.hash,a.hashes[s.target]);for(const s of r.forced||[])assert.equal(s.semantic.hash,a.hashes[s.semantic.month]);for(const c of r.checkpoints){assert.equal(c.after.workers.jsComplete,true);assert.equal(c.after.workers.wasmComplete,true);if(c.after.cache.supported){assert.ok(c.after.cache.residentBytes<=96*1024**2);assert.equal(c.after.cache.count,1);assert.ok(c.after.cache.arrays.every(v=>v.detached===false));}}}
assert.equal(read('A-untraced-memory.json').samples.length,160);assert.equal(read('B-untraced-memory.json').samples.length,160);assert.equal(read('B-forced-memory.json').forced.length,60);
assert.equal(read('worker-invalidation-regression.json').passed,true);
for(const name of ['B-browser-regression-v3','latest-browser-regression']){const r=read(name+'.json');assert.equal(r.status,'passed');assert.equal(r.contextRecovered,true);assert.equal(r.workerErrorObserved,true);assert.equal(r.workerRecovered,true);}
for(const name of ['smoke-B','latest-regression'])assert.deepEqual(read(name+'.json').stale,{rejected:4,unchanged:true});
for(const row of read('screenshot-comparison.json').slice(0,3))assert.equal(row.differentPixels,0);
assert.match(readFileSync(base+'/focused-unit.log','utf8'),/fail 0/);
const sha=b=>createHash('sha256').update(b).digest('hex');for(const p of read('preflight.json').files)assert.equal(sha(readFileSync('D:/dev/worktrees/ui/'+p.path)),p.sha256);
for(const root of ['w2-p2-diagnostic','w2-p3-before','w2-p3-after','w2-p3-latest'])assert.equal(execFileSync('git',['-C','D:/dev/worktrees/'+root,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
writeFileSync(base+'/final-audit.json',JSON.stringify({at:new Date().toISOString(),passed:true,primaryTransitions:600,additionalUntracedTransitions:320,forcedRepreparations:60,latestTransitions:6,conditions:a.conditions.A.coldRuns===10?'10/10/10 fresh processes':'invalid',protectedFilesUnchanged:true,detachedSourcesClean:true,scopeOnly:true,knownEarlierDiagnosticFailures:['B-browser-regression.json','B-browser-regression-v2.json'],memoryVerdict:'See memory-verdict.md for bounded stability and trace-control evidence.'},null,2));
const files=[];function walk(dir,relative=''){for(const e of readdirSync(dir,{withFileTypes:true})){const rel=relative+e.name;if(e.isDirectory())walk(dir+'/'+e.name,rel+'/');else if(e.isFile()&&rel!=='SHA256SUMS.json'){const b=readFileSync(dir+'/'+e.name);files.push({path:rel,bytes:b.length,sha256:sha(b)});}else if(!e.isFile())throw Error('Unexpected linked artifact '+rel);}}walk(base);
writeFileSync(base+'/SHA256SUMS.json',JSON.stringify({at:new Date().toISOString(),files},null,2));console.log('W3_FINAL_AUDIT '+JSON.stringify({passed:true,files:files.length,bytes:files.reduce((n,v)=>n+v.bytes,0)}));
