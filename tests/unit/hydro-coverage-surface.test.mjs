import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHydroCoverage } from '../../shared/frontend/js/modules/gpu-hydro-coverage.js';

function fakeGl(supportMax = true) {
  const constants = ['MAX','ARRAY_BUFFER','TEXTURE_2D','TEXTURE3','ACTIVE_TEXTURE','TEXTURE_BINDING_2D',
    'FRAMEBUFFER','READ_FRAMEBUFFER','FRAMEBUFFER_BINDING','READ_FRAMEBUFFER_BINDING',
    'VIEWPORT','CURRENT_PROGRAM','ARRAY_BUFFER_BINDING','COLOR_CLEAR_VALUE','COLOR_WRITEMASK',
    'BLEND','STENCIL_TEST','SCISSOR_TEST','DEPTH_TEST','CULL_FACE','BLEND_EQUATION_RGB',
    'BLEND_EQUATION_ALPHA','BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA',
    'NEAREST','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T',
    'CLAMP_TO_EDGE','RGBA','UNSIGNED_BYTE','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','STATIC_DRAW',
    'COLOR_BUFFER_BIT','ONE','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','FUNC_ADD','TRIANGLE_STRIP','FLOAT',
    'VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS']
    .reduce((obj,key,index)=>(obj[key]=index+1,obj),{});
  const gl = {...constants};
  let activeTexture = gl.TEXTURE3, framebuffer = null, readFramebuffer = null, program = null, arrayBuffer = null;
  let viewport = [0,0,128,128], clear = [0,0,0,0], colorMask = [true,true,true,true];
  let equation = gl.FUNC_ADD, factors=[gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA];
  const enabled = new Set([gl.BLEND]);
  const bindings = new Map();
  const calls = [];
  gl.calls = calls;
  gl.isContextLost = () => false;
  gl.createShader = () => ({});
  gl.shaderSource = gl.compileShader = gl.deleteShader = gl.attachShader = gl.linkProgram = () => {};
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getShaderInfoLog = gl.getProgramInfoLog = () => '';
  gl.createProgram = () => ({});
  gl.getExtension = name => supportMax && name === 'EXT_blend_minmax' ? {MAX_EXT:gl.MAX}:null;
  gl.createTexture = () => ({});
  gl.createFramebuffer = () => ({});
  gl.createBuffer = () => ({});
  gl.deleteTexture = gl.deleteFramebuffer = gl.deleteBuffer = gl.deleteProgram = () => {};
  gl.getAttribLocation = () => 0;
  gl.getUniformLocation = () => ({});
  gl.getParameter = name => {
    if (name===gl.ACTIVE_TEXTURE) return activeTexture;
    if (name===gl.TEXTURE_BINDING_2D) return bindings.get(activeTexture)||null;
    if (name===gl.FRAMEBUFFER_BINDING) return framebuffer;
    if (name===gl.READ_FRAMEBUFFER_BINDING) return readFramebuffer;
    if (name===gl.VIEWPORT) return viewport;
    if (name===gl.CURRENT_PROGRAM) return program;
    if (name===gl.ARRAY_BUFFER_BINDING) return arrayBuffer;
    if (name===gl.COLOR_CLEAR_VALUE) return clear;
    if (name===gl.COLOR_WRITEMASK) return colorMask;
    if (name===gl.BLEND_EQUATION_RGB||name===gl.BLEND_EQUATION_ALPHA)return equation;
    if (name===gl.BLEND_SRC_RGB) return factors[0];
    if (name===gl.BLEND_DST_RGB) return factors[1];
    if (name===gl.BLEND_SRC_ALPHA) return factors[2];
    if (name===gl.BLEND_DST_ALPHA) return factors[3];
    return null;
  };
  gl.isEnabled = name => enabled.has(name);
  gl.enable = name => enabled.add(name);
  gl.disable = name => enabled.delete(name);
  gl.activeTexture = value => activeTexture=value;
  gl.bindTexture = (_,texture) => bindings.set(activeTexture,texture);
  gl.bindFramebuffer = (target,value) => {if(target===gl.READ_FRAMEBUFFER)readFramebuffer=value;else {framebuffer=value;readFramebuffer=value;}};
  gl.viewport = (...args) => viewport=args;
  gl.useProgram = value => program=value;
  gl.bindBuffer = (_,value) => arrayBuffer=value;
  gl.clearColor = (...args) => clear=args;
  gl.colorMask = (...args) => colorMask=args;
  gl.blendEquation = value => {equation=value;calls.push(['equation',value]);};
  gl.blendEquationSeparate = (rgb) => equation=rgb;
  gl.blendFunc = (...args) => {factors=[args[0],args[1],args[0],args[1]];};
  gl.blendFuncSeparate = (...args) => factors=args;
  gl.texImage2D = gl.texParameteri = gl.framebufferTexture2D = gl.bufferData =
    gl.clear = gl.uniform1i = gl.uniform4fv = gl.enableVertexAttribArray =
    gl.vertexAttribPointer = gl.disableVertexAttribArray = ()=>{};
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
  gl.drawArrays = (...args) => calls.push(['draw',...args]);
  return gl;
}

test('coverage surface uses MAX union and restores the previous scene framebuffer', () => {
  const gl=fakeGl();
  const coverage=createGpuHydroCoverage();
  coverage.setContext(gl,2);
  let count=0;
  assert.equal(coverage.render({width:128,height:128,color:[0.1,0.3,0.7,0.6],paint(){count++;}}),true);
  assert.equal(coverage.render({width:128,height:128,color:[0.1,0.3,0.7,0.6],paint(){count++;}}),true);
  assert.equal(count,2);
  assert.equal(coverage.stats().renderCount,2);
  assert.equal(coverage.stats().bufferBytes,128*128*4);
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING),null);
  assert.equal(gl.getParameter(gl.BLEND_EQUATION_RGB),gl.FUNC_ADD);
  assert.ok(gl.calls.some(call=>call[0]==='equation'&&call[1]===gl.MAX));
  assert.equal(gl.calls.filter(call=>call[0]==='draw').length,2);
  coverage.dispose();
  assert.equal(coverage.stats().bufferBytes,0);
});

test('unavailable WebGL1 MAX blending and budget overflow return to direct SDF', () => {
  const gl=fakeGl(false), coverage=createGpuHydroCoverage({maxBytes:16});
  coverage.setContext(gl,1);
  let painted=false;
  assert.equal(coverage.render({width:2,height:2,color:[1,1,1,1],paint(){painted=true;}}),false);
  assert.equal(painted,false);
  assert.equal(coverage.stats().fallbackCount,1);
  const gl2=fakeGl();
  coverage.setContext(gl2,2);
  assert.equal(coverage.render({width:3,height:3,color:[1,1,1,1],paint(){painted=true;}}),false);
  assert.equal(painted,false);
  assert.equal(coverage.stats().fallbackCount,2);
});
