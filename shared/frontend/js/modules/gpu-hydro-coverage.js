import { linkGpuProgram } from './gpu-shader-utils.js';

// Union coverage prevents dark joints where separately drawn river capsules overlap.
// This is a visual-only surface: hydro IDs, source geometry and picking never use it.
export function createGpuHydroCoverage({ maxBytes = 96 * 1024 * 1024 } = {}) {
  let gl = null, version = 0, maximum = null, unavailable = false;
  let texture = null, framebuffer = null, quad = null, program = null;
  let width = 0, height = 0, renderCount = 0, fallbackCount = 0;

  function release() {
    if (gl && !gl.isContextLost?.()) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (quad) gl.deleteBuffer(quad);
      if (program) gl.deleteProgram(program.program);
    }
    texture = framebuffer = quad = program = null;
    width = height = 0;
  }

  function dispose() {
    release();
    gl = null; version = 0; maximum = null; unavailable = false;
  }

  function setContext(nextGl, nextVersion) {
    if (gl === nextGl && version === nextVersion) return;
    dispose();
    if (!nextGl) return;
    gl = nextGl; version = nextVersion;
    maximum = nextVersion === 2 ? nextGl.MAX : nextGl.getExtension('EXT_blend_minmax')?.MAX_EXT;
    unavailable = !Number.isFinite(maximum);
  }

  function handleContextLost() {
    // Context-owned names are invalid already; do not attempt driver deletion.
    texture = framebuffer = quad = program = null;
    gl = null; width = height = 0; maximum = null; unavailable = false;
  }

  function ensureTarget(nextWidth, nextHeight) {
    if (!program) {
      const modern = version === 2;
      const vertex = `${modern ? '#version 300 es\n' : ''}precision highp float;
        ${modern ? 'in' : 'attribute'} vec2 aPosition;
        ${modern ? 'out' : 'varying'} vec2 vUv;
        void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }`;
      const fragment = `${modern ? '#version 300 es\n' : ''}precision highp float;
        ${modern ? 'in' : 'varying'} vec2 vUv;
        ${modern ? 'out vec4 outColor;' : ''}
        uniform sampler2D uCoverage; uniform vec4 uHydroColor;
        void main() {
          float amount = ${modern ? 'texture' : 'texture2D'}(uCoverage, vUv).a;
          if (amount <= 0.001) discard;
          ${modern ? 'outColor' : 'gl_FragColor'} = vec4(uHydroColor.rgb, uHydroColor.a * amount);
        }`;
      const handle = linkGpuProgram(gl, vertex, fragment, { label: 'hydro coverage' });
      program = { program: handle, corner: gl.getAttribLocation(handle, 'aPosition'),
        sample: gl.getUniformLocation(handle, 'uCoverage'), color: gl.getUniformLocation(handle, 'uHydroColor') };
      quad = gl.createBuffer();
      if (!quad) throw new Error('Hydro coverage quad allocation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    }
    if (!texture) {
      texture = gl.createTexture(); framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new Error('Hydro coverage framebuffer allocation failed');
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (width !== nextWidth || height !== nextHeight) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nextWidth, nextHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Hydro coverage framebuffer incomplete');
      width = nextWidth; height = nextHeight;
    }
  }

  function capture() {
    const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const activeBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.activeTexture(gl.TEXTURE3);
    const texture3 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.activeTexture(activeTexture);
    return {
      activeTexture, activeBinding, texture3,
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      readFramebuffer: version === 2 ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null,
      viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
      program: gl.getParameter(gl.CURRENT_PROGRAM),
      arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      clearColor: Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)),
      colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK)),
      blend: gl.isEnabled(gl.BLEND), stencil: gl.isEnabled(gl.STENCIL_TEST),
      scissor: gl.isEnabled(gl.SCISSOR_TEST), depth: gl.isEnabled(gl.DEPTH_TEST),
      cull: gl.isEnabled(gl.CULL_FACE),
      equations: [gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)],
      blendFactors: [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB),
        gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA)],
    };
  }

  function restore(saved) {
    const enabled = (flag, value) => value ? gl.enable(flag) : gl.disable(flag);
    gl.bindFramebuffer(gl.FRAMEBUFFER, saved.framebuffer);
    if (version === 2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.readFramebuffer);
    gl.viewport(...saved.viewport);
    gl.useProgram(saved.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, saved.arrayBuffer);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, saved.texture3);
    gl.activeTexture(saved.activeTexture);
    gl.bindTexture(gl.TEXTURE_2D, saved.activeBinding);
    enabled(gl.BLEND, saved.blend); enabled(gl.STENCIL_TEST, saved.stencil);
    enabled(gl.SCISSOR_TEST, saved.scissor); enabled(gl.DEPTH_TEST, saved.depth);
    enabled(gl.CULL_FACE, saved.cull);
    gl.blendEquationSeparate(...saved.equations);
    gl.blendFuncSeparate(...saved.blendFactors);
    gl.colorMask(...saved.colorMask);
    gl.clearColor(...saved.clearColor);
  }

  function render({ width: requestedWidth, height: requestedHeight, color, paint }) {
    const w = Math.ceil(requestedWidth), h = Math.ceil(requestedHeight);
    if (!gl || unavailable || !Number.isSafeInteger(w) || !Number.isSafeInteger(h)
      || w <= 0 || h <= 0 || w * h * 4 > maxBytes) {
      fallbackCount++;
      return false;
    }
    let saved = null;
    try {
      saved = capture();
      ensureTarget(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendEquation(maximum);
      gl.blendFunc(gl.ONE, gl.ONE);
      paint();
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.framebuffer);
      if (version === 2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.readFramebuffer);
      gl.viewport(...saved.viewport);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program.program);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(program.sample, 3);
      gl.uniform4fv(program.color, color);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(program.corner);
      gl.vertexAttribPointer(program.corner, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(program.corner);
      renderCount++;
      return true;
    } catch (error) {
      fallbackCount++;
      unavailable = true;
      // A shader/resource failure must not blank the base scene.
      console.warn('Hydro coverage unavailable; using direct SDF rendering', error);
      return false;
    } finally {
      if (saved && gl && !gl.isContextLost?.()) restore(saved);
    }
  }

  return Object.freeze({ setContext, handleContextLost, render, dispose,
    stats: () => Object.freeze({ enabled: !!gl && !unavailable, maximumBlend: maximum !== null,
      width, height, bufferBytes: width * height * 4, renderCount, fallbackCount }) });
}
