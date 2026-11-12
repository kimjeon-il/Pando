import assert from 'node:assert/strict';
import test from 'node:test';
import {createRenderDevice} from '../../../src/rendering/render-device.js';

function fakeGl(version=2) {
  const names=['MAX_TEXTURE_SIZE','ACTIVE_TEXTURE','TEXTURE_2D','TEXTURE_BINDING_2D',
    'TEXTURE0','TEXTURE3','FRAMEBUFFER','DRAW_FRAMEBUFFER','READ_FRAMEBUFFER',
    'FRAMEBUFFER_BINDING','READ_FRAMEBUFFER_BINDING','ARRAY_BUFFER','ARRAY_BUFFER_BINDING',
    'VIEWPORT','CURRENT_PROGRAM','COLOR_CLEAR_VALUE','COLOR_WRITEMASK',
    'BLEND','STENCIL_TEST','SCISSOR_TEST','DEPTH_TEST','CULL_FACE',
    'BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA','BLEND_SRC_RGB','BLEND_DST_RGB',
    'BLEND_SRC_ALPHA','BLEND_DST_ALPHA','FUNC_ADD','FUNC_SUBTRACT',
    'SRC_ALPHA','ONE_MINUS_SRC_ALPHA','ONE','ZERO'];
  const gl=Object.fromEntries(names.map((name,i)=>[name,i+1]));
  const s={activeTexture:gl.TEXTURE0,textures:new Map(),drawFramebuffer:null,
    readFramebuffer:null,viewport:[0,0,900,700],program:null,arrayBuffer:null,
    clearColor:[0,0,0,0],colorMask:[true,true,true,true],
    enabled:new Set(),equations:[gl.FUNC_ADD,gl.FUNC_ADD],
    factors:[gl.ONE,gl.ZERO,gl.ONE,gl.ZERO]};
  let queries=0;
  gl.queries=()=>queries;
  gl.getContextAttributes=()=>({stencil:true});
  gl.getExtension=name=>name==='OES_element_index_uint'||name==='ANGLE_instanced_arrays'?{}:null;
  gl.isContextLost=()=>false;
  gl.getParameter=key=>{
    queries++;
    if(key===gl.MAX_TEXTURE_SIZE)return 4096;
    if(key===gl.ACTIVE_TEXTURE)return s.activeTexture;
    if(key===gl.TEXTURE_BINDING_2D)return s.textures.get(s.activeTexture)||null;
    if(key===gl.FRAMEBUFFER_BINDING)return s.drawFramebuffer;
    if(key===gl.READ_FRAMEBUFFER_BINDING)return s.readFramebuffer;
    if(key===gl.VIEWPORT)return [...s.viewport];
    if(key===gl.CURRENT_PROGRAM)return s.program;
    if(key===gl.ARRAY_BUFFER_BINDING)return s.arrayBuffer;
    if(key===gl.COLOR_CLEAR_VALUE)return [...s.clearColor];
    if(key===gl.COLOR_WRITEMASK)return [...s.colorMask];
    if(key===gl.BLEND_EQUATION_RGB)return s.equations[0];
    if(key===gl.BLEND_EQUATION_ALPHA)return s.equations[1];
    if(key===gl.BLEND_SRC_RGB)return s.factors[0];
    if(key===gl.BLEND_DST_RGB)return s.factors[1];
    if(key===gl.BLEND_SRC_ALPHA)return s.factors[2];
    if(key===gl.BLEND_DST_ALPHA)return s.factors[3];
    throw Error('Unexpected GL query '+key);
  };
  gl.activeTexture=unit=>{s.activeTexture=unit;};
  gl.bindTexture=(target,texture)=>{assert.equal(target,gl.TEXTURE_2D);s.textures.set(s.activeTexture,texture);};
  gl.bindFramebuffer=(target,value)=>{
    if(target===gl.FRAMEBUFFER||target===gl.DRAW_FRAMEBUFFER)s.drawFramebuffer=value;
    if(target===gl.FRAMEBUFFER||target===gl.READ_FRAMEBUFFER)s.readFramebuffer=value;
  };
  gl.viewport=(...args)=>{s.viewport=args;};
  gl.useProgram=value=>{s.program=value;};
  gl.bindBuffer=(target,value)=>{if(target===gl.ARRAY_BUFFER)s.arrayBuffer=value;};
  gl.clearColor=(...args)=>{s.clearColor=args;};
  gl.colorMask=(...args)=>{s.colorMask=args;};
  gl.isEnabled=cap=>s.enabled.has(cap);
  gl.enable=cap=>s.enabled.add(cap);
  gl.disable=cap=>s.enabled.delete(cap);
  gl.blendEquation=value=>{s.equations=[value,value];};
  gl.blendEquationSeparate=(rgb,alpha)=>{s.equations=[rgb,alpha];};
  gl.blendFunc=(src,dst)=>{s.factors=[src,dst,src,dst];};
  gl.blendFuncSeparate=(...args)=>{s.factors=args;};
  gl.deleteTexture=obj=>{
    for(const [unit,value] of s.textures)if(value===obj)s.textures.set(unit,null);
  };
  gl.deleteFramebuffer=obj=>{
    if(s.drawFramebuffer===obj)s.drawFramebuffer=null;
    if(s.readFramebuffer===obj)s.readFramebuffer=null;
  };
  gl.deleteBuffer=obj=>{if(s.arrayBuffer===obj)s.arrayBuffer=null;};
  gl.deleteProgram=obj=>{if(s.program===obj)s.program=null;};
  return gl;
}

