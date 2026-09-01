import { isRenderDevice } from './render-device.js';

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('scene cache shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'scene cache shader compile failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

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
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('scene cache program allocation failed');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'scene cache program link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return {
    program,
    position: gl.getAttribLocation(program, 'aPosition'),
    scene: gl.getUniformLocation(program, 'uScene'),
  };
}

export function createSceneColorCache() {
  let device = null;
  let gl = null;
  let framebuffer = null;
  let colorTexture = null;
  let stencilBuffer = null;
  let quadBuffer = null;
  let compositeProgram = null;
  let width = 0;
  let height = 0;
  let valid = false;
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

  function deleteTarget() {
    if (!gl || gl.isContextLost?.()) {
      framebuffer = colorTexture = stencilBuffer = null;
      width = height = 0;
      valid = false;
      return;
    }
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (colorTexture) gl.deleteTexture(colorTexture);
    if (stencilBuffer) gl.deleteRenderbuffer(stencilBuffer);
    framebuffer = colorTexture = stencilBuffer = null;
    width = height = 0;
    valid = false;
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
    if (framebuffer && width === nextWidth && height === nextHeight) return true;
    deleteTarget();
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
      width = nextWidth;
      height = nextHeight;
      valid = false;
      recreateCount += 1;
      return true;
    } catch (error) {
      failureCount += 1;
      lastFailureReason = error?.message || String(error);
      deleteTarget();
      disabled = true;
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      } catch (_) {}
      return false;
    }
  }

  function invalidate(reason = '') {
    valid = false;
    generation += 1;
    if (reason) lastInvalidationReason = String(reason);
  }

  function beginScene(pixelWidth, pixelHeight) {
    missCount += 1;
    if (!createTarget(pixelWidth, pixelHeight)) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    valid = false;
    return true;
  }

  function finishScene(targetFramebuffer = null) {
    if (!gl || !framebuffer || disabled || gl.isContextLost?.()) return false;
    valid = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    return true;
  }

  function composite(pixelWidth = width, pixelHeight = height, {
    targetFramebuffer = null,
    clearTarget = true,
  } = {}) {
    if (!gl || !valid || !colorTexture || !compositeProgram || disabled || gl.isContextLost?.()) return false;
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
      gl.bindTexture(gl.TEXTURE_2D, colorTexture);
      gl.uniform1i(compositeProgram.scene, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(compositeProgram.position);
      hitCount += 1;
      compositeCount += 1;
      return true;
    } catch (error) {
      failureCount += 1;
      lastFailureReason = error?.message || String(error);
      valid = false;
      return false;
    } finally {
      compositeMs += performance.now() - started;
    }
  }

  function handleContextLost() {
    framebuffer = colorTexture = stencilBuffer = quadBuffer = compositeProgram = null;
    width = height = 0;
    valid = false;
    disabled = false;
    device = null;
    gl = null;
  }

  function dispose() {
    deleteTarget();
    deleteProgramResources();
    device = null;
    gl = null;
    disabled = false;
    valid = false;
  }

  return Object.freeze({
    initialize,
    beginScene,
    finishScene,
    composite,
    invalidate,
    handleContextLost,
    dispose,
    isValid: () => valid && !disabled,
    isAvailable: () => !!gl && !!compositeProgram && !disabled,
    stats: () => Object.freeze({
      valid,
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
