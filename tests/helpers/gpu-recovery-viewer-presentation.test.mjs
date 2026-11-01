import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createMapRenderCoordinator,MAP_RENDER_DIRTY,MAP_RENDER_MASKS} from '../../shared/frontend/js/modules/map-render-coordinator.js';
import {createMapVisualFrame} from '../../shared/frontend/js/modules/map-visual-frame.js';

const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
const start=source.indexOf('    function invalidateGpuFrame('),end=source.indexOf('    function invalidatePhysicalScene(',start);
assert.ok(start>0&&end>start);
function fixture({active=false,fallback=false,disposed=false,succeeded=true}={}){
 const callbacks=[],draws=[],presented=[];
 const coordinator=createMapRenderCoordinator({requestFrame:callback=>callbacks.push(callback),
  prepareView:({frameId})=>createMapVisualFrame({frameId,projectGeneration:2,viewState:{projection:'flat',size:{width:100,height:80},scale:10,translate:[50,40]}}),
  canPresentFrame:(_frame,result)=>result?.succeeded!==false,
  renderers:{view:frame=>{const result={succeeded,frameId:frame.frameId};draws.push({frame,result});return result;},
   gpuInteraction:frame=>{draws.push({frame,result:{succeeded}});},
   viewPresentation:(frame,result)=>presented.push({frame,result})},
 });
 const context=vm.createContext({disposed,
  gpuRecovery:{snapshot:()=>({active}),fallbackTicket:()=>fallback?{}:null},
  scheduleGpuFrame:reason=>coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME,reason),
  scheduleGpuInteractionFrame:reason=>coordinator.invalidate(MAP_RENDER_DIRTY.GPU_INTERACTION,reason),
  renderViewFrame:reason=>coordinator.invalidate(MAP_RENDER_MASKS.VIEW,reason),
 });
 vm.runInContext(source.slice(start,end),context);
 return{context,draws,presented,flush:()=>{while(callbacks.length)callbacks.shift()();}};
}
for(const phase of ['active','fallback'])test(`${phase} recovery upload schedules the actual coordinator approval path`,()=>{
 const f=fixture({[phase]:true});f.context.invalidateGpuFrame('land-ready');f.flush();
 assert.equal(f.draws.length,1);assert.equal(f.presented.length,1);
 assert.equal(f.presented[0].frame,f.draws[0].frame);assert.equal(f.presented[0].result,f.draws[0].result);
 assert.equal(f.presented[0].frame.projectGeneration,2);
});
test('recovery interaction completion also enters shared frame approval',()=>{
 const f=fixture({active:true});f.context.invalidateGpuInteraction('selection-ready');f.flush();
 assert.equal(f.draws.length,1);assert.equal(f.presented.length,1);assert.equal(f.presented[0].frame,f.draws[0].frame);
});
for(const method of ['invalidateGpuFrame','invalidateGpuInteraction'])test(`ordinary ${method} retains its lightweight work mask`,()=>{
 const f=fixture();f.context[method]('ordinary');f.flush();assert.equal(f.draws.length,1);assert.equal(f.presented.length,0);
});
test('disposing prevents recovery redraw and approval scheduling',()=>{
 const f=fixture({active:true,disposed:true});f.context.invalidateGpuFrame();f.context.invalidateGpuInteraction();f.flush();
 assert.equal(f.draws.length,0);assert.equal(f.presented.length,0);
});
test('a rejected GPU submission cannot be approved by recovery scheduling',()=>{
 const f=fixture({active:true,succeeded:false});f.context.invalidateGpuFrame('not-ready');f.flush();
 assert.equal(f.draws.length,1);assert.equal(f.presented.length,0);
});
