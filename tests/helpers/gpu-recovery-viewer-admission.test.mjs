import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createMapRenderCoordinator,MAP_RENDER_DIRTY} from '../../shared/frontend/js/modules/map-render-coordinator.js';

const source=readFileSync(new URL('../../shared/frontend/js/modules/rendering-domain.js',import.meta.url),'utf8');
const start=source.indexOf('  const invalidateGpuFrame = reason => invalidate(');
const end=source.indexOf('  const invalidateGpuInteraction',start);
assert.ok(start>=0&&end>start);
function fixture(){
 const frames=[],drawn=[],committed=[],extra=[];let ready=true,blocked=false,generation=2;
 const coordinator=createMapRenderCoordinator({requestFrame:fn=>(frames.push(fn),frames.length),
  prepareView:({frameId})=>({frameId,projectGeneration:2,revision:1}),now:()=>0,
  isPresentationBlocked:()=>blocked,
  canPresentFrame:(frame,result)=>ready&&frame.projectGeneration===generation&&result?.succeeded===true,
  renderers:{view:frame=>{drawn.push(frame);return{succeeded:ready};},viewPresentation:frame=>committed.push(frame),
   countries:()=>extra.push('countries'),base:()=>extra.push('base'),labelLayout:()=>extra.push('label-layout')},
 });
 const context=vm.createContext({MAP_RENDER_DIRTY,invalidate:(mask,reason)=>coordinator.invalidate(mask,reason)});
 vm.runInContext(source.slice(start,end)+'\nglobalThis.invalidateGpuFrame=invalidateGpuFrame;',context);
 return{drawn,committed,extra,request:context.invalidateGpuFrame,
  frame(){assert.ok(frames.length,'a frame was scheduled');frames.shift()();},
  ready:value=>{ready=value;},block:value=>{blocked=value;},generation:value=>{generation=value;}};
}
test('GPU completion requests approve the exact drawn frame without rebuilding scene geometry',()=>{
 const f=fixture();f.request('country-boundary-resource-ready');f.frame();
 assert.equal(f.drawn.length,1);assert.equal(f.committed.length,1,'draw-only invalidation loses recovery completion');
 assert.equal(f.committed[0],f.drawn[0]);assert.deepEqual(f.extra,[]);
});
test('an unready draw is not approved but the later completed upload publishes exactly once',()=>{
 const f=fixture();f.ready(false);f.request('overlay-upload-budget');f.frame();assert.equal(f.committed.length,0);
 f.ready(true);f.request('overlay-resource-ready');f.frame();
 assert.equal(f.committed.length,1);assert.equal(f.committed[0],f.drawn[1]);assert.deepEqual(f.extra,[]);
});
test('project-blocked and stale-generation draws cannot bypass the existing admission predicate',()=>{
 const f=fixture();f.block(true);f.request('gpu-recovery-resources-ready');f.frame();assert.equal(f.drawn.length,0);assert.equal(f.committed.length,0);
 f.block(false);f.generation(3);f.request('overlay-resource-ready');f.frame();assert.equal(f.committed.length,0);
});
test('multiple completion requests coalesce into one drawn and approved frame',()=>{
 const f=fixture();f.request('physical-land-ready');f.request('stroke-ready');f.frame();
 assert.equal(f.drawn.length,1);assert.equal(f.committed.length,1);assert.equal(f.committed[0],f.drawn[0]);
});
