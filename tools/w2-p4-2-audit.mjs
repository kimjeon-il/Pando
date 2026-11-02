import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');const read=n=>JSON.parse(readFileSync(base+'/'+n));
const analysis=read('p4-analysis.json'),expected={'2025-12':'84eeed0ee1b2268b7e841a121416355205dc20c306feb89373e58b18ff086ad5','2026-11':'e6010b615633fac3f1eef040f2a7a6a018937d86535c96b76d19d335ead31789'};
assert.equal(analysis.rows.length,120);for(const row of analysis.rows)assert.equal(row.hash,expected[row.target]);
for(const label of ['A','B','A2']){
 assert.equal(analysis.conditions[label].display.n,10);
 for(let i=0;i<10;i++){const r=read(`p4-${label}-cold-${i}.json`);assert.equal(r.status,'passed');assert.equal(r.errors.length,0);assert.equal(r.warnings.filter(w=>w.type==='error').length,0);assert.deepEqual(r.processesAfterClose,[]);}
 for(let i=0;i<3;i++){const r=read(`p4-${label}-untraced-${i}.json`);assert.equal(r.status,'passed');assert.deepEqual(r.processesAfterClose,[]);for(const s of r.samples)assert.equal(s.semantic.hash,expected[s.target]);}
 const m=read(`p4-${label}-memory.json`);assert.equal(m.status,'passed');assert.equal(m.samples.length,20);assert.deepEqual(m.stale,{rejected:4,unchanged:true});assert.deepEqual(m.processesAfterClose,[]);for(const s of m.samples)assert.equal(s.semantic.hash,expected[s.target]);
 for(const c of m.checkpoints){assert.equal(c.after.workers.jsComplete,true);assert.equal(c.after.workers.wasmComplete,true);assert.equal(c.after.cache.count,1);assert.ok(c.after.cache.residentBytes<=96*1024**2);assert.ok(c.after.cache.arrays.every(a=>a.detached===false));}
}
const t=read('transport.json');assert.equal(t.status,'passed');assert.equal(t.result.featureCount,254);assert.equal(t.result.rows.length,30);assert.ok(t.result.rows.every(r=>r.digest===t.result.expected));
const input=read('input-responsiveness.json');assert.equal(input.rows.length,9);for(const r of input.rows){assert.equal(r.status,'passed');assert.equal(r.events.length,12);assert.ok(r.events.every(e=>Number.isFinite(e.latency)&&e.latency>=0));}
const browser=read('p4-B-browser-regression.json');assert.equal(browser.status,'passed');assert.equal(browser.contextRecovered,true);assert.equal(browser.workerErrorObserved,true);assert.equal(browser.workerRecovered,true);
const early=read('early-analysis.json');assert.equal(early.rows.length,3);assert.ok(read('snapshot-reproducibility.json').passed);
const sha=b=>createHash('sha256').update(b).digest('hex');for(const f of read('preflight.json').files)assert.equal(sha(readFileSync('D:/dev/worktrees/ui/'+f.path)),f.sha256);
assert.equal(execFileSync('git',['-C','D:/dev/worktrees/w2-p3-after','status','--porcelain'],{encoding:'utf8'}).trim(),'');
const focused=readFileSync(base+'/focused-unit.log','utf8');assert.match(focused,/pass 4/);assert.match(focused,/fail 0/);
writeFileSync(base+'/final-audit.json',JSON.stringify({at:new Date().toISOString(),passed:true,cold:30,warm:60,allPrimaryTransitions:120,untracedTransitions:18,memoryTransitions:60,inputRuns:9,transportRoundTrips:30,earlyRuns:3,protectedHashesMatch:true},null,2));
const files=[];function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const name=prefix+e.name;if(e.isDirectory())walk(dir+'/'+e.name,name+'/');else if(e.isFile()&&name!=='SHA256SUMS.json'){const bytes=readFileSync(dir+'/'+e.name);files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}else if(!e.isFile())throw Error('Unexpected link '+name);}}walk(base);
writeFileSync(base+'/SHA256SUMS.json',JSON.stringify({at:new Date().toISOString(),files},null,2));console.log('W4_FINAL_AUDIT',JSON.stringify({passed:true,files:files.length,bytes:files.reduce((n,v)=>n+v.bytes,0)}));
