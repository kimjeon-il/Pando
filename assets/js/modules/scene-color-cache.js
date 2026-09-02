import { isRenderDevice } from './render-device.js';
import { linkGpuProgram } from './gpu-shader-utils.js';

function createCompositeProgram(device) {
  const { gl, version } = device;
  const vertexSource = version === 2 ? `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPosition;
    out vec2 vUv;
    void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.0,1.0);}`
    : `precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.0,1.0);}`;
  const fragmentSource = version === 2 ? `#version 300 es
    precision mediump float;
    uniform sampler2D uScene;
    in vec2 vUv;
    out vec4 outColor;
    void main(){outColor=texture(uScene,vUv);}`
    : `precision mediump float;
    uniform sampler2D uScene;
    varying vec2 vUv;
    void main(){gl_FragColor=texture2D(uScene,vUv);}`;
  const program = linkGpuProgram(gl, vertexSource, fragmentSource, { label: 'scene cache' });
  return {
    program,
    position: gl.getAttribLocation(program, 'aPosition'),
    scene: gl.getUniformLocation(program, 'uScene'),
  };
}

export function createSceneColorCache() {
  let device = null;
  let gl = null;
  let activeTarget = null;
  let stagingTarget = null;
  let quadBuffer = null;
  let compositeProgram = null;
  let width = 0;
  let height = 0;
  let valid = false;
  let dirty = true;
  let activeViewSignature = '';
  let stagingViewSignature = '';
  let activeProjectGeneration = 0;
  let stagingProjectGeneration = 0;
  let disabled = false;
  let generation = 0;
  let hitCount = 0;
  let missCount = 0;
  let compositeCount = 0;
  let compositeMs = 0;
  let recreateCount = 0;
  let failureCount = 0;
  let lastFailureReason = '';
  let lastInvalidationReason = '';

  function deleteTarget(target) {
    if (!target) return;
    if (!gl || gl.isContextLost?.()) return;
    if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
    if (target.colorTexture) gl.deleteTexture(target.colorTexture);
    if (target.stencilBuffer) gl.deleteRenderbuffer(target.stencilBuffer);
  }

  function clearTargets() {
    deleteTarget(activeTarget);
    deleteTarget(stagingTarget);
    activeTarget = null;
    stagingTarget = null;
    width = height = 0;
    valid = false;
    dirty = true;
    activeViewSignature = '';
    stagingViewSignature = '';
    activeProjectGeneration = 0;
    stagingProjectGeneration = 0;
  }

  function deleteProgramResources() {
    if (gl && !gl.isContextLost?.()) {
      if (quadBuffer) gl.deleteBuffer(quadBuffer);
      if (compositeProgram?.program) gl.deleteProgram(compositeProgram.program);
    }
    quadBuffer = null;
    compositeProgram = null;
  }

  function initialize(nextDevice) {
    dispose();
    if (!isRenderDevice(nextDevice)) return false;
    device = nextDevice;
    gl = nextDevice.gl;
    try {
      compositeProgram = createCompositeProgram(nextDevice);
      quadBuffer = gl.createBuffer();
      if (!quadBuffer) throw new Error('scene cache quad allocation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      disabled = false;
      generation += 1;
      return true;
    } catch (error) {
      failureCount += 1;
      lastFailureReason = error?.message || String(error);
      disabled = true;
      deleteProgramResources();
      return false;
    }
  }

  function createTarget(pixelWidth, pixelHeight) {
    if (!gl || disabled || gl.isContextLost?.()) return false;
    const nextWidth = Math.max(1, Math.round(Number(pixelWidth) || 1));
    const nextHeight = Math.max(1, Math.round(Number(pixelHeight) || 1));
    if (stagingTarget && stagingTarget.width === nextWidth && stagingTarget.height === nextHeight) return true;
    let colorTexture = null;
    let framebuffer = null;
    let stencilBuffer = null;
    try {
      colorTexture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      if (!colorTexture || !framebuffer) throw new Error('scene cache target allocation failed');
      gl.bindTexture(gl.TEXTURE_2D, colorTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nextWidth, nextHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
      if (device.capabilities.stencil) {
        stencilBuffer = gl.createRenderbuffer();
        if (!stencilBuffer) throw new Error('scene cache stencil allocation failed');
        gl.bindRenderbuffer(gl.RENDERBUFFER, stencilBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, nextWidth, nextHeight);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencilBuffer);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('scene cache framebuffer incomplete');
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      deleteTarget(stagingTarget);
      stagingTarget = { framebuffer, colorTexture, stencilBuffer, width: nextWidth, height: nextHeight };
      stagingViewSignature = '';
      recreateCount += 1;
      return true;
    } catch (error) {
      failureCount += 1;
      lastFailureReason = error?.message || String(error);
      deleteTarget({ framebuffer, colorTexture, stencilBuffer });
      // Keep an already-rendered scene usable when only the staging target
      // failed. A cache with no active target remains unavailable until the
      // next explicit initialization/invalidation.
      disabled = !activeTarget;
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      } catch (_) {}
      return false;
    }
  }

  function invalidate(reason = '') {
    dirty = true;
    generation += 1;
    if (reason) lastInvalidationReason = String(reason);
  }

  function canComposite(viewSignature = '', projectGeneration = 0) {
    // An invalidated cache may still own a perfectly good texture, but that
    // texture belongs to the previous scene revision.  Never let callers
    // composite it while a replacement is being staged; doing so leaves
    // removed geometry (notably edited borders) as framebuffer afterimages.
    return valid && !dirty && !!activeTarget && !disabled
      && activeViewSignature === String(viewSignature || '')
      && activeProjectGeneration === Number(projectGeneration || 0);
  }

  // A failed rebuild must not blank a frame that was already valid for the
  // exact same project/view. This deliberately ignores `dirty`, but still
  // requires both signatures to match so stale geometry is never reused
  // across a camera move or project reset.
  function hasActiveFor(viewSignature = '', projectGeneration = 0) {
    return valid && !!activeTarget && !disabled
      && activeViewSignature === String(viewSignature || '')
      && activeProjectGeneration === Number(projectGeneration || 0);
  }

  function reset({ dropActive = false } = {}) {
    if (dropActive) {
      clearTargets();
      disabled = false;
      generation += 1;
      return true;
    }
    invalidate('reset');
    return true;
  }

  function beginScene(pixelWidth, pixelHeight, viewSignature = '', projectGeneration = 0) {
    missCount += 1;
    if (!createTarget(pixelWidth, pixelHeight)) return false;
    stagingViewSignature = String(viewSignature || '');
    stagingProjectGeneration = Number(projectGeneration || 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, stagingTarget.framebuffer);
    gl.viewport(0, 0, stagingTarget.width, stagingTarget.height);
    return true;
  }

  function finishScene(targetFramebuffer = null, viewSignature = stagingViewSignature, projectGeneration = stagingProjectGeneration) {
    if (!gl || !stagingTarget || disabled || gl.isContextLost?.()) return false;
    const previousActive = activeTarget;
    const previousActiveSignature = activeViewSignature;
    const previousActiveProjectGeneration = activeProjectGeneration;
    activeTarget = stagingTarget;
    stagingTarget = previousActive;
    activeViewSignature = String(viewSignature || stagingViewSignature || '');
    stagingViewSignature = previousActiveSignature;
    activeProjectGeneration = Number(projectGeneration || stagingProjectGeneration || 0);
    stagingProjectGeneration = previousActive ? previousActiveProjectGeneration : 0;
    width = activeTarget.width;
    height = activeTarget.height;
    valid = true;
    dirty = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    return true;
  }

  function composite(pixelWidth = width, pixelHeight = height, {
    targetFramebuffer = null,
    clearTarget = true,
  } = {}) {
    if (!gl || !valid || !activeTarget?.colorTexture || !compositeProgram || disabled || gl.isContextLost?.()) return false;
    const started = performance.now();
    const targetWidth = Math.max(1, Math.round(Number(pixelWidth) || width || 1));
    const targetHeight = Math.max(1, Math.round(Number(pixelHeight) || height || 1));
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
      gl.viewport(0, 0, targetWidth, targetHeight);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      if (clearTarget) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.useProgram(compositeProgram.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(compositeProgram.position);
      gl.vertexAttribPointer(compositeProgram.position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, activeTarget.colorTexture);
      gl.uniform1i(compositeProgram.scene, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(compositeProgram.position);
      hitCount += 1;
      compositeCount += 1;
      return true;
    } catch (error) {
      failureCount += 1;
      lastFailureReason = error?.message || String(error);
      return false;
    } finally {
      compositeMs += performance.now() - started;
    }
  }

  function handleContextLost() {
    activeTarget = stagingTarget = null;
    quadBuffer = compositeProgram = null;
    width = height = 0;
    valid = false;
    dirty = true;
    activeViewSignature = '';
    stagingViewSignature = '';
    activeProjectGeneration = 0;
    stagingProjectGeneration = 0;
    disabled = false;
    device = null;
    gl = null;
  }

  function dispose() {
    clearTargets();
    deleteProgramResources();
    device = null;
    gl = null;
    disabled = false;
    valid = false;
    dirty = true;
  }

  return Object.freeze({
    initialize,
    beginScene,
    finishScene,
    composite,
    invalidate,
    reset,
    handleContextLost,
    dispose,
    isValid: () => valid && !!activeTarget && !disabled,
    isDirty: () => dirty,
    hasActive: () => !!activeTarget && valid && !disabled,
    hasActiveFor,
    canComposite,
    isAvailable: () => !!gl && !!compositeProgram && !disabled,
    stats: () => Object.freeze({
      valid,
      dirty,
      activeViewSignature,
      stagingViewSignature,
      activeProjectGeneration,
      stagingProjectGeneration,
      state: disabled ? 'unavailable' : (valid && !dirty ? 'valid' : (activeTarget ? 'rebuilding' : 'unavailable')),
      disabled,
      width,
      height,
      generation,
      hitCount,
      missCount,
      compositeCount,
      compositeMs,
      recreateCount,
      failureCount,
      lastFailureReason,
      lastInvalidationReason,
    }),
  });
}
