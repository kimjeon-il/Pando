import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderDevice} from '../../src/rendering/render-device.js';
import {createGpuPolygonOverlayPass} from '../../src/rendering/gpu-polygon-overlay-pass.js';
import {createGpuUploadScheduler} from '../../src/rendering/gpu-upload-scheduler.js';

function fakeWebGl2() {
  const names=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS',
    'FRAMEBUFFER_BINDING','READ_FRAMEBUFFER_BINDING','VIEWPORT','CURRENT_PROGRAM',
    'ARRAY_BUFFER_BINDING','COPY_WRITE_BUFFER_BINDING','ACTIVE_TEXTURE',
    'BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA','BLEND_SRC_RGB','BLEND_DST_RGB',
    'BLEND_SRC_ALPHA','BLEND_DST_ALPHA','COLOR_WRITEMASK','COLOR_CLEAR_VALUE',
    'TEXTURE_BINDING_2D','BLEND','DEPTH_TEST','CULL_FACE','SCISSOR_TEST',
    'STENCIL_TEST','FRAMEBUFFER','DRAW_FRAMEBUFFER','READ_FRAMEBUFFER',
    'ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','COPY_WRITE_BUFFER','TEXTURE0',
    'TEXTURE_2D','FUNC_ADD','ONE','ZERO','STATIC_DRAW','MAX_TEXTURE_SIZE'];
  const gl=Object.fromEntries(names.map(name=>[name,name]));
  const bindings=new Map();
  let reads=0, writes=0;
  gl.drawingBufferWidth=800;gl.drawingBufferHeight=600;
  gl.isContextLost=()=>false;gl.isEnabled=()=>false;
  gl.getContextAttributes=()=>({stencil:true});
  gl.getParameter=key=>{
    reads++;
    if(key===gl.VIEWPORT)return [0,0,800,600];
    if(key===gl.COLOR_WRITEMASK)return [true,true,true,true];
    if(key===gl.COLOR_CLEAR_VALUE)return [0,0,0,0];
    if(key===gl.MAX_TEXTURE_SIZE)return 4096;
    if(key===gl.ACTIVE_TEXTURE)return gl.TEXTURE0;
    if(key===gl.COPY_WRITE_BUFFER_BINDING)return bindings.get(gl.COPY_WRITE_BUFFER)||null;
    if(key===gl.ARRAY_BUFFER_BINDING)return bindings.get(gl.ARRAY_BUFFER)||null;
    return null;
  };
  gl.createShader=()=>({});gl.shaderSource=()=>{};gl.compileShader=()=>{};
  gl.getShaderParameter=()=>true;gl.deleteShader=()=>{};
  gl.createProgram=()=>({});gl.attachShader=()=>{};gl.linkProgram=()=>{};
  gl.getProgramParameter=()=>true;gl.deleteProgram=()=>{};
  gl.getAttribLocation=()=>0;gl.getUniformLocation=()=>({});
  gl.createBuffer=()=>({});
  gl.bindBuffer=(target,buffer)=>bindings.set(target,buffer);
  gl.bufferData=(target,size)=>{assert.equal(target,gl.COPY_WRITE_BUFFER);assert.ok(size>0);writes++;};
  gl.bufferSubData=(target,offset,bytes)=>{assert.equal(target,gl.COPY_WRITE_BUFFER);assert.ok(offset>=0);assert.ok(bytes.byteLength>0);writes++;};
  gl.deleteBuffer=()=>{};
  for(const name of ['bindFramebuffer','viewport','useProgram','activeTexture','bindTexture',
    'enable','disable','blendEquation','blendEquationSeparate','blendFunc',
    'blendFuncSeparate','colorMask','clearColor']) gl[name]=()=>{};
  return {gl,bindings,reads:()=>reads,writes:()=>writes};
}

