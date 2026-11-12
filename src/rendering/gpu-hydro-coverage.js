import { linkGpuProgram } from "./gpu-shader-utils.js";
import { createRenderDevice, isRenderDevice } from "./render-device.js";

// Union coverage prevents dark joints where separately drawn river capsules overlap.
// This is a visual-only surface: hydro IDs, source geometry and picking never use it.
export function createGpuHydroCoverage({ maxBytes = 96 * 1024 * 1024 } = {}) {
  let gl = null, version = 0, maximum = null, unavailable = false;
  let device = null;
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
    gl = null; device = null; version = 0; maximum = null; unavailable = false;
  }

  function setContext(nextGl, nextVersion) {
    const nextDevice = isRenderDevice(nextGl) ? nextGl : null;
    const context = nextDevice?.gl || nextGl;
    const resolvedVersion = nextDevice?.version || nextVersion;
    if (gl === context && version === resolvedVersion && device === nextDevice) return;
    dispose();
    if (!context) return;
    gl = context; device = nextDevice; version = resolvedVersion;
    maximum = resolvedVersion === 2 ? context.MAX : context.getExtension('EXT_blend_minmax')?.MAX_EXT;
    unavailable = !Number.isFinite(maximum);
  }

  function handleContextLost() {
    // Context-owned names are invalid already; do not attempt driver deletion.
    texture = framebuffer = quad = program = null;
    gl = null; device = null; width = height = 0; maximum = null; unavailable = false;
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

  // Only the RenderDevice may snapshot the shared GL context.
  // No driver readback is permitted in a coverage pass.
  function capture() {
    if (!device?.state) throw new Error('Hydro coverage requires a RenderDevice state contract');
    return device.state.capture();
  }

  function restore(saved) {
    device?.state.restore(saved);
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