test('RenderDevice scopes restore GL2 read/draw targets, texture units and blend without driver reads',()=>{
  const gl=fakeGl(2), fbo={id:'draw'}, read={id:'read'},tex0={id:0},tex3={id:3},program={id:'prior'},buffer={id:'old'};
  gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex0);
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,tex3);
  gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.enable(gl.BLEND);gl.enable(gl.STENCIL_TEST);
  gl.blendEquationSeparate(gl.FUNC_SUBTRACT,gl.FUNC_ADD);
  gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.SRC_ALPHA,gl.ZERO);
  gl.clearColor(0.15,0.2,0.3,1);gl.colorMask(true,false,true,false);
  const owner=createRenderDevice({gl,version:2,contextRevision:9});
  assert.equal(owner.state.tracked,true);
  const reads=gl.queries(),before=owner.state.capture();
  gl.bindFramebuffer(gl.FRAMEBUFFER,{id:'temporary'});
  gl.viewport(1,2,4,8);gl.useProgram(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,{id:'other'});
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,{id:'other3'});
  gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);
  gl.clearColor(0,0,0,0);gl.colorMask(true,true,true,true);
  gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ZERO);
  const intermediate=owner.state.capture();
  gl.viewport(10,20,30,40);
  owner.state.restore(intermediate);
  assert.deepEqual(owner.state.capture(),intermediate);
  owner.state.restore(before);
  assert.deepEqual(owner.state.capture(),before);
  assert.equal(gl.queries(),reads,'no driver read after initial state admission');
  assert.deepEqual(owner.state.capture().viewport,[0,0,900,700]);
  assert.equal(owner.state.capture().texture0,tex0);
  assert.equal(owner.state.capture().texture3,tex3);
  assert.equal(owner.state.capture().framebuffer,fbo);
  assert.equal(owner.state.capture().readFramebuffer,read);
});

test('WebGL1 snapshots restore without WebGL2 READ_FRAMEBUFFER operations',()=>{
  const gl=fakeGl(1),owner=createRenderDevice({gl,version:1,contextRevision:2});
  const initial=owner.state.capture(),queries=gl.queries();
  gl.bindFramebuffer(gl.FRAMEBUFFER,{id:'temp'});
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,{id:'temp'});
  gl.blendEquation(gl.FUNC_SUBTRACT);gl.enable(gl.SCISSOR_TEST);
  assert.equal(owner.state.restore(initial),true);
  assert.deepEqual(owner.state.capture(),initial);
  assert.equal(gl.queries(),queries);
});

test('deleted GL handles are dropped from the ledger and old context generations are rejected',()=>{
  const gl=fakeGl(),texture={id:'texture'},buffer={id:'buffer'};
  const old=createRenderDevice({gl,version:2,contextRevision:1});
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.deleteTexture(texture);gl.deleteBuffer(buffer);
  const now=old.state.capture();
  assert.equal(now.texture3,null);assert.equal(now.arrayBuffer,null);
  const device=createRenderDevice({gl,version:2,contextRevision:2});
  assert.equal(device.state,old.state,'same context shares one ledger');
  assert.equal(device.state.contextRevision,2);
  assert.throws(()=>device.state.restore(now),/Stale RenderDevice/);
});

test('tracked buffer liveness avoids driver checks and detects deletion',()=>{
  const gl=fakeGl(),device=createRenderDevice({gl,version:2,contextRevision:7});
  const buffer={id:'saved'},before=gl.queries();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  assert.equal(device.state.isBufferLive(buffer),true);
  gl.deleteBuffer(buffer);
  assert.equal(device.state.isBufferLive(buffer),false);
  assert.equal(device.state.isBufferLive(null),false);
  assert.equal(gl.queries(),before,'liveness checks must not read GL state');
});

test('unpatchable WebGL contexts retain correct but slower state snapshots',()=>{
  const gl=fakeGl();
  Object.preventExtensions(gl);
  const device=createRenderDevice({gl,version:2});
  assert.equal(device.state.tracked,false);
  const before=device.state.capture(),count=gl.queries();
  gl.clearColor(0.6,0.7,0.8,0.9);
  device.state.restore(before);
  assert.deepEqual(device.state.capture().clearColor,before.clearColor);
  assert.ok(gl.queries()>count);
});
