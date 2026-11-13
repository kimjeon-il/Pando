import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Pure report-contract fixtures. These are NOT Viewer benchmark results.
const zooms=Array.from({length:32},(_,i)=>i+1);
const fake=(source,delta=0,pin='a'.repeat(40))=>({
  schema:'pando-p1-gpu-zoom-ab-v1',sourceCommit:source,dataPin:pin,
  status:'partial',backend:'webgl2',gpuMode:'swiftshader',expectedRuntimeBackend:'webgl2',
  viewport:[1280,800],frozenClock:'2026-11-06T03:00:00+09:00',
  browserVersion:'151.0.mock-fixture',zooms,projections:['globe','flat'],
  device:{platform:'linux',cpuModel:'synthetic fixture',logicalCpus:4,physicalDeviceVerified:false},
  gpu:{actualRenderer:'webgl2',unmaskedRenderer:'synthetic SwiftShader fixture'},
  rows:['globe','flat'].flatMap(projection=>zooms.map(zoom=>projection==='flat'
    ? {projection,zoom,status:'unsupported',reason:'Flat projection is prohibited by the actual Viewer product policy'}
    : {projection,zoom,status:'passed',elapsedMs:100+delta+zoom,cpuTaskMs:10+delta,
      raf:{rafP95GapMs:16},stats:{gpuTrackedBufferBytes:100000},
      frameSha256:zoom.toString(16).padStart(64,'0')}))
});
function run(base,next){
  const dir=mkdtempSync(join(tmpdir(),'pando-p1-report-'));
  try{
    const before=join(dir,'before.json'),after=join(dir,'after.json'),out=join(dir,'compare.json');
    writeFileSync(before,JSON.stringify(base));
    writeFileSync(after,JSON.stringify(next));
    const execution=spawnSync(process.execPath,[
      resolve('scripts/p1-gpu-zoom-ab.mjs'),'--mode=compare',
      '--baseline='+before,'--candidate='+after,'--out='+out
    ],{encoding:'utf8',timeout:15000});
    return {exit:execution.status,output:JSON.parse(readFileSync(out,'utf8')),stderr:execution.stderr};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('verified globe scope passes, but unsupported flat is explicit and never becomes zero',()=>{
  const {exit,output}=run(fake('1'.repeat(40)),fake('2'.repeat(40),-10));
  assert.equal(exit,0);
  assert.equal(output.status,'globe-complete-flat-unavailable');
  assert.equal(output.comparable,true);
  assert.equal(output.sourceScopeAccepted,true);
  assert.equal(output.unsupportedProjection,'flat');
  assert.equal(output.pairedCells,32);
  assert.equal(output.unsupportedOrFailedCells,32);
  assert.equal(output.summary.flatPaired,0);
  assert.ok(output.rows.filter(r=>r.projection==='flat').every(r=>
    !r.comparable&&r.baselineMs===null&&r.candidateMs===null&&r.transitionDeltaPercent===null));
  assert.ok(output.rows.filter(r=>r.projection==='globe').every(r=>r.transitionDeltaPercent<0));
});
test('source pins must match before any metrics can be interpreted',()=>{
  const {exit,output}=run(fake('1'.repeat(40)),fake('2'.repeat(40),0,'b'.repeat(40)));
  assert.equal(exit,1);
  assert.equal(output.status,'invalid');
  assert.ok(output.issues.includes('different-dataPin'));
});
test('a same-commit A/B is invalid even if every number differs',()=>{
  const {exit,output}=run(fake('1'.repeat(40)),fake('1'.repeat(40),-10));
  assert.equal(exit,1);
  assert.equal(output.status,'invalid');
  assert.ok(output.issues.includes('same-commit-not-ab'));
});
test('a failed source sample cannot be disguised as a valid comparison',()=>{
  const b=fake('1'.repeat(40)),c=fake('2'.repeat(40));
  c.status='failed';
  const {exit,output}=run(b,c);
  assert.equal(exit,1);
  assert.equal(output.status,'invalid');
  assert.ok(output.issues.includes('source-measurement-failed'));
});

test('unknown unsupported projection is never silently accepted',()=>{
  const b=fake('1'.repeat(40)),c=fake('2'.repeat(40));
  c.rows.find(r=>r.projection==='flat').reason='Missing critical renderer';
  const {exit,output}=run(b,c);
  assert.equal(exit,1);
  assert.equal(output.status,'incomplete');
  assert.equal(output.sourceScopeAccepted,false);
});
test('missing visible pixel certificate invalidates even numeric-complete globe rows',()=>{
  const b=fake('1'.repeat(40)),c=fake('2'.repeat(40));
  b.rows.find(r=>r.projection==='globe'&&r.zoom===8).frameSha256=null;
  const {exit,output}=run(b,c);
  assert.equal(exit,1);
  assert.equal(output.status,'invalid');
  assert.ok(output.issues.includes('missing-visible-frame-hash'));
});
