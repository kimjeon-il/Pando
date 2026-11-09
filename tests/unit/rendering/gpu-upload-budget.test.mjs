import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuUploadScheduler} from '../../../src/rendering/gpu-upload-scheduler.js';
function clock(){let time=0;const frames=[];const scheduler=createGpuUploadScheduler({
  requestFrame:fn=>(frames.push(fn),frames.length),cancelFrame(){},now:()=>time,
  isHidden:()=>false,isInputPending:()=>false,getByteBudget:()=>1024*1024});
  return {scheduler,frames,advance(ms){time+=ms;},tick(){time+=16;frames.shift()?.();}};}
test('one ready upload consumes the available frame byte budget instead of one chunk per frame',async()=>{
  const c=clock();let calls=0;
  const done=c.scheduler.enqueueUpload({key:'initial-country',step:({byteBudget})=>{
    assert.ok(byteBudget<=256*1024);c.advance(0.1);return {bytes:256*1024,done:++calls===4};}});
  c.tick();assert.equal(calls,4);await done;
  assert.equal(c.scheduler.getStats().frames,1);
  assert.equal(c.scheduler.getStats().uploadedBytes,1024*1024);
  assert.ok(c.scheduler.getStats().maxQueueWaitMs>=16);
  assert.ok(c.scheduler.getStats().maxJobWallMs>=16);
});
test('zero progress yields rather than spinning or starving another job',async()=>{
  const c=clock();let stalls=0,ran=false;
  const idle=c.scheduler.enqueueUpload({key:'stalled',priority:100,step(){stalls++;return {bytes:0};}}).catch(error=>error);
  const other=c.scheduler.enqueueUpload({key:'ready',step(){ran=true;return {bytes:16,done:true};}});
  c.tick();assert.equal(stalls,1);assert.equal(ran,true);await other;
  c.scheduler.cancelAll();assert.equal((await idle).name,'AbortError');
});
test('time budget still stops repeated work before another frame',async()=>{
  const c=clock();let calls=0;
  const done=c.scheduler.enqueueUpload({key:'costly',step(){c.advance(1.1);return {bytes:128,done:++calls===3};}});
  c.tick();assert.equal(calls,2);c.tick();await done;
  assert.equal(c.scheduler.getStats().completed,1);
});
