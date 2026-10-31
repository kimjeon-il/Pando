import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from '../helpers/gpu-recovery-source-harness.mjs';

// Exercise the canonical initializer through the actual scheduler. Unlike the
// earlier copied closure fixture, cancellation uses the renderer's reset/loss paths.
test('project replacement before shader compilation restarts preparation for the current project',async()=>{
  const f=await fixture({shared:true});
  f.c.initializeSharedGpuPasses();f.c.resetProjectRenderState({generation:8});await f.flush();
  assert.equal(f.events.filter(row=>row[0]==='stroke').length,1);
  assert.equal(f.c.sharedGpuPassesReady(),true);
  assert.equal(f.events.filter(row=>row[0]==='fallback').length,0);
});
for(const pass of ['polygon','stroke'])test(`required ${pass} initialization false switches to Canvas with diagnostics`,async()=>{
  const f=await fixture({shared:true});
  if(pass==='polygon')f.c.polygonOverlayPass.initialize=()=>false;
  else f.c.strokeRenderer.initializeProgressively=async()=>false;
  f.c.initializeSharedGpuPasses();await f.flush();
  const failures=f.events.filter(row=>row[0]==='fallback'),diagnostics=f.events.filter(row=>row[0]==='error');
  assert.equal(failures.length,1);assert.match(failures[0][1],new RegExp(pass));assert.equal(diagnostics.length,1);
});
test('required pass initialization exception is contained by the renderer boundary',async()=>{
  const original=new Error('shader link failed'),f=await fixture({shared:true});
  f.c.polygonOverlayPass.initialize=()=>{throw original;};f.c.initializeSharedGpuPasses();await f.flush();
  assert.deepEqual(f.events.filter(row=>row[0]==='fallback').map(row=>row[1]),['shader link failed']);
  assert.equal(f.events.filter(row=>row[0]==='error').length,1);
});
for(const replace of ['replaceProject','replaceContext','dispose'])test(`cancelled initialization after ${replace} cannot switch the current renderer`,async()=>{
  const f=await fixture({shared:true,holdStroke:true});f.c.initializeSharedGpuPasses();await f.flush();
  if(replace==='replaceProject')f.c.resetProjectRenderState({generation:8});
  else if(replace==='replaceContext')f.loss();else f.stop();
  f.rejectStroke(new Error('old shader failed'));
  // Retired continuation must settle without requiring a new animation frame.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.events.filter(row=>row[0]==='fallback').length,0);
  assert.equal(f.events.filter(row=>row[0]==='error').length,0);
  f.stop();
});
