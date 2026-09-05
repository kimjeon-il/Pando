import assert from 'node:assert/strict';
import test from 'node:test';

import { applyGpuBlendMode, parseGpuColor, resetGpuNormalBlend } from '../../assets/js/modules/gpu-blend-utils.js';
import { compileGpuShader, linkGpuProgram } from '../../assets/js/modules/gpu-shader-utils.js';
import { GPU_VIEW_UNIFORM_NAMES, setGpuViewUniforms } from '../../assets/js/modules/gpu-view-uniforms.js';
import { createSceneColorCache } from '../../assets/js/modules/scene-color-cache.js';

function createFakeGl({ compileOk = true, linkOk = true, validateShaderSource = false } = {}) {
  let nextId = 1;
  const calls = [];
  const shaders = new Map();
  const programs = new Map();
  const gl = {
    calls,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    BLEND: 5,
    SRC_ALPHA: 6,
    ONE_MINUS_SRC_ALPHA: 7,
    ONE: 8,
    DST_COLOR: 9,
    ARRAY_BUFFER: 10,
    STATIC_DRAW: 11,
    createShader(type) {
      const shader = { id: nextId++, type };
      shaders.set(shader, { source: '', compiled: compileOk });
      return shader;
    },
    shaderSource(shader, source) { shaders.get(shader).source = source; calls.push(['shaderSource', shader.type, source]); },
    compileShader(shader) {
      const entry = shaders.get(shader);
      if (validateShaderSource) {
        let depth = 0;
        entry.compiled = entry.compiled && [...entry.source].every(character => {
          if (character === '{') depth += 1;
          if (character === '}') depth -= 1;
          return depth >= 0;
        }) && depth === 0;
      }
      calls.push(['compileShader', shader.type]);
    },
    getShaderParameter(shader) { return shaders.get(shader).compiled; },
    getShaderInfoLog() { return 'compile failed'; },
    deleteShader(shader) { calls.push(['deleteShader', shader?.type]); shaders.delete(shader); },
    createProgram() {
      const program = { id: nextId++ };
      programs.set(program, { linked: linkOk });
      return program;
    },
    attachShader(program, shader) { calls.push(['attachShader', program.id, shader.type]); },
    linkProgram(program) { calls.push(['linkProgram', program.id]); },
    getProgramParameter(program) { return programs.get(program).linked; },
    getProgramInfoLog() { return 'link failed'; },
    deleteProgram(program) { calls.push(['deleteProgram', program?.id]); programs.delete(program); },
    getAttribLocation() { return 0; },
    getUniformLocation(_program, name) { return name; },
    createBuffer() { return { id: nextId++ }; },
    bindBuffer(...args) { calls.push(['bindBuffer', ...args]); },
    bufferData(...args) { calls.push(['bufferData', ...args]); },
    deleteBuffer(buffer) { calls.push(['deleteBuffer', buffer?.id]); },
    isContextLost() { return false; },
    enable(cap) { calls.push(['enable', cap]); },
    blendFuncSeparate(...args) { calls.push(['blendFuncSeparate', ...args]); },
    uniform2f(...args) { calls.push(['uniform2f', ...args]); },
    uniform1f(...args) { calls.push(['uniform1f', ...args]); },
    uniform3fv(...args) { calls.push(['uniform3fv', ...args]); },
    uniform1i(...args) { calls.push(['uniform1i', ...args]); },
  };
  return gl;
}

test('GPU shader helper compiles, links, and cleans temporary shaders', () => {
  const gl = createFakeGl();
  const program = linkGpuProgram(gl, 'vertex', 'fragment', { label: 'test' });
  assert.ok(program);
  assert.equal(gl.calls.filter(([name]) => name === 'deleteShader').length, 2);
  assert.equal(gl.calls.filter(([name]) => name === 'deleteProgram').length, 0);
});

test('GPU shader helper deletes failed shaders and programs', () => {
  const compileGl = createFakeGl({ compileOk: false });
  assert.throws(() => compileGpuShader(compileGl, compileGl.VERTEX_SHADER, 'bad'), /compile failed/);
  assert.equal(compileGl.calls.filter(([name]) => name === 'deleteShader').length, 1);

  const linkGl = createFakeGl({ linkOk: false });
  assert.throws(() => linkGpuProgram(linkGl, 'vertex', 'fragment'), /link failed/);
  assert.equal(linkGl.calls.filter(([name]) => name === 'deleteShader').length, 2);
  assert.equal(linkGl.calls.filter(([name]) => name === 'deleteProgram').length, 1);
});

test('SceneColorCache shaders initialize with balanced WebGL sources', () => {
  for (const version of [1, 2]) {
    const gl = createFakeGl({ validateShaderSource: true });
    const cache = createSceneColorCache();
    assert.equal(cache.initialize({ gl, version, capabilities: { stencil: false } }), true);
    assert.equal(cache.stats().disabled, false);
    cache.dispose();
  }
});

test('GPU blend helper preserves normal and multiply contracts', () => {
  assert.deepEqual(parseGpuColor('#336699'), [0x33 / 255, 0x66 / 255, 0x99 / 255]);
  assert.deepEqual(parseGpuColor('invalid'), [0, 0, 0]);
  const gl = createFakeGl();
  applyGpuBlendMode(gl, 'normal');
  applyGpuBlendMode(gl, 'multiply');
  resetGpuNormalBlend(gl);
  assert.deepEqual(gl.calls.filter(([name]) => name === 'blendFuncSeparate').map(([, ...args]) => args), [
    [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
  ]);
});

test('GPU view helper writes the shared uniforms in stable order', () => {
  const gl = createFakeGl();
  const frameContext = {
    viewport: [100, 200],
    translate: [10, 20],
    scale: 3,
    rowX: [1, 0, 0],
    rowY: [0, 1, 0],
    rowZ: [0, 0, 1],
    flatCenter: [0.1, 0.2],
    mode: 1,
  };
  const locations = new Map(GPU_VIEW_UNIFORM_NAMES.map(name => [name, name]));
  assert.equal(setGpuViewUniforms(gl, { frameContext, worldOffset: 2, getLocation: name => locations.get(name) }), true);
  assert.deepEqual(gl.calls.filter(([name]) => name.startsWith('uniform')).map(([name, location, ...values]) => [name, location, ...values]), [
    ['uniform2f', 'uViewport', 100, 200],
    ['uniform2f', 'uTranslate', 10, 20],
    ['uniform1f', 'uScale', 3],
    ['uniform3fv', 'uRowX', [1, 0, 0]],
    ['uniform3fv', 'uRowY', [0, 1, 0]],
    ['uniform3fv', 'uRowZ', [0, 0, 1]],
    ['uniform2f', 'uFlatCenter', 0.1, 0.2],
    ['uniform1f', 'uWorldOffset', 2],
    ['uniform1i', 'uMode', 1],
  ]);
});
