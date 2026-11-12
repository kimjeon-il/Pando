function detectWebGlVersion(gl) {
  if (!gl) return 0;
  const webGl2 = typeof globalThis.WebGL2RenderingContext !== 'undefined'
    && gl instanceof globalThis.WebGL2RenderingContext;
  return webGl2 ? 2 : 1;
}


/**
 * The single RenderDevice owns the GL state ledger for scoped coverage passes.
 * A snapshot is a plain JS copy: no synchronous driver readback during drawing.
 * All writes to these states must go through the context methods installed here.
 * A context revision always creates a fresh ledger; no state crosses recovery.
 */
function createGlStateContract(gl, version, contextRevision) {
  const textureUnits = new Map();
  const flags = new Map();
  // Keep lifecycle receipts for names created by this context revision.
  // A buffer deleted while an upload is in progress must never be rebound.
  const bufferLifetimes = new WeakMap();
  let bufferBindingCaptures = 0;
  let bufferBindingRestores = 0;
  let bufferBindingRejected = 0;
  const markBuffer = (buffer, alive) => {
    if (buffer && (typeof buffer === 'object' || typeof buffer === 'function'))
      bufferLifetimes.set(buffer, { contextRevision, alive });
  };
  const liveBuffer = buffer => {
    if (!buffer) return true;
    const receipt = bufferLifetimes.get(buffer);
    return !!receipt && receipt.contextRevision === contextRevision && receipt.alive === true;
  };
  const tracked = {
    framebuffer: null, readFramebuffer: null, viewport: [0, 0, gl.drawingBufferWidth || 1, gl.drawingBufferHeight || 1],
    program: null, arrayBuffer: null, activeTexture: gl.TEXTURE0,
    equations: [gl.FUNC_ADD, gl.FUNC_ADD],
    blendFactors: [gl.ONE, gl.ZERO, gl.ONE, gl.ZERO],
    colorMask: [true, true, true, true], clearColor: [0, 0, 0, 0],
  };
  // One initialization snapshot, never per-frame. It also handles a context
  // already initialized by a caller before RenderDevice was created.
  tracked.framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  tracked.readFramebuffer = version === 2 ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null;
  tracked.viewport = Array.from(gl.getParameter(gl.VIEWPORT));
  tracked.program = gl.getParameter(gl.CURRENT_PROGRAM);
  tracked.arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  // Existing allocations can predate the RenderDevice (initial scene setup).
  // The currently bound buffer is admitted exactly once for this context.
  markBuffer(tracked.arrayBuffer, true);
  tracked.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
  tracked.equations = [gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)];
  tracked.blendFactors = [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB),
    gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA)];
  tracked.colorMask = Array.from(gl.getParameter(gl.COLOR_WRITEMASK));
  tracked.clearColor = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE));
  textureUnits.set(tracked.activeTexture, gl.getParameter(gl.TEXTURE_BINDING_2D));
  for (const flag of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST])
    flags.set(flag, gl.isEnabled(flag));

  const originals = new Map();
  let active = true;
  const intercept = (method, update, { resultOnly = false } = {}) => {
    const native = gl[method].bind(gl);
    originals.set(method, gl[method]);
    Object.defineProperty(gl, method, { configurable: true, writable: true, value(...args) {
      const result = native(...args);
      if (active && !gl.isContextLost?.()) {
        if (resultOnly) update(result);
        else update(...args);
      }
      return result;
    } });
  };
  intercept('bindFramebuffer', (target, value) => {
    if (target === gl.FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER) tracked.framebuffer = value;
    if (version === 2 && (target === gl.FRAMEBUFFER || target === gl.READ_FRAMEBUFFER)) tracked.readFramebuffer = value;
  });
  intercept('viewport', (...args) => { tracked.viewport = args; });
  intercept('useProgram', value => { tracked.program = value; });
  intercept('createBuffer', buffer => { markBuffer(buffer, true); }, { resultOnly: true });
  intercept('bindBuffer', (target, value) => {
    if (target !== gl.ARRAY_BUFFER) return;
    // Buffers allocated before this ledger may first appear here; they are
    // admitted only on their first binding, never after an observed deletion.
    if (value && !bufferLifetimes.has(value)) markBuffer(value, true);
    tracked.arrayBuffer = value;
  });
  intercept('deleteBuffer', value => {
    if (!value) return;
    markBuffer(value, false);
    // Deletion also releases the WebGL ARRAY_BUFFER binding.
    if (tracked.arrayBuffer === value) tracked.arrayBuffer = null;
  });
  intercept('activeTexture', value => { tracked.activeTexture = value; });
  intercept('bindTexture', (target, value) => {
    if (target === gl.TEXTURE_2D) textureUnits.set(tracked.activeTexture, value);
  });
  intercept('enable', flag => { flags.set(flag, true); });
  intercept('disable', flag => { flags.set(flag, false); });
  intercept('blendEquation', value => { tracked.equations = [value, value]; });
  intercept('blendEquationSeparate', (rgb, alpha) => { tracked.equations = [rgb, alpha]; });
  intercept('blendFunc', (src, dst) => { tracked.blendFactors = [src, dst, src, dst]; });
  intercept('blendFuncSeparate', (...args) => { tracked.blendFactors = args; });
  intercept('colorMask', (...args) => { tracked.colorMask = args; });
  intercept('clearColor', (...args) => { tracked.clearColor = args; });

  function capture() {
    if (!active || gl.isContextLost?.()) return null;
    return {
      ...tracked,
      contextRevision,
      viewport: [...tracked.viewport], equations: [...tracked.equations],
      blendFactors: [...tracked.blendFactors], colorMask: [...tracked.colorMask],
      clearColor: [...tracked.clearColor], textures: new Map(textureUnits), flags: new Map(flags),
    };
  }
  function captureArrayBufferBinding() {
    if (!active || gl.isContextLost?.()) return null;
    bufferBindingCaptures += 1;
    return Object.freeze({ contextRevision, buffer: tracked.arrayBuffer });
  }
  function restoreArrayBufferBinding(snapshot) {
    // A stale asynchronous upload must not mutate a newly restored context.
    if (!active || gl.isContextLost?.()) return false;
    const sameGeneration = !!snapshot && snapshot.contextRevision === contextRevision;
    const canRestore = sameGeneration && liveBuffer(snapshot.buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, canRestore ? snapshot.buffer : null);
    if (canRestore) bufferBindingRestores += 1;
    else bufferBindingRejected += 1;
    return !!canRestore;
  }
  function restore(state) {
    if (!state || !active || gl.isContextLost?.() || state.contextRevision !== contextRevision) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    if (version === 2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
    gl.viewport(...state.viewport);
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, liveBuffer(state.arrayBuffer) ? state.arrayBuffer : null);
    // Restore all texture units modified by the pass, not only the active unit.
    for (const unit of new Set([...textureUnits.keys(), ...state.textures.keys()])) {
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, state.textures.get(unit) || null);
    }
    gl.activeTexture(state.activeTexture);
    for (const [flag, enabled] of state.flags) enabled ? gl.enable(flag) : gl.disable(flag);
    gl.blendEquationSeparate(...state.equations);
    gl.blendFuncSeparate(...state.blendFactors);
    gl.colorMask(...state.colorMask);
    gl.clearColor(...state.clearColor);
  }
  function dispose() {
    if (!active) return;
    active = false;
    for (const [method, original] of originals) {
      if (gl[method] !== original) Object.defineProperty(gl, method, {
        configurable: true, writable: true, value: original,
      });
    }
    originals.clear();
  }
  return Object.freeze({
    capture, restore, captureArrayBufferBinding, restoreArrayBufferBinding, dispose,
    bufferBindingStats: () => Object.freeze({
      captures: bufferBindingCaptures, restores: bufferBindingRestores,
      rejected: bufferBindingRejected, contextRevision,
    }),
  });
}

export function createRenderDevice({ gl, canvas = null, version = 0, contextRevision = 0 } = {}) {
  if (!gl) return null;
  const resolvedVersion = Number(version) || detectWebGlVersion(gl);
  if (![1, 2].includes(resolvedVersion)) return null;
  const uintIndices = resolvedVersion === 2 || !!gl.getExtension?.('OES_element_index_uint');
  const instancing = resolvedVersion === 2 || !!gl.getExtension?.('ANGLE_instanced_arrays');
  const attributes = gl.getContextAttributes?.() || {};
  const revision = Math.max(0, Number(contextRevision) || 0);
  const state = createGlStateContract(gl, resolvedVersion, revision);
  return Object.freeze({
    gl,
    canvas,
    version: resolvedVersion,
    contextRevision: revision,
    state,
    capabilities: Object.freeze({
      uintIndices,
      instancing,
      stencil: !!attributes.stencil,
      maxTextureSize: Number(gl.getParameter?.(gl.MAX_TEXTURE_SIZE) || 0),
    }),
  });
}

export function isRenderDevice(value) {
  return !!value?.gl && [1, 2].includes(Number(value.version)) && !!value.capabilities;
}
