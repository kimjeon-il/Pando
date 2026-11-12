// RenderDevice-owned WebGL state ledger. Passes share one real context; they do
// not issue synchronous getParameter queries every time coverage is painted.
// The one-time admission snapshot is the fallback when a platform prevents
// instrumenting instance methods. Every tracked mutation is applied only after
// its native WebGL call returns successfully.
const owners = new WeakMap();

function readState(gl, version) {
  const parameter = name => name === undefined ? null : gl.getParameter(name);
  const activeTexture = parameter(gl.ACTIVE_TEXTURE) ?? gl.TEXTURE0 ?? gl.TEXTURE3;
  const textures = new Map([[activeTexture, parameter(gl.TEXTURE_BINDING_2D)]]);
  for (const unit of [gl.TEXTURE0, gl.TEXTURE3]) {
    if (!Number.isFinite(unit) || textures.has(unit)) continue;
    gl.activeTexture(unit);
    textures.set(unit, parameter(gl.TEXTURE_BINDING_2D));
  }
  gl.activeTexture(activeTexture);
  return {
    activeTexture, textures,
    framebuffer: parameter(gl.FRAMEBUFFER_BINDING),
    readFramebuffer: version === 2 ? parameter(gl.READ_FRAMEBUFFER_BINDING) : null,
    viewport: Array.from(parameter(gl.VIEWPORT) ?? [0, 0, gl.drawingBufferWidth || 1, gl.drawingBufferHeight || 1]),
    program: parameter(gl.CURRENT_PROGRAM),
    arrayBuffer: parameter(gl.ARRAY_BUFFER_BINDING),
    clearColor: Array.from(parameter(gl.COLOR_CLEAR_VALUE) ?? [0, 0, 0, 0]),
    colorMask: Array.from(parameter(gl.COLOR_WRITEMASK) ?? [true, true, true, true]),
    blend: gl.isEnabled(gl.BLEND),
    stencil: gl.isEnabled(gl.STENCIL_TEST),
    scissor: gl.isEnabled(gl.SCISSOR_TEST),
    depth: gl.isEnabled(gl.DEPTH_TEST),
    cull: gl.isEnabled(gl.CULL_FACE),
    equations: [parameter(gl.BLEND_EQUATION_RGB), parameter(gl.BLEND_EQUATION_ALPHA)],
    blendFactors: [
      parameter(gl.BLEND_SRC_RGB), parameter(gl.BLEND_DST_RGB),
      parameter(gl.BLEND_SRC_ALPHA), parameter(gl.BLEND_DST_ALPHA),
    ],
  };
}
function cloneState(state, gl) {
  const { textures, ...fields } = state;
  return {
    ...fields,
    texture: textures.get(state.activeTexture) ?? null,
    texture0: textures.get(gl.TEXTURE0) ?? null,
    texture3: textures.get(gl.TEXTURE3) ?? null,
    viewport: [...state.viewport], clearColor: [...state.clearColor],
    colorMask: [...state.colorMask], equations: [...state.equations],
    blendFactors: [...state.blendFactors],
  };
}

function instrument(gl, getState, markDeletedBuffer) {
  if (!Object.isExtensible(gl)) return false;
  const caps = new Map([
    [gl.BLEND, 'blend'], [gl.STENCIL_TEST, 'stencil'],
    [gl.SCISSOR_TEST, 'scissor'], [gl.DEPTH_TEST, 'depth'],
    [gl.CULL_FACE, 'cull'],
  ]);
  const update = {
    activeTexture: ([unit], state) => { state.activeTexture = unit; },
    bindTexture: ([target, texture], state) => {
      if (target === gl.TEXTURE_2D) state.textures.set(state.activeTexture, texture);
    },
    bindFramebuffer: ([target, framebuffer], state) => {
      if (target === gl.FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER) state.framebuffer = framebuffer;
      if (target === gl.FRAMEBUFFER || target === gl.READ_FRAMEBUFFER) state.readFramebuffer = framebuffer;
    },
    viewport: (args, state) => { state.viewport = [...args]; },
    useProgram: ([program], state) => { state.program = program; },
    bindBuffer: ([target, buffer], state) => { if (target === gl.ARRAY_BUFFER) state.arrayBuffer = buffer; },
    clearColor: (args, state) => { state.clearColor = [...args]; },
    colorMask: (args, state) => { state.colorMask = [...args]; },
    enable: ([cap], state) => { if (caps.has(cap)) state[caps.get(cap)] = true; },
    disable: ([cap], state) => { if (caps.has(cap)) state[caps.get(cap)] = false; },
    blendEquation: ([equation], state) => { state.equations = [equation, equation]; },
    blendEquationSeparate: (args, state) => { state.equations = [...args]; },
    blendFunc: ([src, dst], state) => { state.blendFactors = [src, dst, src, dst]; },
    blendFuncSeparate: (args, state) => { state.blendFactors = [...args]; },
    deleteTexture: ([texture], state) => {
      for (const [unit, bound] of state.textures) if (bound === texture) state.textures.set(unit, null);
    },
    deleteFramebuffer: ([framebuffer], state) => {
      if (state.framebuffer === framebuffer) state.framebuffer = null;
      if (state.readFramebuffer === framebuffer) state.readFramebuffer = null;
    },
    deleteProgram: ([program], state) => { if (state.program === program) state.program = null; },
    deleteBuffer: ([buffer], state) => {
      markDeletedBuffer(buffer);
      if (state.arrayBuffer === buffer) state.arrayBuffer = null;
    },
  };
  const previous = [];
  try {
    for (const [name, mutate] of Object.entries(update)) {
      const original = gl[name];
      if (typeof original !== 'function') continue;
      const descriptor = Object.getOwnPropertyDescriptor(gl, name);
      if (descriptor && !descriptor.configurable) throw new TypeError('Non-configurable GL method: ' + name);
      Object.defineProperty(gl, name, {
        configurable: true, writable: true,
        value: function (...args) {
          const result = original.apply(this, args);
          mutate(args, getState());
          return result;
        },
      });
      previous.push([name, descriptor]);
    }
    return true;
  } catch {
    for (const [name, descriptor] of previous.reverse()) {
      if (descriptor) Object.defineProperty(gl, name, descriptor);
      else delete gl[name];
    }
    return false; // Preserve correctness with the slower one-shot GL queries.
  }
}

