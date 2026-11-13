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
  gl.createBuffer=()=>({});
  return gl;
}

test('RenderDevice tracks GL1 and GL2 coverage snapshots without synchronous hot-path queries',()=>{
  for(const version of [1,2]){
    const gl=fakeGl(version);
    const owner=createRenderDevice({gl,version,contextRevision:4});
    assert.ok(owner.state);
    const fbo={id:'fbo'},texture={id:'unit0'},buffer=gl.createBuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.blendEquationSeparate(gl.FUNC_SUBTRACT,gl.FUNC_ADD);
    gl.enable(gl.STENCIL_TEST);gl.colorMask(true,false,true,false);
    const baseline=owner.state.capture(),queries=gl.queries();
    gl.bindFramebuffer(gl.FRAMEBUFFER,{id:'temporary'});
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
    gl.bindBuffer(gl.ARRAY_BUFFER,null);
    gl.disable(gl.STENCIL_TEST);gl.colorMask(false,false,false,false);
    owner.state.restore(baseline);
    assert.deepEqual(owner.state.capture(),baseline);
    assert.equal(gl.queries(),queries,'coverage snapshot and restore must not query the driver');
    assert.equal(owner.state.capture().framebuffer,fbo);
    assert.equal(owner.state.capture().textures.get(gl.TEXTURE0),texture);
    owner.state.dispose();
    assert.equal(owner.state.capture(),null);
  }
});

test('a newer GL context revision refuses to replay stale state',()=>{
  const gl=fakeGl(2),old=createRenderDevice({gl,version:2,contextRevision:1});
  const stale=old.state.capture();
  old.state.dispose();
  const device=createRenderDevice({gl,version:2,contextRevision:2});
  const before=device.state.capture();
  assert.equal(before.contextRevision,2);
  device.state.restore(stale);
  assert.deepEqual(device.state.capture(),before);
});
