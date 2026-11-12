import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderDevice } from '../../../src/rendering/render-device.js';

function fakeGl() {
  let serial = 0;
  let lost = false;
  const live = new Set();
  const state = {
    framebuffer: null, readFramebuffer:null, viewport:[0,0,400,300],
    program:null, buffer:null, activeTexture:0, textures:new Map(),
    enabled:new Set(), equations:[0,0],blendFactors:[1,0,1,0],
    colorMask:[true,true,true,true],clearColor:[0,0,0,0],
  };
  let queries=0, bufferChecks=0;
  const constants=['ARRAY_BUFFER','ARRAY_BUFFER_BINDING','FRAMEBUFFER','DRAW_FRAMEBUFFER','READ_FRAMEBUFFER',
    'FRAMEBUFFER_BINDING','READ_FRAMEBUFFER_BINDING','VIEWPORT','CURRENT_PROGRAM',
    'ACTIVE_TEXTURE','TEXTURE0','TEXTURE_BINDING_2D','TEXTURE_2D',
    'BLEND','DEPTH_TEST','CULL_FACE','SCISSOR_TEST','STENCIL_TEST',
    'BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA','BLEND_SRC_RGB','BLEND_DST_RGB',
    'BLEND_SRC_ALPHA','BLEND_DST_ALPHA','COLOR_WRITEMASK','COLOR_CLEAR_VALUE',
    'FUNC_ADD','ONE','ZERO','MAX_TEXTURE_SIZE'];
  const gl = Object.fromEntries(constants.map((k,i)=>[k,i+1]));
  gl.ACTIVE_TEXTURE=2000; gl.TEXTURE0=2001;
  state.activeTexture=gl.TEXTURE0;
  gl.drawingBufferWidth=400;gl.drawingBufferHeight=300;
  gl.getContextAttributes=()=>({stencil:true});
  gl.getExtension=()=>null;
  gl.getParameter=param=>{
    queries++;
    const props=new Map([
      [gl.FRAMEBUFFER_BINDING,state.framebuffer],
      [gl.READ_FRAMEBUFFER_BINDING,state.readFramebuffer],
      [gl.VIEWPORT,state.viewport],
      [gl.CURRENT_PROGRAM,state.program],
      [gl.ARRAY_BUFFER_BINDING,state.buffer],
      [gl.ACTIVE_TEXTURE,state.activeTexture],
      [gl.TEXTURE_BINDING_2D,state.textures.get(state.activeTexture)||null],
      [gl.BLEND_EQUATION_RGB,state.equations[0]],
      [gl.BLEND_EQUATION_ALPHA,state.equations[1]],
      [gl.BLEND_SRC_RGB,state.blendFactors[0]],
      [gl.BLEND_DST_RGB,state.blendFactors[1]],
      [gl.BLEND_SRC_ALPHA,state.blendFactors[2]],
      [gl.BLEND_DST_ALPHA,state.blendFactors[3]],
      [gl.COLOR_WRITEMASK,state.colorMask],
      [gl.COLOR_CLEAR_VALUE,state.clearColor],
      [gl.MAX_TEXTURE_SIZE,8192],
    ]);
    return props.get(param);
  };
  gl.isEnabled=cap=>state.enabled.has(cap);
  gl.isContextLost=()=>lost;
  gl.createBuffer=()=>{const buffer={id:++serial};live.add(buffer);return buffer;};
  gl.deleteBuffer=buffer=>{live.delete(buffer);if(state.buffer===buffer)state.buffer=null;};
  gl.bindBuffer=(target,buffer)=>{if(target===gl.ARRAY_BUFFER){
    if(buffer&&!live.has(buffer))throw Error('Deleted buffer rebound');
    state.buffer=buffer;
  }};
  gl.isBuffer=()=>{bufferChecks++;throw Error('Do not query driver isBuffer');};
  gl.bindFramebuffer=(target,value)=>{
    if(target===gl.FRAMEBUFFER||target===gl.DRAW_FRAMEBUFFER)state.framebuffer=value;
    if(target===gl.FRAMEBUFFER||target===gl.READ_FRAMEBUFFER)state.readFramebuffer=value;
  };
  gl.viewport=(...args)=>{state.viewport=args;};
  gl.useProgram=value=>{state.program=value;};
  gl.activeTexture=value=>{state.activeTexture=value;};
  gl.bindTexture=(_target,value)=>{state.textures.set(state.activeTexture,value);};
  gl.enable=cap=>{state.enabled.add(cap);};
  gl.disable=cap=>{state.enabled.delete(cap);};
  gl.blendEquation=value=>{state.equations=[value,value];};
  gl.blendEquationSeparate=(...a)=>{state.equations=a;};
  gl.blendFunc=(a,b)=>{state.blendFactors=[a,b,a,b];};
  gl.blendFuncSeparate=(...a)=>{state.blendFactors=a;};
  gl.colorMask=(...a)=>{state.colorMask=a;};
  gl.clearColor=(...a)=>{state.clearColor=a;};
  return {gl,state,get queries(){return queries;},get bufferChecks(){return bufferChecks;},
    lose(){lost=true;},restore(){lost=false;}};
}