/** One ledger per WebGL context. The caller's contextRevision invalidates old
 * snapshots after context loss; a restored context must be re-admitted. */
export function renderDeviceState(gl, { version = 2, contextRevision = 0 } = {}) {
  if (!gl) throw new TypeError('WebGL state requires a context');
  const previous = owners.get(gl);
  if (previous) {
    previous.admit(version, contextRevision);
    return previous;
  }
  let admittedVersion = version, admittedRevision = contextRevision;
  let state = readState(gl, version);
  let captures = 0, restores = 0;
  let deletedBuffers = new WeakSet();
  const tracked = instrument(gl, () => state, buffer => {
    if (buffer && (typeof buffer === 'object' || typeof buffer === 'function')) deletedBuffers.add(buffer);
  });

  const read = () => tracked ? state : readState(gl, admittedVersion);
  const facade = Object.freeze({
    get tracked() { return tracked; },
    get contextRevision() { return admittedRevision; },
    capture() {
      captures += 1;
      return Object.freeze({ ...cloneState(read(), gl), contextRevision: admittedRevision });
    },
    framebuffer() { return read().framebuffer; },
    // Driver-free in the ordinary tracked path: no gl.isBuffer per upload.
    // On non-instrumentable contexts the slow GL query is a correctness fallback.
    isBufferLive(buffer) {
      if (!buffer || gl.isContextLost?.()) return false;
      return tracked ? !deletedBuffers.has(buffer) : (typeof gl.isBuffer === 'function' ? gl.isBuffer(buffer) : true);
    },
    restore(saved) {
      if (!saved || saved.contextRevision !== admittedRevision)
        throw new TypeError('Stale RenderDevice state snapshot');
      if (gl.isContextLost?.()) return false;
      restores += 1;
      const enabled = (cap, value) => value ? gl.enable(cap) : gl.disable(cap);
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.framebuffer);
      if (admittedVersion === 2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.readFramebuffer);
      gl.viewport(...saved.viewport);
      gl.useProgram(saved.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, saved.arrayBuffer);
      for (const unit of [gl.TEXTURE0, gl.TEXTURE3, saved.activeTexture]) {
        if (!Number.isFinite(unit)) continue;
        gl.activeTexture(unit);
        gl.bindTexture(gl.TEXTURE_2D, unit === saved.activeTexture ? saved.texture
          : unit === gl.TEXTURE3 ? saved.texture3 : saved.texture0);
      }
      gl.activeTexture(saved.activeTexture);
      enabled(gl.BLEND, saved.blend);
      enabled(gl.STENCIL_TEST, saved.stencil);
      enabled(gl.SCISSOR_TEST, saved.scissor);
      enabled(gl.DEPTH_TEST, saved.depth);
      enabled(gl.CULL_FACE, saved.cull);
      gl.blendEquationSeparate(...saved.equations);
      gl.blendFuncSeparate(...saved.blendFactors);
      gl.colorMask(...saved.colorMask);
      gl.clearColor(...saved.clearColor);
      return true;
    },
    admit(nextVersion, nextRevision) {
      if (nextVersion === admittedVersion && nextRevision === admittedRevision) return;
      if (![1, 2].includes(nextVersion)) throw new TypeError('Unsupported WebGL state version');
      admittedVersion = nextVersion;
      admittedRevision = nextRevision;
      deletedBuffers = new WeakSet();
      state = readState(gl, admittedVersion);
    },
    stats() { return Object.freeze({ tracked, captures, restores, contextRevision: admittedRevision }); },
  });
  owners.set(gl, facade);
  return facade;
}