test('polygon upload restores WebGL2 copy-write binding without any per-slice getParameter',async()=>{
  const fake=fakeWebGl2(),{gl,bindings}=fake;
  const device=createRenderDevice({gl,version:2,contextRevision:3});
  const pass=createGpuPolygonOverlayPass();
  assert.equal(pass.initialize(device),true);
  const sentinel=gl.createBuffer();
  gl.bindBuffer(gl.COPY_WRITE_BUFFER,sentinel);
  const arraySentinel=gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,arraySentinel);
  const readings=fake.reads(),tasks=[];
  const scheduler={cancelKey(){},enqueueUpload(job){
    tasks.push(job);return Promise.resolve();
  }};
  pass.setUploadScheduler(scheduler);
  const packet={key:'physical-land',role:'physical-land',protected:true,positions:new Float32Array(65536),
    indices:new Uint32Array([0,1,2]),priority:100};
  assert.equal(pass.ensureResource(packet).reason,'upload-pending');
  assert.equal(tasks.length,1);
  let done=false,steps=0;
  while(!done && steps<16) {
    const result=tasks[0].step({byteBudget:256*1024});
    done=!!result.done;steps++;
    assert.equal(bindings.get(gl.COPY_WRITE_BUFFER),sentinel,'copy-write binding must be restored after each step');
    assert.equal(bindings.get(gl.ELEMENT_ARRAY_BUFFER),arraySentinel,'index uploads may not mutate the active VAO');
    assert.equal(fake.reads(),readings,'no synchronous GL driver readback during staged polygon uploads');
  }
  assert.equal(done,true);
  assert.ok(steps>=5);
  assert.equal(fake.writes(),4);
  assert.equal(pass.hasResource('physical-land'),true);
  assert.equal(pass.stats().physicalBaseBufferBytes,packet.positions.byteLength+packet.indices.byteLength);
  const snapshot=device.state.captureCopyWriteBufferBinding();
  gl.deleteBuffer(sentinel);
  assert.equal(device.state.restoreCopyWriteBufferBinding(snapshot),false,'deleted buffer cannot be rebound');
  assert.equal(bindings.get(gl.COPY_WRITE_BUFFER),null);
  pass.dispose();device.state.dispose();
});


test('upload diagnostics distinguish polygon and terrain CPU steps and pending jobs',async()=>{
  let clock=0, next=0;
  const callbacks=new Map();
  const scheduler=createGpuUploadScheduler({
    requestFrame:callback=>{const id=++next;callbacks.set(id,callback);return id;},
    cancelFrame:id=>callbacks.delete(id),
    now:()=>clock,isHidden:()=>false,isInputPending:()=>false,getByteBudget:()=>1024,
  });
  let polygonSteps=0;
  const polygon=scheduler.enqueueUpload({key:'polygon:base',priority:100,
    step:()=>{clock+=1;polygonSteps++;return polygonSteps===1?{bytes:64}:{bytes:32,done:true};}});
  const terrain=scheduler.enqueueUpload({key:'terrain:tile',priority:80,
    step:()=>{clock+=0.5;return {bytes:48,done:true};}});
  assert.deepEqual(scheduler.getStats().pendingByKind,
    {polygon:1,terrain:1,hydro:0,stroke:0,natural:0,other:0});
  while(callbacks.size) {
    const [id,callback]=callbacks.entries().next().value;
    callbacks.delete(id);callback();
  }
  await Promise.all([polygon,terrain]);
  const s=scheduler.getStats();
  assert.equal(s.pending,0);
  assert.equal(s.byKind.polygon.steps,2);
  assert.equal(s.byKind.polygon.uploadedBytes,96);
  assert.equal(s.byKind.terrain.uploadedBytes,48);
  assert.equal(s.byKind.terrain.steps,1);
  assert.equal(s.byKind.polygon.cpuStepMs,2);
  assert.equal(s.byKind.terrain.cpuStepMs,0.5);
  assert.equal(s.uploadedBytes,144);
  scheduler.dispose();
});