test('alive stroke upload binding restores from RenderDevice with zero GL queries',()=>{
  const f=fakeGl(), device=createRenderDevice({gl:f.gl,version:2,contextRevision:1});
  const saved=f.gl.createBuffer();f.gl.bindBuffer(f.gl.ARRAY_BUFFER,saved);
  const snapshot=device.state.captureArrayBufferBinding();
  const upload=f.gl.createBuffer();f.gl.bindBuffer(f.gl.ARRAY_BUFFER,upload);
  const before=f.queries;
  assert.equal(device.state.restoreArrayBufferBinding(snapshot),true);
  assert.equal(f.state.buffer,saved);
  assert.equal(f.queries,before);
  assert.equal(f.bufferChecks,0);
  assert.deepEqual(device.state.bufferBindingStats().captures,1);
  device.state.dispose();
});

test('deleted and context-lost bindings never resurrect into an upload',()=>{
  const f=fakeGl(), device=createRenderDevice({gl:f.gl,version:2,contextRevision:8});
  const old=f.gl.createBuffer();f.gl.bindBuffer(f.gl.ARRAY_BUFFER,old);
  const saved=device.state.captureArrayBufferBinding();
  f.gl.deleteBuffer(old);
  const upload=f.gl.createBuffer();f.gl.bindBuffer(f.gl.ARRAY_BUFFER,upload);
  assert.equal(device.state.restoreArrayBufferBinding(saved),false);
  assert.equal(f.state.buffer,null);
  assert.equal(device.state.bufferBindingStats().rejected,1);
  f.lose();
  assert.equal(device.state.restoreArrayBufferBinding(saved),false);
  assert.equal(device.state.captureArrayBufferBinding(),null);
  device.state.dispose();
  f.restore();
  const next=createRenderDevice({gl:f.gl,version:2,contextRevision:9});
  assert.equal(device.state.restoreArrayBufferBinding(saved),false,
    'disposed context cannot mutate the new generation');
  assert.equal(f.state.buffer,null);
  next.state.dispose();
  assert.equal(f.bufferChecks,0);
});

test('coverage snapshot ignores a buffer deleted before state restoration',()=>{
  const f=fakeGl(),device=createRenderDevice({gl:f.gl,version:2,contextRevision:5});
  const first=f.gl.createBuffer();f.gl.bindBuffer(f.gl.ARRAY_BUFFER,first);
  const state=device.state.capture();
  f.gl.deleteBuffer(first);
  const other=f.gl.createBuffer();f.gl.bindBuffer(f.gl.ARRAY_BUFFER,other);
  device.state.restore(state);
  assert.equal(f.state.buffer,null);
  device.state.dispose();
});
